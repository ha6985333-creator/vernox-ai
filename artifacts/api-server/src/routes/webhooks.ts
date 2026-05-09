import { Router, type IRouter } from "express";
import crypto from "crypto";
import { createTenantWithCredentials } from "../lib/accounts.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * Payoneer Checkout IPN (Instant Payment Notification)
 *
 * Payoneer POSTs form-encoded fields to this endpoint when a payment completes.
 * Fields: uid, type, ref, amount, currency, status, sign, p_email, p_firstname, p_lastname
 * status=2 means payment completed/approved.
 * Signature: MD5(`uid:type:ref:amount:currency:status:PAYONEER_SECRET`)
 * Must respond with plain-text "OK" to acknowledge.
 *
 * Set up your IPN URL in Payoneer dashboard:
 *   https://<your-domain>/api/webhooks/payoneer
 */
router.post("/webhooks/payoneer", async (req, res) => {
  const secret = process.env["PAYONEER_SECRET"];

  const body = req.body as Record<string, string>;
  const { uid, type, ref, amount, currency, status, sign, p_email, p_firstname, p_lastname } = body;

  logger.info({ uid, type, ref, amount, status, p_email }, "Payoneer IPN received");

  // Verify signature if secret is configured
  if (secret) {
    const expected = crypto
      .createHash("md5")
      .update(`${uid}:${type}:${ref}:${amount}:${currency}:${status}:${secret}`)
      .digest("hex")
      .toLowerCase();
    const received = (sign ?? "").toLowerCase();

    if (expected !== received) {
      logger.warn({ received, expected }, "Payoneer IPN signature mismatch");
      res.status(400).send("INVALID_SIGNATURE");
      return;
    }
  } else {
    logger.warn("PAYONEER_SECRET not set — skipping signature check");
  }

  // status=2 means payment approved/completed
  if (status !== "2") {
    logger.info({ status }, "Payoneer IPN ignored — not a completed payment");
    res.send("OK");
    return;
  }

  if (!p_email) {
    logger.warn("Payoneer IPN missing payer email — cannot provision account");
    res.send("OK");
    return;
  }

  const name = [p_firstname, p_lastname].filter(Boolean).join(" ") || p_email.split("@")[0] || "Customer";

  try {
    await createTenantWithCredentials({ name, email: p_email, plan: "starter" });
    logger.info({ ref, email: p_email }, "Tenant provisioned from Payoneer IPN");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // If tenant already exists (duplicate payment), just log and ack
    if (message.includes("unique") || message.includes("duplicate") || message.includes("already")) {
      logger.info({ email: p_email }, "Payoneer IPN: tenant already exists, skipping");
    } else {
      logger.error({ err, email: p_email }, "Failed to provision tenant from Payoneer IPN");
    }
  }

  res.send("OK");
});

export default router;
