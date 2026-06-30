// Google Calendar integration via Replit Connectors SDK
// Connection: conn_google-calendar_01KR7DB5RWE4MV95ET992H7GZS
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger.js";
import { BUSINESS_NAME, CALENDAR_ID } from "../config.js";
import type { BookingDetails } from "./email.js";

const SLOT_DURATION_MINUTES = 60;
const BUSINESS_START_HOUR = 9; // 9 AM
const BUSINESS_END_HOUR = 17; // 5 PM
const SEARCH_WINDOW_DAYS = 30;
const SLOT_STEP_MINUTES = 30;
const WEEKEND_DAYS = new Set(["Sat", "Sun"]);

// The timezone the server resolves business hours against when none is supplied.
export const SERVER_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface BusyInterval {
  start: number; // epoch ms
  end: number; // epoch ms
}

/**
 * Parse a human-readable datetime string like "May 15 at 2pm" into
 * ISO 8601 start/end times. Falls back to tomorrow 9am if unparseable.
 */
function parseDatetime(raw: string): { start: string; end: string } {
  const parsed = new Date(raw);
  const base = isNaN(parsed.getTime())
    ? (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      })()
    : parsed;

  const end = new Date(base.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);
  return { start: base.toISOString(), end: end.toISOString() };
}

// ── Availability primitives ───────────────────────────────────────────────────

/**
 * Query Google Calendar's freeBusy API for busy intervals on CALENDAR_ID within
 * the given window. A single freeBusy call is fast (one round-trip) — keeping us
 * well under the 500ms target even when scanning a 30-day window.
 */
async function fetchBusyIntervals(
  timeMinISO: string,
  timeMaxISO: string,
): Promise<BusyInterval[]> {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy(
    "google-calendar",
    "/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        items: [{ id: CALENDAR_ID }],
      }),
    },
  );

  const rawText = await response.text();
  if (!response.ok) {
    logger.error(
      { status: response.status, body: rawText.slice(0, 400) },
      "Google Calendar freeBusy error",
    );
    throw new Error(`freeBusy request failed with status ${response.status}`);
  }

  let data: {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  } = {};
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error("freeBusy response was not valid JSON");
  }

  const busy = data.calendars?.[CALENDAR_ID]?.busy ?? [];
  return busy
    .map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }))
    .filter((b) => !isNaN(b.start) && !isNaN(b.end));
}

function overlapsBusy(
  startMs: number,
  endMs: number,
  intervals: BusyInterval[],
): boolean {
  return intervals.some((iv) => startMs < iv.end && endMs > iv.start);
}

/** Weekday + local hour/minute of an instant, evaluated in a target timezone. */
function zonedParts(
  ms: number,
  timeZone: string,
): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // hour12:false can emit "24" at midnight
  return { weekday: get("weekday"), hour, minute: parseInt(get("minute"), 10) };
}

/** True when the whole slot falls on a weekday within business hours (in tz). */
function isWithinBusinessHours(
  startMs: number,
  durationMinutes: number,
  timeZone: string,
): boolean {
  const { weekday, hour, minute } = zonedParts(startMs, timeZone);
  if (WEEKEND_DAYS.has(weekday)) return false;
  const startDecimal = hour + minute / 60;
  const endDecimal = startDecimal + durationMinutes / 60;
  return startDecimal >= BUSINESS_START_HOUR && endDecimal <= BUSINESS_END_HOUR;
}

/**
 * Is the requested slot free? Checks a single duration-long window against the
 * calendar's busy intervals. Throws if the Calendar API can't be reached so the
 * caller can decide how to handle the outage.
 */
export async function checkAvailability(
  requestedISO: string,
  durationMinutes = SLOT_DURATION_MINUTES,
): Promise<boolean> {
  const start = new Date(requestedISO).getTime();
  if (isNaN(start)) throw new Error("Invalid requested datetime");
  const end = start + durationMinutes * 60_000;
  const busy = await fetchBusyIntervals(
    new Date(start).toISOString(),
    new Date(end).toISOString(),
  );
  return !overlapsBusy(start, end, busy);
}

/**
 * Find the next `count` open slots starting after `fromISO`, scanning up to 30
 * days. Respects Mon–Fri business hours (9am–5pm) in the given timezone and
 * skips intervals that overlap existing calendar events. Uses one freeBusy call.
 */
export async function findNextAvailableSlots(
  fromISO: string,
  count = 3,
  durationMinutes = SLOT_DURATION_MINUTES,
  timeZone: string = SERVER_TIMEZONE,
): Promise<string[]> {
  const requested = new Date(fromISO).getTime();
  const windowStart = Math.max(isNaN(requested) ? Date.now() : requested, Date.now());
  const windowEnd = windowStart + SEARCH_WINDOW_DAYS * 24 * 60 * 60_000;
  const busy = await fetchBusyIntervals(
    new Date(windowStart).toISOString(),
    new Date(windowEnd).toISOString(),
  );

  const stepMs = SLOT_STEP_MINUTES * 60_000;
  const slots: string[] = [];
  // Begin at the next step boundary strictly after the requested time.
  let cursor = Math.ceil((windowStart + 1) / stepMs) * stepMs;
  while (cursor < windowEnd && slots.length < count) {
    const slotEnd = cursor + durationMinutes * 60_000;
    if (
      isWithinBusinessHours(cursor, durationMinutes, timeZone) &&
      !overlapsBusy(cursor, slotEnd, busy)
    ) {
      slots.push(new Date(cursor).toISOString());
    }
    cursor += stepMs;
  }
  return slots;
}

// ── Event creation ────────────────────────────────────────────────────────────

/**
 * Create a calendar event for a confirmed booking. Best-effort: on failure it
 * logs and returns null rather than throwing. Returns the created event id.
 */
export async function addCalendarEvent(
  booking: BookingDetails,
): Promise<string | null> {
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
      },
    );

    const rawText = await response.text();

    if (!response.ok) {
      logger.error(
        { status: response.status, body: rawText.slice(0, 400) },
        "Google Calendar API error",
      );
      return null;
    }

    let data: { id?: string; htmlLink?: string } = {};
    try {
      data = JSON.parse(rawText) as typeof data;
    } catch {
      logger.warn("Calendar response was not valid JSON");
    }

    logger.info(
      { eventId: data.id, link: data.htmlLink, customer: booking.name },
      "Calendar event created",
    );
    return data.id ?? null;
  } catch (err) {
    logger.error({ err }, "Failed to create Google Calendar event");
    return null;
  }
}
