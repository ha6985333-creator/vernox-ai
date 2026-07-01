import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ────────────────────────────────────────────────────────────────────
// @workspace/db connects to Postgres on import, so it must be mocked. We expose
// configurable query stubs via vi.hoisted so each test can set the tenant plan.
const mocks = vi.hoisted(() => ({
  usersFindFirst: vi.fn(),
  tenantsFindFirst: vi.fn(),
  onConflictDoUpdate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      usersTable: { findFirst: mocks.usersFindFirst },
      tenantsTable: { findFirst: mocks.tenantsFindFirst },
      notificationSettingsTable: { findFirst: vi.fn(() => Promise.resolve(undefined)) },
    },
    insert: () => ({
      values: () => ({ onConflictDoUpdate: mocks.onConflictDoUpdate }),
    }),
  },
  notificationSettingsTable: { tenantId: "tenantId" },
  notificationLogsTable: {},
}));

// Keep the real SSRF guard (isValidSlackWebhook); only stub the network call.
vi.mock("../lib/notifications.js", async (importActual) => {
  const actual = await importActual<typeof import("../lib/notifications.js")>();
  return { ...actual, postSlack: vi.fn(() => Promise.resolve({ ok: true })) };
});

const VALID_WEBHOOK = "https://hooks.slack.com/services/T000/B000/XXXXXXXX";

async function buildApp() {
  const notificationsRouter = (await import("./notifications.js")).default;
  const app = express();
  app.use(express.json());
  // Simulate an authenticated tenant user.
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: string } }).session = { userId: "u1" };
    next();
  });
  app.use("/api", notificationsRouter);
  return app;
}

describe("POST /api/notifications/slack/connect — tier gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usersFindFirst.mockResolvedValue({ tenantId: "t1" });
    mocks.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  it("returns 403 for a Pro tenant and never persists the webhook", async () => {
    mocks.tenantsFindFirst.mockResolvedValue({ id: "t1", plan: "pro" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/notifications/slack/connect")
      .send({ webhookUrl: VALID_WEBHOOK });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Business plan/i);
    expect(mocks.onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for a legacy 'starter' plan (normalizes to Pro)", async () => {
    mocks.tenantsFindFirst.mockResolvedValue({ id: "t1", plan: "starter" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/notifications/slack/connect")
      .send({ webhookUrl: VALID_WEBHOOK });

    expect(res.status).toBe(403);
    expect(mocks.onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it("succeeds for a Business tenant and persists the webhook", async () => {
    mocks.tenantsFindFirst.mockResolvedValue({ id: "t1", plan: "business" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/notifications/slack/connect")
      .send({ webhookUrl: VALID_WEBHOOK });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slackConnected: true, slackEnabled: true });
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("succeeds for an Enterprise tenant", async () => {
    mocks.tenantsFindFirst.mockResolvedValue({ id: "t1", plan: "enterprise" });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/notifications/slack/connect")
      .send({ webhookUrl: VALID_WEBHOOK });

    expect(res.status).toBe(200);
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});
