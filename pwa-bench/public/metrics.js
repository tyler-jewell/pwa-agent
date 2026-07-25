/**
 * Shared JSONL metrics schema + pure aggregation.
 * Single source of truth for stats/charts — no parallel metric paths.
 * Works in browser (IndexedDB) and Node (in-memory for tests).
 */

export const EVENT_TYPES = Object.freeze([
  "run_start",
  "run_end",
  "load_start",
  "load_end",
  "infer_start",
  "infer_end",
  "cache_probe",
  "memory_sample",
  "runtime_unavailable",
  "error",
  "bench_start",
  "bench_end",
]);

export const RUNTIMES = Object.freeze(["webllm", "transformersjs"]);

/**
 * @typedef {object} MetricEvent
 * @property {string} id
 * @property {string} ts ISO-8601
 * @property {string} type one of EVENT_TYPES
 * @property {string} [runId]
 * @property {string} [runtime] webllm | transformersjs
 * @property {string} [model]
 * @property {object} [data]
 */

export function makeEvent(type, partial = {}) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`unknown event type: ${type}`);
  }
  return {
    id: partial.id || cryptoRandomId(),
    ts: partial.ts || new Date().toISOString(),
    type,
    runId: partial.runId ?? null,
    runtime: partial.runtime ?? null,
    model: partial.model ?? null,
    data: partial.data ?? {},
  };
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Serialize events as JSONL text (one JSON object per line). */
export function eventsToJsonl(events) {
  return events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
}

/** Parse JSONL text into events; skips blank lines; throws on bad lines if strict. */
export function parseJsonl(text, { strict = false } = {}) {
  const out = [];
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (!obj || typeof obj !== "object" || !obj.type) {
        if (strict) throw new Error(`line ${i + 1}: missing type`);
        continue;
      }
      out.push(obj);
    } catch (err) {
      if (strict) throw new Error(`line ${i + 1}: ${err.message}`);
    }
  }
  return out;
}

/**
 * Aggregate run-level stats from a flat event stream.
 * Side-by-side byRuntime/cacheCompare use REAL framework runs only
 * (synthetic:true excluded — harness timings are not WebLLM/TJS).
 * @param {object[]} events
 * @param {{ includeSynthetic?: boolean }} [opts] includeSynthetic only expands `runs`; never mixes into byRuntime.
 * @returns {{ runs: object[], realRuns: object[], byRuntime: object, cacheCompare: object[], memoryPeaks: object[], syntheticRunCount: number }}
 */
export function aggregateMetrics(events, opts = {}) {
  const byRun = new Map();
  for (const e of events) {
    if (!e.runId) continue;
    // bench_* uses a separate runId and must not create empty compare rows
    if (e.type === "bench_start" || e.type === "bench_end") continue;
    if (!byRun.has(e.runId)) {
      byRun.set(e.runId, {
        runId: e.runId,
        runtime: e.runtime || null,
        model: e.model || null,
        events: [],
        startTs: null,
        endTs: null,
        status: "open",
        loadMs: null,
        inferMs: null,
        totalMs: null,
        cacheHit: null,
        cachePhase: null,
        peakMemoryBytes: null,
        usedJsHeapBytes: null,
        tokensOut: null,
        error: null,
        unavailable: false,
        synthetic: false,
      });
    }
    const r = byRun.get(e.runId);
    r.events.push(e);
    if (e.runtime) r.runtime = e.runtime;
    if (e.model) r.model = e.model;
    if (e.data?.synthetic === true || e.data?.mode === "synthetic" || e.runtime === "synthetic") {
      r.synthetic = true;
    }
    if (e.type === "run_start" || e.type === "bench_start") {
      r.startTs = e.ts;
      if (e.data?.cachePhase) r.cachePhase = e.data.cachePhase;
      if (e.data?.mode === "synthetic") r.synthetic = true;
    }
    if (e.type === "run_end" || e.type === "bench_end") {
      r.endTs = e.ts;
      r.status = e.data?.status || "ok";
      if (typeof e.data?.totalMs === "number") r.totalMs = e.data.totalMs;
      if (e.data?.synthetic === true) r.synthetic = true;
    }
    if (e.type === "load_end" && typeof e.data?.durationMs === "number") {
      r.loadMs = e.data.durationMs;
      if (typeof e.data.cacheHit === "boolean") r.cacheHit = e.data.cacheHit;
      if (e.data.cachePhase) r.cachePhase = e.data.cachePhase;
      if (e.data.synthetic === true) r.synthetic = true;
    }
    if (e.type === "infer_end" && typeof e.data?.durationMs === "number") {
      r.inferMs = e.data.durationMs;
      if (typeof e.data.tokensOut === "number") r.tokensOut = e.data.tokensOut;
      if (e.data.synthetic === true) r.synthetic = true;
    }
    if (e.type === "cache_probe") {
      if (typeof e.data?.hit === "boolean") r.cacheHit = e.data.hit;
      if (e.data?.phase) r.cachePhase = e.data.phase;
      if (e.data?.synthetic === true) r.synthetic = true;
    }
    if (e.type === "memory_sample") {
      const used = e.data?.usedJSHeapSize ?? e.data?.usedJsHeapBytes ?? null;
      const total = e.data?.totalJSHeapSize ?? e.data?.totalJsHeapBytes ?? null;
      const peak = e.data?.peakBytes ?? used;
      if (typeof peak === "number") {
        r.peakMemoryBytes =
          r.peakMemoryBytes == null ? peak : Math.max(r.peakMemoryBytes, peak);
      }
      if (typeof used === "number") r.usedJsHeapBytes = used;
      if (typeof total === "number") r.totalJsHeapBytes = total;
    }
    if (e.type === "runtime_unavailable") {
      r.unavailable = true;
      r.status = "unavailable";
      r.error = e.data?.reason || "unavailable";
    }
    if (e.type === "error") {
      r.status = "error";
      r.error = e.data?.message || "error";
    }
  }

  const runs = [...byRun.values()].sort((a, b) =>
    String(a.startTs || "").localeCompare(String(b.startTs || ""))
  );

  /** Real framework runs only — decision-quality compare source. */
  const realRuns = runs.filter(
    (r) => !r.synthetic && r.runtime !== "synthetic" && RUNTIMES.includes(r.runtime)
  );
  const syntheticRunCount = runs.filter((r) => r.synthetic || r.runtime === "synthetic").length;

  const byRuntime = {};
  for (const rt of RUNTIMES) {
    const subset = realRuns.filter((r) => r.runtime === rt && !r.unavailable);
    const loads = subset.map((r) => r.loadMs).filter((n) => typeof n === "number");
    const infers = subset.map((r) => r.inferMs).filter((n) => typeof n === "number");
    const mems = subset
      .map((r) => r.peakMemoryBytes)
      .filter((n) => typeof n === "number");
    byRuntime[rt] = {
      runCount: subset.length,
      unavailableCount: realRuns.filter((r) => r.runtime === rt && r.unavailable).length,
      // also count unavailable among all non-synthetic with this runtime tag
      avgLoadMs: avg(loads),
      avgInferMs: avg(infers),
      avgPeakMemoryBytes: avg(mems),
      minLoadMs: loads.length ? Math.min(...loads) : null,
      maxLoadMs: loads.length ? Math.max(...loads) : null,
      cachedLoads: subset.filter((r) => r.cacheHit === true || r.cachePhase === "cached"),
      uncachedLoads: subset.filter(
        (r) => r.cacheHit === false || r.cachePhase === "uncached" || r.cachePhase === "cold"
      ),
    };
    // unavailable may have no load_end — count from all non-synthetic
    byRuntime[rt].unavailableCount = runs.filter(
      (r) => r.runtime === rt && !r.synthetic && r.unavailable
    ).length;
  }

  const cacheCompare = [];
  for (const rt of RUNTIMES) {
    const uncached = byRuntime[rt].uncachedLoads
      .map((r) => r.loadMs)
      .filter((n) => typeof n === "number");
    const cached = byRuntime[rt].cachedLoads
      .map((r) => r.loadMs)
      .filter((n) => typeof n === "number");
    cacheCompare.push({
      runtime: rt,
      uncachedAvgMs: avg(uncached),
      cachedAvgMs: avg(cached),
      uncachedCount: uncached.length,
      cachedCount: cached.length,
      speedup:
        avg(uncached) != null && avg(cached) != null && avg(cached) > 0
          ? avg(uncached) / avg(cached)
          : null,
    });
  }

  const memoryPeaks = realRuns
    .filter((r) => typeof r.peakMemoryBytes === "number")
    .map((r) => ({
      runId: r.runId,
      runtime: r.runtime,
      model: r.model,
      peakMemoryBytes: r.peakMemoryBytes,
      cachePhase: r.cachePhase,
    }));

  return {
    runs: opts.includeSynthetic === false ? realRuns : runs,
    realRuns,
    byRuntime,
    cacheCompare,
    memoryPeaks,
    syntheticRunCount,
  };
}

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Side-by-side comparison rows for UI / export. */
export function buildCompareTable(agg) {
  const rows = [];
  for (const rt of RUNTIMES) {
    const s = agg.byRuntime[rt];
    const cc = agg.cacheCompare.find((c) => c.runtime === rt) || {};
    rows.push({
      runtime: rt,
      runs: s.runCount,
      unavailable: s.unavailableCount,
      avgLoadMs: round1(s.avgLoadMs),
      avgInferMs: round1(s.avgInferMs),
      avgPeakMemoryMb: s.avgPeakMemoryBytes != null ? round1(s.avgPeakMemoryBytes / (1024 * 1024)) : null,
      uncachedAvgLoadMs: round1(cc.uncachedAvgMs),
      cachedAvgLoadMs: round1(cc.cachedAvgMs),
      cacheSpeedup: cc.speedup != null ? round2(cc.speedup) : null,
    });
  }
  return rows;
}

function round1(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 10) / 10;
}
function round2(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

export function formatCompareText(agg) {
  const rows = buildCompareTable(agg);
  const lines = ["runtime\truns\tavgLoadMs\tavgInferMs\tavgPeakMB\tuncachedLoadMs\tcachedLoadMs\tspeedup"];
  for (const r of rows) {
    lines.push(
      [
        r.runtime,
        r.runs,
        r.avgLoadMs ?? "—",
        r.avgInferMs ?? "—",
        r.avgPeakMemoryMb ?? "—",
        r.uncachedAvgLoadMs ?? "—",
        r.cachedAvgLoadMs ?? "—",
        r.cacheSpeedup != null ? `${r.cacheSpeedup}x` : "—",
      ].join("\t")
    );
  }
  return lines.join("\n");
}

// —— Durable log (browser IndexedDB; Node memory store for tests) ——

const DB_NAME = "pwa-llm-bench";
const STORE = "events";
const DB_VERSION = 1;

export function createMemoryLog(seed = []) {
  const events = [...seed];
  return {
    async append(ev) {
      events.push(ev);
      return ev;
    },
    async appendMany(list) {
      for (const e of list) events.push(e);
    },
    async all() {
      return [...events];
    },
    async clear() {
      events.length = 0;
    },
    async exportJsonl() {
      return eventsToJsonl(events);
    },
    async importJsonl(text) {
      const parsed = parseJsonl(text, { strict: true });
      events.push(...parsed);
      return parsed.length;
    },
  };
}

export async function openBrowserLog() {
  if (typeof indexedDB === "undefined") {
    return createMemoryLog();
  }
  const db = await openDb();
  return {
    async append(ev) {
      await idbPut(db, ev);
      return ev;
    },
    async appendMany(list) {
      for (const e of list) await idbPut(db, e);
    },
    async all() {
      return idbGetAll(db);
    },
    async clear() {
      await idbClear(db);
    },
    async exportJsonl() {
      return eventsToJsonl(await idbGetAll(db));
    },
    async importJsonl(text) {
      const parsed = parseJsonl(text, { strict: true });
      for (const e of parsed) await idbPut(db, e);
      return parsed.length;
    },
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("ts", "ts", { unique: false });
        os.createIndex("runId", "runId", { unique: false });
        os.createIndex("type", "type", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, ev) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(ev);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Sample browser memory (Chrome performance.memory when present). */
export function sampleMemory() {
  const m =
    typeof performance !== "undefined" && performance.memory
      ? performance.memory
      : null;
  if (m) {
    return {
      usedJSHeapSize: m.usedJSHeapSize,
      totalJSHeapSize: m.totalJSHeapSize,
      jsHeapSizeLimit: m.jsHeapSizeLimit,
      peakBytes: m.usedJSHeapSize,
      source: "performance.memory",
    };
  }
  return {
    usedJSHeapSize: null,
    totalJSHeapSize: null,
    jsHeapSizeLimit: null,
    peakBytes: null,
    source: "unavailable",
  };
}
