/**
 * Recruiter — background one recommendation per refresh (value-add models).
 */
import { decideRecruitment } from "../recruit/decide.js";
import { loadAggression } from "../recruit/settings.js";
import { emit, EVT } from "../core/events.js";

export function createRecruiterAgent({ registry, notify }) {
  async function estimateStorage() {
    try {
      if (navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }
    } catch {
      /* ignore */
    }
    return { usage: 0, quota: 0 };
  }

  async function gatherCandidates() {
    if (typeof registry.collectCandidates === "function") {
      return registry.collectCandidates();
    }
    return registry.list().filter((m) => m.status !== "ready");
  }

  /**
   * Bus handler — at most one recommendation when warranted.
   */
  async function handler({ input = {} } = {}) {
    const aggression =
      input.aggression != null
        ? input.aggression
        : await loadAggression(3);
    const installed = registry.list();
    const candidates = await gatherCandidates();

    const storage = input.storage || (await estimateStorage());
    const decision = decideRecruitment({
      installed,
      candidates,
      storage,
      aggression,
    });

    emit(EVT.RECRUIT, { decision, aggression });

    if (decision.action === "none") {
      return {
        ok: true,
        decision,
        notified: false,
        message: decision.reason,
      };
    }

    const title =
      decision.action === "replace"
        ? "Model replace recommended"
        : "New model recommended";
    const body = decision.reason;
    let notifyPayload = null;
    if (notify) {
      notifyPayload = await notify.notify({
        title,
        body,
        requireApproval: true,
        agentId: "recruiter",
        tag: `recruit-${decision.candidate?.id || "none"}`,
        data: {
          type: "recruit",
          action: decision.action,
          candidateId: decision.candidate?.id,
          replaceId: decision.replaceId,
          candidate: decision.candidate,
          reason: decision.reason,
        },
      });
    }

    return {
      ok: true,
      decision,
      notified: !!notifyPayload,
      notifyId: notifyPayload?.id || null,
      message: body,
    };
  }

  return { handler, gatherCandidates, estimateStorage };
}
