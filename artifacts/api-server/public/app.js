(function () {
  "use strict";

  const API_URL = "/api/chat";

  const chatBubble  = document.getElementById("chatBubble");
  const chatWindow  = document.getElementById("chatWindow");
  const chatMessages = document.getElementById("chatMessages");
  const userInput   = document.getElementById("userInput");
  const sendBtn     = document.getElementById("sendBtn");
  const iconChat    = chatBubble.querySelector(".icon-chat");
  const iconClose   = chatBubble.querySelector(".icon-close");

  let isOpen    = false;
  let isLoading = false;
  let messages  = [];       // full conversation history sent to the API
  let typingEl  = null;     // reference to the live typing indicator element

  // ── Toggle chat open / close ──────────────────────────────────────────
  function toggleChat() {
    isOpen = !isOpen;
    chatWindow.classList.toggle("hidden", !isOpen);
    iconChat.classList.toggle("hidden", isOpen);
    iconClose.classList.toggle("hidden", !isOpen);

    if (isOpen) {
      if (messages.length === 0) sendWelcome();
      setTimeout(() => userInput.focus(), 120);
    }
  }

  // ── Render a message bubble ───────────────────────────────────────────
  function appendMessage(role, text) {
    const wrap = document.createElement("div");
    wrap.className = `message ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(new Date());

    wrap.appendChild(bubble);
    wrap.appendChild(time);
    chatMessages.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  // ── Typing indicator ─────────────────────────────────────────────────
  function showTyping() {
    const wrap = document.createElement("div");
    wrap.className = "message ai";
    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "typing-dot";
      indicator.appendChild(dot);
    }
    wrap.appendChild(indicator);
    chatMessages.appendChild(wrap);
    scrollToBottom();
    typingEl = wrap;
  }

  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  // ── Send user message ─────────────────────────────────────────────────
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
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const reply = data.message || "";
      messages.push({ role: "assistant", content: reply });
      hideTyping();
      appendMessage("ai", reply);
    } catch (err) {
      hideTyping();
      appendMessage("ai", "Sorry, something went wrong. Please try again in a moment.");
      console.error("Chat error:", err);
      messages.pop();
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      userInput.focus();
    }
  }

  // ── Welcome message ───────────────────────────────────────────────────
  async function sendWelcome() {
    isLoading = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
      });
      const data = await res.json();
      const reply = data.message || "Hi there! How can I help you today?";
      messages = [
        { role: "user", content: "Hello" },
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
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function autoResize() {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
  }

  // ── Event listeners ───────────────────────────────────────────────────
  chatBubble.addEventListener("click", toggleChat);

  sendBtn.addEventListener("click", sendMessage);

  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  userInput.addEventListener("input", autoResize);
})();
