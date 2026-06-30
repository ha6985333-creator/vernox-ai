import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { leadsTable } from "./leads";

// Delivery audit trail for owner booking notifications (email + slack). leadId
// is nullable + set-null on lead delete so the log survives as a delivery record.
export const notificationLogsTable = pgTable("notification_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenantsTable.id, { onDelete: "cascade" })
    .notNull(),
  leadId: uuid("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  // What triggered it — currently only "booking".
  notificationType: text("notification_type").notNull(),
  // email | slack
  channel: text("channel").notNull(),
  // sent | failed | skipped
  status: text("status").notNull(),
  // Why it was skipped/failed (e.g. "quiet hours", "low quality score").
  reason: text("reason"),
  // Snapshot of the lead's completeness score (0-100) at notify time.
  qualityScore: integer("quality_score"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNotificationLogSchema = createInsertSchema(notificationLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type NotificationLog = typeof notificationLogsTable.$inferSelect;
