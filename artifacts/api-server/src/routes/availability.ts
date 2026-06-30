import { Router, type IRouter } from "express";
import { db, availabilityChecksTable } from "@workspace/db";
import { checkAvailability, findNextAvailableSlots, type SlotOptions } from "../lib/calendar.js";
import type { BusinessHours } from "../lib/businessHours.js";

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

  // When a tenant is given, use its configured hours/timezone/duration as the
  // defaults; explicit body params (timezone/durationMinutes) still win.
  let tenantHours: BusinessHours | undefined;
  let tenantTimezone: string | undefined;
  let tenantDuration: number | undefined;
  if (tenantId) {
    const tenant = await db.query.tenantsTable.findFirst({
      where: (t, { eq }) => eq(t.id, tenantId),
    });
    if (tenant) {
      tenantHours = tenant.businessHours ?? undefined;
      tenantTimezone = tenant.timezone ?? undefined;
      tenantDuration = tenant.bookingDurationMinutes ?? undefined;
    }
  }

  const slotOptions: SlotOptions = {
    durationMinutes: body.durationMinutes !== undefined ? duration : tenantDuration ?? duration,
    businessHours: tenantHours,
    timeZone: timezone ?? tenantTimezone,
  };

  try {
    const available = await checkAvailability(requestedDateTime, slotOptions);
    const suggestedTimes = available
      ? []
      : await findNextAvailableSlots(requestedDateTime, 4, slotOptions);

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
