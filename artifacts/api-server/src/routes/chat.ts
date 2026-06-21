import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { SYSTEM_PROMPT } from "../config.js";
import { sendConfirmationEmail, type BookingDetails } from "../lib/email.js";
import { addCalendarEvent } from "../lib/calendar.js";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
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

function extractAndValidateBooking(reply: string): {
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

  // Address
  if (!parsed.address || parsed.address.trim().length < 5) {
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
        address: parsed.address!.trim(),
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
    const groq = new Groq({ apiKey });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const rawReply = completion.choices[0]?.message?.content ?? "";
    const { clean, result } = extractAndValidateBooking(rawReply);

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

    // ── Booking detected — run side-effects with full error tracking ──
    const booking = result.booking;

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

    try {
      await addCalendarEvent(booking);
      bookingResults.calendarEvent.created = true;
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
