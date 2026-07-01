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
vi.mock("@workspace/db", () => {
  const values = () => {
    const p: Promise<unknown> & { returning?: () => Promise<unknown[]> } =
      Promise.resolve(undefined);
    p.returning = () => Promise.resolve([{ id: "lead-1" }]);
    return p;
  };
  return {
    db: {
      query: { tenantsTable: { findFirst: mocks.tenantsFindFirst } },
      insert: () => ({ values }),
    },
    leadsTable: {},
    bookingAttemptsTable: {},
  };
});

// Calendar: keep the real datetime parsing (toEpochMs / SERVER_TIMEZONE) so the
// booking validates; stub the network-bound availability + event helpers.
vi.mock("../lib/calendar.js", async (importActual) => {
  const actual = await importActual<typeof import("../lib/calendar.js")>();
  return {
    ...actual,
    checkAvailability: vi.fn(() => Promise.resolve(true)),
    findNextAvailableSlots: vi.fn(() => Promise.resolve([])),
    addCalendarEvent: vi.fn(() => Promise.resolve("evt-1")),
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
