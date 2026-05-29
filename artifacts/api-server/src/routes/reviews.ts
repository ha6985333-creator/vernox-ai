import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { db } from "@workspace/db";
import { reviewsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { BUSINESS_TYPE, BUSINESS_NAME } from "../config.js";

const router: IRouter = Router();

interface ReviewAnalysis {
  sentiment: "positive" | "neutral" | "negative";
  rootCause: string;
  recommendation: string;
  draftResponse: string;
}

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
    model: "llama-3.3-70b-versatile",
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

async function getTenantId(userId: string): Promise<string | null> {
  const user = await db.query.usersTable.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  return user?.tenantId ?? null;
}

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

  const results = [];
  for (const mock of MOCK_GOOGLE_REVIEWS) {
    let analysis: ReviewAnalysis;
    try {
      analysis = await analyzeReview(mock.reviewText, mock.reviewerName, mock.rating);
    } catch (err) {
      req.log.error({ err }, "Groq analysis failed during seed — using fallback");
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
        rating: mock.rating,
        reviewText: mock.reviewText,
        sentiment: analysis.sentiment,
        rootCause: analysis.rootCause,
        recommendation: analysis.recommendation,
        aiDraftResponse: analysis.draftResponse,
        status: "pending",
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
    where: (r, { and, eq }) => and(eq(r.id, req.params.id), eq(r.tenantId, tenantId)),
  });

  if (!review) {
    res.status(404).json({ error: "Review not found" });
    return;
  }

  let analysis: ReviewAnalysis;
  try {
    analysis = await analyzeReview(review.reviewText, review.reviewerName, review.rating);
  } catch (err) {
    req.log.error({ err }, "Groq regeneration failed");
    res.status(502).json({ error: "AI service unavailable. Please try again." });
    return;
  }

  const [updated] = await db
    .update(reviewsTable)
    .set({
      sentiment: analysis.sentiment,
      rootCause: analysis.rootCause,
      recommendation: analysis.recommendation,
      aiDraftResponse: analysis.draftResponse,
      editedResponse: null,
      status: "pending",
    })
    .where(and(eq(reviewsTable.id, req.params.id), eq(reviewsTable.tenantId, tenantId)))
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
    .where(and(eq(reviewsTable.id, req.params.id), eq(reviewsTable.tenantId, tenantId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Review not found" });
    return;
  }

  res.json(updated);
});

export default router;
