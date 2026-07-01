import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// A tenant-initiated request to move to a higher plan. The admin actions each
// one from the dashboard; applying it updates the tenant's `plan` (which
// re-gates features immediately, since gating is read from the DB per request).
export const upgradeRequestsTable = pgTable("upgrade_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }).notNull(),
  // The tenant's plan at the time the request was made (for admin context).
  currentPlan: text("current_plan").notNull(),
  // The plan the tenant wants to move to (pro/business/enterprise).
  requestedPlan: text("requested_plan").notNull(),
  // Optional free-text note from the tenant.
  note: text("note"),
  // new → contacted → applied → declined
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUpgradeRequestSchema = createInsertSchema(upgradeRequestsTable, {
  note: (s) => s.trim().max(500).optional(),
}).omit({ id: true, createdAt: true, status: true });
export type InsertUpgradeRequest = z.infer<typeof insertUpgradeRequestSchema>;
export type UpgradeRequest = typeof upgradeRequestsTable.$inferSelect;
