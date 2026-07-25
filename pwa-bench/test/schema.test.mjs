/**
 * Structural + source-level gates for the isolated bench.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("isolated bench structure", () => {
  it("default port is not 7420", () => {
    const serve = read("serve.mjs");
    assert.match(serve, /7430/);
    assert.match(serve, /PORT === 7420/);
    assert.ok(!serve.includes("listen(7420"));
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.name, "pwa-llm-bench");
  });

  it("wires WebLLM and Transformers.js as selectable runtimes", () => {
    const html = read("public/index.html");
    assert.match(html, /WebLLM/);
    assert.match(html, /Transformers\.js/);
    assert.match(html, /value="webllm"/);
    assert.match(html, /value="transformersjs"/);
    const rt = read("public/runtimes.js");
    assert.match(rt, /@mlc-ai\/web-llm/);
    assert.match(rt, /@huggingface\/transformers/);
    assert.match(rt, /loadWebllm/);
    assert.match(rt, /loadTransformers/);
    // Default TJS model must have model_quantized.onnx (not bare gpt2)
    assert.match(rt, /Xenova\/distilgpt2/);
    assert.match(rt, /model_file_name:\s*"decoder_model_merged_quantized"/);
    // First transformersjs entry is distilgpt2
    const firstTjs = rt.indexOf("transformersjs:");
    const distil = rt.indexOf("Xenova/distilgpt2", firstTjs);
    const gpt2 = rt.indexOf('id: "Xenova/gpt2"', firstTjs);
    assert.ok(distil > 0 && gpt2 > distil, "distilgpt2 listed before gpt2");
  });

  it("single JSONL metrics path for charts/stats", () => {
    const app = read("public/app.js");
    assert.match(app, /aggregateMetrics/);
    assert.match(app, /openBrowserLog/);
    assert.match(app, /exportJsonl/);
    assert.ok(app.includes('from "./metrics.js"'));
    const metrics = read("public/metrics.js");
    assert.match(metrics, /eventsToJsonl/);
    assert.match(metrics, /indexedDB|createMemoryLog/);
  });

  it("cache and memory measurement hooks on run path", () => {
    const app = read("public/app.js");
    assert.match(app, /cache_probe/);
    assert.match(app, /memory_sample/);
    assert.match(app, /load_end/);
    assert.match(app, /runCacheMemoryBench/);
    assert.match(app, /cachePhase/);
    const rt = read("public/runtimes.js");
    assert.match(rt, /sampleMemory|probeCache/);
    assert.match(rt, /cacheHit|cachePhase/);
  });

  it("index has comparison bench title/heading", () => {
    const html = read("public/index.html");
    assert.match(html, /PWA-LLM Comparison Bench/);
    assert.match(html, /id="stats-panel"/);
    assert.match(html, /id="compare-table"/);
    assert.match(html, /chart-load/);
  });
});
