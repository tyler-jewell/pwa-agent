/**
 * Boot hook: run recruiter once per full page load (background, non-blocking).
 */
import { loadAggression, saveAggression } from "../recruit/settings.js";
import { emit, EVT, on } from "../core/events.js";

/**
 * @param {object} opts
 * @param {object} opts.bus
 * @param {object} opts.notify
 * @param {object} opts.trainer - trainer agent has .handler
 */
export function startRecruiterOnBoot({ bus, notify }) {
  // Fire-and-forget after paint — never block chat
  queueMicrotask(() => {
    bus
      .invoke({
        agentId: "recruiter",
        name: "scan-models",
        parentRunId: null,
        input: {},
      })
      .then((result) => {
        if (result?.decision?.action && result.decision.action !== "none") {
          emit(EVT.PILL, {
            level: "warn",
            message: `Recruiter: ${result.decision.action} ${result.decision.candidate?.id || ""}`,
          });
        }
      })
      .catch((e) => {
        emit(EVT.PILL, {
          level: "err",
          message: `Recruiter failed: ${e.message || e}`,
        });
      });
  });
}

/**
 * Wire approve/dismiss for recruit notifications → trainer.
 */
export function wireRecruitApproval({ bus, notify }) {
  on(EVT.AGENT_NOTIFY_ACTION, async ({ action, data: notifyPayload }) => {
    if (action !== "approve") return;
    // notifyPayload is the full agent-notify record; .data holds recruit fields
    const rec = notifyPayload?.data;
    if (!rec || rec.type !== "recruit") return;

    try {
      const result = await bus.invoke({
        agentId: "trainer",
        name: "train-model",
        parentRunId: null,
        input: {
          candidateId: rec.candidateId,
          replaceId: rec.replaceId,
          candidate: rec.candidate,
        },
      });
      if (result?.ok) {
        emit(EVT.PILL, {
          level: "ok",
          message: `Trainer: ${result.modelId} smartness ${result.metrics?.smartness}`,
        });
      } else {
        emit(EVT.PILL, {
          level: "err",
          message: `Trainer failed: ${result?.error || "unknown"}`,
        });
      }
    } catch (e) {
      emit(EVT.PILL, {
        level: "err",
        message: `Trainer error: ${e.message || e}`,
      });
    }
  });

  return {
    async approveNotifyId(id) {
      return notify.approve(id);
    },
    async setAggression(n) {
      return saveAggression(n);
    },
    async getAggression() {
      return loadAggression(3);
    },
  };
}
