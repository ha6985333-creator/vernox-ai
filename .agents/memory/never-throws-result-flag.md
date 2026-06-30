---
name: Never-throws notifiers must return a result
description: Side-effect helpers that swallow their own errors must report outcome via a return value, or callers can't distinguish failure from intentional skip
---

A helper that "never throws" (so a failure can't break the main flow) cannot signal failure by absence of an exception. If a caller sets a monitoring/alert flag based only on "the call returned", it will report success even when delivery actually failed — and conversely treat intentional skips (channel disabled, quiet hours) as if they mattered.

**Rule:** never-throws side-effect helpers (owner notifications, email senders) must return a structured result (e.g. `{attempted, anySent, anyFailed, quietReason}`). Per-channel senders return a `NotifyStatus` (`sent`/`failed`/`skipped`) that the aggregator tallies. The caller's monitoring alert should fire only on `anyFailed`, never on a skip.

**Why:** a booking monitoring block was setting its success flag unconditionally right after a never-throws owner-notify call, masking real email-provider failures so the alert never fired.

Also: an `attempted` field should be set only for `sent`/`failed`, not for `skipped` — a skip is not an attempt.

**How to apply:** any time you call a swallow-errors notifier and then branch on whether it "worked," route the decision through the helper's returned result, not through the fact that it returned.
