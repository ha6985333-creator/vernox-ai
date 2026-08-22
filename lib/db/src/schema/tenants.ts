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

// Enhanced service object for services_v2
export interface Service {
  name: string;
  description?: string | null;
  priceRange?: string | null; // e.g. "$100-200", "Starting at $50", null
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
  // LEGACY: text[] column, will be replaced by services_v2 after migration.
  services: text("services").array(),
  // NEW: Enhanced services with description and price range
  services_v2: jsonb("services_v2").$type<Service[]>(),
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
  // --- NEW BUSINESS PROFILE FIELDS ---
  // Geographic area where services are provided (zip codes, cities, radius, etc.)
  serviceArea: text("service_area"),
  // Minimum advance notice required for bookings (in minutes)
  bookingLeadTimeMinutes: integer("booking_lead_time_minutes"),
  // Email address where qualified leads should be sent (separate from tenant email)
  leadHandoffEmail: text("lead_handoff_email"),
  // Brand voice preference: formal | casual | playful
  brandTone: text("brand_tone").default("casual"),
  // Phrases/words the AI should never use in responses
  phrasesToAvoid: text("phrases_to_avoid").array(),
  // Phrases/words the AI must include when relevant
  mustUsePhrases: text("must_use_phrases").array(),
  // Topics the AI should never discuss or engage with
  topicsToAvoid: text("topics_to_avoid").array(),
  // Google Calendar OAuth2 — set when the tenant connects their Google account.
  googleRefreshToken: text("google_refresh_token"),
  googleCalendarId: text("google_calendar_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;