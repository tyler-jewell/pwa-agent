/**
 * performance-manager — monitor agent activity, MEMORY Areas of opportunity,
 * recommend instruction promotion (≤1 notify per run).
 */
import {
  runPerformanceManagerLogic,
  promoteToInstructions,
} from "../perf/opportunity.js";
import { buildActivityFromState } from "../perf/activity.js";
import { kvGet, kvSet } from "../ports/storage.js";
import { emit, EVT } from "../core/events.js";

const HISTORY_KEY = "perfManagerHistory";

export function createPerformanceManager({
  memoryStore,
  memoryQueue,
  tree,
  registry,
  notify,
}) {
  async function loadHistory() {
    try {
      return (await kvGet(HISTORY_KEY)) || { runs: [] };
    } catch {
      return { runs: [] };
    }
  }

  async function saveHistory(h) {
    try {
      await kvSet(HISTORY_KEY, h);
    } catch {
      /* ignore */
    }
  }

  async function handler({ input = {} } = {}) {
    const history = await loadHistory();
    const models = registry?.list?.() || input.models || [];
    const runRoots = tree?.listRoots?.() || input.runRoots || [];
    const activity =
      input.activity ||
      buildActivityFromState({
        models,
        runRoots,
        prior: history.lastActivity || [],
      });

    const head = memoryStore.getHead().content || "";
    const logic = runPerformanceManagerLogic({
      memoryContent: head,
      activity,
      now: input.now,
    });

    let memoryCommitted = false;
    if (logic.memoryChanged && logic.memoryContent !== head) {
      const commit = await memoryQueue.enqueue(() =>
        memoryStore.commit({
          content: logic.memoryContent,
          source: "performance",
          summaryWhy: "performance-manager: update Areas of opportunity",
        })
      );
      memoryCommitted = !!(commit && commit.ok);
      if (commit && commit.ok === false && !commit.noop) {
        return {
          ok: false,
          error: commit.error || "memory commit failed",
          logic,
        };
      }
    }

    history.runs = [
      ...(history.runs || []),
      {
        ts: new Date().toISOString(),
        opportunityCount: logic.opportunities.length,
        ready: logic.opportunities.filter((o) => o.status === "ready_to_promote")
          .length,
      },
    ].slice(-50);
    history.lastActivity = activity;
    history.opportunities = logic.opportunities;
    await saveHistory(history);

    emit(EVT.PERF, {
      opportunities: logic.opportunities,
      promotion: logic.promotion,
    });

    let notifyPayload = null;
    let notified = false;
    if (logic.shouldNotify && logic.promotion.promote && notify) {
      const p = logic.promotion.promote;
      notifyPayload = await notify.notify({
        title: "Promote opportunity to instructions",
        body: logic.promotion.reason,
        requireApproval: true,
        agentId: "performance-manager",
        tag: `perf-promote-${p.opportunity.id}`,
        data: {
          type: "perf-promote",
          opportunityId: p.opportunity.id,
          agentId: p.opportunity.agentId,
          instruction: p.instruction,
        },
      });
      notified = !!notifyPayload;
    }

    return {
      ok: true,
      opportunities: logic.opportunities,
      memoryCommitted,
      promotion: logic.promotion,
      notified,
      notifyId: notifyPayload?.id || null,
      // enforce one notify max
      notifyCount: notified ? 1 : 0,
      message: logic.promotion.reason,
    };
  }

  /**
   * Apply approved promotion into Standing instructions on MEMORY.
   */
  async function applyPromotion({ agentId, instruction, opportunityId }) {
    const head = memoryStore.getHead().content || "";
    let next = promoteToInstructions(head, { agentId, instruction });
    // Mark opportunity promoted in section
    const { parseOpportunities, mergeOpportunitySection } = await import(
      "../perf/opportunity.js"
    );
    const opps = parseOpportunities(next).map((o) =>
      o.id === opportunityId ? { ...o, status: "promoted" } : o
    );
    next = mergeOpportunitySection(next, opps);

    const commit = await memoryQueue.enqueue(() =>
      memoryStore.commit({
        content: next,
        source: "performance",
        summaryWhy: `performance-manager: promote ${opportunityId} → instructions for ${agentId}`,
      })
    );
    if (!commit?.ok) {
      return { ok: false, error: commit?.error || "commit failed" };
    }
    emit(EVT.PILL, {
      level: "ok",
      message: `Promoted instruction for ${agentId}`,
    });
    return { ok: true };
  }

  return { handler, applyPromotion, loadHistory };
}
