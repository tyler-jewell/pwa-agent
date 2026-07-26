/**
 * Mock runtime adapter — instant UI + self-tests, no GPU.
 * Progressive ladder: tiny (instant/offline) → small → medium (network then offline).
 * Large stays candidate-only (recruiter) for extensibility.
 */
import { RuntimeErrorCode, runtimeError } from "../ports/runtime.js";
import { progressiveLoadOrder, qualityRank } from "../router/progress.js";

const BACKEND_ID = "mock";

function baseModels() {
  return [
    {
      id: "mock-tiny",
      source: "discovered",
      backendId: BACKEND_ID,
      label: "Mock Tiny (instant)",
      capabilities: {
        contextWindowTokens: 2048,
        supportsStreaming: true,
        modalities: ["text"],
        qualityClass: "tiny",
      },
      constraints: {
        approxBytes: 1_000_000,
        requiresWebGpu: false,
        minRamHintMb: 64,
        offlineReady: true,
      },
      status: "ready",
      metrics: { latencyP50Ms: 8, failCount: 0, successCount: 0 },
    },
    {
      id: "mock-small",
      source: "discovered",
      backendId: BACKEND_ID,
      label: "Mock Small (progressive)",
      capabilities: {
        contextWindowTokens: 4096,
        supportsStreaming: true,
        modalities: ["text"],
        qualityClass: "small",
      },
      constraints: {
        approxBytes: 8_000_000,
        requiresWebGpu: false,
        minRamHintMb: 128,
        offlineReady: false,
      },
      status: "announced",
      metrics: { latencyP50Ms: null, failCount: 0, successCount: 0 },
    },
    {
      id: "mock-medium",
      source: "discovered",
      backendId: BACKEND_ID,
      label: "Mock Medium (progressive)",
      capabilities: {
        contextWindowTokens: 8192,
        supportsStreaming: true,
        modalities: ["text"],
        qualityClass: "medium",
      },
      constraints: {
        approxBytes: 32_000_000,
        requiresWebGpu: false,
        minRamHintMb: 256,
        offlineReady: false,
      },
      status: "announced",
      metrics: { latencyP50Ms: null, failCount: 0, successCount: 0 },
    },
  ];
}

/** Recruiter-only: not auto-progressive (extend ladder without auto-download). */
function candidatePool() {
  return [
    {
      id: "mock-large",
      source: "discovered",
      backendId: BACKEND_ID,
      label: "Mock Large (recruiter)",
      capabilities: {
        contextWindowTokens: 16_384,
        supportsStreaming: true,
        modalities: ["text"],
        qualityClass: "large",
      },
      constraints: {
        approxBytes: 128_000_000,
        requiresWebGpu: false,
        minRamHintMb: 512,
        offlineReady: false,
      },
      status: "announced",
      metrics: { latencyP50Ms: null, failCount: 0, successCount: 0 },
    },
  ];
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(runtimeError(RuntimeErrorCode.cancelled, "aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(runtimeError(RuntimeErrorCode.cancelled, "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delayFor(m, baseMs) {
  const r = qualityRank(m);
  return Math.round(baseMs * (1 + r * 0.35));
}

export function createMockAdapter({ progressiveDelayMs = 2500 } = {}) {
  const loaded = new Set(["mock-tiny"]);
  let progressiveStarted = false;
  const announced = baseModels();

  async function discover() {
    return announced.map(cloneRec);
  }

  async function discoverCandidates() {
    return candidatePool().map(cloneRec);
  }

  function cloneRec(m) {
    return {
      ...m,
      capabilities: { ...m.capabilities },
      constraints: { ...m.constraints },
      metrics: { ...m.metrics },
    };
  }

  function getCapabilities(modelId) {
    const m = findModel(modelId);
    return m ? { ...m.capabilities } : null;
  }

  function findModel(modelId) {
    return (
      announced.find((x) => x.id === modelId) ||
      candidatePool().find((x) => x.id === modelId) ||
      null
    );
  }

  async function load(modelId, onStatus) {
    let m = announced.find((x) => x.id === modelId);
    if (!m) {
      const cand = candidatePool().find((x) => x.id === modelId);
      if (cand) {
        m = cloneRec(cand);
        announced.push(m);
      }
    }
    if (!m) throw runtimeError(RuntimeErrorCode.unavailable, `unknown model ${modelId}`);
    if (loaded.has(modelId)) {
      m.status = "ready";
      m.constraints.offlineReady = true;
      onStatus?.(modelId, "ready");
      return;
    }
    m.status = "downloading";
    onStatus?.(modelId, "downloading");
    await sleep(delayFor(m, progressiveDelayMs));
    loaded.add(modelId);
    m.status = "ready";
    m.constraints.offlineReady = true;
    m.metrics.latencyP50Ms = 12 + qualityRank(m) * 10;
    onStatus?.(modelId, "ready");
  }

  async function unload(modelId) {
    if (modelId) loaded.delete(modelId);
  }

  /**
   * Progressive load: sequential by quality (small then medium).
   * Skips when offline — resumes via startProgressive when online again.
   */
  function startProgressive(onStatus, opts = {}) {
    const online = opts.online !== false;
    if (!online) return;
    if (progressiveStarted) return;
    progressiveStarted = true;

    const queue = progressiveLoadOrder(announced);
    (async () => {
      for (const m of queue) {
        try {
          await load(m.id, onStatus);
        } catch (e) {
          m.status = "failed";
          m.metrics.failCount += 1;
          onStatus?.(m.id, "failed", e);
        }
      }
    })();
  }

  /** Allow resume after offline — only if ladder not finished. */
  function resumeProgressive(onStatus, opts = {}) {
    if (opts.online === false) return;
    const pending = progressiveLoadOrder(announced);
    if (!pending.length) return;
    progressiveStarted = false;
    startProgressive(onStatus, opts);
  }

  async function* chatStream({ system, messages, modelId, signal }) {
    if (!loaded.has(modelId)) {
      throw runtimeError(RuntimeErrorCode.unavailable, `model not ready: ${modelId}`);
    }
    const lastUser = [...(messages || [])].reverse().find((m) => m.role === "user");
    const q = (lastUser?.content || "").trim();
    const memHint = (system || "").includes("# Memory") ? " (with MEMORY)" : "";
    const reply = q
      ? `Mock(${modelId})${memHint}: I heard “${q.slice(0, 200)}”. ` +
        "This is a progressive local-first reply from the mock adapter."
      : `Mock(${modelId})${memHint}: Ready.`;

    const words = reply.split(/(\s+)/);
    for (const w of words) {
      if (signal?.aborted) throw runtimeError(RuntimeErrorCode.cancelled, "aborted");
      await sleep(12 + Math.random() * 20, signal);
      yield w;
    }
    const m = announced.find((x) => x.id === modelId);
    if (m) m.metrics.successCount += 1;
  }

  async function complete(opts) {
    let out = "";
    for await (const t of chatStream(opts)) out += t;
    return out;
  }

  return {
    id: BACKEND_ID,
    discover,
    discoverCandidates,
    getCapabilities,
    load,
    unload,
    chatStream,
    complete,
    startProgressive,
    resumeProgressive,
  };
}
