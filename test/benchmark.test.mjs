/**
 * Benchmark protocol — drives shipped runBenchmarkProtocol + applyBenchmarkMetrics.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runBenchmarkProtocol,
  applyBenchmarkMetrics,
  renderLiveModelsMarkdown,
  computeSmartness,
} from "../public/js/train/benchmark.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";

describe("runBenchmarkProtocol", () => {
  it("produces metrics on mock adapter", async () => {
    const adapter = createMockAdapter({ progressiveDelayMs: 5 });
    const [tiny] = await adapter.discover();
    await adapter.load(tiny.id);
    tiny.status = "ready";
    const metrics = await runBenchmarkProtocol(tiny, adapter, {
      prompt: "Say hello in three words.",
    });
    assert.ok(metrics.tokenRate > 0);
    assert.ok(metrics.tokensGenerated > 0);
    assert.ok(metrics.smartness >= 1 && metrics.smartness <= 100);
    assert.ok(metrics.benchAt);
    assert.equal(typeof metrics.storageBytes, "number");
    const updated = applyBenchmarkMetrics(tiny, metrics);
    assert.equal(updated.status, "ready");
    assert.equal(updated.metrics.smartness, metrics.smartness);
  });

  it("renderLiveModelsMarkdown includes model rows", () => {
    const md = renderLiveModelsMarkdown([
      {
        id: "m1",
        label: "Mock Tiny",
        status: "ready",
        capabilities: { qualityClass: "tiny", contextWindowTokens: 2048 },
        constraints: { approxBytes: 1000, minRamHintMb: 64, offlineReady: true },
        metrics: { smartness: 40, tokenRate: 12.5, storageBytes: 1000 },
      },
    ]);
    assert.match(md, /Live models roster/);
    assert.match(md, /Mock Tiny/);
    assert.match(md, /40/);
  });

  it("computeSmartness scales with quality class", () => {
    const a = computeSmartness({
      qualityClass: "tiny",
      tokensPerSec: 10,
      output: "a b c",
      contextWindowTokens: 2048,
    });
    const b = computeSmartness({
      qualityClass: "large",
      tokensPerSec: 10,
      output: "a b c",
      contextWindowTokens: 2048,
    });
    assert.ok(b > a);
  });
});
