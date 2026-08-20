import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { getBusinessType, getSystemPrompt } from "../businessTypes.js";
import { featuresForPlan } from "../tiers.js";
import { sendConfirmationEmail, sendBookingConfirmationToCustomer, type BookingDetails } from "../lib/email.js";
import { notifyBusinessOwner, scoreLead } from "../lib/notifications.js";
import {
  addCalendarEvent,
  checkAvailability,
  findNextAvailableSlots,
  SERVER_TIMEZONE,
  toEpochMs,
} from "../lib/calendar.js";
import type { BusinessHours } from "../lib/businessHours.js";
import { db } from "@workspace/db";
import { leadsTable, bookingAttemptsTable } from "@workspace/db";
import { parseBookingDatetime } from "../lib/dateParser.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const BOOKING_MARKER = "BOOKING_COMPLETE::";

// ── Extract & validate booking ────────────────────────────────────────────────

interface ValidationResult {
  booking: BookingDetails | null;
  errors: string[];
}

function extractAndValidateBooking(reply: string, collectAddress = true, timeZone = SERVER_TIMEZONE): {
  clean: string;
  result: ValidationResult;
} {
  const markerIndex = reply.indexOf(BOOKING_MARKER);
  if (markerIndex === -1) return { clean: reply, result: { booking: null, errors: [] } };

  const clean = reply.slice(0, markerIndex).trim();

  // Strip markdown code fences and trailing garbage after the JSON object
  let jsonStr = reply.slice(markerIndex + BOOKING_MARKER.length).trim();
  jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  // Grab only the first complete JSON object (guards against AI appending extra text)
  const objEnd = jsonStr.indexOf("}");
  if (objEnd !== -1) jsonStr = jsonStr.slice(0, objEnd + 1);

  let parsed: Partial<BookingDetails> = {};
  try {
    parsed = JSON.parse(jsonStr) as Partial<BookingDetails>;
  } catch {
    return {
      clean,
      result: {
        booking: null,
        errors: ["Booking data could not be read — please confirm your details again."],
      },
    };
  }

  const errors: string[] = [];

  // Name
  if (!parsed.name || parsed.name.trim().length < 2) {
    errors.push("a valid full name");
  }

  // Email
  if (!parsed.email || !/.+@.+\..+/.test(parsed.email)) {
    errors.push("a valid email address");
  }

  // Phone — strip non-digits, require ≥ 10 digits
  const phoneDigits = (parsed.phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length < 10) {
    errors.push("a valid phone number (at least 10 digits)");
  }

  // Address — only required for business types that send someone to a location
  if (collectAddress && (!parsed.address || parsed.address.trim().length < 5)) {
    errors.push("a service address");
  }

  // Datetime — the AI emits a zoneless ISO ("2026-07-15T14:00:00") that means a
  // wall-clock time in the TENANT's timezone. toEpochMs() interprets it in that
  // tz (and honors an explicit Z/offset if present); natural-language values fall
  // back to the legacy server-local parser.
  let bookingMs = toEpochMs(parsed.datetime ?? "", timeZone);
  if (isNaN(bookingMs)) {
    const fallback = parseBookingDatetime(parsed.datetime ?? "");
    bookingMs = fallback ? fallback.getTime() : NaN;
  }
  if (isNaN(bookingMs) || bookingMs < Date.now()) {
    errors.push("a valid future date and time");
  }

  if (errors.length > 0) {
    return {
      clean,
      result: { booking: null, errors },
    };
  }

  return {
    clean,
    result: {
      booking: {
        name: parsed.name!.trim(),
        email: parsed.email!.trim().toLowerCase(),
        phone: parsed.phone!.trim(),
        address: (parsed.address ?? "").trim(),
        datetime: new Date(bookingMs).toISOString(),
        issue: parsed.issue ?? "",
      },
      errors: [],
    },
  };
}

// ── Lead capture ──────────────────────────────────────────────────────────────

/** Render the chat history into a plain-text transcript stored with the lead.
 * `finalReply` is the bot's last message this turn (generated server-side, so it
 * isn't yet in `messages`) — appended so the saved transcript is complete. */
function formatTranscript(messages: ChatMessage[], finalReply?: string): string {
  const lines = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const who = m.role === "user" ? "Customer" : "Assistant";
      return `${who}: ${m.content}`;
    });
  if (finalReply && finalReply.trim()) {
    lines.push(`Assistant: ${finalReply.trim()}`);
  }
  return lines.join("\n\n");
}

async function captureLead(
  booking: BookingDetails,
  tenantId: string,
  transcript?: string,
): Promise<string | null> {
  const now = new Date();
  const firstFollowUp = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const preferredDatetime = booking.datetime ? new Date(booking.datetime) : undefined;

  const [lead] = await db.insert(leadsTable).values({
    tenantId,
    visitorName: booking.name,
    visitorEmail: booking.email,
    visitorPhone: booking.phone,
    visitorAddress: booking.address,
    serviceIssue: booking.issue,
    preferredDatetime: preferredDatetime ?? null,
    conversationTranscript: transcript ?? null,
    status: "new",
    nextFollowUpDate: firstFollowUp,
  }).returning({ id: leadsTable.id });

  return lead?.id ?? null;
}

// ── Availability helpers ──────────────────────────────────────────────────────

/** Human-friendly rendering of an ISO slot, e.g. "Tue, Jul 14, 2:00 PM EDT". */
function formatSlot(iso: string, timeZone: string = SERVER_TIMEZONE): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(d);
}

/** Best-effort log of a booking attempt; never throws. */
async function logBookingAttempt(params: {
  booking: BookingDetails;
  tenantId?: string;
  available: boolean | null;
  bookingCreated: boolean;
  calendarEventId: string | null;
  suggestedTimes: string[];
  timezone?: string;
}): Promise<void> {
  try {
    await db.insert(bookingAttemptsTable).values({
      tenantId: params.tenantId ?? null,
      customerName: params.booking.name,
      customerEmail: params.booking.email,
      customerPhone: params.booking.phone,
      requestedDatetime: new Date(params.booking.datetime),
      timezone: params.timezone ?? SERVER_TIMEZONE,
      available: params.available,
      suggestedTimes: params.suggestedTimes,
      bookingCreated: params.bookingCreated,
      calendarEventId: params.calendarEventId,
    });
  } catch (err) {
    logger.warn({ err }, "Failed to log booking attempt");
  }
}

// ── Chat route ────────────────────────────────────────────────────────────────

router.post("/chat", async (req, res) => {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY is not configured." });
    return;
  }

  const { messages, tenantId } = req.body as { messages: ChatMessage[]; tenantId?: string };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required." });
    return;
  }

  for (const msg of messages) {
    if (typeof msg.content === "string" && msg.content.length > 4000) {
      res.status(400).json({ error: "Message exceeds maximum length of 4000 characters." });
      return;
    }
  }

  try {
    // Resolve this tenant's industry + scheduling config so the bot asks
    // tailored questions and the availability checks use the right hours/tz.
    let businessTypeValue: string | undefined;
    let businessName: string | undefined;
    let tenantName: string | undefined;
    let tenantEmail: string | undefined;
    let businessPhone: string | null = null;
    let businessAddress: string | null = null;
    let services: string[] | undefined;
    let businessDescription: string | undefined;
    let businessHours: BusinessHours | undefined;
    let timeZone = SERVER_TIMEZONE;
    let durationMinutes = 60;
    let plan: string | null = null;
    let tenantRefreshToken: string | null = null;
    if (tenantId) {
      const tenant = await db.query.tenantsTable.findFirst({
        where: (t, { eq }) => eq(t.id, tenantId),
      });
      if (tenant) {
        businessTypeValue = tenant.businessType;
        businessName = tenant.businessName ?? undefined;
        tenantName = tenant.name;
        tenantEmail = tenant.email;
        businessPhone = tenant.businessPhone ?? null;
        businessAddress = tenant.businessAddress ?? null;
        services = tenant.services ?? undefined;
        businessDescription = tenant.businessDescription ?? undefined;
        businessHours = tenant.businessHours ?? undefined;
        timeZone = tenant.timezone ?? SERVER_TIMEZONE;
        durationMinutes = tenant.bookingDurationMinutes ?? 60;
        plan = tenant.plan;
        tenantRefreshToken = tenant.googleRefreshToken ?? null;
      } else {
        req.log.warn({ tenantId }, "chat: tenantId provided but no matching tenant found; falling back to general prompt");
      }
    }
    // Plan-based feature gating. Industry-specific AI tailoring is Business+; on
    // lower plans the bot falls back to the generic prompt/business type so it
    // still books appointments but doesn't ask industry-specific questions.
    const features = featuresForPlan(plan);
    const effectiveBusinessType = features.industrySpecificAI ? businessTypeValue : "general";
    const businessType = getBusinessType(effectiveBusinessType);
    const systemPrompt = getSystemPrompt(effectiveBusinessType, businessName, {
      services,
      description: businessDescription,
    });
    const slotOptions = { durationMinutes, businessHours, timeZone, refreshToken: tenantRefreshToken };

    const groq = new Groq({ apiKey });

    const completion = await groq.chat.completions.create({
      model: "qwen-3.6-27b",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const rawReply = completion.choices[0]?.message?.content ?? "";
    const { clean, result } = extractAndValidateBooking(rawReply, businessType.collectAddress, timeZone);

    // ── Validation errors ─────────────────────────────────────────
    if (result.errors.length > 0) {
      res.json({
        message: `We need a few corrections — please provide: ${result.errors.join(", ")}.`,
        bookingConfirmed: false,
      });
      return;
    }

    // ── No booking in this turn ───────────────────────────────────
    if (!result.booking) {
      res.json({ message: clean, bookingConfirmed: false });
      return;
    }

    // ── Booking detected ──────────────────────────────────────────
    const booking = result.booking;

    // ── Availability check — prevent double-bookings ──────────────
    // Verify the slot is still open BEFORE confirming or creating an event.
    let available = true;
    let suggestedTimes: string[] = [];
    try {
      available = await checkAvailability(booking.datetime, slotOptions);
      if (!available) {
        suggestedTimes = await findNextAvailableSlots(booking.datetime, 4, slotOptions);
      }
    } catch (err) {
      // Fail CLOSED: if we can't reach the calendar we must NOT confirm a slot we
      // couldn't verify (that's exactly how double-bookings slip through). Capture
      // the lead so the owner can follow up manually, log the attempt, and tell the
      // customer we couldn't confirm — never silently create the event.
      req.log.error(
        { err, tenantId },
        "Availability check failed — calendar unreachable, not confirming booking",
      );

      if (tenantId) {
        try {
          await captureLead(booking, tenantId, formatTranscript(messages, clean));
        } catch (leadErr) {
          req.log.error({ err: leadErr, tenantId }, "Lead capture failed during calendar outage");
        }
      }

      await logBookingAttempt({
        booking,
        tenantId,
        available: null, // unknown — calendar could not be reached
        bookingCreated: false,
        calendarEventId: null,
        suggestedTimes: [],
        timezone: timeZone,
      });

      res.json({
        message:
          "I'm having trouble checking our calendar availability right now, so I can't confirm this time just yet. Please call us to confirm your appointment, or try again in a few minutes — we've saved your details either way.",
        bookingConfirmed: false,
      });
      return;
    }

    if (!available) {
      await logBookingAttempt({
        booking,
        tenantId,
        available: false,
        bookingCreated: false,
        calendarEventId: null,
        suggestedTimes,
        timezone: timeZone,
      });

      const message = suggestedTimes.length
        ? `Unfortunately ${formatSlot(booking.datetime, timeZone)} is no longer available. Here are the next open times:\n${suggestedTimes
            .map((s) => `• ${formatSlot(s, timeZone)}`)
            .join("\n")}\n\nWhich of these works best for you?`
        : `Unfortunately ${formatSlot(booking.datetime, timeZone)} is no longer available, and I couldn't find an open slot in the next 30 days. Could you suggest another time?`;

      res.json({ message, bookingConfirmed: false, suggestedTimes });
      return;
    }

    // ── Slot is free — run side-effects with full error tracking ──
    const bookingResults = {
      confirmationEmail: { sent: false, error: null as string | null },
      customerEmail:     { sent: false, error: null as string | null },
      calendarEvent:     { created: false, error: null as string | null },
      leadCaptured:      { ok: false, error: null as string | null },
    };

    // Owner notification: for tenant bookings this runs per-tenant below
    // (email + Slack + delivery logging) via notifyBusinessOwner. For the
    // tenant-less fallback path, send the legacy global owner email.
    // Lead quality scoring is Business+; on lower plans we don't compute a score.
    const qualityScore = features.leadScoring ? scoreLead(booking) : null;
    if (!tenantId) {
      try {
        await sendConfirmationEmail(booking);
        bookingResults.confirmationEmail.sent = true;
      } catch (err) {
        const error = err as Error;
        bookingResults.confirmationEmail.error = error.message;
        req.log.error(
          { err: error, bookingEmail: booking.email },
          "Confirmation email failed",
        );
      }
    }

    let calendarEventId: string | null = null;
    try {
      calendarEventId = await addCalendarEvent(booking, durationMinutes, timeZone, tenantRefreshToken);
      bookingResults.calendarEvent.created = calendarEventId !== null;
      if (calendarEventId === null) {
        bookingResults.calendarEvent.error = "Calendar API did not return an event id";
      }
    } catch (err) {
      const error = err as Error;
      bookingResults.calendarEvent.error = error.message;
      req.log.error(
        { err: error, bookingEmail: booking.email },
        "Calendar event creation failed",
      );
    }

    let capturedLeadId: string | null = null;
    if (tenantId) {
      try {
        capturedLeadId = await captureLead(booking, tenantId, formatTranscript(messages, clean));
        bookingResults.leadCaptured.ok = true;
      } catch (err) {
        const error = err as Error;
        bookingResults.leadCaptured.error = error.message;
        req.log.error({ err: error, tenantId }, "Lead capture failed");
      }

      // Send the customer their booking confirmation (never throws). Logged to
      // email_logs so the tenant portal can show delivery status.
      const customerResult = await sendBookingConfirmationToCustomer({
        booking,
        whenText: formatSlot(booking.datetime, timeZone),
        tenantId,
        leadId: capturedLeadId,
        businessName: businessName ?? null,
        businessPhone,
        businessAddress,
      });
      bookingResults.customerEmail.sent = customerResult.success;
      bookingResults.customerEmail.error = customerResult.error ?? null;

      // Notify the business owner across their enabled channels (email + Slack),
      // respecting per-tenant settings + quiet hours. Never throws; every
      // outcome is recorded in notification_logs for the portal.
      const ownerResult = await notifyBusinessOwner({
        tenantId,
        tenant: {
          name: tenantName ?? "",
          email: tenantEmail ?? "",
          businessName: businessName ?? null,
          timezone: timeZone,
        },
        booking,
        leadId: capturedLeadId,
        whenText: formatSlot(booking.datetime, timeZone),
        qualityScore,
        slackAllowed: features.slackNotifications,
      });
      // Only a genuine delivery failure should trip the monitoring alert below.
      // Intentional skips (channel disabled / quiet hours) are not failures.
      bookingResults.confirmationEmail.sent = !ownerResult.anyFailed;
      if (ownerResult.anyFailed) {
        bookingResults.confirmationEmail.error = "owner notification delivery failed (see notification log)";
      }
    }

    // ── Monitoring: alert if any critical step failed ─────────────
    // In production wire this to Slack / PagerDuty / email admin
    if (!bookingResults.confirmationEmail.sent || !bookingResults.calendarEvent.created) {
      logger.error(
        {
          severity: "high",
          bookingEmail: booking.email,        // email only — no phone/address in logs
          confirmationEmail: bookingResults.confirmationEmail,
          calendarEvent: bookingResults.calendarEvent,
        },
        "ALERT: Booking partially failed — manual follow-up required",
      );
    } else {
      logger.info(
        {
          bookingEmail: booking.email,
          confirmationEmail: bookingResults.confirmationEmail.sent,
          customerEmail: bookingResults.customerEmail.sent,
          calendarEvent: bookingResults.calendarEvent.created,
        },
        "Booking captured successfully",
      );
    }

    await logBookingAttempt({
      booking,
      tenantId,
      available: true,
      bookingCreated: bookingResults.calendarEvent.created,
      calendarEventId,
      suggestedTimes: [],
      timezone: timeZone,
    });

    // ── Respond — NEVER echo back PII ────────────────────────────
    // Do NOT include: email, phone, address, or bookingResults detail in the response
    res.json({
      message: clean || "✓ All booked! We've sent a confirmation email and added it to our calendar. We'll be in touch shortly.",
      bookingConfirmed: true,
    });
  } catch (err) {
    req.log.error({ err }, "Groq API error");
    res.status(502).json({ error: "Failed to reach AI service." });
  }
});

export default router;
