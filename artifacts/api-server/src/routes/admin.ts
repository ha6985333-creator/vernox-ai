import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tenantsTable, usersTable } from "@workspace/db";
import { desc, count } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";
import { createTenantWithCredentials } from "../lib/accounts.js";

const router: IRouter = Router();
router.use(requireAdmin);

router.get("/stats", async (req, res) => {
  const [totalTenants] = await db.select({ count: count() }).from(tenantsTable);
  const [activeTenants] = await db.select({ count: count() }).from(tenantsTable)
    .where((await import("drizzle-orm")).eq(tenantsTable.status, "active"));
  const [totalUsers] = await db.select({ count: count() }).from(usersTable)
    .where((await import("drizzle-orm")).eq(usersTable.role, "tenant"));

  res.json({
    totalTenants: Number(totalTenants?.count ?? 0),
    activeTenants: Number(activeTenants?.count ?? 0),
    totalUsers: Number(totalUsers?.count ?? 0),
  });
});

router.get("/tenants", async (_req, res) => {
  const tenants = await db.select().from(tenantsTable).orderBy(desc(tenantsTable.createdAt));
  res.json(tenants);
});

router.get("/tenants/:id", async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: (t, { eq }) => eq(t.id, req.params.id!) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(tenant);
});

router.post("/tenants", async (req, res) => {
  const { name, email, plan } = req.body as { name: string; email: string; plan?: string };
  if (!name || !email) { res.status(400).json({ error: "name and email are required" }); return; }

  try {
    const result = await createTenantWithCredentials({ name, email, plan });
    res.status(201).json({ tenant: result.tenant, tempPassword: result.tempPassword });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create tenant";
    res.status(400).json({ error: message });
  }
});

router.patch("/tenants/:id/status", async (req, res) => {
  const { status } = req.body as { status: string };
  const { eq } = await import("drizzle-orm");

  await db.update(tenantsTable).set({ status }).where(eq(tenantsTable.id, req.params.id!));
  res.json({ ok: true });
});

router.delete("/tenants/:id", async (req, res) => {
  const { eq } = await import("drizzle-orm");
  const id = req.params.id!;

  const tenant = await db.query.tenantsTable.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  // Deleting the tenant cascades to users, leads, follow-ups and reviews
  // (all FKs use onDelete: "cascade"), so this single statement is atomic.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  res.json({ ok: true });
});

export default router;
