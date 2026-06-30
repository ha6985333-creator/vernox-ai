---
name: Lead transcript capture & portal rendering
description: How chatbot conversations become viewable leads in the tenant portal, and the mandatory XSS-safe rendering rule for lead/customer data.
---

# Lead transcript capture & portal rendering

## Transcript capture
When the chatbot completes (or attempts) a booking, the lead is saved with a
`conversation_transcript` (plain text, `Customer:`/`Assistant:` lines). The bot's
**final** reply for that turn is generated server-side and is NOT in the client's
`messages` array, so it must be appended explicitly when building the transcript —
otherwise the saved transcript is missing the booking confirmation.

**Why:** the booking completes on the same turn the bot confirms, so that turn's
assistant message only exists server-side at capture time.

**How to apply:** pass the cleaned final reply as the second arg to the transcript
formatter at every `captureLead` call site (both the normal success path and the
calendar-outage fallback path — they must stay in sync).

## Portal rendering — stored-XSS rule
The tenant portal Leads dashboard displays lead/customer-supplied content (names,
emails, service text, full transcripts). **Always render these via `textContent` /
`document.createElement`, never via `innerHTML` string interpolation.**

**Why:** lead fields originate from untrusted website visitors via the chat widget.
An `innerHTML` sink here is a stored-XSS vector that runs in the business owner's
authenticated portal session.

**How to apply:** the only acceptable `innerHTML` in the portal is for static
literal markup (e.g. a hard-coded empty-state SVG icon). Any value that could
contain user data must go through `textContent`. This mirrors the same rule already
documented for the admin dashboard.
