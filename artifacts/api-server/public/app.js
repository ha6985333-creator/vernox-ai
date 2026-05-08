(function () {
  "use strict";

  const API_URL = "/api/chat";

  const chatWindow   = document.getElementById("chatWindow");
  const chatMessages = document.getElementById("chatMessages");
  const userInput    = document.getElementById("userInput");
  const sendBtn      = document.getElementById("sendBtn");
  const closeBtn     = document.getElementById("closeBtn");
  const chatBubble   = document.getElementById("chatBubble");

  let isLoading = false;
  let messages  = [];
  let typingEl  = null;

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

    userInput.value = "";
    autoResize();
    messages.push({ role: "user", content: text });
    appendMessage("user", text);

    isLoading = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const res  = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data  = await res.json();
      const reply = data.message || "";
      messages.push({ role: "assistant", content: reply });
      hideTyping();
      appendMessage("ai", reply);
    } catch (err) {
      hideTyping();
      appendMessage("ai", "Sorry, something went wrong. Please try again.");
      console.error("Chat error:", err);
      messages.pop();
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
      const res  = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
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
