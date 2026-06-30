import type { BusinessHours, DayHours } from "@workspace/db";

export type { BusinessHours, DayHours };

// Ordered day keys matching the BusinessHours shape.
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

// Default when a tenant hasn't configured hours: Mon–Fri 9am–5pm, closed weekends.
// This preserves the original global behaviour for tenants with no hours set.
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: ["09:00", "17:00"],
  tue: ["09:00", "17:00"],
  wed: ["09:00", "17:00"],
  thu: ["09:00", "17:00"],
  fri: ["09:00", "17:00"],
  sat: null,
  sun: null,
};

/** "09:30" -> 9.5. Assumes a valid HH:MM string. */
export function timeToDecimal(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

/** True for a 24h "HH:MM" string (00:00–23:59). */
export function isHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/**
 * Validate and normalise arbitrary input (e.g. from the admin form) into a
 * BusinessHours object. Returns null when input is null/undefined. Throws an
 * Error with a human-readable message on invalid input.
 */
export function normalizeBusinessHours(input: unknown): BusinessHours | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("businessHours must be an object keyed by day (mon–sun)");
  }
  const src = input as Record<string, unknown>;
  const out = {} as BusinessHours;

  for (const key of DAY_KEYS) {
    const v = src[key];
    if (v === null || v === undefined) {
      out[key] = null;
      continue;
    }
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      typeof v[0] !== "string" ||
      typeof v[1] !== "string" ||
      !isHHMM(v[0]) ||
      !isHHMM(v[1])
    ) {
      throw new Error(`Invalid hours for ${key}: expected ["HH:MM","HH:MM"] or null`);
    }
    if (timeToDecimal(v[0]) >= timeToDecimal(v[1])) {
      throw new Error(`Closing time must be after opening time for ${key}`);
    }
    out[key] = [v[0], v[1]] as DayHours;
  }
  return out;
}
