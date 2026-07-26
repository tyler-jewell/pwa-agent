/** Durable chat transcript. */
import { msgId, nowIso } from "../core/ids.js";
import { validateChatMessage } from "../core/schema.js";
import { kvGet, kvSet, TRANSCRIPT_KEY } from "../ports/storage.js";
import { emit, EVT } from "../core/events.js";

export function createTranscript() {
  /** @type {{ messages: object[], updatedAt: string }} */
  let state = { messages: [], updatedAt: nowIso() };

  async function load() {
    const saved = await kvGet(TRANSCRIPT_KEY);
    if (saved && Array.isArray(saved.messages)) {
      state = { messages: saved.messages, updatedAt: saved.updatedAt || nowIso() };
    }
    emit(EVT.TRANSCRIPT, snapshot());
    return snapshot();
  }

  function snapshot() {
    return {
      messages: state.messages.map((m) => ({ ...m, meta: { ...(m.meta || {}) } })),
      updatedAt: state.updatedAt,
    };
  }

  async function persist() {
    state.updatedAt = nowIso();
    await kvSet(TRANSCRIPT_KEY, snapshot());
    emit(EVT.TRANSCRIPT, snapshot());
  }

  async function append(role, content, meta = {}) {
    const m = {
      id: msgId(),
      role,
      content: content == null ? "" : String(content),
      createdAt: nowIso(),
      meta,
    };
    const err = validateChatMessage(m);
    if (err) throw new Error(err);
    state.messages.push(m);
    await persist();
    return m;
  }

  async function updateContent(id, content, metaPatch) {
    const m = state.messages.find((x) => x.id === id);
    if (!m) return null;
    m.content = content;
    if (metaPatch) m.meta = { ...m.meta, ...metaPatch };
    await persist();
    return m;
  }

  async function replaceMessages(messages) {
    state.messages = messages.slice();
    await persist();
  }

  /** In-memory hydrate after atomic import (no write). */
  async function hydrateFrom(tr) {
    state = {
      messages: (tr?.messages || []).slice(),
      updatedAt: tr?.updatedAt || nowIso(),
    };
    emit(EVT.TRANSCRIPT, snapshot());
  }

  async function clear() {
    state = { messages: [], updatedAt: nowIso() };
    await persist();
  }

  function getMessages() {
    return state.messages.slice();
  }

  return {
    load,
    snapshot,
    append,
    updateContent,
    replaceMessages,
    hydrateFrom,
    clear,
    getMessages,
  };
}
