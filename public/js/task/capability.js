/**
 * Capability + context snapshot for each unit of agent work (FP13).
 * Pure — no DOM/IDB. Uses estimateTokens from core.
 */
import { estimateTokens, estimateMessagesTokens } from "../core/tokens.js";

/** Fraction of context window at/above which the unit should hand off. */
export const CONTEXT_HANDOFF_FRACTION = 0.85;

/**
 * Snapshot of who is working and how much context budget remains.
 * @param {object} opts
 * @param {string} [opts.agentId]
 * @param {object|null} opts.model - ModelRecord-like
 * @param {string} [opts.system]
 * @param {object[]} [opts.messages]
 * @param {string[]} [opts.extraTexts]
 * @param {number} [opts.tokensUsed] - override measured usage
 */
export function buildCapabilitySnapshot({
  agentId = "crew-agent",
  model = null,
  system = "",
  messages = [],
  extraTexts = [],
  tokensUsed = null,
} = {}) {
  const qualityClass = model?.capabilities?.qualityClass || "unknown";
  const contextWindowTokens = Number(model?.capabilities?.contextWindowTokens) || 0;
  const modelId = model?.id || null;
  const measured =
    tokensUsed != null
      ? Number(tokensUsed)
      : estimateMessagesTokens(messages, [system, ...extraTexts]);
  const used = Math.max(0, measured);
  const remaining =
    contextWindowTokens > 0 ? Math.max(0, contextWindowTokens - used) : null;
  const fraction =
    contextWindowTokens > 0 ? used / contextWindowTokens : 0;
  const needsHandoff =
    contextWindowTokens > 0 && fraction >= CONTEXT_HANDOFF_FRACTION;
  const canContinue = !needsHandoff && !!modelId;

  return {
    agentId,
    modelId,
    qualityClass,
    contextWindowTokens,
    tokensUsed: used,
    tokensRemaining: remaining,
    contextFraction: Math.round(fraction * 1000) / 1000,
    canContinue,
    needsHandoff,
    handoffReason: needsHandoff ? "context" : null,
  };
}

/** Estimate tokens for a free-form work blob (goal + notes). */
export function estimateWorkTokens(parts) {
  let t = 0;
  for (const p of parts || []) t += estimateTokens(p || "");
  return t;
}

/**
 * Whether quality class is too weak for required class.
 * @param {string} have - qualityClass of current model
 * @param {string} need - minimum qualityClass for remaining work
 */
export function capabilityInsufficient(have, need) {
  const rank = { tiny: 0, small: 1, medium: 2, large: 3, unknown: -1 };
  return (rank[have] ?? -1) < (rank[need] ?? 0);
}

/**
 * Merge capability shortfall into snapshot (may set needsHandoff).
 */
export function applyCapabilityNeed(snapshot, minQualityClass) {
  if (!snapshot || !minQualityClass) return snapshot;
  if (!capabilityInsufficient(snapshot.qualityClass, minQualityClass)) {
    return { ...snapshot, minQualityClass };
  }
  return {
    ...snapshot,
    minQualityClass,
    needsHandoff: true,
    canContinue: false,
    handoffReason: snapshot.needsHandoff ? snapshot.handoffReason : "capability",
  };
}
