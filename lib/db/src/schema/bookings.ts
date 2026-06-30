import { pgTable, text, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// Lightweight log of every availability check (for debugging / analytics).
// tenantId is nullable because the chat widget can run without a tenant.
export const availabilityChecksTable = pgTable("availability_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  checkedDatetime: timestamp("checked_datetime", { withTimezone: true }).notNull(),
  timezone: text("timezone"),
  isAvailable: boolean("is_available"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAvailabilityCheckSchema = createInsertSchema(availabilityChecksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAvailabilityCheck = z.infer<typeof insertAvailabilityCheckSchema>;
export type AvailabilityCheck = typeof availabilityChecksTable.$inferSelect;

// Log of every booking attempt the chat flow processes — whether the slot was
// available, what alternatives were offered, and whether a calendar event was made.
export const bookingAttemptsTable = pgTable("booking_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  requestedDatetime: timestamp("requested_datetime", { withTimezone: true }).notNull(),
  timezone: text("timezone"),
  available: boolean("available"),
  suggestedTimes: text("suggested_times").array(),
  bookingCreated: boolean("booking_created").default(false).notNull(),
  calendarEventId: text("calendar_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const insertBookingAttemptSchema = createInsertSchema(bookingAttemptsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBookingAttempt = z.infer<typeof insertBookingAttemptSchema>;
export type BookingAttempt = typeof bookingAttemptsTable.$inferSelect;
