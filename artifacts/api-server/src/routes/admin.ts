import { Router, type IRouter } from "express";
import { db, type BusinessHours } from "@workspace/db";
import { tenantsTable, usersTable, purchaseRequestsTable } from "@workspace/db";
import { desc, count, eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";
import { createTenantWithCredentials } from "../lib/accounts.js";
import { BUSINESS_TYPES, isValidBusinessType } from "../businessTypes.js";
import { normalizeBusinessHours } from "../lib/businessHours.js";

const router: IRouter = Router();
router.use(requireAdmin);

interface TenantSettings {
  businessType?: string;
  businessName?: string;
  services?: string[];
  businessHours?: BusinessHours | null;
  bookingDurationMinutes?: number;
  timezone?: string;
  businessDescription?: string;
}

/**
 * Validate the optional per-tenant business fields shared by create + update.
 * Returns the cleaned settings or throws an Error with a user-facing message.
 * Only keys present in the body are returned (so PATCH does partial updates).
 */
function parseTenantSettings(body: Record<string, unknown>): TenantSettings {
  const out: TenantSettings = {};

  if (body.businessType !== undefined) {
    if (typeof body.businessType !== "string" || !isValidBusinessType(body.businessType)) {
      throw new Error("Invalid business type");
    }
    out.businessType = body.businessType;
  }

  if (body.businessName !== undefined) {
    out.businessName = String(body.businessName ?? "").trim();
  }

  if (body.services !== undefined) {
    if (!Array.isArray(body.services)) throw new Error("services must be an array of strings");
    const cleaned = body.services
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0)
      .slice(0, 50);
    if (cleaned.some((s) => s.length > 100)) throw new Error("Each service must be 100 characters or fewer");
    out.services = cleaned;
  }

  if (body.businessHours !== undefined) {
    out.businessHours = normalizeBusinessHours(body.businessHours); // throws on bad input
  }

  if (body.bookingDurationMinutes !== undefined) {
    const d = Number(body.bookingDurationMinutes);
    if (!Number.isFinite(d) || d <= 0 || d > 480) {
      throw new Error("bookingDurationMinutes must be a positive number up to 480");
    }
    out.bookingDurationMinutes = Math.round(d);
  }

  if (body.timezone !== undefined) {
    const tz = String(body.timezone ?? "").trim();
    if (tz) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
      } catch {
        throw new Error("Invalid timezone");
      }
    }
    out.timezone = tz;
  }

  if (body.businessDescription !== undefined) {
    const desc = String(body.businessDescription ?? "").trim();
    if (desc.length > 500) throw new Error("businessDescription must be 500 characters or fewer");
    out.businessDescription = desc;
  }

  return out;
}

router.get("/business-types", (_req, res) => {
  res.json(BUSINESS_TYPES.map((t) => ({ value: t.value, label: t.label })));
});

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

router.get("/purchase-requests", async (_req, res) => {
  const requests = await db.select().from(purchaseRequestsTable).orderBy(desc(purchaseRequestsTable.createdAt));
  res.json(requests);
});

router.patch("/purchase-requests/:id/status", async (req, res) => {
  const { eq } = await import("drizzle-orm");
  const { status } = req.body as { status?: string };
  const allowed = ["new", "contacted", "paid", "closed"];
  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    return;
  }
  await db.update(purchaseRequestsTable).set({ status }).where(eq(purchaseRequestsTable.id, req.params.id!));
  res.json({ ok: true });
});

router.get("/tenants/:id", async (req, res) => {
  const tenant = await db.query.tenantsTable.findFirst({ where: (t, { eq }) => eq(t.id, req.params.id!) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(tenant);
});

router.post("/tenants", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const plan = typeof body.plan === "string" ? body.plan : undefined;
  if (!name || !email) { res.status(400).json({ error: "name and email are required" }); return; }

  let settings: TenantSettings;
  try {
    settings = parseTenantSettings(body);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid tenant settings" });
    return;
  }

  try {
    const result = await createTenantWithCredentials({ name, email, plan, ...settings });
    res.status(201).json({ tenant: result.tenant, tempPassword: result.tempPassword });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create tenant";
    res.status(400).json({ error: message });
  }
});

router.patch("/tenants/:id", async (req, res) => {
  const id = req.params.id!;
  const existing = await db.query.tenantsTable.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
  if (!existing) { res.status(404).json({ error: "Tenant not found" }); return; }

  let settings: TenantSettings;
  try {
    settings = parseTenantSettings(req.body as Record<string, unknown>);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid tenant settings" });
    return;
  }

  const updates: Partial<typeof tenantsTable.$inferInsert> = {};
  if (settings.businessType !== undefined) updates.businessType = settings.businessType;
  if (settings.businessName !== undefined) updates.businessName = settings.businessName || null;
  if (settings.services !== undefined) updates.services = settings.services.length ? settings.services : null;
  if (settings.businessHours !== undefined) updates.businessHours = settings.businessHours;
  if (settings.bookingDurationMinutes !== undefined) updates.bookingDurationMinutes = settings.bookingDurationMinutes;
  if (settings.timezone !== undefined) updates.timezone = settings.timezone || null;
  if (settings.businessDescription !== undefined) updates.businessDescription = settings.businessDescription || null;

  if (Object.keys(updates).length === 0) { res.json({ tenant: existing }); return; }

  const [tenant] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, id)).returning();
  res.json({ tenant });
});

router.patch("/tenants/:id/status", async (req, res) => {
  const { status } = req.body as { status: string };
  await db.update(tenantsTable).set({ status }).where(eq(tenantsTable.id, req.params.id!));
  res.json({ ok: true });
});

router.delete("/tenants/:id", async (req, res) => {
  const id = req.params.id!;

  const tenant = await db.query.tenantsTable.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  // Deleting the tenant cascades to users, leads, follow-ups and reviews
  // (all FKs use onDelete: "cascade"), so this single statement is atomic.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  res.json({ ok: true });
});

export default router;
