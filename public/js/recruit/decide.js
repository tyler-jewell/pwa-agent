/**
 * Pure recruiter decision — no DOM/network.
 * At most one recommendation: add | replace | none.
 */

const QUALITY_RANK = { tiny: 1, small: 2, medium: 3, large: 4 };

/**
 * @param {object} opts
 * @param {object[]} opts.installed - models already known (any status)
 * @param {object[]} opts.candidates - models we could acquire (not ready)
 * @param {{ usage: number, quota: number }} opts.storage - bytes; quota 0 = unknown
 * @param {number} opts.aggression - 1..5 (user lever)
 * @returns {{ action: 'none'|'add'|'replace', candidate: object|null, replaceId: string|null, reason: string, score: number }}
 */
export function decideRecruitment({
  installed = [],
  candidates = [],
  storage = { usage: 0, quota: 0 },
  aggression = 3,
} = {}) {
  const agg = clampAggression(aggression);
  const ready = installed.filter((m) => m.status === "ready");
  const installedIds = new Set(installed.map((m) => m.id));

  const pool = candidates
    .filter((c) => {
      if (!c || !c.id) return false;
      const inst = installed.find((i) => i.id === c.id);
      // Not installed yet, or known but not ready (announced/failed/downloading)
      return !inst || inst.status !== "ready";
    })
    .map((c) => normalizeCandidate(c));

  // Dedupe by id, keep highest qualityClass
  const byId = new Map();
  for (const c of pool) {
    const prev = byId.get(c.id);
    if (!prev || qualityOf(c) > qualityOf(prev)) byId.set(c.id, c);
  }
  const uniq = [...byId.values()];

  if (!uniq.length) {
    return none("no candidates");
  }

  const free = freeBytes(storage);
  const scored = uniq
    .map((c) => ({
      c,
      score: scoreCandidate(c, ready, agg),
      need: Number(c.constraints?.approxBytes) || 0,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return none("no value-add under current aggression");
  }

  const top = scored[0];
  const need = top.need;
  const spaceOk = free === Infinity || free >= need * headroomFactor(agg);

  if (spaceOk) {
    // Low aggression: only add if clearly free and not huge jump
    if (agg <= 2 && need > free * 0.5 && free !== Infinity) {
      // still allow if free enough with headroom
      if (free < need * 1.5) {
        return none("aggression low: not enough free headroom to add");
      }
    }
    return {
      action: "add",
      candidate: top.c,
      replaceId: null,
      reason: `Add ${top.c.label || top.c.id} (score ${top.score.toFixed(2)}, need ${fmtBytes(need)}, free ${fmtBytes(free)})`,
      score: top.score,
    };
  }

  // Not enough space — consider replace if aggression allows
  if (agg < 2) {
    return none("insufficient space and aggression too low to replace");
  }

  const replaceTarget = pickReplaceVictim(ready, top.c, agg);
  if (!replaceTarget) {
    return none("insufficient space and no replace victim");
  }

  const freed = Number(replaceTarget.constraints?.approxBytes) || 0;
  if (free !== Infinity && free + freed < need) {
    return none("replace would still not free enough space");
  }

  // Aggression 2 only replace if quality jump is large
  if (agg === 2 && qualityOf(top.c) - qualityOf(replaceTarget) < 2) {
    return none("aggression modest: quality jump too small to replace");
  }

  return {
    action: "replace",
    candidate: top.c,
    replaceId: replaceTarget.id,
    reason: `Replace ${replaceTarget.label || replaceTarget.id} with ${top.c.label || top.c.id} (score ${top.score.toFixed(2)})`,
    score: top.score,
  };
}

export function clampAggression(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 3;
  return Math.min(5, Math.max(1, Math.round(x)));
}

function none(reason) {
  return {
    action: "none",
    candidate: null,
    replaceId: null,
    reason,
    score: 0,
  };
}

function freeBytes({ usage = 0, quota = 0 } = {}) {
  if (!quota || quota <= 0) return Infinity; // unknown → assume add ok (best-effort)
  return Math.max(0, quota - usage);
}

function headroomFactor(agg) {
  // Higher aggression accepts tighter free space
  return { 1: 2.5, 2: 2, 3: 1.5, 4: 1.2, 5: 1.05 }[agg] || 1.5;
}

function qualityOf(m) {
  return QUALITY_RANK[m?.capabilities?.qualityClass] || 0;
}

function normalizeCandidate(c) {
  return {
    ...c,
    capabilities: { ...(c.capabilities || {}) },
    constraints: { ...(c.constraints || {}) },
    metrics: { ...(c.metrics || {}) },
  };
}

function scoreCandidate(c, ready, agg) {
  const q = qualityOf(c);
  const maxReady = ready.reduce((m, r) => Math.max(m, qualityOf(r)), 0);
  let score = q * 10;

  // Value-add: prefer better than best ready
  if (q > maxReady) score += (q - maxReady) * 15;
  else if (q === maxReady) score += 2; // peer redundancy low value
  else score -= (maxReady - q) * 8; // worse than installed → rarely

  // Prefer streaming + larger context slightly
  if (c.capabilities?.supportsStreaming) score += 1;
  score += Math.min(5, (c.capabilities?.contextWindowTokens || 0) / 4096);

  // Aggression amplifies quality-seeking
  score *= 0.6 + agg * 0.15;

  // Tiny always has baseline if nothing ready
  if (!ready.length && q >= 1) score += 20;

  return score;
}

function pickReplaceVictim(ready, candidate, agg) {
  if (!ready.length) return null;
  // Prefer lowest quality, then largest bytes (free more space)
  const sorted = [...ready].sort((a, b) => {
    const qd = qualityOf(a) - qualityOf(b);
    if (qd !== 0) return qd;
    return (Number(b.constraints?.approxBytes) || 0) - (Number(a.constraints?.approxBytes) || 0);
  });
  const victim = sorted[0];
  // Never replace if victim is better quality than candidate
  if (qualityOf(victim) >= qualityOf(candidate) && agg < 5) return null;
  // Keep at least one model: if only one ready, aggression 5 may still replace
  if (ready.length === 1 && agg < 4) return null;
  return victim;
}

function fmtBytes(n) {
  if (n === Infinity) return "unknown";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
