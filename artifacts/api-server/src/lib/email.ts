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

  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to: booking.email,
    subject: `Appointment Confirmed — ${BUSINESS_TYPE}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.5rem;">Appointment Confirmed</h1>
        </div>
        <p style="color:#374151;font-size:1rem;">Hi <strong>${booking.name}</strong>,</p>
        <p style="color:#374151;">Your appointment has been booked. Here's a summary:</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%;">Service</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.issue}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Date &amp; Time</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.datetime}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Address</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.address}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.phone}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:0.85rem;margin-top:32px;">If you need to reschedule or have any questions, just reply to this email.</p>
        <p style="color:#6b7280;font-size:0.85rem;">— The ${BUSINESS_TYPE} team</p>
      </div>
    `,
  });

  if (error) {
    logger.error({ error }, "Failed to send confirmation email");
  } else {
    logger.info({ to: booking.email }, "Confirmation email sent");
  }
}
