/**
 * Bounded task loop — tick → act | handoff → reassess (FP15).
 * Pure decision helpers + async runner with injected act/snapshot.
 * "Always complete" = always terminate with honest report, not infinite success.
 */
import { packHandoff, shouldHandoff } from "./handoff.js";
import { buildHonestReport } from "./report.js";
import { applyCapabilityNeed } from "./capability.js";

export const DEFAULT_MAX_STEPS = 8;

/**
 * Create initial open task state from a goal + item titles.
 */
export function createTaskState({
  goal,
  itemTitles = [],
  maxSteps = DEFAULT_MAX_STEPS,
  minQualityClass = null,
} = {}) {
  const titles =
    itemTitles.length > 0
      ? itemTitles
      : parseItemsFromGoal(goal);
  const items = titles.map((title, i) => ({
    id: `item_${i + 1}`,
    title: String(title).trim() || `step ${i + 1}`,
    status: "pending",
  }));
  return {
    goal: String(goal || ""),
    items,
    doneSoFar: [],
    remaining: items.map((i) => i.title),
    handoffs: [],
    step: 0,
    maxSteps: Math.max(1, Number(maxSteps) || DEFAULT_MAX_STEPS),
    status: "open",
    minQualityClass,
  };
}

/** Split "a; b; c" or numbered lines into item titles. */
export function parseItemsFromGoal(goal) {
  const g = String(goal || "").trim();
  if (!g) return ["(empty goal)"];
  if (g.includes(";")) {
    return g
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const lines = g
    .split(/\n/)
    .map((s) => s.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  return [g];
}

/**
 * Pure tick decision given state + capability snapshot.
 * @returns {{ action: 'complete'|'exhaust'|'handoff'|'act', item?: object, handoff?: object, reason?: string }}
 */
export function decideTick(state, snapshot, opts = {}) {
  if (!state || state.status !== "open") {
    return { action: "complete", reason: "not open" };
  }
  const pending = state.items.filter((i) => i.status === "pending");
  if (!pending.length) {
    return { action: "complete", reason: "all items done" };
  }
  if (state.step >= state.maxSteps) {
    return { action: "exhaust", reason: "max steps reached" };
  }

  let snap = snapshot || {};
  if (state.minQualityClass) {
    snap = applyCapabilityNeed(snap, state.minQualityClass);
  }

  if (shouldHandoff(snap) || opts.forceHandoff) {
    const handoff = packHandoff({
      goal: state.goal,
      items: state.items,
      doneSoFar: state.doneSoFar,
      remaining: pending.map((i) => i.title),
      constraints: {
        maxSteps: state.maxSteps,
        minQualityClass: state.minQualityClass,
        step: state.step,
      },
      snapshot: snap,
      reason: opts.forceHandoff ? "explicit" : snap.handoffReason || "context",
    });
    return { action: "handoff", handoff, reason: handoff.reason };
  }

  return { action: "act", item: pending[0], reason: "next pending" };
}

/**
 * Apply a successful act on an item.
 */
export function applyActResult(state, itemId, result = {}) {
  const next = cloneState(state);
  next.step += 1;
  const item = next.items.find((i) => i.id === itemId);
  if (!item) return next;
  if (result.ok === false) {
    item.status = "blocked";
    item.note = result.error || result.why || "act failed";
  } else {
    item.status = "done";
    item.note = result.note || null;
    if (!next.doneSoFar.includes(item.title)) next.doneSoFar.push(item.title);
  }
  next.remaining = next.items
    .filter((i) => i.status === "pending" || i.status === "blocked")
    .map((i) => i.title);
  if (next.items.every((i) => i.status === "done")) {
    next.status = "complete";
  }
  return next;
}

/**
 * Record handoff on state (work remains open for successor).
 */
export function applyHandoff(state, handoff) {
  const next = cloneState(state);
  next.step += 1;
  next.handoffs = [...next.handoffs, handoff];
  // After handoff, remaining pending items stay pending for successor path
  return next;
}

export function markExhausted(state) {
  const next = cloneState(state);
  next.status = "exhausted";
  return next;
}

export function markStopped(state, why) {
  const next = cloneState(state);
  next.status = "stopped";
  next.stopWhy = why || "stopped";
  return next;
}

function cloneState(state) {
  return {
    ...state,
    items: (state.items || []).map((i) => ({ ...i })),
    doneSoFar: [...(state.doneSoFar || [])],
    remaining: [...(state.remaining || [])],
    handoffs: [...(state.handoffs || [])],
  };
}

/**
 * Run bounded loop with injected dependencies.
 * @param {object} opts
 * @param {object} opts.state - initial task state
 * @param {() => object|Promise<object>} opts.getSnapshot
 * @param {(item, state, snapshot) => Promise<{ok?:boolean,error?:string,note?:string,handoff?:boolean}>} opts.act
 * @param {(handoff, state) => Promise<object|null>} [opts.onHandoff] - return successor snapshot/model or null
 * @param {(event) => void} [opts.onEvent] - tick telemetry for run tree
 * @param {boolean} [opts.continueAfterHandoff] - if true, keep acting after handoff with same state
 */
export async function runTaskLoop({
  state: initial,
  getSnapshot,
  act,
  onHandoff,
  onEvent,
  continueAfterHandoff = true,
} = {}) {
  let state = cloneState(initial);
  let lastSnapshot = null;
  let lastModelId = null;

  while (state.status === "open") {
    const snapshot = await getSnapshot(state);
    lastSnapshot = snapshot;
    lastModelId = snapshot?.modelId || lastModelId;
    const decision = decideTick(state, snapshot);
    onEvent?.({ type: "tick", step: state.step, decision, snapshot });

    if (decision.action === "complete") {
      state = { ...state, status: "complete" };
      break;
    }
    if (decision.action === "exhaust") {
      state = markExhausted(state);
      break;
    }
    if (decision.action === "handoff") {
      state = applyHandoff(state, decision.handoff);
      onEvent?.({ type: "handoff", handoff: decision.handoff, step: state.step });
      const successor = onHandoff
        ? await onHandoff(decision.handoff, state)
        : null;
      if (!continueAfterHandoff || !successor) {
        // No successor available — stop honestly with remaining work
        if (!state.items.some((i) => i.status === "pending")) {
          state = { ...state, status: "complete" };
        } else {
          state = markStopped(state, "handoff without successor");
        }
        break;
      }
      // Successor accepted — continue loop (getSnapshot should reflect new model)
      continue;
    }

    // act
    const item = decision.item;
    onEvent?.({ type: "act", item, step: state.step, snapshot });
    let result;
    try {
      result = (await act(item, state, snapshot)) || { ok: true };
    } catch (e) {
      result = { ok: false, error: String(e?.message || e) };
    }
    if (result.handoff) {
      const handoff = packHandoff({
        goal: state.goal,
        items: state.items,
        snapshot,
        reason: "explicit",
        constraints: { maxSteps: state.maxSteps, step: state.step },
      });
      state = applyHandoff(state, handoff);
      onEvent?.({ type: "handoff", handoff, step: state.step });
      if (onHandoff) await onHandoff(handoff, state);
      if (!continueAfterHandoff) {
        state = markStopped(state, "explicit handoff stop");
        break;
      }
      continue;
    }
    state = applyActResult(state, item.id, result);
    if (state.status === "complete") break;
  }

  const report = buildHonestReport(state, {
    lastModelId,
    lastSnapshot,
  });
  onEvent?.({ type: "report", report, state });
  return { state, report };
}
