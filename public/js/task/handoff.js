/**
 * Structured handoff payload — successor continues without re-deriving (FP14).
 * Pure — no DOM.
 */

/**
 * Pack a handoff from current task state + capability snapshot.
 * @param {object} opts
 * @param {string} opts.goal
 * @param {object[]} [opts.items] - task items with status
 * @param {string[]} [opts.doneSoFar]
 * @param {string[]} [opts.remaining]
 * @param {object} [opts.constraints]
 * @param {object} [opts.snapshot] - capability snapshot (from)
 * @param {string} [opts.reason] - context | capability | step | explicit
 */
export function packHandoff({
  goal,
  items = [],
  doneSoFar = null,
  remaining = null,
  constraints = {},
  snapshot = null,
  reason = "context",
} = {}) {
  const achieved = items
    .filter((i) => i.status === "done")
    .map((i) => i.title || i.id);
  const open = items
    .filter((i) => i.status === "pending" || i.status === "blocked")
    .map((i) => i.title || i.id);

  const done = doneSoFar != null ? [...doneSoFar] : achieved;
  const rem = remaining != null ? [...remaining] : open;

  return {
    schema: "pwa.handoff.v1",
    goal: String(goal || ""),
    doneSoFar: done,
    remaining: rem,
    constraints: {
      maxSteps: constraints.maxSteps ?? null,
      minQualityClass: constraints.minQualityClass ?? null,
      ...constraints,
    },
    from: {
      agentId: snapshot?.agentId || null,
      modelId: snapshot?.modelId || null,
      qualityClass: snapshot?.qualityClass || null,
      tokensUsed: snapshot?.tokensUsed ?? null,
      contextFraction: snapshot?.contextFraction ?? null,
    },
    reason: reason || snapshot?.handoffReason || "explicit",
    atStep: constraints.step ?? null,
  };
}

/**
 * Apply a handoff into a fresh task-state shape for the successor.
 * @param {object} handoff
 * @param {object} [opts]
 */
export function receiveHandoff(handoff, opts = {}) {
  if (!handoff || typeof handoff !== "object") {
    return { ok: false, error: "invalid handoff" };
  }
  const goal = handoff.goal || "";
  const remaining = Array.isArray(handoff.remaining) ? handoff.remaining : [];
  const doneSoFar = Array.isArray(handoff.doneSoFar) ? handoff.doneSoFar : [];
  const items =
    opts.items ||
    remaining.map((title, i) => ({
      id: `rem_${i + 1}`,
      title: String(title),
      status: "pending",
    }));

  return {
    ok: true,
    state: {
      goal,
      items,
      doneSoFar: [...doneSoFar],
      remaining: remaining.map(String),
      handoffs: [handoff],
      step: 0,
      maxSteps: opts.maxSteps ?? handoff.constraints?.maxSteps ?? 8,
      status: "open",
      receivedFrom: handoff.from || null,
    },
  };
}

/** True when snapshot says we must hand off. */
export function shouldHandoff(snapshot) {
  return !!(snapshot && snapshot.needsHandoff);
}
