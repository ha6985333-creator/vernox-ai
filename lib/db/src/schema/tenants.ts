import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-day opening hours. `null` means the business is closed that day; otherwise
// a ["HH:MM", "HH:MM"] open/close pair (24h clock, in the tenant's timezone).
export type DayHours = [string, string] | null;
export interface BusinessHours {
  mon: DayHours;
  tue: DayHours;
  wed: DayHours;
  thu: DayHours;
  fri: DayHours;
  sat: DayHours;
  sun: DayHours;
}

export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  plan: text("plan").notNull().default("starter"),
  status: text("status").notNull().default("active"),
  // Drives the chat widget's tailored qualifying questions per industry.
  businessType: text("business_type").notNull().default("general"),
  // What the bot calls the business (falls back to a generic name if unset).
  businessName: text("business_name"),
  // Services this business actually offers — the bot only suggests these and
  // politely redirects requests for anything not on the list.
  services: text("services").array(),
  // Per-day opening hours used by the double-booking availability checker.
  businessHours: jsonb("business_hours").$type<BusinessHours>(),
  // Appointment/booking length in minutes (drives slot width + event length).
  bookingDurationMinutes: integer("booking_duration_minutes").default(60),
  // IANA timezone (e.g. "America/New_York") the business operates in.
  timezone: text("timezone"),
  // Short free-text description added as context to the AI prompt.
  businessDescription: text("business_description"),
  // Public contact details shown to customers in booking-confirmation emails.
  businessPhone: text("business_phone"),
  businessAddress: text("business_address"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
