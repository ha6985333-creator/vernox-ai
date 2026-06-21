import { logger } from "./logger.js";

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const DAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function applyTime(date: Date, hour: number, minute: number, ampm?: string): Date {
  let h = hour;
  if (ampm?.toLowerCase() === "pm" && h < 12) h += 12;
  if (ampm?.toLowerCase() === "am" && h === 12) h = 0;
  date.setHours(h, minute, 0, 0);
  return date;
}

const parseTomorrowTime = (match: RegExpMatchArray): Date => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const hour   = parseInt(match[1] ?? "9", 10);
  const minute = parseInt(match[2] ?? "0", 10);
  const ampm   = match[3];
  return applyTime(d, hour, minute, ampm);
};

const parseSpecificDate = (match: RegExpMatchArray): Date => {
  const day    = parseInt(match[1] ?? "1", 10);
  const month  = MONTHS[match[2]?.toLowerCase() ?? ""] ?? 0;
  const hour   = parseInt(match[3] ?? "9", 10);
  const minute = parseInt(match[4] ?? "0", 10);
  const ampm   = match[5];
  const d = new Date();
  d.setMonth(month, day);
  // If that date is in the past, move to next year
  if (d < new Date()) d.setFullYear(d.getFullYear() + 1);
  return applyTime(d, hour, minute, ampm);
};

const parseNextDayOfWeek = (match: RegExpMatchArray): Date => {
  const targetDay = DAYS[match[1]?.toLowerCase() ?? ""] ?? 1;
  const hour      = parseInt(match[2] ?? "9", 10);
  const minute    = parseInt(match[3] ?? "0", 10);
  const ampm      = match[4];
  const d = new Date();
  const currentDay = d.getDay();
  let daysAhead = targetDay - currentDay;
  if (daysAhead <= 0) daysAhead += 7; // always "next" occurrence
  d.setDate(d.getDate() + daysAhead);
  return applyTime(d, hour, minute, ampm);
};

const parseTodayTime = (match: RegExpMatchArray): Date => {
  const d = new Date();
  const hour   = parseInt(match[1] ?? "9", 10);
  const minute = parseInt(match[2] ?? "0", 10);
  const ampm   = match[3];
  return applyTime(d, hour, minute, ampm);
};

const parseThisDayOfWeek = (match: RegExpMatchArray): Date => {
  const targetDay = DAYS[match[1]?.toLowerCase() ?? ""] ?? 1;
  const hour      = parseInt(match[2] ?? "9", 10);
  const minute    = parseInt(match[3] ?? "0", 10);
  const ampm      = match[4];
  const d = new Date();
  const currentDay = d.getDay();
  let daysAhead = targetDay - currentDay;
  if (daysAhead < 0) daysAhead += 7;
  d.setDate(d.getDate() + daysAhead);
  return applyTime(d, hour, minute, ampm);
};

// Matches "3pm", "3:30pm", "3 pm" with no day prefix
const parseTimeOnly = (match: RegExpMatchArray): Date => {
  const d = new Date();
  d.setDate(d.getDate() + 1); // assume tomorrow for bare time
  const hour   = parseInt(match[1] ?? "9", 10);
  const minute = parseInt(match[2] ?? "0", 10);
  const ampm   = match[3];
  return applyTime(d, hour, minute, ampm);
};

const PATTERNS: Array<{ regex: RegExp; fn: (m: RegExpMatchArray) => Date }> = [
  // "tomorrow at 2pm" / "tomorrow at 14:30"
  {
    regex: /tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    fn: parseTomorrowTime,
  },
  // "today at 3pm"
  {
    regex: /today\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    fn: parseTodayTime,
  },
  // "next Monday at 2pm"
  {
    regex: /next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    fn: parseNextDayOfWeek,
  },
  // "this Thursday at 2pm" (nearest occurrence)
  {
    regex: /this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    fn: parseThisDayOfWeek,
  },
  // "Thursday at 2pm" (nearest occurrence, no "next"/"this" prefix)
  {
    regex: /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    fn: parseThisDayOfWeek,
  },
  // "15 March at 2pm" / "15 March 2pm"
  {
    regex: /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    fn: parseSpecificDate,
  },
  // Bare time "3pm" / "3:30 pm" — assume tomorrow
  {
    regex: /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i,
    fn: parseTimeOnly,
  },
];

export function parseBookingDatetime(rawString: string): Date | null {
  if (!rawString || typeof rawString !== "string") return null;

  // 1. Try ISO / standard formats first
  const isoDate = new Date(rawString);
  if (!isNaN(isoDate.getTime())) return isoDate;

  const trimmed = rawString.trim();

  // 2. Try natural language patterns
  for (const { regex, fn } of PATTERNS) {
    const match = trimmed.match(regex);
    if (match) {
      try {
        const parsed = fn(match);
        if (!isNaN(parsed.getTime())) return parsed;
      } catch {
        // try next pattern
      }
    }
  }

  // 3. Fallback — tomorrow 9 AM, with a warning log
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(9, 0, 0, 0);

  logger.warn({ rawString, fallback: fallback.toISOString() }, "Booking datetime unparseable — using fallback");

  return fallback;
}
