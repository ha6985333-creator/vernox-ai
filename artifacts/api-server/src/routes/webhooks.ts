import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { createTenantWithCredentials } from "../lib/accounts.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.post("/webhooks/stripe", async (req, res) => {
  const stripeSecret = process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

  if (!stripeSecret) {
    res.status(500).json({ error: "Stripe not configured" });
    return;
  }

  const stripe = new Stripe(stripeSecret);
  let event: Stripe.Event;

  try {
    if (webhookSecret) {
      const sig = req.headers["stripe-signature"] as string;
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } else {
      event = req.body as Stripe.Event;
    }
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  if (event.type === "customer.subscription.created") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    try {
      const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
      const name = customer.name || "New Customer";
      const email = customer.email!;
      const plan = (subscription.items.data[0]?.price.nickname ?? "starter").toLowerCase();

      await createTenantWithCredentials({
        name,
        email,
        plan,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
      });

      logger.info({ customerId, email }, "Tenant provisioned from Stripe subscription");
    } catch (err) {
      logger.error({ err, customerId }, "Failed to provision tenant from Stripe webhook");
      res.status(500).json({ error: "Provisioning failed" });
      return;
    }
  }

  res.json({ received: true });
});

export default router;
