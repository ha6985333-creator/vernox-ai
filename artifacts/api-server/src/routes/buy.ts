import { Router, type IRouter } from "express";
import { db, purchaseRequestsTable, insertPurchaseRequestSchema } from "@workspace/db";
import { sendPurchaseNotification, sendPurchaseConfirmation } from "../lib/email.js";
import { TIERS } from "../tiers.js";

const router: IRouter = Router();

// Public: the pricing tiers (used by the Buy page to render the locked tier).
router.get("/tiers", (_req, res) => {
  res.json(
    TIERS.map((t) => ({
      key: t.key,
      label: t.label,
      price: t.price,
      priceText: t.priceText,
      tagline: t.tagline,
      featured: t.featured,
      features: t.features,
    })),
  );
});

router.post("/buy", async (req, res) => {
  const parsed = insertPurchaseRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid details.";
    res.status(400).json({ error: message });
    return;
  }

  const data = parsed.data;
  const [record] = await db.insert(purchaseRequestsTable).values(data).returning();

  // Notify the business owner and confirm to the customer. Email failures
  // should not break the user flow — the request is already saved.
  try {
    await Promise.all([
      sendPurchaseNotification(data),
      sendPurchaseConfirmation(data),
    ]);
  } catch (err) {
    req.log.error({ err, id: record?.id }, "Purchase request saved but email sending failed");
  }

  res.status(201).json({ ok: true });
});

export default router;
