/**
 * Boot: run performance-manager once per page refresh (background).
 * Wire approve → apply Standing instructions.
 */
import { emit, EVT, on } from "../core/events.js";

export function startPerformanceManagerOnBoot({ bus }) {
  queueMicrotask(() => {
    bus
      .invoke({
        agentId: "performance-manager",
        name: "review-performance",
        parentRunId: null,
        input: {},
      })
      .then((result) => {
        if (result?.notified) {
          emit(EVT.PILL, {
            level: "warn",
            message: "Performance-manager: promotion recommended",
          });
        }
      })
      .catch((e) => {
        emit(EVT.PILL, {
          level: "err",
          message: `Performance-manager failed: ${e.message || e}`,
        });
      });
  });
}

export function wirePerfPromotionApproval({ notify, performanceManager }) {
  on(EVT.AGENT_NOTIFY_ACTION, async ({ action, data: notifyPayload }) => {
    if (action !== "approve") return;
    const rec = notifyPayload?.data;
    if (!rec || rec.type !== "perf-promote") return;
    try {
      const result = await performanceManager.applyPromotion({
        agentId: rec.agentId,
        instruction: rec.instruction,
        opportunityId: rec.opportunityId,
      });
      if (!result?.ok) {
        emit(EVT.PILL, {
          level: "err",
          message: `Promotion failed: ${result?.error || "unknown"}`,
        });
      }
    } catch (e) {
      emit(EVT.PILL, {
        level: "err",
        message: `Promotion error: ${e.message || e}`,
      });
    }
  });
}
