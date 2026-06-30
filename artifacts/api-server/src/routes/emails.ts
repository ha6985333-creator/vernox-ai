import { Router, type IRouter } from "express";
import { db, emailLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

async function getTenantId(userId: string): Promise<string | null> {
  const user = await db.query.usersTable.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  return user?.tenantId ?? null;
}

// ── GET /api/emails/stats ──────────────────────────────────────────────────────
router.get("/emails/stats", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const rows = await db
    .select({ status: emailLogsTable.status, count: sql<number>`count(*)::int` })
    .from(emailLogsTable)
    .where(eq(emailLogsTable.tenantId, tenantId))
    .groupBy(emailLogsTable.status);

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

// ── GET /api/emails ────────────────────────────────────────────────────────────
router.get("/emails", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const logs = await db
    .select({
      id: emailLogsTable.id,
      templateType: emailLogsTable.templateType,
      recipientEmail: emailLogsTable.recipientEmail,
      subject: emailLogsTable.subject,
      status: emailLogsTable.status,
      errorMessage: emailLogsTable.errorMessage,
      sentAt: emailLogsTable.sentAt,
      createdAt: emailLogsTable.createdAt,
    })
    .from(emailLogsTable)
    .where(eq(emailLogsTable.tenantId, tenantId))
    .orderBy(sql`${emailLogsTable.createdAt} DESC`)
    .limit(50);

  res.json(logs);
});

export default router;
