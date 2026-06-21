import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

const VALID_SOURCES = ["google", "yelp", "trustpilot", "facebook"] as const;
export type ReviewSource = typeof VALID_SOURCES[number];

export const reviewsTable = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }).notNull(),
  reviewerName: text("reviewer_name").notNull(),
  platform: text("platform").notNull().default("google"),
  rating: integer("rating").notNull().default(5),
  reviewText: text("review_text").notNull(),
  sentiment: text("sentiment").notNull().default("neutral"),
  rootCause: text("root_cause").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  aiDraftResponse: text("ai_draft_response").notNull().default(""),
  editedResponse: text("edited_response"),
  status: text("status").notNull().default("pending"),
  // Source tracking
  source: text("source").notNull().default("google"),
  // Groq analysis tracking
  groqCallStatus: text("groq_call_status").notNull().default("pending"),
  groqErrorMessage: text("groq_error_message"),
  lastGroqAttemptAt: timestamp("last_groq_attempt_at"),
  groqRetryCount: integer("groq_retry_count").default(0),
  // Google reply tracking
  googleReplyPostedAt: timestamp("google_reply_posted_at"),
  googleReplyPostStatus: text("google_reply_post_status").default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReviewSchema = createInsertSchema(reviewsTable).omit({
  id: true,
  createdAt: true,
  sentiment: true,
  rootCause: true,
  recommendation: true,
  aiDraftResponse: true,
  status: true,
  groqCallStatus: true,
  groqErrorMessage: true,
  lastGroqAttemptAt: true,
  groqRetryCount: true,
  googleReplyPostedAt: true,
  googleReplyPostStatus: true,
});
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewsTable.$inferSelect;
