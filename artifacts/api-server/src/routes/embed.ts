import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * GET /embed/:tenantId/widget.js
 * Public — no auth. Returns a self-contained JS snippet that embeds the
 * chat widget as a floating button on any third-party website.
 */
router.get("/embed/:tenantId/widget.js", async (req, res) => {
  const { tenantId } = req.params;

  const tenant = await db.query.tenantsTable.findFirst({
    where: eq(tenantsTable.id, tenantId!),
  });

  if (!tenant || tenant.status !== "active") {
    logger.warn({ tenantId }, "Embed request for unknown or inactive tenant");
    res.status(404).type("application/javascript").send("/* Widget not found */");
    return;
  }

  const CHAT_BASE_URL = "https://vernoxai.digital";

  // The embed script is a self-contained IIFE — no dependencies.
  const script = `(function () {
  if (window.__chatWidgetLoaded) return;
  window.__chatWidgetLoaded = true;

  var WIDGET_URL = "${CHAT_BASE_URL}/";
  var TENANT_ID  = "${tenant.id}";

  /* ── Styles ── */
  var style = document.createElement("style");
  style.textContent = [
    "#__cw-btn{position:fixed;bottom:24px;right:24px;z-index:2147483646;width:60px;height:60px;border-radius:50%;background:#1a2e4a;border:none;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;}",
    "#__cw-btn:hover{transform:scale(1.07);box-shadow:0 6px 24px rgba(0,0,0,0.36);}",
    "#__cw-btn svg{width:28px;height:28px;fill:#fff;pointer-events:none;}",
    "#__cw-frame{position:fixed;bottom:100px;right:24px;z-index:2147483645;width:370px;height:600px;max-height:calc(100vh - 120px);border:none;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,0.3);overflow:hidden;transition:opacity .2s,transform .2s;transform-origin:bottom right;}",
    "#__cw-frame.cw-hidden{opacity:0;pointer-events:none;transform:scale(0.92);}",
    "@media(max-width:440px){#__cw-frame{width:calc(100vw - 20px);right:10px;bottom:90px;}}"
  ].join("");
  document.head.appendChild(style);

  /* ── Button ── */
  var btn = document.createElement("button");
  btn.id = "__cw-btn";
  btn.setAttribute("aria-label", "Open chat");
  btn.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>';

  /* ── Close icon (swap on open) ── */
  var iconChat = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>';
  var iconClose = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>';

  /* ── Iframe ── */
  var frame = document.createElement("iframe");
  frame.id = "__cw-frame";
  frame.className = "cw-hidden";
  frame.src = WIDGET_URL + "/demo?t=" + TENANT_ID;
  frame.title = "Chat Widget";
  frame.allow = "microphone";

  document.body.appendChild(btn);
  document.body.appendChild(frame);

  var open = false;
  btn.addEventListener("click", function () {
    open = !open;
    frame.classList.toggle("cw-hidden", !open);
    btn.innerHTML = open ? iconClose : iconChat;
    btn.setAttribute("aria-label", open ? "Close chat" : "Open chat");
  });

  /* Close on Escape */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) { open = false; frame.classList.add("cw-hidden"); btn.innerHTML = iconChat; }
  });
})();`;

  res.type("application/javascript").set("Cache-Control", "public, max-age=300").send(script);
});

export default router;
