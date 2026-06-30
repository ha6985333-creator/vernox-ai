import { db, notificationLogsTable } from "@workspace/db";
import type { NotificationSettings } from "@workspace/db";
import { logger } from "./logger.js";
import { BUSINESS_EMAIL, BUSINESS_NAME } from "../config.js";
import { FROM_EMAIL, getResend, esc, type BookingDetails } from "./email.js";

export interface OwnerTenant {
  name: string;
  email: string;
  businessName: string | null;
  timezone: string | null;
}

export interface OwnerNotifyInput {
  tenantId: string;
  tenant: OwnerTenant | null;
  booking: BookingDetails;
  leadId: string | null;
  whenText: string;
  qualityScore: number;
}

type NotifyStatus = "sent" | "failed" | "skipped";

export interface OwnerNotifyResult {
  /** At least one enabled channel was attempted (i.e. not disabled/quiet-skipped). */
  attempted: boolean;
  /** At least one channel was delivered successfully. */
  anySent: boolean;
  /** At least one channel attempt failed (a real delivery failure worth alerting on). */
  anyFailed: boolean;
  /** Set when ALL channels were suppressed by quiet hours/days. */
  quietReason: string | null;
}

/**
 * Simple completeness-based lead quality score (0-100). Each of the four key
 * pieces of captured info is worth 25 points. Not a predictive model — just a
 * signal of how actionable the lead is for the business owner.
 */
export function scoreLead(booking: BookingDetails): number {
  let score = 0;
  if (booking.phone?.trim()) score += 25;
  if (booking.email?.trim()) score += 25;
  if (booking.issue?.trim()) score += 25;
  if (booking.datetime?.trim()) score += 25;
  return score;
}

function qualityLabel(score: number): { text: string; color: string } {
  if (score >= 75) return { text: "High", color: "#16a34a" };
  if (score >= 50) return { text: "Medium", color: "#d97706" };
  return { text: "Low", color: "#dc2626" };
}

/** Only accept Slack incoming-webhook URLs — guards against SSRF to arbitrary hosts. */
export function isValidSlackWebhook(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

async function logNotification(row: {
  tenantId: string;
  leadId: string | null;
  channel: "email" | "slack";
  status: NotifyStatus;
  reason?: string | null;
  qualityScore?: number | null;
}): Promise<void> {
  try {
    await db.insert(notificationLogsTable).values({
      tenantId: row.tenantId,
      leadId: row.leadId,
      notificationType: "booking",
      channel: row.channel,
      status: row.status,
      reason: row.reason ?? null,
      qualityScore: row.qualityScore ?? null,
      sentAt: row.status === "sent" ? new Date() : null,
    });
  } catch (err) {
    logger.error({ err, tenantId: row.tenantId }, "Failed to write notification_logs row");
  }
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** True when `now` (minutes) falls inside [start,end), supporting overnight windows. */
function inWindow(now: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // overnight (e.g. 22:00 → 07:00)
}

/** Decide whether to skip all notifications based on quiet hours/days (tenant tz). */
function quietSkip(settings: NotificationSettings, tz: string | null): string | null {
  const zone = tz || "UTC";
  const now = new Date();

  if (settings.quietDays && settings.quietDays.length > 0) {
    const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(now);
    if (settings.quietDays.includes(dayName)) return `quiet day (${dayName})`;
  }

  if (settings.quietHoursStart && settings.quietHoursEnd) {
    const start = toMinutes(settings.quietHoursStart);
    const end = toMinutes(settings.quietHoursEnd);
    const nowHHMM = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone,
    }).format(now);
    const cur = toMinutes(nowHHMM);
    if (start !== null && end !== null && cur !== null && inWindow(cur, start, end)) {
      return "quiet hours";
    }
  }

  return null;
}

/**
 * Notify the business owner of a new booking across the channels they have
 * enabled (email + Slack), respecting per-tenant settings and quiet hours.
 * Every outcome is logged to notification_logs. Never throws — the booking flow
 * must not break if a notification fails.
 */
export async function notifyBusinessOwner(input: OwnerNotifyInput): Promise<OwnerNotifyResult> {
  const { tenantId, tenant, booking, leadId, whenText, qualityScore } = input;
  const result: OwnerNotifyResult = { attempted: false, anySent: false, anyFailed: false, quietReason: null };

  let settings: NotificationSettings | undefined;
  try {
    settings = await db.query.notificationSettingsTable.findFirst({
      where: (s, { eq }) => eq(s.tenantId, tenantId),
    });
  } catch (err) {
    logger.error({ err, tenantId }, "Failed to load notification settings");
  }

  // Effective config — defaults apply when a tenant has no settings row yet.
  const emailEnabled = settings?.emailEnabled ?? true;
  const emailOnBooking = settings?.emailOnBooking ?? true;
  const slackEnabled = settings?.slackEnabled ?? false;
  const slackOnBooking = settings?.slackOnBooking ?? true;
  const slackHighValueOnly = settings?.slackHighValueOnly ?? false;
  const slackWebhookUrl = settings?.slackWebhookUrl ?? null;
  const tz = tenant?.timezone ?? null;

  const wantEmail = emailEnabled && emailOnBooking;
  const wantSlack = slackEnabled && slackOnBooking && !!slackWebhookUrl;

  // Quiet hours/days apply to every channel.
  if (settings) {
    const reason = quietSkip(settings, tz);
    if (reason) {
      if (wantEmail) await logNotification({ tenantId, leadId, channel: "email", status: "skipped", reason, qualityScore });
      if (wantSlack) await logNotification({ tenantId, leadId, channel: "slack", status: "skipped", reason, qualityScore });
      logger.info({ tenantId, reason }, "Owner notification skipped (quiet period)");
      result.quietReason = reason;
      return result;
    }
  }

  const tally = (status: NotifyStatus) => {
    if (status === "sent") {
      result.attempted = true;
      result.anySent = true;
    } else if (status === "failed") {
      result.attempted = true;
      result.anyFailed = true;
    }
  };

  if (wantEmail) {
    tally(await sendOwnerEmail(input, settings));
  }

  if (wantSlack) {
    if (slackHighValueOnly && qualityScore < 75) {
      await logNotification({ tenantId, leadId, channel: "slack", status: "skipped", reason: "low quality score", qualityScore });
    } else {
      tally(await sendSlack(slackWebhookUrl!, input));
    }
  }

  return result;
}

async function sendOwnerEmail(input: OwnerNotifyInput, settings: NotificationSettings | undefined): Promise<NotifyStatus> {
  const { tenantId, tenant, booking, leadId, whenText, qualityScore } = input;
  const to = settings?.notificationEmail?.trim() || tenant?.email || BUSINESS_EMAIL;

  if (!to) {
    await logNotification({ tenantId, leadId, channel: "email", status: "skipped", reason: "no recipient configured", qualityScore });
    return "skipped";
  }

  const resend = getResend();
  if (!resend) {
    await logNotification({ tenantId, leadId, channel: "email", status: "skipped", reason: "RESEND_API_KEY not set", qualityScore });
    return "skipped";
  }

  const bizName = tenant?.businessName || BUSINESS_NAME;
  const q = qualityLabel(qualityScore);
  const subject = `🔔 New Booking: ${booking.name} — ${whenText}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
          <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
            <h1 style="color:#fff;margin:0;font-size:1.5rem;">🔔 New Appointment Booking</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:0.9rem;">${esc(bizName)}</p>
          </div>
          <p style="color:#374151;">A new appointment was booked via your chat widget.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;">
            <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%;">Customer</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${esc(booking.name)}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Service</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${esc(booking.issue)}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Date &amp; Time</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${esc(whenText)}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${esc(booking.phone)}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Customer Email</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${esc(booking.email)}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Lead Quality</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;"><span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${q.color};color:#fff;font-weight:600;font-size:0.85rem;">${q.text} · ${qualityScore}/100</span></td></tr>
          </table>
          <p style="color:#6b7280;font-size:0.85rem;">This event has been added to your Google Calendar automatically.</p>
          <p style="color:#6b7280;font-size:0.85rem;">— ${esc(bizName)} chat widget</p>
        </div>`,
    });

    if (error) {
      await logNotification({ tenantId, leadId, channel: "email", status: "failed", reason: String(error.message ?? error), qualityScore });
      logger.error({ error, tenantId }, "Owner notification email failed");
      return "failed";
    }
    await logNotification({ tenantId, leadId, channel: "email", status: "sent", qualityScore });
    logger.info({ tenantId, to }, "Owner notification email sent");
    return "sent";
  } catch (err) {
    await logNotification({ tenantId, leadId, channel: "email", status: "failed", reason: (err as Error).message, qualityScore });
    logger.error({ err, tenantId }, "Owner notification email threw");
    return "failed";
  }
}

/** POST a payload to a Slack incoming webhook. Returns ok/error, never throws. */
export async function postSlack(webhookUrl: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!isValidSlackWebhook(webhookUrl)) return { ok: false, error: "Invalid Slack webhook URL" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Slack responded ${res.status} ${body}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function sendSlack(webhookUrl: string, input: OwnerNotifyInput): Promise<NotifyStatus> {
  const { tenantId, tenant, booking, leadId, whenText, qualityScore } = input;
  const q = qualityLabel(qualityScore);
  const bizName = tenant?.businessName || BUSINESS_NAME;

  const payload = {
    text: `🔔 New Booking: ${booking.name}`,
    attachments: [
      {
        color: q.color,
        title: `New appointment for ${bizName}`,
        fields: [
          { title: "Customer", value: booking.name, short: true },
          { title: "Phone", value: booking.phone, short: true },
          { title: "Service", value: booking.issue, short: false },
          { title: "Appointment", value: whenText, short: false },
          { title: "Email", value: booking.email, short: true },
          { title: "Lead Quality", value: `${q.text} · ${qualityScore}/100`, short: true },
        ],
      },
    ],
  };

  const result = await postSlack(webhookUrl, payload);
  if (result.ok) {
    await logNotification({ tenantId, leadId, channel: "slack", status: "sent", qualityScore });
    logger.info({ tenantId }, "Owner notification Slack sent");
    return "sent";
  }
  await logNotification({ tenantId, leadId, channel: "slack", status: "failed", reason: result.error, qualityScore });
  logger.error({ tenantId, error: result.error }, "Owner notification Slack failed");
  return "failed";
}
