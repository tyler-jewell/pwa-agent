/**
 * Runtime adapter port (README). Core depends only on this shape.
 *
 * RuntimeAdapter:
 *   id: string
 *   discover(): Promise<ModelRecord[]>
 *   getCapabilities(modelId): capabilities | null
 *   load(modelId, opts?): Promise<void>
 *   unload(modelId?): Promise<void>
 *   chatStream({ system, messages, modelId, signal? }): AsyncIterable<string>
 *   complete?({ system, messages, modelId, maxTokens?, signal? }): Promise<string>
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
