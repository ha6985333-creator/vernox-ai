import { db } from "@workspace/db";
import { tenantsTable, usersTable } from "@workspace/db";
import { generateTempPassword, hashPassword } from "./auth.js";
import { sendCredentialsEmail } from "./email.js";
import { logger } from "./logger.js";

export interface CreateTenantInput {
  name: string;
  email: string;
  plan?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export async function createTenantWithCredentials(input: CreateTenantInput) {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const [tenant] = await db.insert(tenantsTable).values({
    name: input.name,
    email: input.email,
    plan: input.plan ?? "starter",
    status: "active",
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
  }).returning();

  if (!tenant) throw new Error("Failed to create tenant");

  const [user] = await db.insert(usersTable).values({
    tenantId: tenant.id,
    email: input.email,
    passwordHash,
    role: "tenant",
  }).returning();

  if (!user) throw new Error("Failed to create user");

  try {
    await sendCredentialsEmail({ name: input.name, email: input.email, password: tempPassword, plan: input.plan ?? "starter" });
  } catch (err) {
    logger.error({ err }, "Failed to send credentials email");
  }

  logger.info({ tenantId: tenant.id, email: input.email }, "Tenant created");
  return { tenant, user, tempPassword };
}

export async function ensureAdminUser() {
  const adminEmail = process.env["ADMIN_EMAIL"];
  const adminPassword = process.env["ADMIN_PASSWORD"];

  if (!adminEmail || !adminPassword) {
    logger.warn("ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed");
    return;
  }

  const existing = await db.query.usersTable.findFirst({ where: (u, { eq }) => eq(u.email, adminEmail) });
  if (existing) return;

  const passwordHash = await hashPassword(adminPassword);
  await db.insert(usersTable).values({ email: adminEmail, passwordHash, role: "admin" });
  logger.info({ email: adminEmail }, "Admin user created");
}
