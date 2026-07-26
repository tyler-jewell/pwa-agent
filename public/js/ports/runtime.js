/**
 * Runtime adapter port (README). Core depends only on this shape.
 * Swap WebLLM / Transformers / mock by implementing this contract—never by
 * editing turn / router / memory / agent bus / task cores.
 *
 * RuntimeAdapter:
 *   id: string
 *   discover(): Promise<ModelRecord[]>
 *   getCapabilities(modelId): capabilities | null
 *   load(modelId, opts?): Promise<void>
 *   unload(modelId?): Promise<void>
 *   chatStream({ system, messages, modelId, signal? }): AsyncIterable<string>
 *   complete?({ system, messages, modelId, maxTokens?, signal? }): Promise<string>
 *   startProgressive?(onStatus, opts?): void
 *   resumeProgressive?(onStatus, opts?): void
 *   discoverCandidates?(): Promise<ModelRecord[]>
 *
 * Errors: { code: RuntimeErrorCode, message: string }
 */

export const RuntimeErrorCode = Object.freeze({
  unavailable: "unavailable",
  load_failed: "load_failed",
  oom: "oom",
  cancelled: "cancelled",
  infer_failed: "infer_failed",
  unsupported: "unsupported",
});

export function runtimeError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  err.runtime = true;
  return err;
}

export function isRuntimeError(e) {
  return !!(e && e.runtime && e.code);
}

/**
 * Validate adapter implements the required port (modularity gate).
 * @returns {string|null} error message or null if ok
 */
export function validateRuntimeAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") return "adapter not an object";
  if (typeof adapter.id !== "string" || !adapter.id) return "id required";
  for (const fn of ["discover", "getCapabilities", "load", "unload", "chatStream"]) {
    if (typeof adapter[fn] !== "function") return `${fn} required`;
  }
  return null;
}
