import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { getSystemPrompt } from "../businessTypes.js";

// A future date so the booking passes the "must be in the future" validation.
const FUTURE_ISO = "2099-07-15T14:00:00";

// The reply the (mocked) LLM returns — includes a complete booking marker so the
// chat route runs the full booking side-effect path where gating is applied.
const BOOKING_REPLY =
  'All set!\nBOOKING_COMPLETE::{"name":"Jane Doe","email":"jane@example.com","phone":"5551234567","address":"123 Main St","datetime":"' +
  FUTURE_ISO +
  '","issue":"leaky faucet"}';

// ── Mocks ────────────────────────────────────────────────────────────────────
interface GroqArgs {
  messages: { role: string; content: string }[];
}
interface OwnerArgs {
  qualityScore: number | null;
  slackAllowed: boolean;
}

const mocks = vi.hoisted(() => ({
  create: vi.fn((_args: GroqArgs) =>
    Promise.resolve({ choices: [{ message: { content: "" } }] }),
  ),
  tenantsFindFirst: vi.fn(),
  notifyBusinessOwner: vi.fn((_args: OwnerArgs) =>
    Promise.resolve({ anyFailed: false }),
  ),
  scoreLead: vi.fn(() => 100),
  checkAvailability: vi.fn((_iso: string, _opts?: unknown) =>
    Promise.resolve(true),
  ),
  findNextAvailableSlots: vi.fn((_iso: string, _count?: number, _opts?: unknown) =>
    Promise.resolve([] as string[]),
  ),
  addCalendarEvent: vi.fn(() => Promise.resolve("evt-1" as string | null)),
  leadInsertValues: vi.fn(),
  bookingAttemptInsertValues: vi.fn(),
}));

// Groq SDK: capture the system prompt passed to the model.
vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create: mocks.create } };
  },
}));

// @workspace/db connects to Postgres on import — mock it. insert(...).values(...)
// is used both awaited directly (booking attempts) and with .returning() (leads),
// so values() returns a thenable that also exposes returning().
// Unique table sentinels so the insert mock can tell which table a call targets.
const LEADS_TABLE = { __table: "leads" };
const BOOKING_ATTEMPTS_TABLE = { __table: "booking_attempts" };

vi.mock("@workspace/db", () => {
  const makeValues = (recorder: (v: unknown) => void) => (vals: unknown) => {
    recorder(vals);
    const p: Promise<unknown> & { returning?: () => Promise<unknown[]> } =
      Promise.resolve(undefined);
    p.returning = () => Promise.resolve([{ id: "lead-1" }]);
    return p;
  };
  return {
    db: {
      query: { tenantsTable: { findFirst: mocks.tenantsFindFirst } },
      insert: (table: unknown) => {
        if (table === BOOKING_ATTEMPTS_TABLE) {
          return { values: makeValues(mocks.bookingAttemptInsertValues) };
        }
        return { values: makeValues(mocks.leadInsertValues) };
      },
    },
    leadsTable: LEADS_TABLE,
    bookingAttemptsTable: BOOKING_ATTEMPTS_TABLE,
  };
});

// Calendar: keep the real datetime parsing (toEpochMs / SERVER_TIMEZONE) so the
// booking validates; stub the network-bound availability + event helpers.
vi.mock("../lib/calendar.js", async (importActual) => {
  const actual = await importActual<typeof import("../lib/calendar.js")>();
  return {
    ...actual,
    checkAvailability: mocks.checkAvailability,
    findNextAvailableSlots: mocks.findNextAvailableSlots,
    addCalendarEvent: mocks.addCalendarEvent,
  };
});

vi.mock("../lib/email.js", () => ({
  sendConfirmationEmail: vi.fn(() => Promise.resolve()),
  sendBookingConfirmationToCustomer: vi.fn(() =>
    Promise.resolve({ success: true, error: null }),
  ),
}));

// notifications.js: capture the qualityScore + slackAllowed passed to the owner
// notifier. scoreLead is also mocked, so if the route ever wrongly scores a Pro
// lead we'd see a non-null value flow through.
vi.mock("../lib/notifications.js", () => ({
  notifyBusinessOwner: mocks.notifyBusinessOwner,
  scoreLead: mocks.scoreLead,
}));

async function buildApp() {
  const chatRouter = (await import("./chat.js")).default;
  const app = express();
  app.use(express.json());
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  app.use((req, _res, next) => {
    (req as unknown as { log: typeof log }).log = log;
    next();
  });
  app.use("/api", chatRouter);
  return app;
}

describe("POST /api/chat — tier gating on booking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["GROQ_API_KEY"] = "test-key";
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: BOOKING_REPLY } }],
    });
    mocks.notifyBusinessOwner.mockResolvedValue({ anyFailed: false });
    mocks.checkAvailability.mockResolvedValue(true);
    mocks.findNextAvailableSlots.mockResolvedValue([]);
    mocks.addCalendarEvent.mockResolvedValue("evt-1");
  });

  it("gives a Pro tenant a null quality score and the general AI prompt", async () => {
    // Tenant is on Pro but has an industry set — gating must ignore the industry.
    mocks.tenantsFindFirst.mockResolvedValue({
      id: "t1",
      plan: "pro",
      businessType: "restaurant",
      businessName: "Tony's Bistro",
      name: "Tony",
      email: "tony@example.com",
      services: ["Dinner"],
      businessDescription: "A cozy spot",
    });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "book me in" }], tenantId: "t1" });

    expect(res.status).toBe(200);
    expect(res.body.bookingConfirmed).toBe(true);

    // 1) The system prompt sent to the model is the GENERAL prompt, not the
    //    restaurant one — industry-specific AI is Business+.
    const sentPrompt = mocks.create.mock.calls[0][0].messages[0].content;
    const generalPrompt = getSystemPrompt("general", "Tony's Bistro", {
      services: ["Dinner"],
      description: "A cozy spot",
    });
    const restaurantPrompt = getSystemPrompt("restaurant", "Tony's Bistro", {
      services: ["Dinner"],
      description: "A cozy spot",
    });
    expect(sentPrompt).toBe(generalPrompt);
    expect(sentPrompt).not.toBe(restaurantPrompt);

    // 2) The owner notification carries a null quality score, and lead scoring
    //    was never even computed for a Pro tenant.
    expect(mocks.notifyBusinessOwner).toHaveBeenCalledTimes(1);
    const ownerArgs = mocks.notifyBusinessOwner.mock.calls[0][0];
    expect(ownerArgs.qualityScore).toBeNull();
    expect(ownerArgs.slackAllowed).toBe(false);
    expect(mocks.scoreLead).not.toHaveBeenCalled();
  });

  it("gives a Business tenant a real quality score and the industry prompt", async () => {
    mocks.tenantsFindFirst.mockResolvedValue({
      id: "t2",
      plan: "business",
      businessType: "restaurant",
      businessName: "Tony's Bistro",
      name: "Tony",
      email: "tony@example.com",
      services: ["Dinner"],
      businessDescription: "A cozy spot",
    });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "book me in" }], tenantId: "t2" });

    expect(res.status).toBe(200);
    expect(res.body.bookingConfirmed).toBe(true);

    const sentPrompt = mocks.create.mock.calls[0][0].messages[0].content;
    const restaurantPrompt = getSystemPrompt("restaurant", "Tony's Bistro", {
      services: ["Dinner"],
      description: "A cozy spot",
    });
    expect(sentPrompt).toBe(restaurantPrompt);

    expect(mocks.scoreLead).toHaveBeenCalledTimes(1);
    const ownerArgs = mocks.notifyBusinessOwner.mock.calls[0][0];
    expect(ownerArgs.qualityScore).toBe(100);
    expect(ownerArgs.slackAllowed).toBe(true);
  });
});

describe("POST /api/chat — fail-closed double-booking safeguard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["GROQ_API_KEY"] = "test-key";
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: BOOKING_REPLY } }],
    });
    mocks.notifyBusinessOwner.mockResolvedValue({ anyFailed: false });
    mocks.checkAvailability.mockResolvedValue(true);
    mocks.findNextAvailableSlots.mockResolvedValue([]);
    mocks.addCalendarEvent.mockResolvedValue("evt-1");
    mocks.tenantsFindFirst.mockResolvedValue({
      id: "t1",
      plan: "business",
      businessType: "general",
      businessName: "Acme Services",
      name: "Owner",
      email: "owner@example.com",
      services: ["Repairs"],
      businessDescription: "We fix things",
    });
  });

  it("does NOT confirm the booking when the calendar is unreachable (fails closed)", async () => {
    // Calendar outage — checkAvailability throws.
    mocks.checkAvailability.mockRejectedValue(new Error("calendar unreachable"));

    const app = await buildApp();
    const res = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "book me in" }], tenantId: "t1" });

    // 1) The booking must NOT be confirmed.
    expect(res.status).toBe(200);
    expect(res.body.bookingConfirmed).toBe(false);

    // 2) No calendar event may be created for an unverified slot.
    expect(mocks.addCalendarEvent).not.toHaveBeenCalled();

    // 3) The lead is still captured so the owner can follow up manually.
    expect(mocks.leadInsertValues).toHaveBeenCalledTimes(1);

    // 4) The attempt is logged with available=null (calendar could not be reached)
    //    and bookingCreated=false.
    expect(mocks.bookingAttemptInsertValues).toHaveBeenCalledTimes(1);
    const attempt = mocks.bookingAttemptInsertValues.mock.calls[0][0] as {
      available: boolean | null;
      bookingCreated: boolean;
      calendarEventId: string | null;
    };
    expect(attempt.available).toBeNull();
    expect(attempt.bookingCreated).toBe(false);
    expect(attempt.calendarEventId).toBeNull();

    // 5) No owner notification / customer-facing confirmation side effects fired.
    expect(mocks.notifyBusinessOwner).not.toHaveBeenCalled();
  });

  it("does NOT confirm and offers alternatives when the slot is already taken", async () => {
    // Slot is taken — checkAvailability returns false; suggest next open times.
    mocks.checkAvailability.mockResolvedValue(false);
    const suggestions = [
      "2099-07-15T15:00:00.000Z",
      "2099-07-15T16:00:00.000Z",
    ];
    mocks.findNextAvailableSlots.mockResolvedValue(suggestions);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "book me in" }], tenantId: "t1" });

    // 1) The booking must NOT be confirmed.
    expect(res.status).toBe(200);
    expect(res.body.bookingConfirmed).toBe(false);

    // 2) Suggested alternative times are offered back to the customer.
    expect(res.body.suggestedTimes).toEqual(suggestions);

    // 3) No calendar event is created for a taken slot.
    expect(mocks.addCalendarEvent).not.toHaveBeenCalled();

    // 4) The attempt is logged as unavailable with the suggested times.
    expect(mocks.bookingAttemptInsertValues).toHaveBeenCalledTimes(1);
    const attempt = mocks.bookingAttemptInsertValues.mock.calls[0][0] as {
      available: boolean | null;
      bookingCreated: boolean;
      suggestedTimes: string[];
    };
    expect(attempt.available).toBe(false);
    expect(attempt.bookingCreated).toBe(false);
    expect(attempt.suggestedTimes).toEqual(suggestions);
  });
});
