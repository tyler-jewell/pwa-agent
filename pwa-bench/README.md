# PWA-LLM Comparison Bench

Isolated greenfield research MVP — **not** day-2 `msa-web`.

Compares **WebLLM** vs **Transformers.js** with a single JSONL metrics log (IndexedDB), live stats, historical charts, and side-by-side cache/memory numbers.

## Serve (port 7430 — never 7420)

```bash
cd pwa-bench
npm start
# → http://127.0.0.1:7430/
```

Override: `PWA_BENCH_PORT=7431 npm start`

## Tests

```bash
npm test
```

## Operator flow

1. Pick runtime (WebLLM / Transformers.js) and model (default TJS: **DistilGPT-2**).
2. Default is **real** local inference (CDN model download). Failures emit `runtime_unavailable` into JSONL.
3. **Cache + memory bench** runs uncached then cached phases; compare table uses **real** runs only.
4. Optional **synthetic harness** is for UI smoke only — tagged `runtime=synthetic`, excluded from framework compare.
5. **Export JSONL** downloads the full common event stream.

## Event types

`run_start`, `run_end`, `load_start`, `load_end`, `infer_start`, `infer_end`, `cache_probe`, `memory_sample`, `runtime_unavailable`, `error`, `bench_start`, `bench_end`.
