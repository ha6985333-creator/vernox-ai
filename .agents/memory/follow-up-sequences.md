---
name: Automated follow-up sequences
description: How the Business+ SMS/email nurture drip engine is structured and why state lives on the lead row
---

# Automated follow-up sequences (Business+)

A fixed multi-step nurture drip that fires after a lead is captured. Engine + scheduler in `artifacts/api-server/src/lib/followUpSequence.ts`; SMS transport in `lib/sms.ts` (Twilio REST via fetch, no SDK).

## Key decisions
- **No new table.** Sequence state lives on the lead row (`followUpCount`, `nextFollowUpDate`, `lastContactDate`, `followUpPaused`) plus a tenant master switch `notification_settings.followUpSequencesEnabled`. Per-channel sends are logged to the existing `lead_follow_ups` table.
  **Why:** the lead row already carried follow-up counters for manual follow-ups; reusing them keeps the scheduler a simple "find due leads" query and avoids migration churn (drizzle push hangs here — additive cols go in via psql).
- **Gate enforced on every scheduler tick**, not just in the UI: `hasFeature(plan, "follow_up_sequences")` (rank 2). A downgraded tenant simply stops receiving new steps; existing state is untouched.
- **Scheduler is a 5-min `setInterval`, `.unref()`'d**, started in `index.ts` after `ensureAdminUser()`. Not a cron/queue — acceptable at single-server scale.
- **Advance the lead even if a channel fails.** `advanceLead()` runs regardless of per-channel send success so a permanently failing channel (e.g. no Twilio creds) can't wedge a lead on the same step forever. SMS with no creds is logged `skipped`, email still sends.
- **1h min-gap guard** vs `lastContactDate` prevents an automated step double-sending right after a manual follow-up.

## How to apply
- Step-1 delay (`FIRST_STEP_DELAY_MS`, 2h) must stay in sync with `captureLead()`'s initial `nextFollowUpDate` offset in `chat.ts`, or the first touch lands early/late.
- Sequence-management routes live in `routes/leads.ts` — static paths (`/leads/sequences`, `/leads/sequences/settings`) MUST be registered before `/leads/:leadId` or the param route shadows them.
- SMS/email nurture was previously "marketing-only, not built" in the pricing gating notes — this feature moved `follow_up_sequences` into the actually-gated set.
