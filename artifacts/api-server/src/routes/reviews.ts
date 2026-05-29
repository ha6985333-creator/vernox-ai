import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { db } from "@workspace/db";
import { reviewsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import { BUSINESS_TYPE, BUSINESS_NAME } from "../config.js";

const router: IRouter = Router();

interface ReviewAnalysis {
  sentiment: "positive" | "neutral" | "negative";
  themes: string[];
  draftResponse: string;
}

async function analyzeReview(reviewText: string, reviewerName: string, rating: number): Promise<ReviewAnalysis> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const groq = new Groq({ apiKey });

  const prompt = `You are a professional review response manager for ${BUSINESS_NAME}, a ${BUSINESS_TYPE} business.

Analyze this ${rating}-star customer review from "${reviewerName}" and respond with ONLY a valid JSON object — no markdown, no code blocks, no extra text:

{
  "sentiment": "positive" | "neutral" | "negative",
  "themes": ["theme1", "theme2"],
  "draftResponse": "A professional, warm, and concise response (2-3 sentences). Address the reviewer by name. Match the tone to the sentiment."
}

Review text: "${reviewText.replace(/"/g, "'")}"

Rules:
- sentiment must be exactly one of: positive, neutral, negative
- themes: 2-4 short phrases describing key topics in the review
- draftResponse: empathetic, professional, specific to a ${BUSINESS_TYPE} business — never generic
- For negative reviews: acknowledge the issue, apologize, offer to resolve
- For positive reviews: thank them warmly, reinforce what they praised
- For neutral: thank them and invite further feedback`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 350,
    temperature: 0.4,
  });

  const content = completion.choices[0]?.message?.content ?? "{}";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Groq response");

  const parsed = JSON.parse(jsonMatch[0]) as Partial<ReviewAnalysis>;

  return {
    sentiment: (["positive", "neutral", "negative"].includes(parsed.sentiment ?? ""))
      ? parsed.sentiment as ReviewAnalysis["sentiment"]
      : "neutral",
    themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 4) : [],
    draftResponse: parsed.draftResponse ?? "Thank you for your feedback. We appreciate you taking the time to share your experience.",
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

  const result = reviews.map(r => ({
    ...r,
    themes: (() => { try { return JSON.parse(r.themes); } catch { return []; } })(),
  }));

  res.json(result);
});

// ── POST /api/reviews ─────────────────────────────────────────────────────────
router.post("/reviews", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) {
    res.status(403).json({ error: "No tenant associated with this account" });
    return;
  }

  const { reviewerName, platform = "manual", rating = 5, reviewText } = req.body as {
    reviewerName: string;
    platform?: string;
    rating?: number;
    reviewText: string;
  };

  if (!reviewText?.trim()) {
    res.status(400).json({ error: "reviewText is required" });
    return;
  }
  if (!reviewerName?.trim()) {
    res.status(400).json({ error: "reviewerName is required" });
    return;
  }
  if (rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be 1-5" });
    return;
  }

  let analysis: ReviewAnalysis;
  try {
    analysis = await analyzeReview(reviewText.trim(), reviewerName.trim(), rating);
  } catch (err) {
    req.log.error({ err }, "Groq analysis failed — using fallback");
    analysis = {
      sentiment: rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative",
      themes: [],
      draftResponse: `Thank you for your review, ${reviewerName}. We appreciate you sharing your experience with ${BUSINESS_NAME}.`,
    };
  }

  const [review] = await db
    .insert(reviewsTable)
    .values({
      tenantId,
      reviewerName: reviewerName.trim(),
      platform,
      rating,
      reviewText: reviewText.trim(),
      sentiment: analysis.sentiment,
      themes: JSON.stringify(analysis.themes),
      aiDraftResponse: analysis.draftResponse,
      status: "pending",
    })
    .returning();

  res.status(201).json({
    ...review,
    themes: analysis.themes,
  });
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
      themes: JSON.stringify(analysis.themes),
      aiDraftResponse: analysis.draftResponse,
      editedResponse: null,
      status: "pending",
    })
    .where(and(eq(reviewsTable.id, req.params.id), eq(reviewsTable.tenantId, tenantId)))
    .returning();

  res.json({
    ...updated,
    themes: analysis.themes,
  });
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

  res.json({
    ...updated,
    themes: (() => { try { return JSON.parse(updated.themes); } catch { return []; } })(),
  });
});

export default router;
