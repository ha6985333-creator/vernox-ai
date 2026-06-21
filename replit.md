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

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + express-session
- DB: PostgreSQL + Drizzle ORM
- Auth: bcrypt password hashing, session-based
- Email: Resend
- AI: Groq (llama-3.3-70b-versatile)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/config.ts` — business type + AI system prompt
- `artifacts/api-server/src/app.ts` — Express app + middleware
- `artifacts/api-server/src/routes/` — auth, admin, chat, webhooks
- `artifacts/api-server/src/lib/` — auth helpers, email, accounts, logger
- `artifacts/api-server/public/` — static frontend files
- `lib/db/src/schema/` — tenants + users Drizzle tables

## Pages

| URL | Description |
|---|---|
| `/` | Chat widget (main product) |
| `/buy` | "Buy Now" thank-you page — explains user will be contacted with payment link, then login credentials |
| `/login` | Login page for admin + tenants |
| `/admin` | Master admin dashboard (admin only) |
| `/portal` | Tenant landing page after login |

## API Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Login |
| POST | `/api/auth/logout` | session | Logout |
| GET | `/api/auth/me` | session | Current user |
| GET | `/api/admin/tenants` | admin | List all tenants |
| POST | `/api/admin/tenants` | admin | Manually create tenant |
| PATCH | `/api/admin/tenants/:id/status` | admin | Suspend/activate |
| GET | `/api/admin/stats` | admin | Stats counters |
| POST | `/api/webhooks/payoneer` | public | Payoneer IPN (auto-provision) |

## Product

- **Chat widget**: AI-powered lead qualification + appointment booking for any business type (currently configured as "plumber"). Change `BUSINESS_TYPE` and `SYSTEM_PROMPT` in `config.ts` to switch industries.
- **Booking detection**: When AI detects a completed booking it emits `BOOKING_COMPLETE::{}`, triggering a green confirmation banner and sending a notification email.
- **Admin dashboard**: Master admin can view all customers, create accounts manually, suspend/activate tenants.
- **Auto-provisioning**: Payoneer IPN webhook at `/api/webhooks/payoneer` — when a payment completes, a tenant account is created and credentials are emailed automatically.

## Architecture decisions

- Session auth (not JWT) — simpler for a server-rendered multi-page app
- Admin seeded on startup via `ensureAdminUser()` — idempotent, safe to run repeatedly
- Duplicate-safe IPN handler — if same payer email pays twice, second provision is silently skipped
- Payoneer IPN responds with plain-text `OK` as required by the Payoneer spec

## User preferences

- Business type: plumber (change in config.ts)
- Notify email: ha6985333@gmail.com
- Pricing: $899/month, no setup fee
- Payment provider: manual for now — "Buy Now" sends users to `/buy`; team contacts them with a payment link, then emails login credentials after payment. (Payoneer IPN webhook still exists in code but is not the active flow.)

## Gotchas

- drizzle-kit requires bare imports (no `.js`) in schema files; runtime ESM uses `.js` extensions
- bcrypt requires native build approval: `pnpm approve-builds`
- Stripe package is installed but not used (replaced by Payoneer) — safe to leave or remove
- Static pages at `/admin` and `/portal` are SPA-style: JS checks `/api/auth/me` and redirects to `/login` if unauthenticated
