/** Contract validators — README Data schemas. */

const MEMORY_MAX = 64 * 1024;
const SOURCES = new Set([
  "reflect",
  "compact",
  "restore",
  "import",
  "seed",
  "user_edit",
  "router_lesson",
  "performance",
]);
const ROLES = new Set(["user", "assistant", "system", "summary"]);
const QUALITY = new Set(["tiny", "small", "medium", "large"]);
const MSTATUS = new Set(["announced", "downloading", "ready", "failed", "evicted"]);
const RSTATUS = new Set(["started", "streaming", "ok", "error"]);
const AGENTS = new Set([
  "chat-agent",
  "memory-agent",
  "router-agent",
  "recruiter",
  "trainer",
  "performance-manager",
  "crew-agent",
  "goal-agent",
]);

export function utf8Bytes(str) {
  return new TextEncoder().encode(str || "").length;
}

export function validateMemoryVersion(v, { requireWhy = false } = {}) {
  if (!v || typeof v !== "object") return "not an object";
  if (typeof v.id !== "string" || !v.id) return "id required";
  if (typeof v.createdAt !== "string") return "createdAt required";
  if (typeof v.content !== "string") return "content required";
  if (utf8Bytes(v.content) > MEMORY_MAX) return "content exceeds 64 KiB";
  if (!SOURCES.has(v.source)) return `invalid source: ${v.source}`;
  if (v.parentId != null && typeof v.parentId !== "string") return "parentId invalid";
  if (requireWhy && (!v.summaryWhy || !String(v.summaryWhy).trim())) {
    return "summaryWhy required for this source";
  }
  return null;
}

export function validateChatMessage(m) {
  if (!m || typeof m !== "object") return "not an object";
  if (typeof m.id !== "string") return "id required";
  if (!ROLES.has(m.role)) return `invalid role: ${m.role}`;
  if (typeof m.content !== "string") return "content required";
  if (typeof m.createdAt !== "string") return "createdAt required";
  return null;
}

export function validateModelRecord(m) {
  if (!m || typeof m !== "object") return "not an object";
  if (typeof m.id !== "string") return "id required";
  if (m.source !== "discovered") return "source must be discovered";
  if (typeof m.backendId !== "string") return "backendId required";
  if (typeof m.label !== "string") return "label required";
  const c = m.capabilities;
  if (!c || typeof c.contextWindowTokens !== "number") return "capabilities invalid";
  if (!QUALITY.has(c.qualityClass)) return "qualityClass invalid";
  if (!MSTATUS.has(m.status)) return "status invalid";
  return null;
}

export function validateRunTreeEvent(e) {
  if (!e || typeof e !== "object") return "not an object";
  if (typeof e.runId !== "string") return "runId required";
  if (!AGENTS.has(e.agentId)) return "agentId invalid";
  if (!RSTATUS.has(e.status)) return "status invalid";
  return null;
}

export function validateExportBundle(b) {
  if (!b || typeof b !== "object") return "not an object";
  if (b.schemaVersion !== 1) return `unsupported schemaVersion: ${b.schemaVersion}`;
  // Accept legacy export app id for one-time migration
  if (b.app !== "pwa" && b.app !== "pwa-agent") return "app must be pwa";
  if (!Array.isArray(b.memoryVersions)) return "memoryVersions required";
  if (!b.transcript || !Array.isArray(b.transcript.messages)) return "transcript invalid";
  return null;
}

export function validateVersionManifest(v) {
  if (!v || typeof v !== "object") return "not an object";
  if (typeof v.buildId !== "string" || !v.buildId) return "buildId required";
  if (typeof v.createdAt !== "string") return "createdAt required";
  if (!v.changelog || typeof v.changelog.summary !== "string") return "changelog.summary required";
  return null;
}

export const SEED_MEMORY = "# Memory\n\n_(empty — learn from this human.)_\n";
export const IDENTITY_SYSTEM =
  "You are Progressive Web Agent (pwa), a local-first progressive agent in the user's browser. " +
  "You know nothing about this human until MEMORY.md teaches you. Be concise, helpful, and honest. " +
  "You progressively use better models as they become ready; self-improve MEMORY; host orchestrates tools and other agents transparently in the feed. " +
  "You work as an army of small smart people: always know your capability and context budget, hand off when needed, loop until done or budget ends, and report honestly what you achieved and what you did not.";

export { MEMORY_MAX };
