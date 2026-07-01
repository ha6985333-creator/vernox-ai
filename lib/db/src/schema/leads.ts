import { pgTable, text, integer, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const leadsTable = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }).notNull(),
  visitorName: text("visitor_name").notNull(),
  visitorEmail: text("visitor_email").notNull(),
  visitorPhone: text("visitor_phone").notNull(),
  visitorAddress: text("visitor_address").notNull(),
  serviceIssue: text("service_issue").notNull(),
  preferredDatetime: timestamp("preferred_datetime"),
  conversationTranscript: text("conversation_transcript"),
  status: text("status").notNull().default("new"),
  followUpCount: integer("follow_up_count").default(0),
  lastContactDate: timestamp("last_contact_date"),
  nextFollowUpDate: timestamp("next_follow_up_date"),
  // When true, the automated follow-up sequence for this lead is paused by the
  // tenant. Manual follow-ups are unaffected; the scheduler skips paused leads.
  followUpPaused: boolean("follow_up_paused").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const leadFollowUpsTable = pgTable("lead_follow_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }).notNull(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }).notNull(),
  channel: text("channel").notNull(),
  messageNumber: integer("message_number").notNull(),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  followUpCount: true,
  lastContactDate: true,
  nextFollowUpDate: true,
  conversationTranscript: true,
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;

export const insertLeadFollowUpSchema = createInsertSchema(leadFollowUpsTable).omit({
  id: true,
  createdAt: true,
  status: true,
  sentAt: true,
  openedAt: true,
  clickedAt: true,
});
export type InsertLeadFollowUp = z.infer<typeof insertLeadFollowUpSchema>;
export type LeadFollowUp = typeof leadFollowUpsTable.$inferSelect;
