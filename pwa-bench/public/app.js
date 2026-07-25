/**
 * PWA-LLM comparison bench UI — all metrics read from shared JSONL log only.
 */
import {
  makeEvent,
  openBrowserLog,
  aggregateMetrics,
  buildCompareTable,
  formatCompareText,
  sampleMemory,
  eventsToJsonl,
} from "./metrics.js";
import {
  MODELS,
  loadModel,
  runTurn,
  unloadModel,
  unloadAll,
  probeCache,
  isUnavailableError,
  runSyntheticLoad,
  runSyntheticInfer,
} from "./runtimes.js";

const $ = (id) => document.getElementById(id);

let log;
let busy = false;

async function init() {
  log = await openBrowserLog();
  $("runtime").addEventListener("change", fillModels);
  fillModels();
  $("btn-run").addEventListener("click", () => runOnce({ cachePhase: null }));
  $("btn-bench").addEventListener("click", runCacheMemoryBench);
  $("btn-refresh").addEventListener("click", refreshUi);
  $("btn-export").addEventListener("click", exportJsonl);
  $("btn-clear").addEventListener("click", clearLog);
  $("btn-unload").addEventListener("click", () => {
    unloadAll();
    setStatus("All in-process engines unloaded (disk/Cache API may retain model assets).");
  });
  await refreshUi();
  setStatus("Ready. Port 7430 bench — select runtime + model, then Run turn or Cache/memory bench.");
}

function fillModels() {
  const rt = $("runtime").value;
  const sel = $("model");
  sel.innerHTML = "";
  for (const m of MODELS[rt] || []) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${m.label} (${m.sizeHint})`;
    sel.appendChild(o);
  }
}

function setBusy(v) {
  busy = v;
  for (const id of ["btn-run", "btn-bench", "btn-clear", "btn-export", "btn-unload"]) {
    $(id).disabled = v;
  }
}

function setStatus(msg) {
  $("status").textContent = msg;
}

function newRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function emit(type, fields) {
  const ev = makeEvent(type, fields);
  await log.append(ev);
  return ev;
}

/**
 * Full instrumented path: load → infer → memory samples → JSONL.
 * mode: "real" | "synthetic"
 */
async function runOnce({ cachePhase = null, mode = null, skipBusyGuard = false } = {}) {
  if (busy && !skipBusyGuard) return;
  if (!skipBusyGuard) setBusy(true);
  const selectedRuntime = $("runtime").value;
  const model = $("model").value;
  const prompt = $("prompt").value || "Say hello in one short sentence.";
  const useSynthetic = mode === "synthetic" || $("use-synthetic").checked;
  // Synthetic harness is NOT tagged as webllm/transformersjs (excluded from compare).
  const runtime = useSynthetic ? "synthetic" : selectedRuntime;
  const phase =
    cachePhase ||
    ($("force-uncached").checked ? "uncached" : null) ||
    "auto";
  const runId = newRunId();
  const tRun0 = performance.now();

  try {
    await emit("run_start", {
      runId,
      runtime,
      model,
      data: {
        promptLen: prompt.length,
        cachePhase: phase,
        mode: useSynthetic ? "synthetic" : "real",
        selectedRuntime,
        synthetic: useSynthetic,
      },
    });
    await emit("memory_sample", {
      runId,
      runtime,
      model,
      data: { ...sampleMemory(), stage: "before_load", synthetic: useSynthetic },
    });

    let loadResult;
    let handle = null;

    if (useSynthetic) {
      const p = phase === "cached" ? "cached" : "uncached";
      await emit("load_start", {
        runId,
        runtime: "synthetic",
        model,
        data: { mode: "synthetic", cachePhase: p, synthetic: true, selectedRuntime },
      });
      loadResult = await runSyntheticLoad(p);
      await emit("load_end", {
        runId,
        runtime: "synthetic",
        model,
        data: {
          durationMs: loadResult.durationMs,
          cacheHit: loadResult.cacheHit,
          cachePhase: loadResult.cachePhase,
          synthetic: true,
          selectedRuntime,
        },
      });
      await emit("cache_probe", {
        runId,
        runtime: "synthetic",
        model,
        data: {
          hit: loadResult.cacheHit,
          phase: loadResult.cachePhase,
          synthetic: true,
          selectedRuntime,
        },
      });
    } else {
      if ($("force-uncached").checked) {
        unloadModel(runtime, model);
      }
      const probe = await probeCache(runtime, model);
      const resolvedPhase =
        phase === "auto" ? (probe.processWarm ? "cached" : "uncached") : phase;
      await emit("cache_probe", {
        runId,
        runtime,
        model,
        data: { ...probe, phase: resolvedPhase },
      });
      await emit("load_start", {
        runId,
        runtime,
        model,
        data: { cachePhase: resolvedPhase },
      });
      try {
        loadResult = await loadModel(runtime, model, {
          cachePhase: resolvedPhase,
          forceReload: resolvedPhase === "uncached" && $("force-uncached").checked,
          onProgress: (p) => {
            const text =
              typeof p === "object"
                ? p.text || p.status || JSON.stringify(p).slice(0, 80)
                : String(p);
            setStatus(`Loading ${runtime}/${model}: ${text}`);
          },
        });
        handle = loadResult.engine;
        await emit("load_end", {
          runId,
          runtime,
          model,
          data: {
            durationMs: loadResult.durationMs,
            cacheHit: loadResult.cacheHit,
            cachePhase: loadResult.cachePhase,
          },
        });
      } catch (err) {
        if (isUnavailableError(err)) {
          await emit("runtime_unavailable", {
            runId,
            runtime,
            model,
            data: { reason: err.reason || err.message },
          });
          await emit("run_end", {
            runId,
            runtime,
            model,
            data: {
              status: "unavailable",
              totalMs: performance.now() - tRun0,
            },
          });
          $("reply").textContent = `Runtime unavailable: ${err.reason || err.message}`;
          setStatus(`Unavailable (${runtime}): ${err.reason || err.message}`);
          await refreshUi();
          return;
        }
        throw err;
      }
    }

    await emit("memory_sample", {
      runId,
      runtime,
      model,
      data: {
        ...(loadResult.memory || sampleMemory()),
        stage: "after_load",
        synthetic: useSynthetic,
      },
    });

    await emit("infer_start", {
      runId,
      runtime,
      model,
      data: { promptLen: prompt.length, synthetic: useSynthetic },
    });
    setStatus(`Inferring (${useSynthetic ? "synthetic-harness" : runtime})…`);
    let inferResult;
    if (useSynthetic) {
      inferResult = await runSyntheticInfer(prompt);
    } else {
      inferResult = await runTurn(handle, prompt, { maxTokens: 24 });
    }
    await emit("infer_end", {
      runId,
      runtime,
      model,
      data: {
        durationMs: inferResult.durationMs,
        tokensOut: inferResult.tokensOut,
        synthetic: !!inferResult.synthetic || useSynthetic,
      },
    });
    await emit("memory_sample", {
      runId,
      runtime,
      model,
      data: {
        ...(inferResult.memory || sampleMemory()),
        stage: "after_infer",
        synthetic: useSynthetic,
      },
    });

    const totalMs = performance.now() - tRun0;
    await emit("run_end", {
      runId,
      runtime,
      model,
      data: {
        status: "ok",
        totalMs,
        loadMs: loadResult.durationMs,
        inferMs: inferResult.durationMs,
        synthetic: useSynthetic,
      },
    });

    $("reply").textContent = inferResult.text || "(empty)";
    setStatus(
      `OK ${runtime} load=${loadResult.durationMs.toFixed(1)}ms infer=${inferResult.durationMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms cache=${loadResult.cachePhase}`
    );
    await refreshUi();
  } catch (err) {
    await emit("error", {
      runId,
      runtime,
      model,
      data: { message: err.message || String(err) },
    });
    await emit("run_end", {
      runId,
      runtime,
      model,
      data: { status: "error", totalMs: performance.now() - tRun0 },
    });
    $("reply").textContent = `Error: ${err.message || err}`;
    setStatus(`Error: ${err.message || err}`);
    await refreshUi();
  } finally {
    if (!skipBusyGuard) setBusy(false);
  }
}

/**
 * Objective cache + memory bench: uncached then cached load/infer for current runtime,
 * writing all events into the shared JSONL stream.
 */
async function runCacheMemoryBench() {
  if (busy) return;
  setBusy(true);
  const selectedRuntime = $("runtime").value;
  const model = $("model").value;
  const useSynthetic = $("use-synthetic").checked;
  const runtime = useSynthetic ? "synthetic" : selectedRuntime;
  const benchId = newRunId();
  setStatus(
    `Cache/memory bench starting for ${runtime}${useSynthetic ? " (harness only)" : " (REAL framework)"}…`
  );

  try {
    await emit("bench_start", {
      runId: benchId,
      runtime,
      model,
      data: {
        mode: useSynthetic ? "synthetic" : "real",
        phases: ["uncached", "cached"],
        selectedRuntime,
        synthetic: useSynthetic,
      },
    });

    // Phase 1: cold / uncached — force process unload so load is not engine-warm hit
    $("force-uncached").checked = true;
    if (!useSynthetic) unloadModel(selectedRuntime, model);
    await runOnce({
      cachePhase: "uncached",
      mode: useSynthetic ? "synthetic" : "real",
      skipBusyGuard: true,
    });

    // Drop process cache so second load exercises disk/Cache API reuse
    if (!useSynthetic) unloadModel(selectedRuntime, model);

    // Phase 2: cached (browser Cache / HTTP cache after unload)
    $("force-uncached").checked = false;
    await runOnce({
      cachePhase: "cached",
      mode: useSynthetic ? "synthetic" : "real",
      skipBusyGuard: true,
    });

    await emit("bench_end", {
      runId: benchId,
      runtime,
      model,
      data: { status: "ok", synthetic: useSynthetic },
    });
    setStatus(`Bench complete for ${runtime}. Compare table uses REAL runs only.`);
    await refreshUi();
  } catch (err) {
    await emit("error", {
      runId: benchId,
      runtime,
      model,
      data: { message: err.message || String(err) },
    });
    setStatus(`Bench error: ${err.message || err}`);
  } finally {
    setBusy(false);
  }
}

async function refreshUi() {
  const events = await log.all();
  const agg = aggregateMetrics(events);
  const rows = buildCompareTable(agg);

  $("stat-events").textContent = String(events.length);
  $("stat-runs").textContent = String(agg.realRuns?.length ?? 0);
  const ok = (agg.realRuns || []).filter((r) => r.status === "ok").length;
  $("stat-ok").textContent = String(ok);
  if ($("stat-synth")) {
    $("stat-synth").textContent = String(agg.syntheticRunCount || 0);
  }
  const mem = sampleMemory();
  $("stat-heap").textContent =
    mem.usedJSHeapSize != null
      ? `${(mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)} MB`
      : "n/a";

  const tbody = $("compare-body");
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="rt-${r.runtime}">${r.runtime}</td>
      <td class="num">${r.runs}</td>
      <td class="num">${fmt(r.avgLoadMs)}</td>
      <td class="num">${fmt(r.avgInferMs)}</td>
      <td class="num">${fmt(r.avgPeakMemoryMb)}</td>
      <td class="num">${fmt(r.uncachedAvgLoadMs)}</td>
      <td class="num">${fmt(r.cachedAvgLoadMs)}</td>
      <td class="num">${r.cacheSpeedup != null ? r.cacheSpeedup + "×" : "—"}</td>
      <td class="num">${r.unavailable || 0}</td>`;
    tbody.appendChild(tr);
  }

  $("compare-text").textContent = formatCompareText(agg);
  $("log-preview").textContent = eventsToJsonl(events.slice(-40));

  drawLoadChart(agg);
  drawMemoryChart(agg);
  drawHistoryChart(agg);
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return typeof n === "number" ? n.toFixed(1) : String(n);
}

function drawLoadChart(agg) {
  const canvas = $("chart-load");
  const ctx = canvas.getContext("2d");
  const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const h = (canvas.height = 150 * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const cw = canvas.clientWidth;
  const ch = 150;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#1a222e";
  ctx.fillRect(0, 0, cw, ch);

  const series = [];
  // Charts: real framework loads only
  for (const r of agg.realRuns || []) {
    if (typeof r.loadMs === "number" && r.runtime && !r.synthetic) {
      series.push({
        runtime: r.runtime,
        v: r.loadMs,
        cached: r.cacheHit === true || r.cachePhase === "cached",
      });
    }
  }
  if (!series.length) {
    ctx.fillStyle = "#8b9bb0";
    ctx.font = "12px sans-serif";
    ctx.fillText("No load timings yet", 12, 28);
    return;
  }
  const maxV = Math.max(...series.map((s) => s.v), 1);
  const barW = Math.max(4, (cw - 24) / series.length - 2);
  series.forEach((s, i) => {
    const bh = (s.v / maxV) * (ch - 36);
    const x = 12 + i * (barW + 2);
    const y = ch - 20 - bh;
    ctx.fillStyle = s.runtime === "webllm" ? "#7aa2f7" : "#c3e88d";
    if (s.cached) ctx.globalAlpha = 0.55;
    ctx.fillRect(x, y, barW, bh);
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = "#8b9bb0";
  ctx.font = "11px sans-serif";
  ctx.fillText("Load ms (dim=cached) blue=webllm green=tjs", 12, 14);
}

function drawMemoryChart(agg) {
  const canvas = $("chart-mem");
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = 150 * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const cw = canvas.clientWidth;
  const ch = 150;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#1a222e";
  ctx.fillRect(0, 0, cw, ch);

  const pts = agg.memoryPeaks;
  if (!pts.length) {
    ctx.fillStyle = "#8b9bb0";
    ctx.font = "12px sans-serif";
    ctx.fillText("No memory samples (Chrome exposes performance.memory)", 12, 28);
    return;
  }
  const maxV = Math.max(...pts.map((p) => p.peakMemoryBytes), 1);
  ctx.strokeStyle = "#5ee4a8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = 12 + (i / Math.max(pts.length - 1, 1)) * (cw - 24);
    const y = ch - 20 - (p.peakMemoryBytes / maxV) * (ch - 40);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "#8b9bb0";
  ctx.font = "11px sans-serif";
  ctx.fillText("Peak JS heap (bytes) over runs", 12, 14);
}

function drawHistoryChart(agg) {
  const canvas = $("chart-hist");
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = 150 * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const cw = canvas.clientWidth;
  const ch = 150;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#1a222e";
  ctx.fillRect(0, 0, cw, ch);

  const ok = (agg.realRuns || []).filter(
    (r) => typeof r.totalMs === "number" || typeof r.inferMs === "number"
  );
  if (!ok.length) {
    ctx.fillStyle = "#8b9bb0";
    ctx.font = "12px sans-serif";
    ctx.fillText("No historical REAL run totals yet", 12, 28);
    return;
  }
  const vals = ok.map((r) => r.totalMs ?? r.inferMs ?? 0);
  const maxV = Math.max(...vals, 1);
  ctx.strokeStyle = "#3d9cf0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  vals.forEach((v, i) => {
    const x = 12 + (i / Math.max(vals.length - 1, 1)) * (cw - 24);
    const y = ch - 20 - (v / maxV) * (ch - 40);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // points colored by runtime
  ok.forEach((r, i) => {
    const v = r.totalMs ?? r.inferMs ?? 0;
    const x = 12 + (i / Math.max(ok.length - 1, 1)) * (cw - 24);
    const y = ch - 20 - (v / maxV) * (ch - 40);
    ctx.fillStyle = r.runtime === "webllm" ? "#7aa2f7" : "#c3e88d";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#8b9bb0";
  ctx.font = "11px sans-serif";
  ctx.fillText("Historical total/infer ms", 12, 14);
}

async function exportJsonl() {
  const text = await log.exportJsonl();
  const blob = new Blob([text], { type: "application/x-ndjson" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pwa-bench-metrics-${Date.now()}.jsonl`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`Exported ${text.split("\n").filter(Boolean).length} events as JSONL.`);
}

async function clearLog() {
  if (!confirm("Clear all metrics events from IndexedDB?")) return;
  await log.clear();
  await refreshUi();
  setStatus("Log cleared.");
}

// Expose for Playwright / automated probes
window.__pwaBench = {
  refreshUi,
  runOnce,
  runCacheMemoryBench,
  getLog: async () => (log ? log.all() : []),
  exportJsonlText: async () => (log ? log.exportJsonl() : ""),
  aggregate: async () => aggregateMetrics(await log.all()),
  clear: async () => {
    await log.clear();
    await refreshUi();
  },
};

init().catch((err) => {
  console.error(err);
  setStatus(`Init failed: ${err.message || err}`);
});
