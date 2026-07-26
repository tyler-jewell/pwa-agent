import { on, EVT } from "../core/events.js";
import { clear, escapeHtml } from "./render.js";

export function mountChat({ transcriptEl, formEl, inputEl, sendBtn, chatAgent, getMessages }) {
  let streamingEl = null;

  function renderAll(messages) {
    clear(transcriptEl);
    streamingEl = null;
    for (const m of messages) appendBubble(m.role, m.content, false);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function appendBubble(role, content, streaming) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.innerHTML = `<div class="role">${escapeHtml(role)}</div><div class="body"></div>`;
    div.querySelector(".body").textContent = content;
    if (streaming) streamingEl = div;
    transcriptEl.appendChild(div);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    return div;
  }

  function onToken(tok) {
    if (!streamingEl) appendBubble("assistant", "", true);
    const body = streamingEl.querySelector(".body");
    body.textContent += tok;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  on(EVT.TRANSCRIPT, (snap) => {
    // Avoid clobbering mid-stream UI; final paint happens in submit finally
    if (streamingEl) return;
    renderAll(snap.messages);
  });

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = inputEl.value;
    if (!text.trim()) return;
    inputEl.value = "";
    sendBtn.disabled = true;
    streamingEl = null;
    try {
      await chatAgent.handleUserMessage(text, { onToken });
    } finally {
      streamingEl = null;
      if (getMessages) renderAll(getMessages());
      sendBtn.disabled = false;
      inputEl.focus();
    }
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  return { renderAll, onToken };
}
