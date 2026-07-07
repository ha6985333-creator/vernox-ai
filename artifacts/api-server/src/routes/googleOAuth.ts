/**
 * Tenant self-serve Google Calendar OAuth2 routes.
 *
 * Endpoints:
 *   GET  /api/tenant/google/auth        — Initiate OAuth consent (tenant must be logged in)
 *   GET  /api/auth/google/callback      — OAuth callback (public, CSRF-protected via signed state)
 *   GET  /api/tenant/google/status      — Check connection status (tenant must be logged in)
 *   DELETE /api/tenant/google/disconnect — Revoke + clear token (tenant must be logged in)
 *
 * Environment variables required:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI  (must be registered in Google Cloud Console)
 *
 * Register this callback URL in Google Cloud Console → APIs & Services →
 * Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tenantsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import {
  getAuthorizationUrl,
  verifyState,
  exchangeCodeForTokens,
  revokeRefreshToken,
} from "../lib/googleOAuth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Helper: resolve tenantId from the logged-in user's session ────────────────

async function getTenantIdForUser(userId: string): Promise<string | null> {
  const user = await db.query.usersTable.findFirst({
    where: (u, { eq: e }) => e(u.id, userId),
  });
  return user?.tenantId ?? null;
}

// ── GET /api/tenant/google/auth ───────────────────────────────────────────────
// Redirect the logged-in tenant to Google's consent screen.

router.get("/tenant/google/auth", requireAuth, async (req, res) => {
  const tenantId = await getTenantIdForUser(req.session.userId!);
  if (!tenantId) {
    res.status(404).json({ error: "No tenant associated with this account." });
    return;
  }

  try {
    const url = getAuthorizationUrl(tenantId);
    res.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth configuration error";
    logger.error({ err }, "Failed to generate Google authorization URL");
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/auth/google/callback ─────────────────────────────────────────────
// Google redirects here after the user grants (or denies) permission.
// The URL must be registered as an "Authorized redirect URI" in Google Cloud Console.

router.get("/auth/google/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;

  // Determine a safe redirect target for post-auth navigation.
  // Falls back to "/" if FRONTEND_URL isn't set.
  const frontendBase = process.env["FRONTEND_URL"]?.replace(/\/$/, "") ?? "";
  const successRedirect = `${frontendBase}/dashboard?calendar=connected`;
  const errorRedirect = (reason: string) =>
    `${frontendBase}/dashboard?calendar=error&reason=${encodeURIComponent(reason)}`;

  // User denied permission on Google's consent screen
  if (oauthError) {
    logger.warn({ oauthError }, "Google OAuth: user denied permission");
    res.redirect(errorRedirect("access_denied"));
    return;
  }

  if (!code || !state) {
    res.redirect(errorRedirect("missing_params"));
    return;
  }

  // Verify HMAC-signed state (CSRF protection)
  let tenantId: string;
  try {
    const payload = verifyState(state);
    // payload format: "tenantId=<uuid>"
    const match = /^tenantId=([a-f0-9-]+)$/i.exec(payload);
    if (!match?.[1]) throw new Error("Malformed state payload");
    tenantId = match[1];
  } catch (err) {
    logger.error({ err }, "Google OAuth: invalid state parameter");
    res.redirect(errorRedirect("invalid_state"));
    return;
  }

  // Exchange the code for tokens
  let result: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    result = await exchangeCodeForTokens(code);
  } catch (err) {
    logger.error({ err, tenantId }, "Google OAuth: token exchange failed");
    res.redirect(errorRedirect("token_exchange_failed"));
    return;
  }

  // Persist the refresh token to the tenant row
  try {
    await db
      .update(tenantsTable)
      .set({ googleRefreshToken: result.refreshToken })
      .where(eq(tenantsTable.id, tenantId));

    logger.info(
      { tenantId, email: result.email },
      "Google Calendar connected for tenant",
    );
  } catch (err) {
    logger.error({ err, tenantId }, "Google OAuth: failed to persist refresh token");
    res.redirect(errorRedirect("db_error"));
    return;
  }

  res.redirect(successRedirect);
});

// ── GET /api/tenant/google/status ────────────────────────────────────────────
// Returns whether the tenant has connected their Google Calendar, and which
// Google account is connected (if the email was captured at token-exchange time).

router.get("/tenant/google/status", requireAuth, async (req, res) => {
  const tenantId = await getTenantIdForUser(req.session.userId!);
  if (!tenantId) {
    res.status(404).json({ error: "No tenant associated with this account." });
    return;
  }

  const tenant = await db.query.tenantsTable.findFirst({
    where: (t, { eq: e }) => e(t.id, tenantId),
  });
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found." });
    return;
  }

  // We don't expose the raw refresh token — just the connected state.
  // If we want to show "Connected as user@gmail.com" we'd need a separate
  // googleAccountEmail column; for now we return connected:true/false.
  res.json({
    connected: !!tenant.googleRefreshToken,
    calendarId: tenant.googleCalendarId ?? "primary",
  });
});

// ── DELETE /api/tenant/google/disconnect ──────────────────────────────────────
// Revoke the stored token and clear it from the database.

router.delete("/tenant/google/disconnect", requireAuth, async (req, res) => {
  const tenantId = await getTenantIdForUser(req.session.userId!);
  if (!tenantId) {
    res.status(404).json({ error: "No tenant associated with this account." });
    return;
  }

  const tenant = await db.query.tenantsTable.findFirst({
    where: (t, { eq: e }) => e(t.id, tenantId),
  });
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found." });
    return;
  }

  if (!tenant.googleRefreshToken) {
    // Already disconnected — idempotent success
    res.json({ ok: true, message: "Google Calendar was not connected." });
    return;
  }

  // Best-effort revoke at Google (ignore errors — stale tokens can't be revoked)
  await revokeRefreshToken(tenant.googleRefreshToken);

  // Clear from DB
  await db
    .update(tenantsTable)
    .set({ googleRefreshToken: null })
    .where(eq(tenantsTable.id, tenantId));

  logger.info({ tenantId }, "Google Calendar disconnected for tenant");
  res.json({ ok: true });
});

export default router;
