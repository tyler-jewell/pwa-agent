/**
 * Shared agent notification facade — any allowed agent can request user-visible notify.
 * Uses in-app banner/pill + optional Notification API / push path.
 */
import { emit, EVT } from "../core/events.js";

/**
 * @param {object} [opts]
 * @param {(detail: object) => void} [opts.onAction] - called for approve/dismiss with { id, action, data }
 */
export function createAgentNotify({ onAction } = {}) {
  /** @type {Map<string, object>} */
  const pending = new Map();

  /**
   * @param {object} n
   * @param {string} n.title
   * @param {string} n.body
   * @param {string} [n.tag]
   * @param {object} [n.data]
   * @param {boolean} [n.requireApproval]
   * @param {string} [n.agentId]
   */
  async function notify(n) {
    const id = n.tag || `notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id,
      title: n.title || "Progressive Web Agent",
      body: n.body || "",
      tag: id,
      data: n.data || {},
      requireApproval: !!n.requireApproval,
      agentId: n.agentId || "system",
      ts: new Date().toISOString(),
    };
    pending.set(id, payload);

    emit(EVT.PILL, {
      level: n.requireApproval ? "warn" : "ok",
      message: `${payload.title}: ${payload.body}`.slice(0, 200),
    });
    emit(EVT.AGENT_NOTIFY, payload);

    // Browser Notification when permitted (shared path for all agents)
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg?.showNotification) {
          await reg.showNotification(payload.title, {
            body: payload.body,
            tag: payload.tag,
            data: { ...payload.data, notifyId: id, requireApproval: payload.requireApproval },
          });
        } else {
          // eslint-disable-next-line no-new
          new Notification(payload.title, { body: payload.body, tag: payload.tag });
        }
      } catch {
        /* non-fatal */
      }
    }

    return payload;
  }

  function approve(id) {
    const p = pending.get(id);
    if (!p) return null;
    pending.delete(id);
    onAction?.({ id, action: "approve", data: p });
    emit(EVT.AGENT_NOTIFY_ACTION, { id, action: "approve", data: p });
    return p;
  }

  function dismiss(id) {
    const p = pending.get(id);
    if (!p) return null;
    pending.delete(id);
    onAction?.({ id, action: "dismiss", data: p });
    emit(EVT.AGENT_NOTIFY_ACTION, { id, action: "dismiss", data: p });
    return p;
  }

  function getPending(id) {
    return id ? pending.get(id) || null : [...pending.values()];
  }

  return { notify, approve, dismiss, getPending };
}
