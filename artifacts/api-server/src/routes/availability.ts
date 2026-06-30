import { Router, type IRouter } from "express";
import { db, availabilityChecksTable } from "@workspace/db";
import { checkAvailability, findNextAvailableSlots } from "../lib/calendar.js";

const router: IRouter = Router();

interface CheckBody {
  requestedDateTime?: unknown;
  timezone?: unknown;
  durationMinutes?: unknown;
  tenantId?: unknown;
}

// POST /api/check-availability
// Checks Google Calendar for a requested slot. If taken, returns alternatives.
router.post("/check-availability", async (req, res) => {
  const body = (req.body ?? {}) as CheckBody;

  const requestedDateTime =
    typeof body.requestedDateTime === "string" ? body.requestedDateTime.trim() : "";
  if (!requestedDateTime) {
    res.status(400).json({ error: "requestedDateTime (ISO 8601 string) is required" });
    return;
  }
  const when = new Date(requestedDateTime);
  if (isNaN(when.getTime())) {
    res.status(400).json({ error: "requestedDateTime must be a valid ISO 8601 date string" });
    return;
  }

  const timezone =
    typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : undefined;
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      res.status(400).json({ error: "Invalid timezone" });
      return;
    }
  }

  let duration = 60;
  if (body.durationMinutes !== undefined) {
    const d = Number(body.durationMinutes);
    if (!Number.isFinite(d) || d <= 0 || d > 480) {
      res.status(400).json({ error: "durationMinutes must be a positive number up to 480" });
      return;
    }
    duration = Math.round(d);
  }

  const tenantId =
    typeof body.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : undefined;

  try {
    const available = await checkAvailability(requestedDateTime, duration);
    const suggestedTimes = available
      ? []
      : await findNextAvailableSlots(requestedDateTime, 4, duration, timezone);

    // Best-effort log; never let logging failures break the response.
    try {
      await db.insert(availabilityChecksTable).values({
        tenantId: tenantId ?? null,
        checkedDatetime: when,
        timezone: timezone ?? null,
        isAvailable: available,
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to log availability check");
    }

    res.json({
      available,
      requestedDateTime,
      suggestedTimes,
      timezone: timezone ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "check-availability failed");
    res.status(502).json({ error: "Could not check calendar availability. Please try again." });
  }
});

export default router;
