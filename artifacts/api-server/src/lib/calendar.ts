/**
 * Google Calendar integration — uses the googleapis package + per-tenant
 * OAuth2 refresh tokens stored in the database. Replaces the former
 * @replit/connectors-sdk implementation which only worked on Replit.
 *
 * Public API is backward-compatible: functions now accept an optional
 * `refreshToken` parameter. When omitted (tenant hasn't connected yet)
 * the calendar functions throw a clear "not connected" error so callers
 * can handle the outage gracefully.
 */
import { google } from "googleapis";
import { logger } from "./logger.js";
import { BUSINESS_NAME, CALENDAR_ID } from "../config.js";
import { getAuthorizedClient } from "./googleOAuth.js";
import type { BookingDetails } from "./email.js";
import {
  DEFAULT_BUSINESS_HOURS,
  timeToDecimal,
  type BusinessHours,
  type DayKey,
} from "./businessHours.js";

const SLOT_DURATION_MINUTES = 60;
const SEARCH_WINDOW_DAYS = 30;
const SLOT_STEP_MINUTES = 30;

/** Per-tenant scheduling options shared by the availability primitives. */
export interface SlotOptions {
  durationMinutes?: number;
  businessHours?: BusinessHours | null;
  timeZone?: string;
  /** The tenant's stored Google OAuth2 refresh token. Required for live
   *  calendar checks; when undefined the availability functions throw. */
  refreshToken?: string | null;
}

// The timezone the server resolves business hours against when none is supplied.
export const SERVER_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface BusyInterval {
  start: number; // epoch ms
  end: number; // epoch ms
}

// Matches a zoneless wall-clock datetime ("2026-07-01T17:00" / "...:00") with
// no trailing Z or ±HH:MM offset.
const ZONELESS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Offset (ms) of a timezone at a given instant: localWallClockAsUTC − instant. */
function tzOffsetMs(instantMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
  }
  let hour = map.hour ?? 0;
  if (hour === 24) hour = 0; // hour12:false can emit "24" at midnight
  const asUTC = Date.UTC(map.year ?? 1970, (map.month ?? 1) - 1, map.day ?? 1, hour, map.minute ?? 0, map.second ?? 0);
  return asUTC - instantMs;
}

/**
 * Convert a datetime string to epoch ms. A string that carries an explicit
 * timezone (trailing `Z` or `±HH:MM`) is honored as-is. A zoneless wall-clock
 * string is interpreted as local time in `timeZone` — so "5pm" means 5pm in the
 * business's timezone, not on the server. Returns NaN if unparseable.
 */
export function toEpochMs(raw: string, timeZone: string): number {
  const m = ZONELESS_RE.exec(raw.trim());
  if (!m) return new Date(raw).getTime(); // has offset, or other format → native
  const [, Y, Mo, D, H, Mi, S] = m;
  const guess = Date.UTC(+Y!, +Mo! - 1, +D!, +H!, +Mi!, S ? +S : 0);
  // One correction pass; exact except inside the ~1h DST fold, which is fine here.
  return guess - tzOffsetMs(guess, timeZone);
}

/**
 * Parse a datetime string into ISO 8601 start/end instants. Zoneless strings are
 * interpreted in `timeZone`. Falls back to tomorrow 9am (in `timeZone`) when
 * unparseable.
 */
function parseDatetime(
  raw: string,
  durationMinutes = SLOT_DURATION_MINUTES,
  timeZone = SERVER_TIMEZONE,
): { start: string; end: string } {
  const ms = toEpochMs(raw, timeZone);
  const baseMs = isNaN(ms)
    ? (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d.getTime();
      })()
    : ms;

  const end = baseMs + durationMinutes * 60 * 1000;
  return { start: new Date(baseMs).toISOString(), end: new Date(end).toISOString() };
}

// ── Availability primitives ───────────────────────────────────────────────────

/**
 * Resolve the effective calendar ID for a tenant. Falls back to the global
 * CALENDAR_ID env var (default: "primary") when the tenant hasn't overridden.
 */
function resolveCalendarId(tenantCalendarId?: string | null): string {
  return tenantCalendarId?.trim() || CALENDAR_ID;
}

/**
 * Query Google Calendar's freeBusy API for busy intervals within the given
 * window, authenticated as the tenant via their stored refresh token.
 *
 * A single freeBusy call is fast (one round-trip) — keeping us well under
 * the 500ms target even when scanning a 30-day window.
 */
async function fetchBusyIntervals(
  timeMinISO: string,
  timeMaxISO: string,
  refreshToken: string,
  calendarId?: string | null,
): Promise<BusyInterval[]> {
  const auth = getAuthorizedClient(refreshToken);
  const calId = resolveCalendarId(calendarId);

  const cal = google.calendar({ version: "v3", auth });
  const response = await cal.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: calId }],
    },
  });

  const busy = response.data.calendars?.[calId]?.busy ?? [];
  return busy
    .map((b) => ({
      start: new Date(b.start!).getTime(),
      end: new Date(b.end!).getTime(),
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

/** Map an Intl "short" weekday ("Mon") to a BusinessHours key ("mon"). */
function weekdayKey(weekday: string): DayKey {
  return weekday.toLowerCase().slice(0, 3) as DayKey;
}

/**
 * True when the whole slot falls within the configured open hours for that day
 * (evaluated in the given timezone). A `null` day means closed.
 */
function isWithinBusinessHours(
  startMs: number,
  durationMinutes: number,
  timeZone: string,
  hours: BusinessHours,
): boolean {
  const { weekday, hour, minute } = zonedParts(startMs, timeZone);
  const window = hours[weekdayKey(weekday)];
  if (!window) return false; // closed that day
  const startDecimal = hour + minute / 60;
  const endDecimal = startDecimal + durationMinutes / 60;
  return startDecimal >= timeToDecimal(window[0]) && endDecimal <= timeToDecimal(window[1]);
}

/**
 * Is the requested slot free? Checks a single duration-long window against the
 * calendar's busy intervals. Throws if the Calendar API can't be reached so the
 * caller can decide how to handle the outage.
 *
 * @param refreshToken - The tenant's stored Google OAuth2 refresh token.
 *   When null/undefined, throws "Google Calendar not connected" immediately.
 */
export async function checkAvailability(
  requestedISO: string,
  opts: SlotOptions = {},
): Promise<boolean> {
  const durationMinutes = opts.durationMinutes ?? SLOT_DURATION_MINUTES;
  const timeZone = opts.timeZone ?? SERVER_TIMEZONE;
  const hours = opts.businessHours ?? DEFAULT_BUSINESS_HOURS;

  if (!opts.refreshToken) {
    throw new Error("Google Calendar not connected for this tenant. Connect via the dashboard.");
  }

  const start = toEpochMs(requestedISO, timeZone);
  if (isNaN(start)) throw new Error("Invalid requested datetime");

  // A slot outside the business's open hours is never bookable, regardless of
  // what the calendar says — treat it as unavailable so the caller offers
  // in-hours alternatives instead.
  if (!isWithinBusinessHours(start, durationMinutes, timeZone, hours)) return false;

  const end = start + durationMinutes * 60_000;
  const busy = await fetchBusyIntervals(
    new Date(start).toISOString(),
    new Date(end).toISOString(),
    opts.refreshToken,
  );
  return !overlapsBusy(start, end, busy);
}

/**
 * Find the next `count` open slots starting after `fromISO`, scanning up to 30
 * days. Respects business hours in the given timezone and skips intervals that
 * overlap existing calendar events. Uses one freeBusy call.
 *
 * @param refreshToken - Passed through opts.refreshToken. Required for live results.
 */
export async function findNextAvailableSlots(
  fromISO: string,
  count = 3,
  opts: SlotOptions = {},
): Promise<string[]> {
  const durationMinutes = opts.durationMinutes ?? SLOT_DURATION_MINUTES;
  const timeZone = opts.timeZone ?? SERVER_TIMEZONE;
  const hours = opts.businessHours ?? DEFAULT_BUSINESS_HOURS;

  if (!opts.refreshToken) {
    throw new Error("Google Calendar not connected for this tenant. Connect via the dashboard.");
  }

  const requested = toEpochMs(fromISO, timeZone);
  const windowStart = Math.max(isNaN(requested) ? Date.now() : requested, Date.now());
  const windowEnd = windowStart + SEARCH_WINDOW_DAYS * 24 * 60 * 60_000;
  const busy = await fetchBusyIntervals(
    new Date(windowStart).toISOString(),
    new Date(windowEnd).toISOString(),
    opts.refreshToken,
  );

  const stepMs = SLOT_STEP_MINUTES * 60_000;
  const slots: string[] = [];
  // Begin at the next step boundary strictly after the requested time.
  let cursor = Math.ceil((windowStart + 1) / stepMs) * stepMs;
  while (cursor < windowEnd && slots.length < count) {
    const slotEnd = cursor + durationMinutes * 60_000;
    if (
      isWithinBusinessHours(cursor, durationMinutes, timeZone, hours) &&
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
 *
 * @param refreshToken - The tenant's stored Google OAuth2 refresh token.
 *   When null/undefined, logs a warning and returns null without throwing.
 */
export async function addCalendarEvent(
  booking: BookingDetails,
  durationMinutes = SLOT_DURATION_MINUTES,
  timeZone = SERVER_TIMEZONE,
  refreshToken?: string | null,
): Promise<string | null> {
  if (!refreshToken) {
    logger.warn(
      { bookingEmail: booking.email },
      "addCalendarEvent: no Google refresh token for tenant — skipping calendar event",
    );
    return null;
  }

  try {
    const auth = getAuthorizedClient(refreshToken);
    const { start, end } = parseDatetime(booking.datetime, durationMinutes, timeZone);
    const calId = resolveCalendarId();

    const cal = google.calendar({ version: "v3", auth });
    const response = await cal.events.insert({
      calendarId: calId,
      requestBody: {
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
      },
    });

    const eventId = response.data.id ?? null;
    const htmlLink = response.data.htmlLink ?? null;

    logger.info(
      { eventId, link: htmlLink, customer: booking.name },
      "Calendar event created",
    );

    return eventId;
  } catch (err) {
    logger.error({ err }, "Failed to create Google Calendar event");
    return null;
  }
}
