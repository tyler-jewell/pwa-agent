/**
 * Model registry — discovery only (FP3). No hardcoded catalog in app source.
 * Owns progressive load orchestration (network-aware).
 */
import { emit, EVT } from "../core/events.js";
import { validateModelRecord } from "../core/schema.js";
import {
  computeProgressStage,
  formatProgressRuntime,
} from "../router/progress.js";

export function createRegistry() {
  /** @type {Map<string, object>} */
  const models = new Map();
  /** @type {Map<string, object>} */
  const adapters = new Map();
  let preferredModelId = null;

  function list() {
    return [...models.values()].map(cloneModel);
  }

  function get(id) {
    const m = models.get(id);
    return m ? cloneModel(m) : null;
  }

  function cloneModel(m) {
    return {
      ...m,
      capabilities: { ...m.capabilities },
      constraints: { ...m.constraints },
      metrics: { ...m.metrics },
    };
  }

  function isOnline() {
    return typeof navigator === "undefined" ? true : navigator.onLine !== false;
  }

  function emitModels() {
    const modelsList = list();
    const progress = computeProgressStage(modelsList, { online: isOnline() });
    emit(EVT.MODELS, { models: modelsList, progress });
    const rt = formatProgressRuntime(progress);
    emit(EVT.RUNTIME, rt);
  }

  function upsert(record) {
    const err = validateModelRecord(record);
    if (err) {
      console.warn("[registry] skip invalid model", err, record);
      return;
    }
    const prev = models.get(record.id);
    models.set(record.id, {
      ...record,
      metrics:
        record.metrics ||
        prev?.metrics || { latencyP50Ms: null, failCount: 0, successCount: 0 },
      constraints: {
        ...(prev?.constraints || {}),
        ...(record.constraints || {}),
      },
    });
    emitModels();
  }

  function setStatus(id, status, patch = {}) {
    const m = models.get(id);
    if (!m) return;
    m.status = status;
    Object.assign(m, patch);
    if (patch.metrics) m.metrics = { ...m.metrics, ...patch.metrics };
    if (patch.constraints) {
      m.constraints = { ...m.constraints, ...patch.constraints };
    }
    // Progressive load completes → mark offline-capable (PWA cache metaphor)
    if (status === "ready" && m.constraints) {
      m.constraints.offlineReady = true;
    }
    emitModels();
  }

  function registerAdapter(adapter) {
    adapters.set(adapter.id, adapter);
  }

  function listAdapters() {
    return [...adapters.values()];
  }

  async function collectCandidates() {
    const out = [];
    for (const m of list()) {
      if (m.status !== "ready") out.push(m);
    }
    for (const adapter of adapters.values()) {
      if (typeof adapter.discoverCandidates === "function") {
        try {
          const found = await adapter.discoverCandidates();
          for (const rec of found || []) {
            if (rec?.id) out.push(rec);
          }
        } catch (e) {
          console.warn("[registry] discoverCandidates failed", adapter.id, e);
        }
      }
    }
    const map = new Map();
    for (const c of out) map.set(c.id, c);
    return [...map.values()];
  }

  async function discoverAll() {
    for (const adapter of adapters.values()) {
      const found = await adapter.discover();
      for (const rec of found) upsert(rec);
    }
    return list();
  }

  function readyModels() {
    return list().filter((m) => m.status === "ready");
  }

  /** Prefer tiniest ready for cold start; router may prefer larger later. */
  function bestReady(qualityPreference = ["tiny", "small", "medium", "large"]) {
    const ready = readyModels();
    for (const q of qualityPreference) {
      const hit = ready.find((m) => m.capabilities.qualityClass === q);
      if (hit) return hit;
    }
    return ready[0] || null;
  }

  function getAdapterFor(modelId) {
    const m = models.get(modelId);
    if (!m) return null;
    return adapters.get(m.backendId) || null;
  }

  function setPreferred(id) {
    preferredModelId = id;
  }

  function getPreferred() {
    if (preferredModelId && models.get(preferredModelId)?.status === "ready") {
      return get(preferredModelId);
    }
    return bestReady();
  }

  function onProgressStatus(id, status) {
    setStatus(id, status);
  }

  function startProgressiveLoads() {
    const online = isOnline();
    for (const adapter of adapters.values()) {
      if (typeof adapter.startProgressive === "function") {
        adapter.startProgressive(onProgressStatus, { online });
      }
    }
    emitModels();
  }

  /** When network returns, resume unfinished progressive downloads. */
  function resumeProgressiveLoads() {
    if (!isOnline()) return;
    for (const adapter of adapters.values()) {
      if (typeof adapter.resumeProgressive === "function") {
        adapter.resumeProgressive(onProgressStatus, { online: true });
      } else if (typeof adapter.startProgressive === "function") {
        adapter.startProgressive(onProgressStatus, { online: true });
      }
    }
  }

  function progressSnapshot() {
    return computeProgressStage(list(), { online: isOnline() });
  }

  function refreshProgress() {
    emitModels();
  }

  function snapshot() {
    return list();
  }

  return {
    registerAdapter,
    listAdapters,
    collectCandidates,
    discoverAll,
    list,
    get,
    upsert,
    setStatus,
    readyModels,
    bestReady,
    getAdapterFor,
    setPreferred,
    getPreferred,
    startProgressiveLoads,
    resumeProgressiveLoads,
    progressSnapshot,
    refreshProgress,
    snapshot,
  };
}
