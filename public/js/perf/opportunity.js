/**
 * Pure performance-manager logic: opportunity upsert, progress, promotion readiness.
 * No DOM / network.
 */
import {
  SECTION_OPP,
  SECTION_INSTR,
  extractSection,
  upsertSection,
  renderOpportunitySection,
  renderInstructionsSection,
  parseOpportunityBlocks,
  parseInstructionMap,
} from "./opportunity-md.js";

export { SECTION_OPP, SECTION_INSTR, extractSection, upsertSection };

/** Testable thresholds (not LLM vibes). */
export const THRESHOLDS = {
  minSamplesForProgress: 3,
  minSamplesForPromote: 4,
  improveRatio: 0.1,
  improveAbs: 2,
  maxOpenOpportunities: 8,
};

export function parseOpportunities(content) {
  return parseOpportunityBlocks(extractSection(content, SECTION_OPP));
}

export function mergeOpportunitySection(content, opportunities) {
  return upsertSection(content || "", SECTION_OPP, renderOpportunitySection(opportunities));
}

export function parseInstructions(content) {
  return parseInstructionMap(extractSection(content, SECTION_INSTR));
}

export function promoteToInstructions(content, { agentId, instruction }) {
  const map = parseInstructions(content);
  const list = map[agentId] || [];
  if (!list.includes(instruction)) list.push(instruction);
  map[agentId] = list;
  return upsertSection(content || "", SECTION_INSTR, renderInstructionsSection(map));
}

export function upsertFromActivity({ existing = [], activity = [], now } = {}) {
  const ts = now || new Date().toISOString();
  const byId = new Map(existing.map((o) => [o.id, { ...o, scores: [...(o.scores || [])] }]));

  for (const a of activity) {
    if (!a?.agentId || !Number.isFinite(a.score)) continue;
    const id = a.id || `opp-${a.agentId}-${slug(a.metric || "metric")}`;
    let o = byId.get(id);
    if (!o) {
      if (byId.size >= THRESHOLDS.maxOpenOpportunities) continue;
      o = {
        id,
        agentId: a.agentId,
        title: a.title || `Improve ${a.metric || "performance"} for ${a.agentId}`,
        status: "open",
        attempts: 0,
        baseline: a.score,
        lastScore: a.score,
        scores: [],
        evidence: a.note || "",
        createdAt: ts,
        updatedAt: ts,
      };
      byId.set(id, o);
    }
    if (o.status === "promoted") continue;
    o.scores.push(a.score);
    o.attempts = o.scores.length;
    o.lastScore = a.score;
    o.updatedAt = ts;
    if (!o.baseline && o.scores.length) o.baseline = o.scores[0];
    if (a.note) o.evidence = a.note;
    o.status = computeStatus(o);
  }

  for (const o of byId.values()) {
    if (o.status !== "promoted") o.status = computeStatus(o);
  }

  const opportunities = [...byId.values()];
  const changed =
    opportunities.length !== existing.length ||
    opportunities.some((o) => {
      const e = existing.find((x) => x.id === o.id);
      return !e || e.lastScore !== o.lastScore || e.status !== o.status || e.attempts !== o.attempts;
    });

  return { opportunities, changed };
}

export function decidePromotion({ opportunities = [] } = {}) {
  const ready = opportunities
    .filter((o) => o.status === "ready_to_promote")
    .sort((a, b) => b.lastScore - a.lastScore || b.attempts - a.attempts);

  if (!ready.length) {
    return { promote: null, reason: "no opportunity ready to promote" };
  }

  const o = ready[0];
  const instruction =
    o.title.startsWith("Improve") || o.title.startsWith("Reduce")
      ? o.title
      : `Focus: ${o.title}`;

  return {
    promote: { opportunity: o, instruction },
    reason: `Promote “${o.title}” for ${o.agentId} after ${o.attempts} samples (baseline ${o.baseline} → ${o.lastScore})`,
  };
}

export function runPerformanceManagerLogic({
  memoryContent = "",
  activity = [],
  now,
} = {}) {
  const existing = parseOpportunities(memoryContent);
  const { opportunities, changed } = upsertFromActivity({
    existing,
    activity,
    now,
  });
  const nextContent = changed
    ? mergeOpportunitySection(memoryContent, opportunities)
    : memoryContent;
  const promotion = decidePromotion({ opportunities });
  return {
    opportunities,
    memoryContent: nextContent,
    memoryChanged: changed || nextContent !== memoryContent,
    promotion,
    shouldNotify: !!promotion.promote,
  };
}

export function computeStatus(o) {
  const scores = o.scores || [];
  if (o.status === "promoted") return "promoted";
  if (scores.length < THRESHOLDS.minSamplesForProgress) return "open";
  const baseline = o.baseline ?? scores[0];
  const last = scores[scores.length - 1];
  const improved =
    last >= baseline + THRESHOLDS.improveAbs ||
    last >= baseline * (1 + THRESHOLDS.improveRatio);
  if (scores.length >= THRESHOLDS.minSamplesForPromote && improved) {
    const half = scores.slice(Math.floor(scores.length / 2));
    const avg = half.reduce((s, x) => s + x, 0) / half.length;
    if (avg > baseline) return "ready_to_promote";
  }
  if (improved) return "improving";
  return "open";
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
