/**
 * Google OAuth2 helpers for the tenant-facing Calendar integration.
 *
 * Reads credentials exclusively from environment variables:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI  (e.g. https://your-domain.com/api/auth/google/callback)
 *
 * Scopes requested:
 *   https://www.googleapis.com/auth/calendar.events  — create/read events
 *   https://www.googleapis.com/auth/calendar.readonly — freeBusy queries
 *   https://www.googleapis.com/auth/userinfo.email   — identify which Google
 *                                                      account was connected
 */
import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { createHmac, timingSafeEqual } from "crypto";

// ── Credential validation ─────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ── OAuth2Client factory ──────────────────────────────────────────────────────

/**
 * Build a fresh OAuth2Client from environment variables. Throws at call time
 * (not module load time) so unit tests that don't exercise OAuth don't fail.
 */
export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    requireEnv("GOOGLE_REDIRECT_URI"),
  );
}

// ── State HMAC (CSRF protection) ──────────────────────────────────────────────

/**
 * Sign an arbitrary payload string with SESSION_SECRET so we can verify it
 * round-trips through Google's `state` parameter without tampering.
 *
 * Format: `<payload>.<hex-hmac>`
 */
function signState(payload: string): string {
  const secret = process.env["SESSION_SECRET"] ?? "dev-secret-change-me";
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

/**
 * Verify a signed state string. Returns the original payload if valid, or
 * throws if the signature doesn't match (CSRF / forgery attempt).
 */
export function verifyState(signed: string): string {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) throw new Error("Invalid OAuth state: missing signature");

  const payload = signed.slice(0, lastDot);
  const receivedMac = signed.slice(lastDot + 1);

  const secret = process.env["SESSION_SECRET"] ?? "dev-secret-change-me";
  const expectedMac = createHmac("sha256", secret).update(payload).digest("hex");

  // Constant-time comparison to prevent timing attacks
  const received = Buffer.from(receivedMac, "hex");
  const expected = Buffer.from(expectedMac, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("OAuth state signature mismatch — possible CSRF attempt");
  }

  return payload;
}

// ── Authorization URL ─────────────────────────────────────────────────────────

/**
 * Generate the Google consent screen URL for a given tenant.
 * The `tenantId` is embedded in a signed `state` parameter so the callback
 * can identify which tenant to store the token for, with CSRF protection.
 */
export function getAuthorizationUrl(tenantId: string): string {
  const client = createOAuth2Client();
  const state = signState(`tenantId=${tenantId}`);

  return client.generateAuthUrl({
    access_type: "offline",   // request a refresh token
    prompt: "consent",        // force consent screen so refresh token is always issued
    scope: SCOPES,
    state,
  });
}

// ── Code exchange ─────────────────────────────────────────────────────────────

export interface ExchangeResult {
  refreshToken: string;
  accessToken: string | null;
  /** ISO string of when the access token expires, or null if unknown. */
  expiryDate: string | null;
  /** The Google account email address that was authorized. */
  email: string | null;
}

/**
 * Exchange an authorization code for tokens. Returns the refresh token plus
 * the Google account email so we can show "Connected as user@gmail.com" in
 * the dashboard. Throws on network / API errors.
 */
export async function exchangeCodeForTokens(code: string): Promise<ExchangeResult> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    // This happens when the user has already authorized the app and we didn't
    // pass prompt:"consent". We always pass it, so this is a safety net only.
    throw new Error(
      "Google did not return a refresh token. Make sure the OAuth consent " +
      "screen is configured with prompt:consent and access_type:offline.",
    );
  }

  // Fetch the authorized account's email via the userinfo endpoint
  client.setCredentials(tokens);
  let email: string | null = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    email = data.email ?? null;
  } catch {
    // Non-fatal — we just won't know which account was connected
  }

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? null,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    email,
  };
}

// ── Authenticated client for API calls ────────────────────────────────────────

/**
 * Build an OAuth2Client pre-loaded with a tenant's refresh token. The client
 * handles silent access-token refresh automatically on each API call.
 */
export function getAuthorizedClient(refreshToken: string): OAuth2Client {
  const client = createOAuth2Client();
  const credentials: Credentials = { refresh_token: refreshToken };
  client.setCredentials(credentials);
  return client;
}

// ── Token revocation ──────────────────────────────────────────────────────────

/**
 * Revoke a refresh token at Google's servers. Best-effort: if the token is
 * already expired/revoked Google returns a 400, which we silently ignore so
 * our DB cleanup still runs.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    const client = createOAuth2Client();
    await client.revokeToken(refreshToken);
  } catch {
    // Intentionally swallowed — stale/invalid tokens can't be revoked but we
    // still want to clear them from the database.
  }
}
