// Google Calendar integration via Replit Connectors SDK
// Connection: conn_google-calendar_01KR7DB5RWE4MV95ET992H7GZS
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger.js";
import { BUSINESS_NAME, CALENDAR_ID } from "../config.js";
import type { BookingDetails } from "./email.js";

/**
 * Parse a human-readable datetime string like "May 15 at 2pm" into
 * ISO 8601 start/end times. Falls back to tomorrow 9am if unparseable.
 */
function parseDatetime(raw: string): { start: string; end: string } {
  const parsed = new Date(raw);
  const base = isNaN(parsed.getTime()) ? (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  })() : parsed;

  const end = new Date(base.getTime() + 60 * 60 * 1000);
  return { start: base.toISOString(), end: end.toISOString() };
}

export async function addCalendarEvent(booking: BookingDetails): Promise<void> {
  try {
    const connectors = new ReplitConnectors();
    const { start, end } = parseDatetime(booking.datetime);

    const event = {
      summary: `Appointment: ${booking.name} — ${booking.issue}`,
      description: [
        `Customer: ${booking.name}`,
        `Email: ${booking.email}`,
        `Phone: ${booking.phone}`,
        `Issue: ${booking.issue}`,
        `Booked via ${BUSINESS_NAME} chat widget`,
      ].join("\n"),
      location: booking.address,
      start: { dateTime: start, timeZone: "UTC" },
      end: { dateTime: end, timeZone: "UTC" },
      attendees: [{ email: booking.email, displayName: booking.name }],
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 30 },
        ],
      },
    };

    const response = await connectors.proxy(
      "google-calendar",
      `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }
    );

    const rawText = await response.text();

    if (!response.ok) {
      logger.error({ status: response.status, body: rawText.slice(0, 400) }, "Google Calendar API error");
      return;
    }

    let data: { id?: string; htmlLink?: string } = {};
    try { data = JSON.parse(rawText) as typeof data; } catch {
      logger.warn("Calendar response was not valid JSON");
    }

    logger.info({ eventId: data.id, link: data.htmlLink, customer: booking.name }, "Calendar event created");
  } catch (err) {
    logger.error({ err }, "Failed to create Google Calendar event");
  }
}
