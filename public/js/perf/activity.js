/**
 * Derive performance activity samples from registry + run tree (pure).
 */
export function buildActivityFromState({ models = [], runRoots = [], prior = [] } = {}) {
  const activity = [];

  // Model quality → chat-agent / trainer opportunity scores
  const ready = models.filter((m) => m.status === "ready");
  const bestSmart = ready.reduce(
    (m, x) => Math.max(m, Number(x.metrics?.smartness) || 0),
    0
  );
  activity.push({
    id: "opp-chat-agent-smartness",
    agentId: "chat-agent",
    metric: "smartness",
    title: "Improve chat quality via better models",
    score: bestSmart || 10,
    note: `best ready smartness=${bestSmart}`,
  });

  // Error rate from run tree leaves
  const flat = flattenRuns(runRoots);
  const byAgent = new Map();
  for (const r of flat) {
    const a = r.agentId || "unknown";
    if (!byAgent.has(a)) byAgent.set(a, { ok: 0, err: 0 });
    const s = byAgent.get(a);
    if (r.status === "error") s.err += 1;
    else if (r.status === "ok") s.ok += 1;
  }
  for (const [agentId, s] of byAgent) {
    const total = s.ok + s.err;
    if (!total) continue;
    const successRate = Math.round((s.ok / total) * 100);
    activity.push({
      id: `opp-${agentId}-reliability`,
      agentId,
      metric: "reliability",
      title: `Reduce ${agentId} run errors`,
      score: successRate,
      note: `ok=${s.ok} err=${s.err}`,
    });
  }

  // If no tree yet, seed baseline samples so manager still writes section
  if (!activity.length) {
    activity.push({
      id: "opp-chat-agent-bootstrap",
      agentId: "chat-agent",
      metric: "bootstrap",
      title: "Establish stable chat + memory loop",
      score: 20,
      note: "bootstrap sample",
    });
  }

  // Carry forward prior scores slightly so multi-refresh history accumulates in tests via input
  for (const p of prior) {
    if (p && p.id && Number.isFinite(p.score)) {
      // only if not already sampled this run
      if (!activity.find((a) => a.id === p.id)) {
        activity.push({ ...p, note: (p.note || "") + " (carried)" });
      }
    }
  }

  return activity;
}

function flattenRuns(roots, out = []) {
  for (const r of roots || []) {
    out.push(r);
    if (r.children?.length) flattenRuns(r.children, out);
  }
  return out;
}
