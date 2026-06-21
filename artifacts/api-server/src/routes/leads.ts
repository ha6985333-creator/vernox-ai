import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { leadsTable, leadFollowUpsTable } from "@workspace/db";
import { eq, and, count, isNotNull, sql } from "drizzle-orm";
import { sendLeadFollowUp } from "../lib/email.js";

const router: IRouter = Router();

async function getTenantId(userId: string): Promise<string | null> {
  const user = await db.query.usersTable.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  return user?.tenantId ?? null;
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***@***.***";
  return email.slice(0, Math.min(3, at)) + "***" + email.slice(at);
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return phone.slice(0, 3) + "****" + phone.slice(-2);
}

// ── GET /api/leads/stats ───────────────────────────────────────────────────────
router.get("/leads/stats", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const leads = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.tenantId, tenantId));

  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === "new").length;
  const contactedLeads = leads.filter(l => l.status === "contacted").length;
  const convertedLeads = leads.filter(l => l.status === "converted").length;
  const unsubscribedLeads = leads.filter(l => l.status === "unsubscribed").length;

  const followUpRows = await db
    .select({ total: count(), opened: count(leadFollowUpsTable.openedAt) })
    .from(leadFollowUpsTable)
    .where(eq(leadFollowUpsTable.tenantId, tenantId));

  const totalFollowUpsSent = Number(followUpRows[0]?.total ?? 0);
  const emailsOpened = Number(followUpRows[0]?.opened ?? 0);
  const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

  res.json({
    totalLeads,
    newLeads,
    contactedLeads,
    convertedLeads,
    unsubscribedLeads,
    totalFollowUpsSent,
    emailsOpened,
    conversionRate,
  });
});

// ── GET /api/leads ─────────────────────────────────────────────────────────────
router.get("/leads", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const leads = await db
    .select({
      id: leadsTable.id,
      visitorName: leadsTable.visitorName,
      visitorEmail: leadsTable.visitorEmail,
      visitorPhone: leadsTable.visitorPhone,
      serviceIssue: leadsTable.serviceIssue,
      status: leadsTable.status,
      followUpCount: leadsTable.followUpCount,
      createdAt: leadsTable.createdAt,
      nextFollowUpDate: leadsTable.nextFollowUpDate,
    })
    .from(leadsTable)
    .where(eq(leadsTable.tenantId, tenantId))
    .orderBy(sql`${leadsTable.createdAt} DESC`);

  const masked = leads.map(l => ({
    ...l,
    visitorEmail: maskEmail(l.visitorEmail),
    visitorPhone: maskPhone(l.visitorPhone),
  }));

  res.json(masked);
});

// ── GET /api/leads/:leadId ─────────────────────────────────────────────────────
router.get("/leads/:leadId", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const lead = await db.query.leadsTable.findFirst({
    where: (l, { and, eq }) => and(eq(l.id, req.params.leadId!), eq(l.tenantId, tenantId)),
  });

  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  res.json(lead);
});

// ── POST /api/leads/:leadId/contact ───────────────────────────────────────────
router.post("/leads/:leadId/contact", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const { channel, message_number } = req.body as { channel: unknown; message_number: unknown };

  if (!["email", "sms", "whatsapp"].includes(channel as string)) {
    res.status(400).json({ error: "channel must be 'email', 'sms', or 'whatsapp'" });
    return;
  }
  const msgNum = Number(message_number);
  if (!Number.isInteger(msgNum) || msgNum < 1 || msgNum > 3) {
    res.status(400).json({ error: "message_number must be 1, 2, or 3" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({
    where: (l, { and, eq }) => and(eq(l.id, req.params.leadId!), eq(l.tenantId, tenantId)),
  });

  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  if (lead.status === "unsubscribed") { res.status(400).json({ error: "Lead has unsubscribed" }); return; }
  if ((lead.followUpCount ?? 0) >= 3) { res.status(400).json({ error: "Maximum follow-ups (3) already sent" }); return; }

  // Rate limit: 1 follow-up per lead per hour
  if (lead.lastContactDate) {
    const since = Date.now() - new Date(lead.lastContactDate).getTime();
    if (since < 60 * 60 * 1000) {
      const waitMins = Math.ceil((60 * 60 * 1000 - since) / 60000);
      res.status(429).json({ error: `Please wait ${waitMins} more minute(s) before sending another follow-up` });
      return;
    }
  }

  const now = new Date();
  const nextFollowUp = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [followUp] = await db
    .insert(leadFollowUpsTable)
    .values({
      leadId: lead.id,
      tenantId,
      channel: channel as string,
      messageNumber: msgNum,
      status: "pending",
    })
    .returning();

  await db
    .update(leadsTable)
    .set({
      followUpCount: (lead.followUpCount ?? 0) + 1,
      lastContactDate: now,
      nextFollowUpDate: nextFollowUp,
      status: lead.status === "new" ? "contacted" : lead.status,
      updatedAt: now,
    })
    .where(and(eq(leadsTable.id, lead.id), eq(leadsTable.tenantId, tenantId)));

  // Fire send in background — don't block response
  if (channel === "email") {
    sendLeadFollowUp(lead, msgNum).then(async () => {
      await db
        .update(leadFollowUpsTable)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(leadFollowUpsTable.id, followUp!.id));
    }).catch(async (err) => {
      req.log.error({ err, leadId: lead.id }, "Lead follow-up email failed");
      await db
        .update(leadFollowUpsTable)
        .set({ status: "failed" })
        .where(eq(leadFollowUpsTable.id, followUp!.id));
    });
  } else {
    // SMS / WhatsApp: placeholder
    req.log.info({ channel, leadId: lead.id }, "Follow-up channel not yet integrated — coming soon");
    db.update(leadFollowUpsTable)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(leadFollowUpsTable.id, followUp!.id))
      .catch(() => {});
  }

  res.json({ ok: true, messageId: followUp!.id });
});

// ── POST /api/leads/:leadId/mark-converted ────────────────────────────────────
router.post("/leads/:leadId/mark-converted", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const [updated] = await db
    .update(leadsTable)
    .set({ status: "converted", updatedAt: new Date() })
    .where(and(eq(leadsTable.id, req.params.leadId!), eq(leadsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }

  res.json({ ok: true });
});

// ── POST /api/leads/:leadId/unsubscribe ───────────────────────────────────────
router.post("/leads/:leadId/unsubscribe", async (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tenantId = await getTenantId(req.session.userId);
  if (!tenantId) { res.status(403).json({ error: "No tenant associated with this account" }); return; }

  const [updated] = await db
    .update(leadsTable)
    .set({ status: "unsubscribed", updatedAt: new Date() })
    .where(and(eq(leadsTable.id, req.params.leadId!), eq(leadsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }

  res.json({ ok: true });
});

export default router;
