---
name: Pricing tier gating
description: How the 3-tier pricing model gates existing features and what stays marketing-only
---

# Pricing tier gating

`artifacts/api-server/src/tiers.ts` is the single source of truth for the 3 tiers (Pro/Business/Enterprise). `normalizePlan()` maps any legacy/unknown/empty/`starter` value → `pro`, so feature checks are always deterministic even for pre-tier tenants.

**Only three EXISTING features are gated** (all Business+, rank ≥ 2): `lead_scoring`, `slack_notifications`, `industry_specific_ai`. Gating is enforced **server-side**, not just hidden in UI:
- lead scoring: chat sets `qualityScore = null` unless `features.leadScoring`.
- slack: `/notifications/slack/connect` returns 403 without the feature AND the delivery path honors `slackAllowed`, so a tenant downgraded after connecting still won't get Slack sends.
- industry AI: chat falls back to the `general` prompt unless `features.industrySpecificAI`.

**Marketing-only features are intentionally NOT gated** (they don't exist yet): SMS/email sequences, multi-location, API access, white-label, CRM sync. They appear on the pricing page as "included" but do nothing. Do not add gate checks for these until the feature is actually built.

**Why:** the tier system had to ship enforcement for real features without faking the unbuilt ones. Adding a `hasFeature` gate for an unbuilt feature would imply it works.

**How to apply:** when adding a new paid feature, add its key to `FEATURE_MIN_RANK` in tiers.ts and enforce it in the server path; when a marketing feature becomes real, wire it the same way. UI (portal Plan Features card, admin) reads `/api/auth/tenant` `features` + `/api/tiers` — keep those shapes in sync with the registry.
