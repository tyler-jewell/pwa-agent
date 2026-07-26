/**
 * crew-agent — bounded multi-step loops under chat-agent (FP13–16).
 * Small smart people: capability-aware, handoff, loop, honest report.
 */
import { estimateMessagesTokens } from "../core/tokens.js";
import { buildCapabilitySnapshot } from "../task/capability.js";
import {
  createTaskState,
  runTaskLoop,
  parseItemsFromGoal,
} from "../task/loop.js";
import { formatReportForChat } from "../task/report.js";
import { rankModels } from "../router/rank.js";
import { probeDevice } from "../router/probe.js";

/**
 * Detect multi-step crew work: "task:" prefix or multi-item goal.
 */
export function isCrewTask(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (/^task\s*:/i.test(t)) return true;
  if (/^crew\s*:/i.test(t)) return true;
  if (t.includes(";") && t.split(";").filter((s) => s.trim()).length >= 2) {
    return true;
  }
  return false;
}

export function extractCrewGoal(text) {
  const t = (text || "").trim();
  return t.replace(/^(task|crew)\s*:\s*/i, "").trim() || t;
}

export function createCrewAgent({ registry }) {
  /**
   * Bus handler — runs bounded loop; returns honest report.
   * input: { goal, items?, maxSteps?, minQualityClass?, modelId?, system?, messages? }
   */
  async function handler({ input = {} } = {}) {
    const goal = String(input.goal || "").trim();
    if (!goal) {
      return {
        ok: false,
        error: "crew-agent requires goal",
        detail: { error: "no goal" },
      };
    }

    const itemTitles =
      Array.isArray(input.items) && input.items.length
        ? input.items.map(String)
        : parseItemsFromGoal(goal);

    let state = createTaskState({
      goal,
      itemTitles,
      maxSteps: input.maxSteps ?? Math.max(itemTitles.length + 2, 4),
      minQualityClass: input.minQualityClass || null,
    });

    let model =
      (input.modelId && registry.get(input.modelId)) ||
      registry.getPreferred() ||
      registry.bestReady();

    if (!model) {
      return {
        ok: false,
        error: "no ready model for crew",
        detail: { error: "no model" },
      };
    }

    const events = [];
    const workingTexts = [];

    const result = await runTaskLoop({
      state,
      getSnapshot: async (st) => {
        const tokensUsed = estimateMessagesTokens(
          input.messages || [],
          [input.system || "", goal, ...workingTexts, ...st.doneSoFar]
        );
        // Simulate growing context as work accumulates
        const inflated = tokensUsed + workingTexts.join("").length / 4;
        return buildCapabilitySnapshot({
          agentId: "crew-agent",
          model,
          system: input.system || "",
          messages: input.messages || [],
          extraTexts: [goal, ...workingTexts],
          tokensUsed: inflated,
        });
      },
      act: async (item, st, snapshot) => {
        workingTexts.push(item.title);
        // Mock-first crew: complete item if we can continue; else signal handoff
        if (snapshot?.needsHandoff) {
          return { handoff: true };
        }
        return {
          ok: true,
          note: `done by ${snapshot.modelId} (${snapshot.qualityClass}, ctx ${snapshot.contextFraction})`,
        };
      },
      onHandoff: async (handoff) => {
        events.push({ type: "handoff", handoff });
        // Pick a stronger ready model if available
        const ready = registry.readyModels();
        const ranked = rankModels(ready, probeDevice(), "high");
        const next =
          ranked.find(
            (m) =>
              m.id !== model?.id &&
              qualityRank(m) > qualityRank(model)
          ) || ranked.find((m) => m.id !== model?.id);
        if (next) {
          model = next;
          return { modelId: next.id };
        }
        return null;
      },
      onEvent: (ev) => events.push(ev),
      continueAfterHandoff: true,
    });

    const report = result.report;
    return {
      ok: true,
      report,
      state: result.state,
      text: formatReportForChat(report),
      detail: {
        status: report.status,
        complete: report.complete,
        achieved: report.achieved.length,
        notAchieved: report.notAchieved.length,
        stepsUsed: report.stepsUsed,
        handoffCount: report.handoffCount,
        modelId: model?.id,
        capability: events.filter((e) => e.snapshot).slice(-1)[0]?.snapshot,
      },
    };
  }

  return { handler, isCrewTask, extractCrewGoal };
}

function qualityRank(m) {
  const q = m?.capabilities?.qualityClass;
  return { tiny: 0, small: 1, medium: 2, large: 3 }[q] ?? 0;
}
