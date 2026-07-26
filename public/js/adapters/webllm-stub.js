/**
 * Optional WebLLM-shaped adapter stub — no vendor SDK import (FP0).
 * Announces a GPU model; load fails with clear code until a real adapters/webllm.js
 * is added that dynamically imports the CDN/SDK outside core.
 */
import { RuntimeErrorCode, runtimeError } from "../ports/runtime.js";

const BACKEND_ID = "webllm-stub";

export function createWebLlmStubAdapter() {
  const models = [
    {
      id: "webllm-stub-tiny",
      source: "discovered",
      backendId: BACKEND_ID,
      label: "WebLLM (stub — wire real adapter later)",
      capabilities: {
        contextWindowTokens: 4096,
        supportsStreaming: true,
        modalities: ["text"],
        qualityClass: "small",
      },
      constraints: {
        approxBytes: 50_000_000,
        requiresWebGpu: true,
        minRamHintMb: 2048,
        offlineReady: false,
      },
      status: "announced",
      metrics: { latencyP50Ms: null, failCount: 0, successCount: 0 },
    },
  ];

  return {
    id: BACKEND_ID,
    async discover() {
      const gpu = typeof navigator !== "undefined" && !!navigator.gpu;
      return models.map((m) => ({
        ...m,
        status: gpu ? m.status : "failed",
        capabilities: { ...m.capabilities },
        constraints: { ...m.constraints },
        metrics: { ...m.metrics },
      }));
    },
    async discoverCandidates() {
      return [];
    },
    getCapabilities(modelId) {
      const m = models.find((x) => x.id === modelId);
      return m ? { ...m.capabilities } : null;
    },
    async load() {
      throw runtimeError(
        RuntimeErrorCode.unsupported,
        "WebLLM stub only — add adapters/webllm.js with dynamic vendor import"
      );
    },
    async unload() {},
    startProgressive() {
      /* real WebLLM adapter: background load after tiny is ready */
    },
    resumeProgressive() {},
    async *chatStream() {
      throw runtimeError(RuntimeErrorCode.unavailable, "WebLLM stub not loaded");
    },
  };
}
