/** Device capability probes for routing (equal core — not chat-owned). */
export function probeDevice() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  return {
    deviceMemoryGb: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency || 2,
    webgpu: typeof navigator !== "undefined" && !!navigator.gpu,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
  };
}

export function taskComplexity(userText) {
  const t = (userText || "").trim();
  if (t.length > 800) return "high";
  if (t.length > 200 || /\b(code|explain|analyze|plan|compare)\b/i.test(t)) return "medium";
  return "low";
}
