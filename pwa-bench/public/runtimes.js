/**
 * Runtime adapters: WebLLM and Transformers.js behind one interface.
 * loadModel / runTurn / unload / probeCache — same metrics shape for both.
 */

import { sampleMemory } from "./metrics.js";

/**
 * Selectable models. Transformers entries carry loadOpts so we request ONNX
 * files that actually exist on HF (gpt2 has no model_quantized.onnx).
 */
export const MODELS = {
  webllm: [
    {
      id: "SmolLM2-135M-Instruct-q0f16-MLC",
      label: "SmolLM2-135M (WebLLM)",
      sizeHint: "~135M",
    },
    {
      id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
      label: "TinyLlama-1.1B q4 (WebLLM)",
      sizeHint: "~1.1B q4",
    },
  ],
  transformersjs: [
    {
      id: "Xenova/distilgpt2",
      label: "DistilGPT-2 (Transformers.js WASM)",
      sizeHint: "~82M",
      // distilgpt2 ships onnx/model_quantized.onnx
      loadOpts: { dtype: "q8" },
    },
    {
      id: "Xenova/gpt2",
      label: "GPT-2 decoder quantized (Transformers.js)",
      sizeHint: "~124M",
      // gpt2 has decoder_* only — not model_quantized.onnx
      loadOpts: {
        dtype: "q8",
        model_file_name: "decoder_model_merged_quantized",
      },
    },
    {
      id: "Xenova/LaMini-Flan-T5-77M",
      label: "LaMini-Flan-T5-77M (text2text)",
      sizeHint: "~77M",
      task: "text2text-generation",
      loadOpts: { dtype: "q8" },
    },
  ],
};

function modelMeta(runtime, modelId) {
  return (MODELS[runtime] || []).find((m) => m.id === modelId) || { id: modelId };
}

/** @type {Map<string, any>} */
const engines = new Map();

/** In-process buffer used only by synthetic harness (not a framework). */
let synthColdBuf = null;

/**
 * @param {"webllm"|"transformersjs"} runtime
 * @param {string} model
 * @param {{ onProgress?: (p: object) => void, forceReload?: boolean, cachePhase?: string }} opts
 */
export async function loadModel(runtime, model, opts = {}) {
  const key = `${runtime}::${model}`;
  const t0 = performance.now();
  if (!opts.forceReload && engines.has(key)) {
    return {
      engine: engines.get(key),
      durationMs: performance.now() - t0,
      cacheHit: true,
      cachePhase: opts.cachePhase || "cached",
      memory: sampleMemory(),
      synthetic: false,
    };
  }
  if (runtime === "webllm") {
    return loadWebllm(key, model, opts, t0);
  }
  if (runtime === "transformersjs") {
    return loadTransformers(key, model, opts, t0);
  }
  throw unavailable(runtime, "unknown runtime id");
}

const WEBLLM_CDNS = [
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm",
  "https://esm.sh/@mlc-ai/web-llm@0.2.79/lib?bundle",
  "https://unpkg.com/@mlc-ai/web-llm@0.2.79/lib/index.js",
];

async function loadWebllm(key, model, opts, t0) {
  let CreateMLCEngine;
  let lastErr = null;
  for (const url of WEBLLM_CDNS) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      CreateMLCEngine = mod.CreateMLCEngine || mod.default?.CreateMLCEngine;
      if (typeof CreateMLCEngine === "function") break;
      lastErr = new Error(`CreateMLCEngine missing from ${url}`);
      CreateMLCEngine = null;
    } catch (err) {
      lastErr = err;
      CreateMLCEngine = null;
    }
  }
  if (typeof CreateMLCEngine !== "function") {
    throw unavailable(
      "webllm",
      `module import failed: ${lastErr?.message || "no CreateMLCEngine"}`
    );
  }
  try {
    const engine = await CreateMLCEngine(model, {
      initProgressCallback: (p) => opts.onProgress?.(p),
    });
    engines.set(key, { kind: "webllm", engine, model });
    const phase = opts.cachePhase || "uncached";
    return {
      engine: engines.get(key),
      durationMs: performance.now() - t0,
      cacheHit: phase === "cached",
      cachePhase: phase,
      memory: sampleMemory(),
      synthetic: false,
    };
  } catch (err) {
    throw unavailable("webllm", err.message || String(err));
  }
}

const TJS_CDNS = [
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0/+esm",
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0",
  "https://esm.sh/@huggingface/transformers@3.4.0",
];

async function importTransformers() {
  let lastErr = null;
  for (const url of TJS_CDNS) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod.pipeline) {
        if (mod.env) {
          mod.env.allowLocalModels = false;
          mod.env.useBrowserCache = true;
        }
        return mod;
      }
      lastErr = new Error(`pipeline missing from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw unavailable("transformersjs", `module import failed: ${lastErr?.message || lastErr}`);
}

async function loadTransformers(key, model, opts, t0) {
  const mod = await importTransformers();
  const meta = modelMeta("transformersjs", model);
  const task = meta.task || "text-generation";
  const loadOpts = {
    progress_callback: (p) => opts.onProgress?.(p),
    ...(meta.loadOpts || { dtype: "q8" }),
  };
  try {
    const pipe = await mod.pipeline(task, model, loadOpts);
    engines.set(key, {
      kind: "transformersjs",
      engine: pipe,
      model,
      task,
    });
    const phase = opts.cachePhase || "uncached";
    return {
      engine: engines.get(key),
      durationMs: performance.now() - t0,
      cacheHit: phase === "cached",
      cachePhase: phase,
      memory: sampleMemory(),
      synthetic: false,
    };
  } catch (err) {
    throw unavailable("transformersjs", err.message || String(err));
  }
}

/**
 * @param {{ kind: string, engine: any, model: string, task?: string }} handle
 * @param {string} prompt
 * @param {{ maxTokens?: number }} opts
 */
export async function runTurn(handle, prompt, opts = {}) {
  const maxTokens = opts.maxTokens ?? 24;
  const t0 = performance.now();
  if (handle.kind === "webllm") {
    const reply = await handle.engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    });
    const text = reply.choices?.[0]?.message?.content ?? "";
    const tokensOut = reply.usage?.completion_tokens ?? estimateTokens(text);
    return {
      text,
      durationMs: performance.now() - t0,
      tokensOut,
      memory: sampleMemory(),
      synthetic: false,
    };
  }
  if (handle.kind === "transformersjs") {
    const genOpts = {
      max_new_tokens: maxTokens,
      temperature: 0.7,
      return_full_text: false,
      do_sample: false,
    };
    const out = await handle.engine(prompt, genOpts);
    let text;
    if (Array.isArray(out)) {
      text = out[0]?.generated_text ?? out[0]?.translation_text ?? String(out[0] ?? "");
    } else {
      text = String(out?.generated_text ?? out?.translation_text ?? out ?? "");
    }
    return {
      text,
      durationMs: performance.now() - t0,
      tokensOut: estimateTokens(text),
      memory: sampleMemory(),
      synthetic: false,
    };
  }
  throw new Error("unknown engine kind");
}

export function unloadModel(runtime, model) {
  const key = `${runtime}::${model}`;
  engines.delete(key);
}

export function unloadAll() {
  engines.clear();
}

/** Has an in-process engine for this pair (not disk cache). */
export function isEngineWarm(runtime, model) {
  return engines.has(`${runtime}::${model}`);
}

/**
 * Cache probe: engine warm = process hit; Cache API store count for disk assets.
 * Disk reuse is measured as second load after unloadModel (browser HTTP/Cache).
 */
export async function probeCache(runtime, model) {
  const warm = isEngineWarm(runtime, model);
  let cacheApiKeys = null;
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      cacheApiKeys = names.length;
    }
  } catch {
    cacheApiKeys = null;
  }
  return {
    processWarm: warm,
    cacheApiStoreCount: cacheApiKeys,
    hit: warm,
  };
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function unavailable(runtime, reason) {
  const err = new Error(reason);
  err.code = "RUNTIME_UNAVAILABLE";
  err.runtime = runtime;
  err.reason = reason;
  return err;
}

export function isUnavailableError(err) {
  return err && err.code === "RUNTIME_UNAVAILABLE";
}

/**
 * Synthetic harness only — NOT a WebLLM/Transformers.js measurement.
 * Callers must tag events with runtime "synthetic" (see app.js).
 * Measures real TypedArray alloc cost + optional process reuse, not setTimeout fakes.
 */
export async function runSyntheticLoad(cachePhase = "uncached") {
  const t0 = performance.now();
  const coldBytes = 2 * 1024 * 1024;
  const warmBytes = 256 * 1024;
  if (cachePhase === "cached" && synthColdBuf) {
    // reuse held buffer (process "cache")
    let s = 0;
    for (let i = 0; i < synthColdBuf.length; i += 8192) s += synthColdBuf[i];
    void s;
  } else {
    const buf = new Uint8Array(cachePhase === "cached" ? warmBytes : coldBytes);
    for (let i = 0; i < buf.length; i += 4096) buf[i] = (i ^ 0x5a) & 255;
    synthColdBuf = buf;
    let s = 0;
    for (let i = 0; i < buf.length; i += 4096) s += buf[i];
    void s;
  }
  const durationMs = performance.now() - t0;
  return {
    durationMs,
    cacheHit: cachePhase === "cached",
    cachePhase,
    memory: sampleMemory(),
    synthetic: true,
  };
}

export async function runSyntheticInfer(prompt) {
  const t0 = performance.now();
  let h = 2166136261;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // CPU-bound hash work proportional to prompt (not fixed sleep)
  let x = h;
  const iters = 50000 + (prompt.length * 200);
  for (let i = 0; i < iters; i++) {
    x = Math.imul(x ^ (x >>> 13), 0x5bd1e995);
  }
  const text = `[synthetic-harness] h=${(x >>> 0).toString(16)} echo:${prompt.slice(0, 48)}`;
  return {
    text,
    durationMs: performance.now() - t0,
    tokensOut: estimateTokens(text),
    memory: sampleMemory(),
    synthetic: true,
  };
}
