---
name: drizzle-kit push hangs
description: How to apply dev schema changes when `drizzle-kit push` stalls in this repo
---

`pnpm --filter @workspace/db run push` (drizzle-kit push) hangs in this environment — it waits on an interactive prompt that never resolves under the agent shell.

**Why:** drizzle-kit's interactive confirmation step blocks with no TTY.

**How to apply:** For small/additive dev schema changes (e.g. adding nullable or defaulted columns), apply them directly with `psql "$DATABASE_URL" -c "ALTER TABLE ..."` and keep the Drizzle schema file (`lib/db/src/schema/`) in sync so types stay correct. Verify with a `\d <table>` or a SELECT. Reserve push for when you can run it interactively.
