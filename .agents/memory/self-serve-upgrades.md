---
name: Self-serve plan upgrades
description: How tenant upgrade requests are captured, deduped, and applied by admin
---

# Self-serve plan upgrades

Tenants request a higher plan from the portal (replaces the old `mailto`). Flow: portal modal → `POST /api/upgrade-request` `{requestedPlan, note?}` → saves an `upgrade_requests` row (`lib/db/src/schema/upgradeRequests.ts`) → admin actions it in the dashboard **Upgrade Requests** table.

**One open request per tenant.** The tenant POST rejects a plan that is not strictly higher than the tenant's current plan, and if an open request (status `new`/`contacted`) already exists it is **reused/overwritten** instead of inserting a duplicate. `GET /api/upgrade-request` returns the tenant's open request (or `{pending:null}`) so the portal card can show a "⏳ Pending" state.

**Admin apply re-gates instantly.** Admin "Apply Plan" calls `PATCH /api/admin/tenants/:id {plan}` (validated via `isValidPlan`) then marks the request `applied`. No restart is needed because feature gating (`hasFeature`/`featuresForPlan` in `tiers.ts`) reads the tenant plan from the DB on every request.

**Why:** the goal was an admin-actionable audit record, not silent auto-upgrades — a human confirms/collects payment, then applies. Dedupe avoids a tenant spamming the queue.

**How to apply:** if you add auto-provisioning on payment, set the plan via the same admin PATCH path and close the matching open request. Keep the strictly-higher validation server-side (never trust the client select).
