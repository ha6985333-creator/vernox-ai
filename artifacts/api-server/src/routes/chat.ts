import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { SYSTEM_PROMPT } from "../config.js";
import { sendConfirmationEmail, type BookingDetails } from "../lib/email.js";
import { addCalendarEvent } from "../lib/calendar.js";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";

const router: IRouter = Router();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const BOOKING_MARKER = "BOOKING_COMPLETE::";

function extractBooking(reply: string): { clean: string; booking: BookingDetails | null } {
  const markerIndex = reply.indexOf(BOOKING_MARKER);
  if (markerIndex === -1) return { clean: reply, booking: null };

  const clean = reply.slice(0, markerIndex).trim();
  const jsonStr = reply.slice(markerIndex + BOOKING_MARKER.length).trim();

  try {
    const booking = JSON.parse(jsonStr) as BookingDetails;
    return { clean, booking };
  } catch {
    return { clean, booking: null };
  }
}

async function captureLead(booking: BookingDetails, tenantId: string): Promise<void> {
  const now = new Date();
  const firstFollowUp = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  let preferredDatetime: Date | undefined;
  if (booking.datetime) {
    const parsed = new Date(booking.datetime);
    if (!isNaN(parsed.getTime())) preferredDatetime = parsed;
  }

  await db.insert(leadsTable).values({
    tenantId,
    visitorName: booking.name || "Unknown",
    visitorEmail: booking.email || "",
    visitorPhone: booking.phone || "",
    visitorAddress: booking.address || "",
    serviceIssue: booking.issue || "",
    preferredDatetime: preferredDatetime ?? null,
    status: "new",
    nextFollowUpDate: firstFollowUp,
  });
}

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
    const { clean, booking } = extractBooking(rawReply);

    if (booking?.email) {
      // Fire all side-effects in parallel — none block the chat response
      const sideEffects: Promise<void>[] = [
        sendConfirmationEmail(booking).catch(() => {}),
        addCalendarEvent(booking).catch(() => {}),
      ];

      // Capture lead if we have a tenantId (from embed widget)
      if (tenantId) {
        sideEffects.push(
          captureLead(booking, tenantId).catch((err) => {
            req.log.error({ err, tenantId }, "Failed to capture lead");
          })
        );
      }

      Promise.all(sideEffects);
    }

    res.json({ message: clean, bookingConfirmed: !!booking });
  } catch (err) {
    req.log.error({ err }, "Groq API error");
    res.status(502).json({ error: "Failed to reach AI service." });
  }
});

export default router;
