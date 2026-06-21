(function () {
  "use strict";

  const API_URL = "/api/chat";

  const chatWindow   = document.getElementById("chatWindow");
  const chatMessages = document.getElementById("chatMessages");
  const userInput    = document.getElementById("userInput");
  const sendBtn      = document.getElementById("sendBtn");
  const closeBtn     = document.getElementById("closeBtn");
  const chatBubble   = document.getElementById("chatBubble");

  // Read tenant ID from URL query param (set by embed script: ?t=<tenantId>)
  const widgetTenantId = new URLSearchParams(window.location.search).get("t") || "";

  let isLoading = false;
  let messages  = [];
  let typingEl  = null;

  // ── Conversation timeout (30 min inactivity) ──────────────────
  let lastActivityTime = Date.now();
  const CONVERSATION_TIMEOUT = 30 * 60 * 1000;

  const resetActivity = () => { lastActivityTime = Date.now(); };
  document.addEventListener("mousemove", resetActivity, { passive: true });
  document.addEventListener("keypress",  resetActivity, { passive: true });

  setInterval(() => {
    if (messages.length === 0) return;
    if (Date.now() - lastActivityTime > CONVERSATION_TIMEOUT) {
      messages = [];
      appendMessage("ai", "Your session has timed out after 30 minutes. Please refresh to start a new conversation.");
      userInput.disabled = true;
      sendBtn.disabled   = true;
    }
  }, 60_000);

  // ── Open / close ──────────────────────────────────────────────
  function openChat() {
    chatWindow.classList.remove("hidden");
    chatBubble.style.display = "none";
    if (messages.length === 0) sendWelcome();
    else setTimeout(() => userInput.focus(), 120);
  }

  function closeChat() {
    chatWindow.classList.add("hidden");
    chatBubble.style.display = "flex";
  }

  // ── Render a bubble ───────────────────────────────────────────
  function appendMessage(role, text) {
    const wrap   = document.createElement("div");
    wrap.className = `message ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;

    const time   = document.createElement("span");
    time.className = "message-time";
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    wrap.appendChild(bubble);
    wrap.appendChild(time);
    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return wrap;
  }

  // ── Typing indicator ──────────────────────────────────────────
  function showTyping() {
    const wrap = document.createElement("div");
    wrap.className = "message ai";
    const ind  = document.createElement("div");
    ind.className = "typing-indicator";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "typing-dot";
      ind.appendChild(dot);
    }
    wrap.appendChild(ind);
    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    typingEl = wrap;
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  // ── Send message ──────────────────────────────────────────────
  async function sendMessage() {
    if (isLoading) return;
    const text = userInput.value.trim();
    if (!text) return;

    resetActivity();
    userInput.value = "";
    autoResize();
    messages.push({ role: "user", content: text });
    appendMessage("user", text);

    isLoading = true;
    sendBtn.disabled = true;
    showTyping();

    let status = 0;

    try {
      const body = { messages };
      if (widgetTenantId) body.tenantId = widgetTenantId;

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      status = res.status;
      hideTyping();

      if (res.status === 429) {
        messages.pop();
        appendMessage("ai", "I'm receiving a lot of messages right now — please wait a moment and try again.");
        return;
      }

      if (res.status === 502) {
        messages.pop();
        appendMessage("ai", "Our service is temporarily unavailable. Please try again in a moment, or call us directly.");
        return;
      }

      if (!res.ok) {
        messages.pop();
        appendMessage("ai", "Something unexpected happened. Please refresh and try again, or contact us directly.");
        console.error("[Vernox] Chat error:", res.status);
        return;
      }

      const data  = await res.json();
      const reply = data.message || "";
      messages.push({ role: "assistant", content: reply });
      appendMessage("ai", reply);
      if (data.bookingConfirmed) showBookingBanner();
    } catch (err) {
      hideTyping();
      messages.pop();
      if (!status) {
        appendMessage("ai", "Could not connect to our service. Please check your connection and try again.");
      } else {
        appendMessage("ai", "Something unexpected happened. Please refresh and try again.");
      }
      console.error("[Vernox] Chat error:", err);
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      userInput.focus();
    }
  }

  // ── Welcome message (auto-sent on open) ───────────────────────
  async function sendWelcome() {
    isLoading = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const body = { messages: [{ role: "user", content: "Hello" }] };
      if (widgetTenantId) body.tenantId = widgetTenantId;

      const res  = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data  = await res.json();
      const reply = data.message || "Hi there! How can I help you today?";
      messages = [
        { role: "user",      content: "Hello" },
        { role: "assistant", content: reply },
      ];
      hideTyping();
      appendMessage("ai", reply);
    } catch {
      hideTyping();
      const fallback = "Hi there! How can I help you today?";
      messages = [{ role: "assistant", content: fallback }];
      appendMessage("ai", fallback);
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      setTimeout(() => userInput.focus(), 80);
    }
  }

  // ── Booking confirmation banner ───────────────────────────────
  function showBookingBanner() {
    if (document.getElementById("bookingBanner")) return;
    const banner = document.createElement("div");
    banner.id = "bookingBanner";
    banner.innerHTML = `
      <span style="font-size:1.2rem;">✓</span>
      <span>Booking confirmed! A confirmation email is on its way.</span>
    `;
    Object.assign(banner.style, {
      display: "flex", alignItems: "center", gap: "10px",
      margin: "8px 14px", padding: "10px 14px",
      background: "#d1fae5", color: "#065f46",
      borderRadius: "10px", fontSize: "0.85rem", fontWeight: "600",
      animation: "msgIn 0.25s ease both",
    });
    chatMessages.appendChild(banner);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ── Auto-resize textarea ──────────────────────────────────────
  function autoResize() {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
  }

  // ── Events ────────────────────────────────────────────────────
  closeBtn.addEventListener("click", closeChat);
  chatBubble.addEventListener("click", openChat);
  sendBtn.addEventListener("click", sendMessage);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  userInput.addEventListener("input", autoResize);

  // Open automatically on page load
  openChat();
})();
