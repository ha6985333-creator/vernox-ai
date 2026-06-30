import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const purchaseRequestsTable = pgTable("purchase_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  businessName: text("business_name").notNull(),
  phone: text("phone").notNull(),
  // Selected pricing tier (pro/business/enterprise). Defaults to pro for
  // legacy rows and any request that doesn't specify one.
  tier: text("tier").notNull().default("pro"),
  // Free-text services the buyer offers, captured on the Buy form.
  services: text("services").array(),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPurchaseRequestSchema = createInsertSchema(purchaseRequestsTable, {
  name: (s) => s.trim().min(1, "Name is required").max(120),
  email: (s) => s.trim().email("A valid email is required").max(200),
  businessName: (s) => s.trim().min(1, "Business name is required").max(160),
  phone: (s) => s.trim().min(5, "A valid phone number is required").max(40)
    .regex(/^[0-9+\-()\s.]+$/, "Phone number contains invalid characters"),
  tier: () => z.enum(["pro", "business", "enterprise"]).default("pro"),
  services: () =>
    z.array(z.string().trim().min(1).max(120)).max(50).optional(),
}).omit({
  id: true,
  createdAt: true,
  status: true,
});
export type InsertPurchaseRequest = z.infer<typeof insertPurchaseRequestSchema>;
export type PurchaseRequest = typeof purchaseRequestsTable.$inferSelect;
