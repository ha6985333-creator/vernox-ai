import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { getBusinessType, getSystemPrompt } from "../businessTypes.js";
import { sendConfirmationEmail, type BookingDetails } from "../lib/email.js";
import {
  addCalendarEvent,
  checkAvailability,
  findNextAvailableSlots,
  SERVER_TIMEZONE,
} from "../lib/calendar.js";
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

function extractAndValidateBooking(reply: string, collectAddress = true): {
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

  // Datetime
  const parsedDate = parseBookingDatetime(parsed.datetime ?? "");
  if (!parsedDate || parsedDate < new Date()) {
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
        datetime: parsedDate!.toISOString(),
        issue: parsed.issue ?? "",
      },
      errors: [],
    },
  };
}

// ── Lead capture ──────────────────────────────────────────────────────────────

async function captureLead(booking: BookingDetails, tenantId: string): Promise<void> {
  const now = new Date();
  const firstFollowUp = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const preferredDatetime = booking.datetime ? new Date(booking.datetime) : undefined;

  await db.insert(leadsTable).values({
    tenantId,
    visitorName: booking.name,
    visitorEmail: booking.email,
    visitorPhone: booking.phone,
    visitorAddress: booking.address,
    serviceIssue: booking.issue,
    preferredDatetime: preferredDatetime ?? null,
    status: "new",
    nextFollowUpDate: firstFollowUp,
  });
}

// ── Availability helpers ──────────────────────────────────────────────────────

/** Human-friendly rendering of an ISO slot, e.g. "Tue, Jul 14, 2:00 PM EDT". */
function formatSlot(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SERVER_TIMEZONE,
    timeZoneName: "short",
  }).format(d);
}

/** Best-effort log of a booking attempt; never throws. */
async function logBookingAttempt(params: {
  booking: BookingDetails;
  tenantId?: string;
  available: boolean;
  bookingCreated: boolean;
  calendarEventId: string | null;
  suggestedTimes: string[];
}): Promise<void> {
  try {
    await db.insert(bookingAttemptsTable).values({
      tenantId: params.tenantId ?? null,
      customerName: params.booking.name,
      customerEmail: params.booking.email,
      customerPhone: params.booking.phone,
      requestedDatetime: new Date(params.booking.datetime),
      timezone: SERVER_TIMEZONE,
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

  try {
    // Resolve this tenant's industry so the bot asks tailored questions.
    let businessTypeValue: string | undefined;
    let businessName: string | undefined;
    if (tenantId) {
      const tenant = await db.query.tenantsTable.findFirst({
        where: (t, { eq }) => eq(t.id, tenantId),
      });
      if (tenant) {
        businessTypeValue = tenant.businessType;
        businessName = tenant.businessName ?? undefined;
      } else {
        req.log.warn({ tenantId }, "chat: tenantId provided but no matching tenant found; falling back to general prompt");
      }
    }
    const businessType = getBusinessType(businessTypeValue);
    const systemPrompt = getSystemPrompt(businessTypeValue, businessName);

    const groq = new Groq({ apiKey });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const rawReply = completion.choices[0]?.message?.content ?? "";
    const { clean, result } = extractAndValidateBooking(rawReply, businessType.collectAddress);

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
      available = await checkAvailability(booking.datetime);
      if (!available) {
        suggestedTimes = await findNextAvailableSlots(booking.datetime, 4);
      }
    } catch (err) {
      // Fail open: if the calendar can't be reached we don't block the booking,
      // but log loudly so a calendar outage is visible.
      req.log.error({ err, tenantId }, "Availability check failed — proceeding without it");
      available = true;
    }

    if (!available) {
      await logBookingAttempt({
        booking,
        tenantId,
        available: false,
        bookingCreated: false,
        calendarEventId: null,
        suggestedTimes,
      });

      const message = suggestedTimes.length
        ? `Unfortunately ${formatSlot(booking.datetime)} is no longer available. Here are the next open times:\n${suggestedTimes
            .map((s) => `• ${formatSlot(s)}`)
            .join("\n")}\n\nWhich of these works best for you?`
        : `Unfortunately ${formatSlot(booking.datetime)} is no longer available, and I couldn't find an open slot in the next 30 days. Could you suggest another time?`;

      res.json({ message, bookingConfirmed: false, suggestedTimes });
      return;
    }

    // ── Slot is free — run side-effects with full error tracking ──
    const bookingResults = {
      confirmationEmail: { sent: false, error: null as string | null },
      calendarEvent:     { created: false, error: null as string | null },
      leadCaptured:      { ok: false, error: null as string | null },
    };

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

    let calendarEventId: string | null = null;
    try {
      calendarEventId = await addCalendarEvent(booking);
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

    if (tenantId) {
      try {
        await captureLead(booking, tenantId);
        bookingResults.leadCaptured.ok = true;
      } catch (err) {
        const error = err as Error;
        bookingResults.leadCaptured.error = error.message;
        req.log.error({ err: error, tenantId }, "Lead capture failed");
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
