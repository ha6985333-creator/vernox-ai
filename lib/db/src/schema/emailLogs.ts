import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { leadsTable } from "./leads";

// Audit trail of transactional emails sent on a tenant's behalf (currently
// booking confirmations). leadId is nullable + set-null on lead delete so the
// log survives as a delivery record even if the underlying lead is removed.
export const emailLogsTable = pgTable("email_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }).notNull(),
  leadId: uuid("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  templateType: text("template_type").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  // sent | failed | skipped
  status: text("status").notNull(),
  resendMessageId: text("resend_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogsTable.$inferSelect;
