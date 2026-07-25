/**
 * Unit tests against shipped metrics.js (not re-implementations).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeEvent,
  eventsToJsonl,
  parseJsonl,
  aggregateMetrics,
  buildCompareTable,
  formatCompareText,
  createMemoryLog,
  EVENT_TYPES,
  RUNTIMES,
} from "../public/metrics.js";

describe("makeEvent / schema", () => {
  it("creates required fields for known types", () => {
    const e = makeEvent("run_start", {
      runId: "r1",
      runtime: "webllm",
      model: "m",
      data: { cachePhase: "uncached" },
    });
    assert.equal(e.type, "run_start");
    assert.equal(e.runId, "r1");
    assert.equal(e.runtime, "webllm");
    assert.ok(e.id);
    assert.ok(e.ts);
    assert.equal(e.data.cachePhase, "uncached");
  });

  it("rejects unknown event types", () => {
    assert.throws(() => makeEvent("not_a_real_type"), /unknown event type/);
  });

  it("includes required event type catalog for charts", () => {
    for (const t of [
      "run_start",
      "run_end",
      "load_end",
      "infer_end",
      "cache_probe",
      "memory_sample",
      "runtime_unavailable",
    ]) {
      assert.ok(EVENT_TYPES.includes(t), t);
    }
    assert.deepEqual([...RUNTIMES], ["webllm", "transformersjs"]);
  });
});

describe("JSONL round-trip", () => {
  it("eventsToJsonl + parseJsonl preserves events", () => {
    const events = [
      makeEvent("run_start", { runId: "a", runtime: "webllm", model: "x" }),
      makeEvent("load_end", {
        runId: "a",
        runtime: "webllm",
        model: "x",
        data: { durationMs: 100, cacheHit: false, cachePhase: "uncached" },
      }),
    ];
    const text = eventsToJsonl(events);
    assert.ok(text.endsWith("\n"));
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2);
    const parsed = parseJsonl(text, { strict: true });
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].type, "run_start");
    assert.equal(parsed[1].data.durationMs, 100);
  });
});

describe("aggregateMetrics + compare", () => {
  it("computes side-by-side cache and memory from real event stream", () => {
    const runW1 = "rw1";
    const runW2 = "rw2";
    const runT1 = "rt1";
    const events = [
      makeEvent("run_start", {
        runId: runW1,
        runtime: "webllm",
        model: "Smol",
        data: { cachePhase: "uncached", mode: "real" },
      }),
      makeEvent("load_end", {
        runId: runW1,
        runtime: "webllm",
        model: "Smol",
        data: { durationMs: 200, cacheHit: false, cachePhase: "uncached" },
      }),
      makeEvent("infer_end", {
        runId: runW1,
        runtime: "webllm",
        model: "Smol",
        data: { durationMs: 50, tokensOut: 10 },
      }),
      makeEvent("memory_sample", {
        runId: runW1,
        runtime: "webllm",
        model: "Smol",
        data: { usedJSHeapSize: 40 * 1024 * 1024, peakBytes: 40 * 1024 * 1024 },
      }),
      makeEvent("run_end", {
        runId: runW1,
        runtime: "webllm",
        model: "Smol",
        data: { status: "ok", totalMs: 260 },
      }),
      makeEvent("run_start", {
        runId: runW2,
        runtime: "webllm",
        model: "Smol",
        data: { cachePhase: "cached", mode: "real" },
      }),
      makeEvent("load_end", {
        runId: runW2,
        runtime: "webllm",
        model: "Smol",
        data: { durationMs: 40, cacheHit: true, cachePhase: "cached" },
      }),
      makeEvent("infer_end", {
        runId: runW2,
        runtime: "webllm",
        model: "Smol",
        data: { durationMs: 45, tokensOut: 10 },
      }),
      makeEvent("memory_sample", {
        runId: runW2,
        runtime: "webllm",
        model: "Smol",
        data: { usedJSHeapSize: 42 * 1024 * 1024, peakBytes: 42 * 1024 * 1024 },
      }),
      makeEvent("run_end", {
        runId: runW2,
        runtime: "webllm",
        model: "Smol",
        data: { status: "ok", totalMs: 90 },
      }),
      makeEvent("run_start", {
        runId: runT1,
        runtime: "transformersjs",
        model: "Xenova/distilgpt2",
        data: { cachePhase: "uncached", mode: "real" },
      }),
      makeEvent("load_end", {
        runId: runT1,
        runtime: "transformersjs",
        model: "Xenova/distilgpt2",
        data: { durationMs: 300, cacheHit: false, cachePhase: "uncached" },
      }),
      makeEvent("infer_end", {
        runId: runT1,
        runtime: "transformersjs",
        model: "Xenova/distilgpt2",
        data: { durationMs: 80, tokensOut: 8 },
      }),
      makeEvent("memory_sample", {
        runId: runT1,
        runtime: "transformersjs",
        model: "Xenova/distilgpt2",
        data: { usedJSHeapSize: 55 * 1024 * 1024, peakBytes: 55 * 1024 * 1024 },
      }),
      makeEvent("run_end", {
        runId: runT1,
        runtime: "transformersjs",
        model: "Xenova/distilgpt2",
        data: { status: "ok", totalMs: 400 },
      }),
      // synthetic must NOT pollute framework compare
      makeEvent("run_start", {
        runId: "syn1",
        runtime: "synthetic",
        model: "harness",
        data: { mode: "synthetic", synthetic: true, cachePhase: "uncached" },
      }),
      makeEvent("load_end", {
        runId: "syn1",
        runtime: "synthetic",
        model: "harness",
        data: { durationMs: 9999, cacheHit: false, cachePhase: "uncached", synthetic: true },
      }),
      makeEvent("run_end", {
        runId: "syn1",
        runtime: "synthetic",
        model: "harness",
        data: { status: "ok", totalMs: 9999, synthetic: true },
      }),
    ];

    const agg = aggregateMetrics(events);
    assert.equal(agg.realRuns.length, 3);
    assert.equal(agg.syntheticRunCount, 1);
    assert.equal(agg.byRuntime.webllm.runCount, 2);
    assert.equal(agg.byRuntime.transformersjs.runCount, 1);
    assert.equal(agg.byRuntime.webllm.avgLoadMs, 120);
    // synthetic 9999ms must not appear as webllm/tjs
    assert.notEqual(agg.byRuntime.webllm.avgLoadMs, 9999);
    assert.ok(agg.byRuntime.webllm.avgInferMs > 0);

    const webCache = agg.cacheCompare.find((c) => c.runtime === "webllm");
    assert.equal(webCache.uncachedAvgMs, 200);
    assert.equal(webCache.cachedAvgMs, 40);
    assert.equal(webCache.speedup, 5);

    const table = buildCompareTable(agg);
    const web = table.find((r) => r.runtime === "webllm");
    assert.equal(web.cacheSpeedup, 5);
    assert.equal(web.uncachedAvgLoadMs, 200);
    assert.equal(web.cachedAvgLoadMs, 40);
    assert.ok(web.avgPeakMemoryMb > 0);

    const text = formatCompareText(agg);
    assert.match(text, /webllm/);
    assert.match(text, /transformersjs/);
    assert.match(text, /5x/);
    assert.ok(!text.includes("9999"));
  });

  it("records runtime_unavailable without inventing timings", () => {
    const events = [
      makeEvent("run_start", { runId: "u1", runtime: "webllm", model: "x" }),
      makeEvent("runtime_unavailable", {
        runId: "u1",
        runtime: "webllm",
        model: "x",
        data: { reason: "no WebGPU" },
      }),
      makeEvent("run_end", {
        runId: "u1",
        runtime: "webllm",
        model: "x",
        data: { status: "unavailable", totalMs: 5 },
      }),
    ];
    const agg = aggregateMetrics(events);
    assert.equal(agg.byRuntime.webllm.runCount, 0);
    assert.equal(agg.byRuntime.webllm.unavailableCount, 1);
    assert.equal(agg.runs[0].unavailable, true);
  });
});

describe("createMemoryLog (shipped durable log API)", () => {
  it("append/export/import on real log object", async () => {
    const mem = createMemoryLog();
    const e = makeEvent("cache_probe", {
      runId: "z",
      runtime: "transformersjs",
      data: { hit: true, phase: "cached" },
    });
    await mem.append(e);
    const all = await mem.all();
    assert.equal(all.length, 1);
    const jsonl = await mem.exportJsonl();
    assert.match(jsonl, /cache_probe/);
    await mem.clear();
    assert.equal((await mem.all()).length, 0);
    const n = await mem.importJsonl(jsonl);
    assert.equal(n, 1);
    assert.equal((await mem.all())[0].type, "cache_probe");
  });
});
