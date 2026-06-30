---
name: Timezone-at-source datetime parsing
description: Per-tenant booking datetimes must be interpreted in the tenant timezone at the moment a zoneless string is parsed, never after it has been normalized to an absolute instant.
---

# Timezone-at-source parsing rule

A zoneless datetime string (e.g. the AI booking marker emits `2026-07-15T14:00:00`)
means a **wall-clock time in the tenant's timezone**. It MUST be converted to an
absolute instant using that timezone at the point of parsing — before any
`new Date(raw).toISOString()` round-trip.

**Why:** `new Date("2026-07-15T14:00:00")` interprets a zoneless string as
server-local (UTC on Replit). Once you call `.toISOString()` you have baked in the
wrong instant, and no downstream per-tenant timezone logic can recover the intended
wall-clock time. This silently nullified the per-tenant timezone feature for real
chat bookings even though the standalone availability endpoint looked correct — the
bug lived in the chat extraction path, not the calendar helpers.

**How to apply:**
- Use `toEpochMs(raw, timeZone)` (in `calendar.ts`) to parse any zoneless datetime.
  It interprets zoneless ISO in `timeZone`, honors an explicit `Z`/offset as-is, and
  returns `NaN` for non-ISO/natural-language input.
- Thread the resolved tenant timezone into every parse site. The chat extraction
  helper takes a `timeZone` param sourced from the tenant row.
- Store the result as an absolute instant (`new Date(ms).toISOString()`); downstream
  business-hour checks convert that instant back to tenant wall-clock via `Intl`.
- Natural-language fallback (`parseBookingDatetime`) is still server-local — acceptable
  only because the AI is contracted to emit ISO; treat NL as a rare degraded path.
- Known accepted limitation: `toEpochMs` one-pass offset correction is ambiguous
  inside the ~1h DST fall-back fold.
