import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

// Per-tenant configuration for booking notifications sent to the business owner.
// One row per tenant (unique). Rows are created lazily; absence means "use
// built-in defaults" (email on, slack off), so existing tenants keep working.
export const notificationSettingsTable = pgTable("notification_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .references(() => tenantsTable.id, { onDelete: "cascade" })
    .notNull()
    .unique(),

  // Where owner alerts go. Falls back to the tenant's account email when null.
  notificationEmail: text("notification_email"),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  emailOnBooking: boolean("email_on_booking").notNull().default(true),

  // Slack incoming webhook (https://hooks.slack.com/...). Disabled until set.
  slackEnabled: boolean("slack_enabled").notNull().default(false),
  slackWebhookUrl: text("slack_webhook_url"),
  slackOnBooking: boolean("slack_on_booking").notNull().default(true),
  // When true, only Slack-notify for high-value leads (quality score >= 75).
  slackHighValueOnly: boolean("slack_high_value_only").notNull().default(false),

  // Master switch for the automated lead follow-up sequence (email + SMS).
  // Business+ only (enforced server-side). On by default so the paid promise
  // is delivered; tenants can pause the whole automation from the portal.
  followUpSequencesEnabled: boolean("follow_up_sequences_enabled").notNull().default(true),

  // Quiet hours — "HH:MM" 24h clock, interpreted in the tenant's timezone.
  // When both set, notifications inside the window are skipped (logged).
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  // Day names (e.g. ["Saturday","Sunday"]) on which to skip notifications.
  quietDays: text("quiet_days").array(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNotificationSettingsSchema = createInsertSchema(notificationSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNotificationSettings = z.infer<typeof insertNotificationSettingsSchema>;
export type NotificationSettings = typeof notificationSettingsTable.$inferSelect;
