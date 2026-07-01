import { logger } from "./logger.js";

// ─────────────────────────────────────────────────────────────
//  SMS delivery via Twilio's REST API.
//
//  Kept dependency-free (no SDK) — we POST to the Messages endpoint
//  with fetch, mirroring the lightweight Slack webhook approach. SMS
//  degrades gracefully exactly like email (getResend): if the three
//  Twilio secrets are not configured the sender is a no-op that logs
//  "skipped" and never throws, so booking/follow-up flows keep working.
//
//  Required env to actually deliver:
//    TWILIO_ACCOUNT_SID   — starts with "AC..."
//    TWILIO_AUTH_TOKEN    — account auth token
//    TWILIO_FROM_NUMBER   — a verified Twilio sender in E.164 (e.g. +15551234567)
// ─────────────────────────────────────────────────────────────

export interface SmsResult {
  success: boolean;
  messageId?: string;
  /** Set when the send was intentionally not attempted (missing config / bad number). */
  skipped?: boolean;
  error?: string;
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const fromNumber = process.env["TWILIO_FROM_NUMBER"];
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

export function isSmsConfigured(): boolean {
  return getTwilioConfig() !== null;
}

/**
 * Normalize a raw phone string to E.164 as best we can. Returns null when the
 * input clearly can't be a valid number. A leading "+" is preserved; otherwise
 * an 11-digit US number starting with 1 or a 10-digit US number is assumed and
 * prefixed with "+" / "+1". International numbers should already include "+".
 */
export function toE164(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Send a single SMS. Never throws. Returns a structured result so callers can
 * log the true outcome (sent / skipped / failed) rather than assuming success.
 */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const config = getTwilioConfig();
  if (!config) {
    logger.warn("Twilio not configured — skipping SMS");
    return { success: false, skipped: true, error: "Twilio not configured" };
  }

  const dest = toE164(to);
  if (!dest) {
    logger.warn({ to }, "SMS recipient is not a valid phone number — skipping");
    return { success: false, skipped: true, error: "Invalid phone number" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: dest, From: config.fromNumber, Body: body });
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) {
      const msg = data.message || `Twilio responded ${res.status}`;
      logger.error({ status: res.status, error: msg }, "SMS send failed");
      return { success: false, error: msg };
    }
    logger.info({ messageId: data.sid }, "SMS sent");
    return { success: true, messageId: data.sid };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err }, "SMS send threw");
    return { success: false, error: msg };
  }
}
