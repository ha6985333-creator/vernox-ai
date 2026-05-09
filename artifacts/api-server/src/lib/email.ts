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

export async function sendConfirmationEmail(booking: BookingDetails): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    logger.warn("RESEND_API_KEY not set — skipping confirmation email");
    return;
  }

  const resend = new Resend(apiKey);

  // NOTIFY_EMAIL is the business owner's verified Resend email.
  // Until a custom domain is verified at resend.com/domains, Resend only
  // allows sending to the account's own email address.
  // Set NOTIFY_EMAIL to override; falls back to the customer's address.
  const notifyEmail = process.env["NOTIFY_EMAIL"] || booking.email;

  const emailHtml = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
      <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
        <h1 style="color:#fff;margin:0;font-size:1.5rem;">New Appointment Booking</h1>
      </div>
      <p style="color:#374151;font-size:1rem;">A new appointment has been booked via the chat widget.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%;">Customer</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.name}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Issue</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.issue}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Date &amp; Time</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.datetime}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Service Address</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.address}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.phone}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Email</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.email}</td></tr>
      </table>
      <p style="color:#6b7280;font-size:0.85rem;margin-top:32px;">— ${BUSINESS_TYPE} chat widget</p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to: notifyEmail,
    subject: `New Booking: ${booking.name} — ${booking.datetime}`,
    html: emailHtml,
  });

  if (error) {
    logger.error({ error }, "Failed to send confirmation email");
  } else {
    logger.info({ to: notifyEmail }, "Booking notification email sent");
  }
}
