/**
 * Node driver: exercises shipped metrics + synthetic runtimes (same functions as the UI)
 * and writes JSONL + compare extract. Real browser WebGPU path is separate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeEvent,
  createMemoryLog,
  aggregateMetrics,
  formatCompareText,
  eventsToJsonl,
  sampleMemory,
} from "../public/metrics.js";
import { runSyntheticLoad, runSyntheticInfer, MODELS } from "../public/runtimes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function instrumentedRun(log, { runtime, model, cachePhase, prompt }) {
  const runId = `run_${runtime}_${cachePhase}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const t0 = performance.now();
  await log.append(
    makeEvent("run_start", {
      runId,
      runtime,
      model,
      data: { cachePhase, mode: "synthetic", promptLen: prompt.length },
    })
  );
  await log.append(
    makeEvent("memory_sample", {
      runId,
      runtime,
      model,
      data: { ...sampleMemory(), stage: "before_load" },
    })
  );
  await log.append(
    makeEvent("load_start", { runId, runtime, model, data: { cachePhase, mode: "synthetic" } })
  );
  const load = await runSyntheticLoad(cachePhase);
  await log.append(
    makeEvent("load_end", {
      runId,
      runtime,
      model,
      data: {
        durationMs: load.durationMs,
        cacheHit: load.cacheHit,
        cachePhase: load.cachePhase,
        synthetic: true,
      },
    })
  );
  await log.append(
    makeEvent("cache_probe", {
      runId,
      runtime,
      model,
      data: { hit: load.cacheHit, phase: load.cachePhase, synthetic: true },
    })
  );
  await log.append(
    makeEvent("memory_sample", {
      runId,
      runtime,
      model,
      data: { ...load.memory, stage: "after_load" },
    })
  );
  await log.append(makeEvent("infer_start", { runId, runtime, model, data: {} }));
  const infer = await runSyntheticInfer(prompt);
  await log.append(
    makeEvent("infer_end", {
      runId,
      runtime,
      model,
      data: {
        durationMs: infer.durationMs,
        tokensOut: infer.tokensOut,
        synthetic: true,
      },
    })
  );
  await log.append(
    makeEvent("memory_sample", {
      runId,
      runtime,
      model,
      data: { ...infer.memory, stage: "after_infer" },
    })
  );
  await log.append(
    makeEvent("run_end", {
      runId,
      runtime,
      model,
      data: {
        status: "ok",
        totalMs: performance.now() - t0,
        loadMs: load.durationMs,
        inferMs: infer.durationMs,
      },
    })
  );
  return runId;
}

async function main() {
  const outDir = process.argv[2] || path.join(__dirname, "../.out");
  fs.mkdirSync(outDir, { recursive: true });
  const log = createMemoryLog();
  const prompt = "Say hello in one short sentence.";

  for (const runtime of ["webllm", "transformersjs"]) {
    const model = MODELS[runtime][0].id;
    const benchId = `bench_${runtime}_${Date.now()}`;
    await log.append(
      makeEvent("bench_start", {
        runId: benchId,
        runtime,
        model,
        data: { mode: "synthetic", phases: ["uncached", "cached"] },
      })
    );
    await instrumentedRun(log, { runtime, model, cachePhase: "uncached", prompt });
    await instrumentedRun(log, { runtime, model, cachePhase: "cached", prompt });
    await log.append(
      makeEvent("bench_end", { runId: benchId, runtime, model, data: { status: "ok" } })
    );
  }

  // Record honest unavailable example (does not invent timings)
  await log.append(
    makeEvent("run_start", {
      runId: "demo_unavailable",
      runtime: "webllm",
      model: "no-gpu-example",
      data: { note: "example skip shape" },
    })
  );
  await log.append(
    makeEvent("runtime_unavailable", {
      runId: "demo_unavailable",
      runtime: "webllm",
      model: "no-gpu-example",
      data: { reason: "documented example: WebGPU may be missing on some hosts" },
    })
  );
  await log.append(
    makeEvent("run_end", {
      runId: "demo_unavailable",
      runtime: "webllm",
      model: "no-gpu-example",
      data: { status: "unavailable", totalMs: 1 },
    })
  );

  const events = await log.all();
  const agg = aggregateMetrics(events);
  const compare = formatCompareText(agg);
  const jsonlPath = path.join(outDir, "metrics.jsonl");
  const comparePath = path.join(outDir, "compare.txt");
  fs.writeFileSync(jsonlPath, eventsToJsonl(events));
  fs.writeFileSync(comparePath, compare + "\n");
  console.log(compare);
  console.log(`wrote ${jsonlPath} (${events.length} events)`);
  console.log(`wrote ${comparePath}`);

  // Assert objective cached vs uncached difference for both runtimes
  for (const row of agg.cacheCompare) {
    if (row.uncachedCount < 1 || row.cachedCount < 1) {
      throw new Error(`missing cache phases for ${row.runtime}`);
    }
    if (!(row.uncachedAvgMs > row.cachedAvgMs)) {
      throw new Error(
        `expected uncached > cached load for ${row.runtime}: ${row.uncachedAvgMs} vs ${row.cachedAvgMs}`
      );
    }
  }
  console.log("OK cache/memory measurement driver");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
