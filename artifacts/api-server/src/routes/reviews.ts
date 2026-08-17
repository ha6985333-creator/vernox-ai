import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { db } from "@workspace/db";
import { reviewsTable } from "@workspace/db";
import { eq, and, avg, count, isNotNull, sql } from "drizzle-orm";
import { BUSINESS_TYPE, BUSINESS_NAME } from "../config.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReviewAnalysis {
  sentiment: "positive" | "neutral" | "negative";
  rootCause: string;
  recommendation: string;
  draftResponse: string;
}

// ── Mock Google reviews (seeded on first connect) ─────────────────────────────

const MOCK_GOOGLE_REVIEWS = [
  {
    reviewerName: "James Harrington",
    rating: 5,
    reviewText: "Called at 7am about a burst pipe flooding my kitchen. Technician arrived within 45 minutes, diagnosed and fixed the issue in under an hour. Pricing was transparent and fair. Honestly the best emergency service I have ever used.",
  },
  {
    reviewerName: "Sandra Mitchell",
    rating: 5,
    reviewText: "Our boiler broke down on the coldest night of the year. These guys came out same evening, no extra charge, and had us back up and running by 10pm. The technician was polite, tidy, and explained everything he was doing. Five stars easily.",
  },
  {
    reviewerName: "Kevin O'Brien",
    rating: 1,
    reviewText: "Absolute disaster. Was told a technician would arrive between 9am and 12pm. Nobody showed up. When I called to ask what happened I was put on hold for 20 minutes and then told there had been a scheduling error and the earliest they could reschedule was three days later. Lost a full day of work waiting. Will never use again.",
  },
  {
    reviewerName: "Rachel Thornton",
    rating: 2,
    reviewText: "The actual plumbing work was fine but I was quoted £180 over the phone and handed an invoice for £340 at the end. When I questioned the extra charges the technician said there were 'additional parts' but could not give me a breakdown. Felt completely misled. Sort out your pricing communication.",
  },
  {
    reviewerName: "David Park",
    rating: 1,
    reviewText: "The person who answered the phone was condescending and dismissive. I described a slow drain issue and was told it sounded like 'a job I could do myself with a £5 drain cleaner from B&Q'. When I pushed to book anyway I was made to feel like I was wasting their time. Customer service is non-existent here.",
  },
  {
    reviewerName: "Fiona Campbell",
    rating: 5,
    reviewText: "Replaced our entire hot water cylinder quickly and professionally. The team left the work area spotless — you would never know they had been. They also spotted a potential issue with a nearby joint and flagged it without trying to upsell. Really trustworthy company.",
  },
];

// ── Groq analysis ─────────────────────────────────────────────────────────────

async function analyzeReview(
  reviewText: string,
  reviewerName: string,
  rating: number,
): Promise<ReviewAnalysis> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const groq = new Groq({ apiKey });

  const prompt = `You are a specialist in Google Business reputation management for ${BUSINESS_NAME}, a ${BUSINESS_TYPE} business.

Analyse this ${rating}-star Google Maps review from "${reviewerName}" and respond with ONLY a valid JSON object — no markdown, no code blocks, no extra text:

{
  "sentiment": "positive" | "neutral" | "negative",
  "rootCause": "One precise sentence naming the exact operational failure or strength (e.g. 'No-show appointment caused a full lost working day for the customer', 'Transparent pricing and fast emergency response built strong trust')",
  "recommendation": "One specific, actionable improvement the business owner can implement immediately (e.g. 'Introduce automated SMS reminders with a 30-minute heads-up if a technician is running late', 'Display a full parts-and-labour price list on the Google listing to set expectations upfront')",
  "draftResponse": "A polished, public-facing Google Maps reply (2-3 sentences). For negative: acknowledge the specific issue by name, sincerely apologise, invite offline resolution with contact info. For positive: thank by name, reinforce a specific detail they praised, invite them back."
}

Review text: "${reviewText.replace(/"/g, "'")}"

Rules:
- sentiment must be exactly one of: positive, neutral, negative
- rootCause: be precise about the operational gap — no vague phrases like 'customer service issue'
- recommendation: name a specific system, process, or listing change — not generic advice
- draftResponse: professional, warm, never defensive; address reviewer by first name`;

  const completion = await groq.chat.completions.create({
    model: "qwen-3.6-27b",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 450,
    temperature: 0.35,
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Groq response");

  const parsed = JSON.parse(jsonMatch[0]) as Partial<ReviewAnalysis>;

  return {
    sentiment: (["positive", "neutral", "negative"].includes(parsed.sentiment ?? ""))
      ? (parsed.sentiment as ReviewAnalysis["sentiment"])
      : rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative",
    rootCause: parsed.rootCause ?? "Analysis unavailable — please regenerate.",
    recommendation: parsed.recommendation ?? "Review AI analysis manually.",
    draftResponse: parsed.draftResponse ?? `Thank you for your review, ${reviewerName}. We appreciate you sharing your experience with ${BUSINESS_NAME}.`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTenantId(userId: string): Promise<string | null> {
  const user = await db.query.usersTable.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  return user?.tenantId ?? null;
}

// ── GET /api/reviews/analytics ────────────────────────────────────────────────
router.get("/reviews/analytics", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) {
    res.status(403).json({ error: "No tenant associated with this account" });
    return;
  }

  const reviews = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.tenantId, tenantId));

  const totalReviews = reviews.length;
  const averageRating = totalReviews > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
    : 0;

  const reviewsBySource: Record<string, number> = {};
  const reviewsBySentiment = { positive: 0, neutral: 0, negative: 0 };
  const analysisStatus = { pending: 0, success: 0, failed: 0 };
  let pendingApproval = 0;
  const recentFailures: Array<{ id: string; reviewText: string; groqErrorMessage: string | null; lastGroqAttemptAt: Date | null }> = [];

  for (const r of reviews) {
    // Source breakdown
    const src = r.source ?? "google";
    reviewsBySource[src] = (reviewsBySource[src] ?? 0) + 1;

    // Sentiment breakdown
    if (r.sentiment === "positive" || r.sentiment === "neutral" || r.sentiment === "negative") {
      reviewsBySentiment[r.sentiment]++;
    }

    // Groq analysis status
    const gs = r.groqCallStatus ?? "pending";
    if (gs === "success") analysisStatus.success++;
    else if (gs === "failed") {
      analysisStatus.failed++;
      recentFailures.push({
        id: r.id,
        reviewText: r.reviewText.substring(0, 100),
        groqErrorMessage: r.groqErrorMessage ?? null,
        lastGroqAttemptAt: r.lastGroqAttemptAt ?? null,
      });
    } else {
      analysisStatus.pending++;
    }

    // Pending approval (drafted but not published)
    if (r.status === "pending") pendingApproval++;
  }

  res.json({
    totalReviews,
    reviewsBySource,
    analysisStatus,
    reviewsBySentiment,
    pendingApproval,
    averageRating,
    recentFailures: recentFailures.slice(0, 5),
  });
});

// ── GET /api/reviews ──────────────────────────────────────────────────────────
router.get("/reviews", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) {
    res.status(403).json({ error: "No tenant associated with this account" });
    return;
  }

  const reviews = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.tenantId, tenantId))
    .orderBy(reviewsTable.createdAt);

  res.json(reviews);
});

// ── POST /api/reviews/seed ────────────────────────────────────────────────────
router.post("/reviews/seed", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) {
    res.status(403).json({ error: "No tenant associated with this account" });
    return;
  }

  const existing = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.tenantId, tenantId));

  if (existing.length > 0) {
    res.json({ seeded: false, message: "Reviews already loaded", reviews: existing });
    return;
  }

  // TODO: Real Google OAuth Flow
  // 1. User clicks "Connect Google Business Profile"
  // 2. Redirect to Google OAuth consent screen (accounts.google.com/o/oauth2/v2/auth)
  // 3. Exchange auth code for access + refresh tokens
  // 4. Store encrypted refresh token in tenants table (new column: google_refresh_token)
  // 5. Use token to call Google My Business API: GET /v4/accounts/{accountId}/locations/{locationId}/reviews
  // 6. Import returned reviews into reviews table with source = 'google'

  const results = [];
  for (const mock of MOCK_GOOGLE_REVIEWS) {
    let analysis: ReviewAnalysis | null = null;
    let groqCallStatus: "success" | "failed" = "success";
    let groqErrorMessage: string | null = null;
    const now = new Date();

    try {
      analysis = await analyzeReview(mock.reviewText, mock.reviewerName, mock.rating);
    } catch (err) {
      const error = err as Error;
      groqCallStatus = "failed";
      groqErrorMessage = error.message.substring(0, 500);
      req.log.error({ err: error, tenantId }, "Groq analysis failed during seed");
      analysis = {
        sentiment: mock.rating >= 4 ? "positive" : mock.rating === 3 ? "neutral" : "negative",
        rootCause: "AI analysis unavailable — please regenerate individually.",
        recommendation: "Regenerate this review's analysis using the Regenerate button.",
        draftResponse: `Thank you for your review, ${mock.reviewerName}. We appreciate your feedback and will follow up shortly.`,
      };
    }

    const [review] = await db
      .insert(reviewsTable)
      .values({
        tenantId,
        reviewerName: mock.reviewerName,
        platform: "google",
        source: "google",
        rating: mock.rating,
        reviewText: mock.reviewText,
        sentiment: analysis.sentiment,
        rootCause: analysis.rootCause,
        recommendation: analysis.recommendation,
        aiDraftResponse: analysis.draftResponse,
        status: "pending",
        groqCallStatus,
        groqErrorMessage,
        lastGroqAttemptAt: now,
        groqRetryCount: groqCallStatus === "failed" ? 1 : 0,
      })
      .returning();

    results.push(review);
  }

  res.json({ seeded: true, message: `${results.length} reviews loaded`, reviews: results });
});

// ── POST /api/reviews/:id/regenerate ─────────────────────────────────────────
router.post("/reviews/:id/regenerate", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) {
    res.status(403).json({ error: "No tenant associated with this account" });
    return;
  }

  const review = await db.query.reviewsTable.findFirst({
    where: (r, { and, eq }) => and(eq(r.id, req.params.id!), eq(r.tenantId, tenantId)),
  });

  if (!review) {
    res.status(404).json({ error: "Review not found" });
    return;
  }

  // Rate limit: if already failed 3+ times and last attempt was < 1 hour ago, reject
  const retryCount = review.groqRetryCount ?? 0;
  if (retryCount >= 3 && review.lastGroqAttemptAt) {
    const msSinceLastAttempt = Date.now() - new Date(review.lastGroqAttemptAt).getTime();
    if (msSinceLastAttempt < 60 * 60 * 1000) {
      const waitMins = Math.ceil((60 * 60 * 1000 - msSinceLastAttempt) / 60000);
      res.status(429).json({
        error: `Too many retries. Please try again in ${waitMins} minute(s).`,
      });
      return;
    }
  }

  const now = new Date();
  let analysis: ReviewAnalysis;

  try {
    analysis = await analyzeReview(review.reviewText, review.reviewerName, review.rating);
  } catch (err) {
    const error = err as Error;
    const newRetryCount = retryCount + 1;

    logger.error({ err: error, reviewId: review.id, tenantId, retryCount: newRetryCount }, "Groq regeneration failed");

    await db
      .update(reviewsTable)
      .set({
        groqCallStatus: "failed",
        groqErrorMessage: error.message.substring(0, 500),
        lastGroqAttemptAt: now,
        groqRetryCount: newRetryCount,
      })
      .where(and(eq(reviewsTable.id, req.params.id!), eq(reviewsTable.tenantId, tenantId)));

    res.status(502).json({
      error: "Analysis failed. We'll retry in 1 hour.",
    });
    return;
  }

  // TODO: Real Google Reply Posting
  // When "Approve & Publish" is clicked:
  // 1. Check google_reply_post_status !== 'posted'
  // 2. Call Google Business Profile API:
  //    PUT /v4/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply
  //    Body: { comment: editedResponse || aiDraftResponse }
  // 3. On success: set google_reply_posted_at = now, google_reply_post_status = 'posted'
  // 4. On error: set google_reply_post_status = 'failed', log error with reviewId + tenantId
  // 5. Handle Google API rate limits (429) and location not found (404)

  const [updated] = await db
    .update(reviewsTable)
    .set({
      sentiment: analysis.sentiment,
      rootCause: analysis.rootCause,
      recommendation: analysis.recommendation,
      aiDraftResponse: analysis.draftResponse,
      editedResponse: null,
      status: "pending",
      groqCallStatus: "success",
      groqErrorMessage: null,
      lastGroqAttemptAt: now,
      groqRetryCount: 0,
    })
    .where(and(eq(reviewsTable.id, req.params.id!), eq(reviewsTable.tenantId, tenantId)))
    .returning();

  res.json(updated);
});

// ── PATCH /api/reviews/:id ────────────────────────────────────────────────────
router.patch("/reviews/:id", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) {
    res.status(403).json({ error: "No tenant associated with this account" });
    return;
  }

  const { editedResponse, status } = req.body as { editedResponse?: string; status?: string };

  const updates: Partial<typeof reviewsTable.$inferInsert> = {};
  if (editedResponse !== undefined) updates.editedResponse = editedResponse;
  if (status !== undefined && ["pending", "approved"].includes(status)) updates.status = status;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [updated] = await db
    .update(reviewsTable)
    .set(updates)
    .where(and(eq(reviewsTable.id, req.params.id!), eq(reviewsTable.tenantId, tenantId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Review not found" });
    return;
  }

  res.json(updated);
});

export default router;
