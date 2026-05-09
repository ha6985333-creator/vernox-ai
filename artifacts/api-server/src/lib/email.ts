import { Resend } from "resend";
import { logger } from "./logger.js";
import { BUSINESS_TYPE } from "../config.js";

export interface BookingDetails {
  name: string;
  email: string;
  phone: string;
  address: string;
  datetime: string;
  issue: string;
}

export interface CredentialsEmailInput {
  name: string;
  email: string;
  password: string;
  plan: string;
}

function getResend(): Resend | null {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function notifyTarget(email: string): string {
  return process.env["NOTIFY_EMAIL"] || email;
}

export async function sendConfirmationEmail(booking: BookingDetails): Promise<void> {
  const resend = getResend();
  if (!resend) { logger.warn("RESEND_API_KEY not set — skipping booking email"); return; }

  const to = notifyTarget(booking.email);
  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to,
    subject: `New Booking: ${booking.name} — ${booking.datetime}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.5rem;">New Appointment Booking</h1>
        </div>
        <p style="color:#374151;">A new appointment was booked via the chat widget.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%;">Customer</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.name}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Issue</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.issue}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Date &amp; Time</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.datetime}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Service Address</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.address}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.phone}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Email</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.email}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:0.85rem;">— ${BUSINESS_TYPE} chat widget</p>
      </div>`,
  });

  if (error) logger.error({ error }, "Failed to send booking email");
  else logger.info({ to }, "Booking notification email sent");
}

export async function sendCredentialsEmail(input: CredentialsEmailInput): Promise<void> {
  const resend = getResend();
  if (!resend) { logger.warn("RESEND_API_KEY not set — skipping credentials email"); return; }

  // Credentials always go to the actual customer, never redirected to NOTIFY_EMAIL
  const to = input.email;
  const loginUrl = `https://${process.env["REPLIT_DOMAINS"]}/login`;

  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to,
    subject: `Your account is ready — ${BUSINESS_TYPE}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.5rem;">Welcome, ${input.name}!</h1>
        </div>
        <p style="color:#374151;">Your <strong>${input.plan}</strong> account has been created. Here are your login credentials:</p>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:20px 0;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:0.85rem;">EMAIL</p>
          <p style="margin:0 0 16px;color:#111827;font-weight:700;font-size:1rem;">${input.email}</p>
          <p style="margin:0 0 8px;color:#6b7280;font-size:0.85rem;">TEMPORARY PASSWORD</p>
          <p style="margin:0;color:#111827;font-weight:700;font-size:1rem;letter-spacing:0.05em;">${input.password}</p>
        </div>
        <a href="${loginUrl}" style="display:block;text-align:center;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600;font-size:1rem;margin:24px 0;">Log In Now →</a>
        <p style="color:#6b7280;font-size:0.8rem;">Please change your password after logging in. If you have any questions, reply to this email.</p>
      </div>`,
  });

  if (error) logger.error({ error }, "Failed to send credentials email");
  else logger.info({ to }, "Credentials email sent");
}
