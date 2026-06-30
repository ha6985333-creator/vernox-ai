import { Router, type IRouter } from "express";
import { db, notificationSettingsTable, notificationLogsTable } from "@workspace/db";
import type { NotificationSettings } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { isValidSlackWebhook, postSlack } from "../lib/notifications.js";

const router: IRouter = Router();

async function getTenantId(userId: string): Promise<string | null> {
  const user = await db.query.usersTable.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  return user?.tenantId ?? null;
}

// Effective settings used by the UI: a real row when present, otherwise the
// same defaults the notifier falls back to. slackWebhookUrl is never returned
// to the client (write-only secret); we expose slackConnected instead.
function shape(tenantId: string, s: NotificationSettings | undefined) {
  return {
    tenantId,
    notificationEmail: s?.notificationEmail ?? "",
    emailEnabled: s?.emailEnabled ?? true,
    emailOnBooking: s?.emailOnBooking ?? true,
    slackEnabled: s?.slackEnabled ?? false,
    slackConnected: !!s?.slackWebhookUrl,
    slackOnBooking: s?.slackOnBooking ?? true,
    slackHighValueOnly: s?.slackHighValueOnly ?? false,
    quietHoursStart: s?.quietHoursStart ?? "",
    quietHoursEnd: s?.quietHoursEnd ?? "",
    quietDays: s?.quietDays ?? [],
  };
}

const VALID_DAYS = new Set([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

function validHHMM(v: unknown): boolean {
  return typeof v === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

async function requireTenant(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  return getTenantId(userId);
}

// ── GET /api/notifications/settings ─────────────────────────────────────────
router.get("/notifications/settings", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await requireTenant(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const s = await db.query.notificationSettingsTable.findFirst({
    where: (t, { eq }) => eq(t.tenantId, tenantId),
  });
  res.json(shape(tenantId, s));
});

// ── PUT /api/notifications/settings ─────────────────────────────────────────
router.put("/notifications/settings", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await requireTenant(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const body = req.body as Record<string, unknown>;

  const notificationEmail =
    typeof body.notificationEmail === "string" ? body.notificationEmail.trim() : "";
  if (notificationEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(notificationEmail)) {
    res.status(400).json({ error: "Invalid notification email" });
    return;
  }

  const quietHoursStart = typeof body.quietHoursStart === "string" ? body.quietHoursStart.trim() : "";
  const quietHoursEnd = typeof body.quietHoursEnd === "string" ? body.quietHoursEnd.trim() : "";
  if (quietHoursStart && !validHHMM(quietHoursStart)) { res.status(400).json({ error: "quietHoursStart must be HH:MM" }); return; }
  if (quietHoursEnd && !validHHMM(quietHoursEnd)) { res.status(400).json({ error: "quietHoursEnd must be HH:MM" }); return; }
  if ((quietHoursStart && !quietHoursEnd) || (!quietHoursStart && quietHoursEnd)) {
    res.status(400).json({ error: "Set both quiet-hours start and end, or neither" });
    return;
  }

  let quietDays: string[] = [];
  if (body.quietDays !== undefined) {
    if (!Array.isArray(body.quietDays)) { res.status(400).json({ error: "quietDays must be an array" }); return; }
    quietDays = body.quietDays.map((d) => String(d)).filter((d) => VALID_DAYS.has(d));
  }

  const values = {
    notificationEmail: notificationEmail || null,
    emailEnabled: Boolean(body.emailEnabled ?? true),
    emailOnBooking: Boolean(body.emailOnBooking ?? true),
    slackOnBooking: Boolean(body.slackOnBooking ?? true),
    slackHighValueOnly: Boolean(body.slackHighValueOnly ?? false),
    quietHoursStart: quietHoursStart || null,
    quietHoursEnd: quietHoursEnd || null,
    quietDays: quietDays.length ? quietDays : null,
    updatedAt: new Date(),
  };

  // Note: slackEnabled + slackWebhookUrl are managed only by the connect/
  // disconnect endpoints, never overwritten here.
  await db
    .insert(notificationSettingsTable)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({ target: notificationSettingsTable.tenantId, set: values });

  const s = await db.query.notificationSettingsTable.findFirst({
    where: (t, { eq }) => eq(t.tenantId, tenantId),
  });
  res.json(shape(tenantId, s));
});

// ── POST /api/notifications/slack/connect ───────────────────────────────────
router.post("/notifications/slack/connect", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await requireTenant(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const webhookUrl = typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl.trim() : "";
  if (!isValidSlackWebhook(webhookUrl)) {
    res.status(400).json({ error: "Enter a valid Slack webhook URL (https://hooks.slack.com/...)" });
    return;
  }

  // Verify the webhook actually works before saving it.
  const test = await postSlack(webhookUrl, { text: "✅ Vernox AI is now connected to this channel." });
  if (!test.ok) {
    res.status(400).json({ error: `Slack rejected the webhook: ${test.error ?? "unknown error"}` });
    return;
  }

  const values = { slackWebhookUrl: webhookUrl, slackEnabled: true, updatedAt: new Date() };
  await db
    .insert(notificationSettingsTable)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({ target: notificationSettingsTable.tenantId, set: values });

  res.json({ slackConnected: true, slackEnabled: true });
});

// ── POST /api/notifications/slack/disconnect ────────────────────────────────
router.post("/notifications/slack/disconnect", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await requireTenant(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  await db
    .update(notificationSettingsTable)
    .set({ slackWebhookUrl: null, slackEnabled: false, updatedAt: new Date() })
    .where(eq(notificationSettingsTable.tenantId, tenantId));

  res.json({ slackConnected: false, slackEnabled: false });
});

// ── GET /api/notifications/logs ─────────────────────────────────────────────
router.get("/notifications/logs", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await requireTenant(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const logs = await db
    .select({
      id: notificationLogsTable.id,
      notificationType: notificationLogsTable.notificationType,
      channel: notificationLogsTable.channel,
      status: notificationLogsTable.status,
      reason: notificationLogsTable.reason,
      qualityScore: notificationLogsTable.qualityScore,
      sentAt: notificationLogsTable.sentAt,
      createdAt: notificationLogsTable.createdAt,
    })
    .from(notificationLogsTable)
    .where(eq(notificationLogsTable.tenantId, tenantId))
    .orderBy(sql`${notificationLogsTable.createdAt} DESC`)
    .limit(50);

  res.json(logs);
});

// ── GET /api/notifications/logs/stats ───────────────────────────────────────
router.get("/notifications/logs/stats", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await requireTenant(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const rows = await db
    .select({ status: notificationLogsTable.status, count: sql<number>`count(*)::int` })
    .from(notificationLogsTable)
    .where(eq(notificationLogsTable.tenantId, tenantId))
    .groupBy(notificationLogsTable.status);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.count);
    total += Number(r.count);
  }

  res.json({
    total,
    sent: byStatus["sent"] ?? 0,
    failed: byStatus["failed"] ?? 0,
    skipped: byStatus["skipped"] ?? 0,
  });
});

export default router;
