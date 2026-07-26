/**
 * Shared benchmark protocol — pure metrics shape + runner over RuntimeAdapter.
 * Records capabilities, token rate, storage/memory footprint, quality score.
 */

/**
 * @param {object} model - ModelRecord-like
 * @param {object} adapter - RuntimeAdapter with chatStream/complete/load
 * @param {object} [opts]
 * @returns {Promise<object>} metrics applied onto model
 */
export async function runBenchmarkProtocol(model, adapter, opts = {}) {
  const prompt =
    opts.prompt ||
    "Reply with exactly three short sentences about progressive local agents.";
  const modelId = model.id;
  const t0 = performanceNow();

  if (typeof adapter.load === "function" && model.status !== "ready") {
    await adapter.load(modelId);
  }

  const loadMs = performanceNow() - t0;
  let tokens = 0;
  let out = "";
  const gen0 = performanceNow();
  const signal = opts.signal;

  if (typeof adapter.chatStream === "function") {
    for await (const chunk of adapter.chatStream({
      system: "You are a benchmark harness. Follow instructions exactly.",
      messages: [{ role: "user", content: prompt }],
      modelId,
      signal,
    })) {
      out += chunk;
      tokens += estimateTokens(chunk);
    }
  } else if (typeof adapter.complete === "function") {
    out = await adapter.complete({
      system: "You are a benchmark harness. Follow instructions exactly.",
      messages: [{ role: "user", content: prompt }],
      modelId,
      signal,
    });
    tokens = estimateTokens(out);
  } else {
    throw new Error("adapter cannot generate");
  }

  const genMs = Math.max(1, performanceNow() - gen0);
  const tokensPerSec = (tokens / genMs) * 1000;
  const approxBytes = Number(model.constraints?.approxBytes) || 0;
  const qualityClass = model.capabilities?.qualityClass || "tiny";
  const smartness = computeSmartness({
    qualityClass,
    tokensPerSec,
    output: out,
    contextWindowTokens: model.capabilities?.contextWindowTokens || 0,
  });

  return {
    latencyP50Ms: Math.round(genMs / Math.max(1, tokens)),
    failCount: model.metrics?.failCount || 0,
    successCount: (model.metrics?.successCount || 0) + 1,
    // Extended roster metrics (beyond base schema metrics object)
    tokenRate: Number(tokensPerSec.toFixed(2)),
    tokensGenerated: tokens,
    loadMs: Math.round(loadMs),
    generateMs: Math.round(genMs),
    storageBytes: approxBytes,
    memoryHintMb: Number(model.constraints?.minRamHintMb) || 0,
    smartness,
    qualityClass,
    contextWindowTokens: model.capabilities?.contextWindowTokens || 0,
    supportsStreaming: !!model.capabilities?.supportsStreaming,
    offlineReady: !!model.constraints?.offlineReady,
    benchAt: new Date().toISOString(),
    samplePreview: String(out).slice(0, 160),
  };
}

/**
 * Apply benchmark metrics onto a model record (immutable-friendly).
 */
export function applyBenchmarkMetrics(model, metrics) {
  return {
    ...model,
    status: "ready",
    constraints: {
      ...model.constraints,
      offlineReady: true,
    },
    metrics: {
      latencyP50Ms: metrics.latencyP50Ms,
      failCount: metrics.failCount,
      successCount: metrics.successCount,
      tokenRate: metrics.tokenRate,
      tokensGenerated: metrics.tokensGenerated,
      loadMs: metrics.loadMs,
      generateMs: metrics.generateMs,
      storageBytes: metrics.storageBytes,
      memoryHintMb: metrics.memoryHintMb,
      smartness: metrics.smartness,
      qualityClass: metrics.qualityClass,
      contextWindowTokens: metrics.contextWindowTokens,
      supportsStreaming: metrics.supportsStreaming,
      offlineReady: metrics.offlineReady,
      benchAt: metrics.benchAt,
      samplePreview: metrics.samplePreview,
    },
  };
}

export function computeSmartness({
  qualityClass,
  tokensPerSec,
  output,
  contextWindowTokens,
}) {
  const base = { tiny: 25, small: 45, medium: 65, large: 85 }[qualityClass] || 30;
  const speed = Math.min(15, Math.log10(Math.max(1, tokensPerSec) + 1) * 8);
  const len = Math.min(10, String(output || "").split(/\s+/).filter(Boolean).length / 5);
  const ctx = Math.min(10, (contextWindowTokens || 0) / 2048);
  return Math.round(Math.min(100, base + speed + len + ctx));
}

/** Same estimator as core/tokens when available; local fallback for pure tests. */
export function estimateTokens(text) {
  const s = String(text || "");
  if (!s.length) return 0;
  // utf16 code units / 4 — matches README contract used elsewhere
  let units = 0;
  for (let i = 0; i < s.length; i++) units += 1;
  return Math.max(1, Math.ceil(units / 4));
}

function performanceNow() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/**
 * Render live models markdown table for README / export.
 * @param {object[]} models
 */
export function renderLiveModelsMarkdown(models = []) {
  const rows = models
    .slice()
    .sort((a, b) => (b.metrics?.smartness || 0) - (a.metrics?.smartness || 0));
  const lines = [
    "## Live models roster",
    "",
    "_Auto-generated by Progressive Web Agent trainer after approved recruitment. " +
      "Capabilities, token rate, storage, and smartness come from the shared benchmark protocol._",
    "",
    "| Model | Status | Quality | Smartness | Tokens/s | Storage | RAM hint | Context | Offline |",
    "|-------|--------|---------|-----------|----------|---------|----------|---------|---------|",
  ];
  for (const m of rows) {
    const met = m.metrics || {};
    lines.push(
      `| ${esc(m.label || m.id)} | ${esc(m.status)} | ${esc(m.capabilities?.qualityClass || "—")} | ` +
        `${met.smartness ?? "—"} | ${met.tokenRate ?? "—"} | ${fmt(met.storageBytes ?? m.constraints?.approxBytes)} | ` +
        `${met.memoryHintMb ?? m.constraints?.minRamHintMb ?? "—"} MB | ` +
        `${met.contextWindowTokens ?? m.capabilities?.contextWindowTokens ?? "—"} | ` +
        `${met.offlineReady ?? m.constraints?.offlineReady ? "yes" : "no"} |`
    );
  }
  if (!rows.length) {
    lines.push("| _(none)_ | — | — | — | — | — | — | — | — |");
  }
  lines.push("");
  lines.push(`_Updated: ${new Date().toISOString()}_`);
  lines.push("");
  return lines.join("\n");
}

function esc(s) {
  return String(s ?? "—").replace(/\|/g, "\\|");
}

function fmt(n) {
  if (n == null || n === "") return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  return `${(x / (1024 * 1024)).toFixed(1)} MB`;
}
