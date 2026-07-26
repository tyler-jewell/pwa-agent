/** Export / import / clear (FP8). Atomic IDB replace + deep validation. */
import { nowIso } from "./ids.js";
import {
  validateExportBundle,
  validateMemoryVersion,
  validateChatMessage,
} from "./schema.js";
import { atomicImportState } from "../ports/storage.js";

export function buildExportBundle({ memoryStore, transcript, registry }) {
  const mem = memoryStore.snapshot();
  const tr = transcript.snapshot();
  const preferred = registry.getPreferred();
  return {
    schemaVersion: 1,
    exportedAt: nowIso(),
    app: "pwa",
    memoryHeadId: mem.memoryHeadId,
    memoryVersions: mem.versions,
    transcript: tr,
    modelsSnapshot: registry.snapshot(),
    runtimeHint: {
      backendId: preferred?.backendId || "mock",
      modelId: preferred?.id || "",
    },
  };
}

/** Validate every version/message before any write. */
export function validateBundleDeep(bundle) {
  const err = validateExportBundle(bundle);
  if (err) return err;
  if (!bundle.memoryHeadId) return "memoryHeadId required";
  const ids = new Set();
  for (const v of bundle.memoryVersions) {
    const ve = validateMemoryVersion(v, {
      requireWhy:
        v.source === "reflect" || v.source === "compact" || v.source === "router_lesson",
    });
    if (ve) return `memoryVersion ${v?.id || "?"}: ${ve}`;
    if (ids.has(v.id)) return `duplicate memory version id: ${v.id}`;
    ids.add(v.id);
  }
  if (!ids.has(bundle.memoryHeadId)) {
    return "memoryHeadId not found in memoryVersions";
  }
  const msgs = bundle.transcript?.messages || [];
  for (const m of msgs) {
    const me = validateChatMessage(m);
    if (me) return `message ${m?.id || "?"}: ${me}`;
  }
  return null;
}

/**
 * Atomic import: deep-validate then single multi-store IDB transaction.
 * Caller should wrap with memoryQueue.enqueue for serial mutations.
 */
export async function importBundle(bundle, { memoryStore, transcript }) {
  const err = validateBundleDeep(bundle);
  if (err) throw new Error(err);

  const versions = bundle.memoryVersions.slice();
  const headId = bundle.memoryHeadId;
  const tr = {
    messages: (bundle.transcript.messages || []).map((m) => ({
      ...m,
      meta: { ...(m.meta || {}) },
    })),
    updatedAt: bundle.transcript.updatedAt || nowIso(),
  };

  await atomicImportState({ versions, headId, transcript: tr });
  // Rehydrate in-memory caches from what we just wrote (no second write)
  await memoryStore.hydrateFrom(versions, headId);
  await transcript.hydrateFrom(tr);
  return true;
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
