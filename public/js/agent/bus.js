/**
 * Subagent bus — only chat-agent is principal (FP6).
 * result.ok === false → run tree status "error" (not silent ok).
 */
import { runId, nowIso } from "../core/ids.js";

export function createBus({ tree }) {
  /** @type {Map<string, function>} */
  const handlers = new Map();

  function register(agentId, handler) {
    handlers.set(agentId, handler);
  }

  async function invoke({ agentId, name, parentRunId, input }) {
    if (agentId === "chat-agent") {
      throw new Error("bus.invoke cannot call chat-agent; it is the principal");
    }
    const handler = handlers.get(agentId);
    const id = runId();
    const base = {
      runId: id,
      parentRunId: parentRunId || null,
      agentId,
      name: name || agentId,
    };
    tree.push({ ...base, status: "started", ts: nowIso(), detail: {} });
    if (!handler) {
      tree.push({
        ...base,
        status: "error",
        ts: nowIso(),
        detail: { error: "no handler" },
      });
      throw new Error(`No handler for ${agentId}`);
    }
    try {
      tree.push({ ...base, status: "streaming", ts: nowIso(), detail: {} });
      const result = await handler({ input, runId: id, parentRunId });
      // Structured failure without throw still counts as error in the tree
      if (result && result.ok === false && !result.noop) {
        tree.push({
          ...base,
          status: "error",
          ts: nowIso(),
          detail: { error: result.error || "failed", ...(result.detail || {}) },
        });
        return result;
      }
      tree.push({
        ...base,
        status: "ok",
        ts: nowIso(),
        detail: result?.detail || {},
      });
      return result;
    } catch (e) {
      tree.push({
        ...base,
        status: "error",
        ts: nowIso(),
        detail: { error: String(e?.message || e) },
      });
      throw e;
    }
  }

  return { register, invoke };
}
