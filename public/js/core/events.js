/** Lightweight pub/sub for UI + cores (no vendor). */
const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  const set = listeners.get(type);
  if (set) set.delete(fn);
}

export function emit(type, detail) {
  const set = listeners.get(type);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (e) {
      console.error("[events]", type, e);
    }
  }
}

export const EVT = {
  TRANSCRIPT: "transcript",
  MEMORY: "memory",
  MODELS: "models",
  RUN_TREE: "run-tree",
  PILL: "pill",
  RUNTIME: "runtime",
  UPDATE: "update",
  QUALITY: "quality",
  LIMITED: "limited",
  AGENT_NOTIFY: "agent-notify",
  AGENT_NOTIFY_ACTION: "agent-notify-action",
  RECRUIT: "recruit",
  ROSTER: "roster",
  PERF: "perf",
  PLUGIN: "plugin",
  GOAL: "goal-session",
};
