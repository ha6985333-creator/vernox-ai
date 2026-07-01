# Lead Qualification & Booking Chat Widget

A multitenant SaaS platform with an AI-powered lead qualification and appointment booking chat widget, plus a master admin dashboard for managing customers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Required Environment Variables

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Express session signing key |
| `ADMIN_EMAIL` | Admin login email (set to ha6985333@gmail.com) |
| `ADMIN_PASSWORD` | Admin login password |
| `RESEND_API_KEY` | Email sending (Resend) |
| `NOTIFY_EMAIL` | Where booking alerts are sent |
| `GROQ_API_KEY` | Groq LLM for chat widget |
| `PAYONEER_SECRET` | (Optional) Payoneer IPN signature verification |
| `TWILIO_ACCOUNT_SID` | (Optional) Twilio SID — enables SMS follow-up steps |
| `TWILIO_AUTH_TOKEN` | (Optional) Twilio auth token |
| `TWILIO_FROM_NUMBER` | (Optional) Twilio sender number (E.164) |

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + express-session
- DB: PostgreSQL + Drizzle ORM
- Auth: bcrypt password hashing, session-based
- Email: Resend
- AI: Groq (llama-3.3-70b-versatile)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/config.ts` — platform-level fallback business type + AI system prompt (used by email/reviews)
- `artifacts/api-server/src/businessTypes.ts` — registry of ~21 selectable business types + `getSystemPrompt(type,name)` for per-tenant tailored chat prompts
- `artifacts/api-server/src/app.ts` — Express app + middleware
- `artifacts/api-server/src/routes/` — auth, admin, chat, emails, webhooks
- `artifacts/api-server/src/lib/` — auth helpers, email, accounts, logger, `sms.ts` (Twilio REST), `followUpSequence.ts` (automated drip engine + scheduler)
- `artifacts/api-server/public/` — static frontend files
- `lib/db/src/schema/` — tenants (incl. `businessPhone`/`businessAddress`) + users + `email_logs` Drizzle tables

## Pages

| URL | Description |
|---|---|
| `/` | Chat widget (main product) |
| `/buy` | "Buy Now" page — lead capture form (name/business/email/phone) → on submit reveals thank-you steps; team contacts buyer with payment link, then credentials |
| `/login` | Login page for admin + tenants |
| `/admin` | Master admin dashboard (admin only) |
| `/portal` | Tenant landing page after login (Leads, Emails, Install Widget tabs) |

## API Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/tiers` | public | List the 3 pricing tiers (`{key,label,price,priceText,tagline,featured,features[]}`) |
| POST | `/api/auth/login` | public | Login |
| POST | `/api/auth/logout` | session | Logout |
| GET | `/api/auth/me` | session | Current user |
| POST | `/api/buy` | public | Submit Buy Now lead — saves `purchase_requests` row, emails owner + customer (rate-limited 5/hr per IP) |
| POST | `/api/check-availability` | public | Check a Google Calendar slot — body `{requestedDateTime, timezone?, durationMinutes?, tenantId?}` → `{available, suggestedTimes, ...}`; logs to `availability_checks`; 502 on calendar failure (rate-limited 20/min per IP) |
| GET | `/api/admin/tenants` | admin | List all tenants |
| POST | `/api/admin/tenants` | admin | Manually create tenant (accepts `businessType`, `businessName`) |
| GET | `/api/admin/business-types` | admin | List selectable business types (`{value,label}`) |
| PATCH | `/api/admin/tenants/:id/status` | admin | Suspend/activate |
| GET | `/api/admin/stats` | admin | Stats counters |
| GET | `/api/admin/purchase-requests` | admin | List all sale requests |
| PATCH | `/api/admin/purchase-requests/:id/status` | admin | Set status (new/contacted/paid/closed) |
| GET | `/api/leads/sequences` | tenant | Active automated follow-up sequences (Business+; Pro gets `{gated:true}`). Returns master toggle, SMS-config status, per-lead progress (contacts masked) |
| PUT | `/api/leads/sequences/settings` | tenant | Master on/off toggle for automated sequences (Business+; writes `notification_settings.followUpSequencesEnabled`) |
| POST | `/api/leads/:leadId/pause-sequence` | tenant | Pause/resume one lead's sequence — body `{paused:boolean}` (defaults true) |
| GET | `/api/emails` | tenant | List this tenant's confirmation-email log (limit 50, newest first) |
| GET | `/api/emails/stats` | tenant | Counts grouped by status (`{total,sent,failed,skipped}`) |
| GET | `/api/notifications/settings` | tenant | Owner-notification settings (defaults if no row); `slackWebhookUrl` never returned, `slackConnected` bool instead |
| PUT | `/api/notifications/settings` | tenant | Update settings (notify email, channel toggles, quiet hours/days). Does NOT touch Slack webhook/enabled |
| POST | `/api/notifications/slack/connect` | tenant | Validate (https + hooks.slack.com only) + send live test message before saving the webhook |
| POST | `/api/notifications/slack/disconnect` | tenant | Clear Slack webhook + disable |
| GET | `/api/notifications/logs` | tenant | Owner-notification delivery log (limit 50, newest first) |
| GET | `/api/notifications/logs/stats` | tenant | Counts grouped by status (`{total,sent,failed,skipped}`) |
| POST | `/api/webhooks/payoneer` | public | Payoneer IPN (auto-provision) |

## Product

- **Pricing tiers**: 3 tiers defined in `artifacts/api-server/src/tiers.ts` (single source of truth) — Pro/Business/Enterprise. `normalizePlan()` maps legacy/unknown/`starter` → `pro`. Only three *existing* features are actually gated (all Business+): lead quality scoring, Slack booking notifications, industry-specific AI tailoring — enforced server-side via `hasFeature()`/`featuresForPlan()`, NOT just hidden in UI. Marketing-only features (SMS/email sequences, multi-location, API access, white-label, CRM sync) are advertised but not built/gated. Public `GET /api/tiers` feeds the pricing page + buy form. Admin sets tier at provisioning; `/buy` captures chosen tier + services offered on `purchase_requests`.
- **Chat widget**: AI-powered lead qualification + appointment booking. The bot is **multipurpose** — each tenant has a `businessType` (set when the admin creates the customer) and the chat handler builds a tailored system prompt via `getSystemPrompt()` so it asks industry-appropriate qualifying questions (e.g. restaurant → party size + date/time, no service address). Non-visit business types skip the address requirement. Tenants without a type default to `general`. The `config.ts` `SYSTEM_PROMPT` is now only a platform-level fallback (email/reviews).
- **Booking detection**: When AI detects a completed booking it emits `BOOKING_COMPLETE::{}`, triggering a green confirmation banner and sending a notification email.
- **Customer confirmation emails**: On a completed booking the chat also emails the **customer** a professional HTML confirmation (appointment date/time, business name + phone + address, "reply or call to reschedule/cancel" CTA) via `sendBookingConfirmationToCustomer()`. Every send is logged to `email_logs` (status `sent`/`failed`/`skipped`); the function never throws so a delivery failure can't break the booking. Tenants view the log + counts in the portal **Emails** tab. NOTE: with no verified Resend domain, customer emails to non-owner addresses fail (403) and are logged as `failed` — verify a domain at resend.com/domains and set `FROM_EMAIL` to deliver to real customers.
- **Double-booking prevention**: Before confirming a booking or creating a calendar event, the chat checks the slot against Google Calendar (`freeBusy`). If the slot is taken, the booking is blocked and the bot offers the next open times (Mon–Fri 9–5, scanning 30 days). If the calendar is unreachable, the chat fails **closed** — it captures the lead, declines to confirm, and asks the customer to call. Every attempt is logged to `booking_attempts`. The standalone `POST /api/check-availability` endpoint exposes the same check. Logging tables: `availability_checks`, `booking_attempts`.
- **Owner booking notifications**: On a completed tenant booking the chat alerts the **business owner** across their enabled channels via `notifyBusinessOwner()` — per-tenant email (Resend) + optional Slack (incoming webhook). Respects per-tenant settings: channel on/off toggles, quiet hours (HH:MM in tenant tz, overnight-aware) + quiet days, and a "Slack high-value only" gate (quality score ≥ 75). Every outcome (sent/failed/skipped) is logged to `notification_logs`; the function never throws and returns an `OwnerNotifyResult` so the chat monitoring alert fires only on a *genuine* delivery failure (not an intentional skip). Tenants manage settings, connect/disconnect Slack, and view the delivery log + stats in the portal **Notifications** tab. Replaces the legacy global owner email for the tenant path; the global `sendConfirmationEmail` remains a fallback only when there is no `tenantId`. NOTE: same Resend unverified-domain limit — owner emails to non-owner addresses fail (403) and are logged as `failed`.
- **Automated follow-up sequences** (Business+): After a lead is captured, a fixed multi-step nurture drip fires over ~3 days via a 5-min scheduler (`startFollowUpScheduler()` in `index.ts`, engine in `lib/followUpSequence.ts`). Cadence: email @2h → email + SMS @24h → SMS @72h (`FOLLOW_UP_SEQUENCE`, `STEP_COUNT`). State lives on the lead row (`followUpCount`, `nextFollowUpDate`, `lastContactDate`, `followUpPaused`) plus `notification_settings.followUpSequencesEnabled` (tenant master switch) — no new table. Gated on the `follow_up_sequences` feature (rank 2 = Business+) via `hasFeature()`, enforced server-side on every tick (a downgraded tenant just stops getting new steps). SMS uses Twilio REST (`lib/sms.ts`, no SDK) and degrades gracefully when `TWILIO_*` env is unset (email steps still send; SMS logged `skipped`). Every channel send is logged to `lead_follow_ups`. A 1h min-gap guard prevents double-sends vs manual follow-ups. Tenants view active sequences, toggle the master switch, and pause/resume per-lead in the portal **Leads** tab; Pro tenants see an upgrade prompt.
- **Lead quality score**: `scoreLead()` — simple completeness signal (0-100), 25 pts each for phone/email/service/datetime. Shown in owner notifications + portal log. Not a predictive model.
- **Slack connect**: portal pastes an incoming-webhook URL → `POST /api/notifications/slack/connect` validates (https + `hooks.slack.com` host only, SSRF guard) and sends a live test message before persisting. The stored webhook is write-only (never returned to the client).
- **Admin dashboard**: Master admin can view all customers, create accounts manually, suspend/activate tenants, and review/triage incoming sale requests.
- **Sale notifications**: The `/buy` form POSTs to `/api/buy` → saves a `purchase_requests` row, emails the owner (NOTIFY_EMAIL) a notification, and emails the customer a confirmation. Each request shows in the admin "Sale Requests" table with a status dropdown (new/contacted/paid/closed) and a "New Sale Requests" stat card.
- **Auto-provisioning**: Payoneer IPN webhook at `/api/webhooks/payoneer` — when a payment completes, a tenant account is created and credentials are emailed automatically.

## Architecture decisions

- Session auth (not JWT) — simpler for a server-rendered multi-page app
- Admin seeded on startup via `ensureAdminUser()` — idempotent, safe to run repeatedly
- Duplicate-safe IPN handler — if same payer email pays twice, second provision is silently skipped
- Payoneer IPN responds with plain-text `OK` as required by the Payoneer spec
- Availability check fails **closed** everywhere: if the calendar can't be reached, the chat does NOT confirm the slot — it captures the lead, logs the attempt, and tells the customer to call to confirm (no silent event creation, so no double-booking risk). The `/api/check-availability` endpoint returns 502.
- Known accepted limitation: check-then-create is not atomic, so concurrent requests for the same slot could both pass. Acceptable at single-business scale; would need a transactional slot lock to fully eliminate

## User preferences

- Business type: per-tenant (chosen in admin "Add Customer"). `config.ts` plumber prompt is only the platform-level fallback.
- Notify email: ha6985333@gmail.com
- Pricing: 3 tiers — Pro $899 / Business $1,999 / Enterprise $4,999 per month, no setup fee. Source of truth: `artifacts/api-server/src/tiers.ts`.
- Payment provider: manual for now — "Buy Now" sends users to `/buy`; team contacts them with a payment link, then emails login credentials after payment. (Payoneer IPN webhook still exists in code but is not the active flow.)

## Gotchas

- drizzle-kit requires bare imports (no `.js`) in schema files; runtime ESM uses `.js` extensions
- bcrypt requires native build approval: `pnpm approve-builds`
- Stripe package is installed but not used (replaced by Payoneer) — safe to leave or remove
- Static pages at `/admin` and `/portal` are SPA-style: JS checks `/api/auth/me` and redirects to `/login` if unauthenticated
- Resend with no verified domain (from `onboarding@resend.dev`) can ONLY send to the account owner's own address (ha6985333@gmail.com). So owner sale-notification emails work, but customer confirmation emails to other addresses fail with a 403 (caught + logged, doesn't break the request). To enable customer emails, verify a domain at resend.com/domains and update the `from` address in `lib/email.ts`.
