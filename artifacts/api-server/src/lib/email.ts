import { Resend } from "resend";
import { logger } from "./logger.js";
import { BUSINESS_TYPE, BUSINESS_NAME, BUSINESS_EMAIL } from "../config.js";
import type { Lead } from "@workspace/db";

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

export async function sendConfirmationEmail(booking: BookingDetails): Promise<void> {
  const resend = getResend();
  if (!resend) { logger.warn("RESEND_API_KEY not set — skipping booking email"); return; }

  const to = BUSINESS_EMAIL;
  if (!to) { logger.warn("BUSINESS_EMAIL not configured — skipping booking notification"); return; }

  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to,
    subject: `📅 New Booking: ${booking.name} — ${booking.datetime}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.5rem;">New Appointment Booking</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:0.9rem;">${BUSINESS_NAME}</p>
        </div>
        <p style="color:#374151;">A new appointment was booked via your chat widget.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%;">Customer</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.name}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Issue</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.issue}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Date &amp; Time</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.datetime}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Service Address</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.address}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.phone}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Customer Email</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${booking.email}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:0.85rem;margin-top:16px;">This event has been added to your Google Calendar automatically.</p>
        <p style="color:#6b7280;font-size:0.85rem;">— ${BUSINESS_NAME} chat widget</p>
      </div>`,
  });

  if (error) logger.error({ error }, "Failed to send booking notification email");
  else logger.info({ to }, "Booking notification sent to business owner");
}

export async function sendCredentialsEmail(input: CredentialsEmailInput): Promise<void> {
  const resend = getResend();
  if (!resend) { logger.warn("RESEND_API_KEY not set — skipping credentials email"); return; }

  const to = input.email;
  const domain = process.env["SITE_URL"] ||
    (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim() ||
    "vernoxai.digital";
  const loginUrl = `https://${domain}/login`;

  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to,
    subject: `Your account is ready — ${BUSINESS_NAME}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.5rem;">Welcome, ${input.name}!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:0.9rem;">${BUSINESS_NAME}</p>
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

const FOLLOW_UP_TEMPLATES = [
  {
    subject: (name: string, biz: string) => `Following up on your ${biz} enquiry, ${name}`,
    body: (name: string, issue: string, biz: string) => `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#4f46e5;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.4rem;">Still thinking it over?</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:0.9rem;">${biz}</p>
        </div>
        <p style="color:#374151;">Hi ${name},</p>
        <p style="color:#374151;margin-top:12px;">We noticed you recently enquired about <strong>${issue}</strong> and wanted to check in — have you had a chance to consider our quote?</p>
        <p style="color:#374151;margin-top:12px;">We'd love to help you get this sorted. If you have any questions or need to adjust the timing, just reply to this email.</p>
        <p style="color:#6b7280;font-size:0.85rem;margin-top:24px;">— The ${biz} Team</p>
      </div>`,
  },
  {
    subject: (name: string, biz: string) => `Quick reminder — your ${biz} booking, ${name}`,
    body: (name: string, issue: string, biz: string) => `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#059669;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.4rem;">Don't leave it too long</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:0.9rem;">${biz}</p>
        </div>
        <p style="color:#374151;">Hi ${name},</p>
        <p style="color:#374151;margin-top:12px;">This is a friendly reminder about your <strong>${issue}</strong> enquiry. Small issues can often turn into bigger ones if left unattended — we're ready to help whenever works best for you.</p>
        <p style="color:#374151;margin-top:12px;">Our team has availability this week. Reply to confirm a time that suits you.</p>
        <p style="color:#6b7280;font-size:0.85rem;margin-top:24px;">— The ${biz} Team</p>
      </div>`,
  },
  {
    subject: (name: string, biz: string) => `Last message from ${biz} — we're here if you need us`,
    body: (name: string, issue: string, biz: string) => `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px;">
        <div style="background:#374151;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <h1 style="color:#fff;margin:0;font-size:1.4rem;">We'll leave the door open</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:0.9rem;">${biz}</p>
        </div>
        <p style="color:#374151;">Hi ${name},</p>
        <p style="color:#374151;margin-top:12px;">We won't keep chasing — but please know we're here whenever you're ready to move forward with your <strong>${issue}</strong>.</p>
        <p style="color:#374151;margin-top:12px;">Feel free to reach out any time. We appreciate your interest in ${biz}.</p>
        <p style="color:#6b7280;font-size:0.85rem;margin-top:24px;">— The ${biz} Team</p>
      </div>`,
  },
];

export async function sendLeadFollowUp(lead: Lead, messageNumber: number): Promise<void> {
  const resend = getResend();
  if (!resend) { logger.warn("RESEND_API_KEY not set — skipping lead follow-up email"); return; }

  const template = FOLLOW_UP_TEMPLATES[messageNumber - 1];
  if (!template) throw new Error(`No template for message_number ${messageNumber}`);

  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to: lead.visitorEmail,
    subject: template.subject(lead.visitorName, BUSINESS_NAME),
    html: template.body(lead.visitorName, lead.serviceIssue, BUSINESS_NAME),
  });

  if (error) {
    logger.error({ error, leadId: lead.id }, "Failed to send lead follow-up email");
    throw new Error("Resend failed");
  }
  logger.info({ to: lead.visitorEmail, leadId: lead.id, messageNumber }, "Lead follow-up email sent");
}
