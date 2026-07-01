import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { upgradeRequestsTable } from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { isValidPlan, normalizePlan, type PlanKey } from "../tiers.js";

const router: IRouter = Router();

const RANK: Record<PlanKey, number> = { pro: 1, business: 2, enterprise: 3 };

async function getTenantId(userId: string): Promise<string | null> {
  const user = await db.query.usersTable.findFirst({ where: (u, { eq: e }) => e(u.id, userId) });
  return user?.tenantId ?? null;
}

// ── GET /api/upgrade-request ────────────────────────────────────────────────
// Returns the tenant's most recent still-open (new/contacted) upgrade request,
// so the portal can show a "requested" state instead of the request form.
router.get("/upgrade-request", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const [pending] = await db
    .select()
    .from(upgradeRequestsTable)
    .where(and(
      eq(upgradeRequestsTable.tenantId, tenantId),
      inArray(upgradeRequestsTable.status, ["new", "contacted"]),
    ))
    .orderBy(desc(upgradeRequestsTable.createdAt))
    .limit(1);

  res.json({
    pending: pending
      ? { requestedPlan: pending.requestedPlan, status: pending.status, createdAt: pending.createdAt }
      : null,
  });
});

// ── POST /api/upgrade-request ───────────────────────────────────────────────
// A tenant asks to move to a higher plan. Captured as a record the admin
// actions from the dashboard.
router.post("/upgrade-request", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const tenant = await db.query.tenantsTable.findFirst({ where: (t, { eq: e }) => e(t.id, tenantId) });
  if (!tenant) { res.status(404).json({ error: "No tenant found" }); return; }

  const body = req.body as { requestedPlan?: unknown; note?: unknown };
  const requestedPlan = typeof body.requestedPlan === "string" ? body.requestedPlan : "";
  if (!isValidPlan(requestedPlan)) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  const currentPlan = normalizePlan(tenant.plan);
  if (RANK[requestedPlan] <= RANK[currentPlan]) {
    res.status(400).json({ error: "Requested plan must be higher than your current plan." });
    return;
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

  // Avoid piling up duplicate open requests — reuse the newest open one if any.
  const [existing] = await db
    .select()
    .from(upgradeRequestsTable)
    .where(and(
      eq(upgradeRequestsTable.tenantId, tenantId),
      inArray(upgradeRequestsTable.status, ["new", "contacted"]),
    ))
    .orderBy(desc(upgradeRequestsTable.createdAt))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(upgradeRequestsTable)
      .set({ requestedPlan, note, currentPlan, status: "new" })
      .where(eq(upgradeRequestsTable.id, existing.id))
      .returning();
    res.json({ ok: true, request: updated });
    return;
  }

  const [created] = await db
    .insert(upgradeRequestsTable)
    .values({ tenantId, currentPlan, requestedPlan, note })
    .returning();
  res.status(201).json({ ok: true, request: created });
});

export default router;
