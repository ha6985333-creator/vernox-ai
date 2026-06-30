---
name: Booking availability / double-booking prevention
description: How the chat-widget checks Google Calendar before confirming a booking, and the deliberate failure-mode tradeoffs
---

The chat widget prevents double-bookings by checking Google Calendar **before** confirming a booking or creating an event.

## How it works
- `calendar.ts` exposes `checkAvailability(iso, durationMinutes)` and `findNextAvailableSlots(...)`, both built on a single Google Calendar `freeBusy` API call (via the Replit Connectors SDK `.proxy()`).
- `addCalendarEvent()` returns the created event id (string) or null — best-effort, never throws.
- Datetimes are treated as instants end-to-end (parser → Date → `.toISOString()`), so the UTC freeBusy comparison is correct.
- Business hours for slot suggestions are hardcoded Mon–Fri 9–17, 30-min steps, weekends skipped.
- Two logging tables (`availability_checks`, `booking_attempts`) record every check/attempt. `tenantId` is nullable because the chat can run tenant-less.

## Deliberate failure-mode tradeoffs (don't "fix" without intent)
- **Fails CLOSED everywhere.** If the calendar can't be reached, the chat does NOT confirm the slot: it captures the lead (so it's not lost), logs the attempt with `available=null`, and tells the customer to call to confirm. No silent event creation.
  **Why:** the product requirement is *prevent double-bookings*; silently confirming an unverifiable slot is exactly how double-bookings slip through. Initially built fail-OPEN to avoid losing leads, but both the architect review and the user explicitly chose fail-CLOSED. Lead is still captured, so the "don't lose the lead" goal is met without the double-booking risk.
- **`POST /api/check-availability` fails CLOSED** (502): it's a pure availability query, so surfacing the error is correct.

## Known accepted limitation
- **Check-then-create race**: availability is checked, then the event is created in a separate call, so two concurrent requests for the same slot can both pass. Accepted at current scale (single small business, low concurrency). Fixing properly needs a transactional slot lock / reservation keyed per calendar — only do this if booking volume grows.

## Other notes
- Global `CALENDAR_ID` (one shared calendar), not per-tenant. Per-tenant calendars would need schema + portal UI — out of scope.
- The endpoint is public+unauthenticated, so it's rate-limited (20/min/IP in `app.ts`) to prevent calendar-occupancy probing.
- api-server routes do **manual** request validation (no zod dependency); match that convention. `zod/v4` is NOT resolvable here.
