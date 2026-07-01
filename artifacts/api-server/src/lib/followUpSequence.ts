import { db, leadsTable, leadFollowUpsTable } from "@workspace/db";
import type { Lead } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendLeadFollowUp } from "./email.js";
import { sendSms, isSmsConfigured } from "./sms.js";
import { hasFeature } from "../tiers.js";
import { BUSINESS_NAME } from "../config.js";

// ─────────────────────────────────────────────────────────────
//  AUTOMATED LEAD FOLLOW-UP SEQUENCE
//
//  After a lead is captured the scheduler drips a fixed, multi-step
//  nurture sequence of email + SMS messages over several days. This
//  delivers the "SMS follow-up sequences" / "Email nurture sequences"
//  promise on the Business tier — and is gated to Business+ everywhere
//  (server-side plan check on every tick, never just hidden in the UI).
//
//  State lives on the lead row (no new table needed):
//    followUpCount     — steps already sent (0..STEP_COUNT)
//    nextFollowUpDate  — when the next step is due (null = sequence done)
//    lastContactDate   — last send time (min-gap guard vs manual sends)
//    followUpPaused    — tenant paused THIS lead's sequence
//  Plus notification_settings.followUpSequencesEnabled — tenant master switch.
//
//  A sequence stops when the lead converts or unsubscribes (status check),
//  when the tenant pauses it, when the plan is downgraded below Business,
//  or when all steps have been sent.
// ─────────────────────────────────────────────────────────────

export type FollowUpChannel = "email" | "sms";

export interface SequenceStep {
  /** 1-based step number; also selects the email/SMS template. */
  step: number;
  /** Gap (hours) from the PREVIOUS send (or from capture, for step 1). */
  delayHours: number;
  channels: FollowUpChannel[];
}

// The drip cadence. Step 1's delay must match captureLead()'s initial
// nextFollowUpDate offset so the first touch lands when expected.
export const FOLLOW_UP_SEQUENCE: SequenceStep[] = [
  { step: 1, delayHours: 2, channels: ["email"] },
  { step: 2, delayHours: 24, channels: ["email", "sms"] },
  { step: 3, delayHours: 72, channels: ["sms"] },
];

export const STEP_COUNT = FOLLOW_UP_SEQUENCE.length;

/** Initial offset (ms) used when scheduling the first follow-up at capture. */
export const FIRST_STEP_DELAY_MS = FOLLOW_UP_SEQUENCE[0]!.delayHours * 60 * 60 * 1000;

// Don't fire an automated step within this window of the last contact — protects
// against a rapid double-send when a manual follow-up was just triggered.
const MIN_GAP_MS = 60 * 60 * 1000; // 1 hour

// SMS bodies, one per step (index = step - 1). Kept short (<=160 chars) and
// include a STOP opt-out for basic compliance.
const SMS_TEMPLATES: Array<(name: string, issue: string, biz: string) => string> = [
  (name, issue, biz) =>
    `Hi ${name}, it's ${biz}. Following up on your ${issue} enquiry — happy to help whenever you're ready. Reply to chat or STOP to opt out.`,
  (name, _issue, biz) =>
    `Hi ${name}, a quick reminder from ${biz} — we still have availability this week. Reply to book a time that suits you, or STOP to opt out.`,
  (name, _issue, biz) =>
    `Hi ${name}, last note from ${biz} — we're here whenever you're ready. Just reply to get started. Reply STOP to opt out.`,
];

function smsBody(step: number, lead: Lead, businessName: string): string {
  const tmpl = SMS_TEMPLATES[step - 1];
  const issue = (lead.serviceIssue || "your enquiry").trim();
  return tmpl
    ? tmpl(lead.visitorName, issue, businessName)
    : `Hi ${lead.visitorName}, following up from ${businessName}. Reply STOP to opt out.`;
}

/** Record one attempted channel send in lead_follow_ups. Never throws. */
async function logFollowUp(row: {
  leadId: string;
  tenantId: string;
  channel: FollowUpChannel;
  messageNumber: number;
  status: "sent" | "failed" | "skipped";
}): Promise<void> {
  try {
    await db.insert(leadFollowUpsTable).values({
      leadId: row.leadId,
      tenantId: row.tenantId,
      channel: row.channel,
      messageNumber: row.messageNumber,
      status: row.status,
      sentAt: row.status === "sent" ? new Date() : null,
    });
  } catch (err) {
    logger.error({ err, leadId: row.leadId }, "Failed to write lead_follow_ups row");
  }
}

interface DueLeadRow {
  lead: Lead;
  plan: string | null;
  businessName: string | null;
  sequencesEnabled: boolean;
}

/**
 * Load leads whose next follow-up is due, joined with their tenant's plan +
 * business name + the master follow-up toggle. Only statuses that should still
 * be nurtured are considered ("new"/"contacted").
 */
async function loadDueLeads(now: Date): Promise<DueLeadRow[]> {
  const rows = await db.query.leadsTable.findMany({
    where: (l, { and, eq, lte, isNotNull, inArray }) =>
      and(
        isNotNull(l.nextFollowUpDate),
        lte(l.nextFollowUpDate, now),
        eq(l.followUpPaused, false),
        inArray(l.status, ["new", "contacted"]),
      ),
    limit: 200,
  });

  const due: DueLeadRow[] = [];
  for (const lead of rows) {
    if ((lead.followUpCount ?? 0) >= STEP_COUNT) continue;
    const tenant = await db.query.tenantsTable.findFirst({
      where: (t, { eq }) => eq(t.id, lead.tenantId),
    });
    if (!tenant) continue;
    let sequencesEnabled = true;
    try {
      const settings = await db.query.notificationSettingsTable.findFirst({
        where: (s, { eq }) => eq(s.tenantId, lead.tenantId),
      });
      sequencesEnabled = settings?.followUpSequencesEnabled ?? true;
    } catch (err) {
      logger.error({ err, tenantId: lead.tenantId }, "Failed to load follow-up settings");
    }
    due.push({
      lead,
      plan: tenant.plan ?? null,
      businessName: tenant.businessName ?? null,
      sequencesEnabled,
    });
  }
  return due;
}

/** Send every channel for one step. Returns whether at least one channel sent. */
async function runStep(row: DueLeadRow, step: SequenceStep): Promise<boolean> {
  const { lead } = row;
  const biz = row.businessName?.trim() || BUSINESS_NAME;
  let anySent = false;

  for (const channel of step.channels) {
    if (channel === "email") {
      try {
        await sendLeadFollowUp(lead, step.step, biz);
        anySent = true;
        await logFollowUp({ leadId: lead.id, tenantId: lead.tenantId, channel, messageNumber: step.step, status: "sent" });
      } catch (err) {
        logger.error({ err, leadId: lead.id, step: step.step }, "Sequence email step failed");
        await logFollowUp({ leadId: lead.id, tenantId: lead.tenantId, channel, messageNumber: step.step, status: "failed" });
      }
    } else if (channel === "sms") {
      const result = await sendSms(lead.visitorPhone, smsBody(step.step, lead, biz));
      if (result.success) {
        anySent = true;
        await logFollowUp({ leadId: lead.id, tenantId: lead.tenantId, channel, messageNumber: step.step, status: "sent" });
      } else {
        await logFollowUp({
          leadId: lead.id,
          tenantId: lead.tenantId,
          channel,
          messageNumber: step.step,
          status: result.skipped ? "skipped" : "failed",
        });
      }
    }
  }
  return anySent;
}

/**
 * Advance a lead one step: record the send, bump the counter, schedule the next
 * step (or finish the sequence), and move "new" leads to "contacted".
 */
async function advanceLead(row: DueLeadRow, sentStep: number): Promise<void> {
  const now = new Date();
  const nextStep = FOLLOW_UP_SEQUENCE[sentStep]; // sentStep is 1-based; index sentStep = next
  const nextFollowUpDate = nextStep ? new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000) : null;

  await db
    .update(leadsTable)
    .set({
      followUpCount: sentStep,
      lastContactDate: now,
      nextFollowUpDate,
      status: row.lead.status === "new" ? "contacted" : row.lead.status,
      updatedAt: now,
    })
    .where(eq(leadsTable.id, row.lead.id));
}

/**
 * One scheduler tick: find due leads, gate each by plan + master toggle + min-gap,
 * send the next step, and advance state. Never throws (logs + continues).
 */
export async function processDueFollowUps(now: Date = new Date()): Promise<{ processed: number; sent: number }> {
  let processed = 0;
  let sent = 0;

  let due: DueLeadRow[] = [];
  try {
    due = await loadDueLeads(now);
  } catch (err) {
    logger.error({ err }, "Follow-up scheduler: failed to load due leads");
    return { processed, sent };
  }

  for (const row of due) {
    const { lead } = row;

    // Business+ gate — enforced here, not just in the UI. A downgraded tenant
    // simply stops receiving new steps (existing state is left untouched).
    if (!hasFeature(row.plan, "follow_up_sequences")) continue;
    if (!row.sequencesEnabled) continue;

    // Min-gap guard vs a manual follow-up that just fired.
    if (lead.lastContactDate && now.getTime() - new Date(lead.lastContactDate).getTime() < MIN_GAP_MS) {
      continue;
    }

    const nextStepNumber = (lead.followUpCount ?? 0) + 1;
    const step = FOLLOW_UP_SEQUENCE[nextStepNumber - 1];
    if (!step) continue;

    processed += 1;
    try {
      const anySent = await runStep(row, step);
      if (anySent) sent += 1;
      // Advance regardless of per-channel failures so a permanently failing
      // channel (e.g. no SMS creds) doesn't wedge the lead on the same step.
      await advanceLead(row, nextStepNumber);
    } catch (err) {
      logger.error({ err, leadId: lead.id }, "Follow-up scheduler: step failed");
    }
  }

  if (processed > 0) {
    logger.info({ processed, sent, smsConfigured: isSmsConfigured() }, "Follow-up sequence tick complete");
  }
  return { processed, sent };
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/** Start the periodic follow-up scheduler. Idempotent. */
export function startFollowUpScheduler(intervalMs = 5 * 60 * 1000): void {
  if (schedulerHandle) return;
  logger.info({ intervalMs, smsConfigured: isSmsConfigured() }, "Starting lead follow-up scheduler");
  schedulerHandle = setInterval(() => {
    processDueFollowUps().catch((err) => logger.error({ err }, "Follow-up scheduler tick threw"));
  }, intervalMs);
  // Don't keep the event loop alive solely for the scheduler.
  if (typeof schedulerHandle.unref === "function") schedulerHandle.unref();
}

export function stopFollowUpScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
