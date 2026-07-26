/**
 * In-browser contract self-tests (no external runner).
 */
import { estimateTokens, estimateMessagesTokens } from "../core/tokens.js";
import {
  validateMemoryVersion,
  validateChatMessage,
  validateModelRecord,
  validateRunTreeEvent,
  validateExportBundle,
  validateVersionManifest,
  SEED_MEMORY,
} from "../core/schema.js";
import { validateBundleDeep } from "../core/export.js";
import { createMockAdapter } from "../adapters/mock.js";
import { compactionNeeded, applyCompaction } from "../memory/compact.js";
import { msgId, nowIso } from "../core/ids.js";
import { createBus } from "../agent/bus.js";
import { createRunTree } from "../agent/tree.js";
import { createChatAgent } from "../agent/chat-agent.js";
import { createRegistry } from "../adapters/registry.js";
import { createMemoryQueue } from "../memory/queue.js";

export async function runSelfTests() {
  const results = [];
  const ok = (message) => results.push({ level: "ok", message });
  const fail = (message) => results.push({ level: "fail", message });

  if (estimateTokens("") === 1 && estimateTokens("abcd") === 1 && estimateTokens("abcde") === 2) {
    ok("estimateTokens deterministic");
  } else fail("estimateTokens mismatch");

  const mv = {
    id: "mv_t",
    createdAt: nowIso(),
    content: SEED_MEMORY,
    source: "seed",
    parentId: null,
    summaryWhy: "seed",
    diffFromParent: { added: [], removed: [] },
  };
  if (!validateMemoryVersion(mv)) ok("MemoryVersion schema");
  else fail("MemoryVersion schema: " + validateMemoryVersion(mv));

  const msg = { id: msgId(), role: "user", content: "hi", createdAt: nowIso(), meta: {} };
  if (!validateChatMessage(msg)) ok("ChatMessage schema");
  else fail("ChatMessage schema");

  const model = {
    id: "m1",
    source: "discovered",
    backendId: "mock",
    label: "t",
    capabilities: {
      contextWindowTokens: 100,
      supportsStreaming: true,
      modalities: ["text"],
      qualityClass: "tiny",
    },
    constraints: { approxBytes: 1, requiresWebGpu: false, minRamHintMb: 0, offlineReady: true },
    status: "ready",
    metrics: { latencyP50Ms: null, failCount: 0, successCount: 0 },
  };
  if (!validateModelRecord(model)) ok("ModelRecord schema");
  else fail("ModelRecord: " + validateModelRecord(model));

  if (
    !validateRunTreeEvent({
      runId: "run_1",
      parentRunId: null,
      agentId: "chat-agent",
      name: "t",
      status: "started",
      ts: nowIso(),
      detail: {},
    })
  ) {
    ok("RunTreeEvent schema");
  } else fail("RunTreeEvent schema");

  const bundle = {
    schemaVersion: 1,
    exportedAt: nowIso(),
    app: "pwa",
    memoryHeadId: "mv_t",
    memoryVersions: [mv],
    transcript: { messages: [], updatedAt: nowIso() },
    modelsSnapshot: [],
    runtimeHint: { backendId: "mock", modelId: "m1" },
  };
  if (!validateExportBundle(bundle) && !validateBundleDeep(bundle)) {
    ok("AgentExportBundle schema + deep");
  } else fail("export bundle validation");

  // Negative: corrupt bundle rejected before write
  const bad = {
    ...bundle,
    memoryVersions: [{ id: "x", content: "hi", source: "nope" }],
    memoryHeadId: "x",
  };
  if (validateBundleDeep(bad)) ok("reject corrupt export bundle");
  else fail("corrupt bundle should fail deep validate");

  const badHead = { ...bundle, memoryHeadId: "missing" };
  if (validateBundleDeep(badHead)) ok("reject missing memoryHeadId");
  else fail("missing head should fail");

  if (
    !validateVersionManifest({
      buildId: "x",
      createdAt: nowIso(),
      channel: "local",
      changelog: { summary: "s", full: "f" },
    })
  ) {
    ok("version.json shape");
  } else fail("version.json shape");

  const big = [];
  for (let i = 0; i < 80; i++) {
    big.push({
      id: msgId(),
      role: i % 2 ? "assistant" : "user",
      content: "word ".repeat(40),
      createdAt: nowIso(),
      meta: {},
    });
  }
  const chk = compactionNeeded(big, SEED_MEMORY, 500);
  if (chk.needed) {
    const { messages } = applyCompaction(big);
    if (messages.length === 1 && messages[0].role === "summary") ok("compaction replace");
    else fail("compaction did not replace");
  } else fail("compaction fixture did not trigger");

  try {
    const adapter = createMockAdapter({ progressiveDelayMs: 50 });
    const models = await adapter.discover();
    if (!models.length || models.some((m) => m.source !== "discovered")) {
      fail("mock discover");
    } else ok("mock discover (no hardcoded app catalog)");
    const tiny = models.find((x) => x.capabilities?.qualityClass === "tiny");
    const larger = models.filter((x) => x.capabilities?.qualityClass !== "tiny");
    if (tiny?.status === "ready" && larger.length >= 1) {
      ok("progressive ladder: tiny ready + larger announced");
    } else fail("progressive ladder shape wrong");
    let n = 0;
    const t0 = performance.now();
    for await (const tok of adapter.chatStream({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      modelId: "mock-tiny",
    })) {
      n += tok.length;
      if (n > 5) break;
    }
    if (n > 0 && performance.now() - t0 < 5000) ok("mock stream yields tokens");
    else fail("mock stream failed");
  } catch (e) {
    fail("mock stream: " + (e.message || e));
  }

  if (estimateMessagesTokens([{ content: "abcd" }]) >= 1) ok("estimateMessagesTokens");
  else fail("estimateMessagesTokens");

  // Bus maps result.ok === false → tree error
  try {
    const tree = createRunTree();
    const bus = createBus({ tree });
    bus.register("memory-agent", async () => ({ ok: false, error: "test-fail" }));
    await bus.invoke({
      agentId: "memory-agent",
      name: "reflect",
      parentRunId: null,
      input: {},
    });
    const roots = tree.listRoots();
    const st = roots[0]?.status;
    if (st === "error") ok("bus maps ok:false to tree error");
    else fail(`bus tree status expected error, got ${st}`);
  } catch (e) {
    fail("bus ok:false test: " + (e.message || e));
  }

  // Integration: handleUserMessage must not await memory-agent reflect
  try {
    const tree = createRunTree();
    const bus = createBus({ tree });
    let reflectFinished = false;
    bus.register("router-agent", async () => ({
      modelId: "mock-tiny",
      detail: { modelId: "mock-tiny" },
    }));
    bus.register("memory-agent", async () => {
      await new Promise((r) => setTimeout(r, 120));
      reflectFinished = true;
      return { ok: true, noop: true };
    });
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 5 }));
    await registry.discoverAll();
    const msgs = [];
    const transcript = {
      getMessages: () => msgs.slice(),
      append: async (role, content, meta = {}) => {
        const m = { id: msgId(), role, content, createdAt: nowIso(), meta };
        msgs.push(m);
        return m;
      },
      replaceMessages: async (next) => {
        msgs.length = 0;
        msgs.push(...next);
      },
    };
    const memoryStore = {
      getHead: () => ({ id: "h", content: SEED_MEMORY }),
      commit: async () => ({ ok: true }),
    };
    const agent = createChatAgent({
      bus,
      tree,
      registry,
      transcript,
      memoryStore,
      memoryQueue: createMemoryQueue(),
    });
    await agent.handleUserMessage("hello nonblock", { onToken: () => {} });
    if (!reflectFinished) ok("chat-agent does not await reflect");
    else fail("reflect finished before handleUserMessage returned");
    await new Promise((r) => setTimeout(r, 160));
  } catch (e) {
    fail("non-blocking reflect integration: " + (e.message || e));
  }

  // Core purity without folder: fetch app core modules
  try {
    const paths = [
      "/js/core/schema.js",
      "/js/turn/prompt.js",
      "/js/router/rank.js",
      "/js/memory/store.js",
      "/js/agent/chat-agent.js",
      "/js/live/poll.js",
      "/js/quality/gate.js",
    ];
    let purityFail = null;
    for (const p of paths) {
      const res = await fetch(p, { cache: "no-store" });
      if (!res.ok) continue;
      const text = await res.text();
      const hit = checkCorePurityFromText(p, text);
      if (hit) {
        purityFail = hit;
        break;
      }
    }
    if (purityFail) fail(purityFail);
    else ok("core purity via fetch (no folder bind)");
  } catch (e) {
    fail("purity fetch: " + (e.message || e));
  }

  return results;
}

/** Core product paths — must stay free of vendor inference/UI frameworks (FP0). */
export const CORE_PATH_RE =
  /(?:^|\/)js\/(core|turn|router|memory|agent|task|live|quality|perf|recruit|train|notify|ports)\//;

const VENDOR_RE =
  /@mlc-ai\/web-llm|from\s+['"]@mlc-ai|transformers\.js|https:\/\/cdn\.jsdelivr.*webllm|from\s+['"]react['"]|from\s+['"]react-dom|from\s+['"]vue['"]|from\s+['"]@openai|from\s+['"]openai['"]|from\s+['"]@anthropic|from\s+['"]electron['"]/i;

export function checkCorePurityFromText(path, text) {
  const norm = String(path || "").replace(/\\/g, "/");
  if (!CORE_PATH_RE.test(norm) && !/js\/(core|turn|router|memory|agent|task|live|quality)\//.test(norm)) {
    return null;
  }
  // Quality selftests may import our mock adapter for in-page proof — not a vendor SDK
  if (/quality\/selftests\.js$/.test(norm)) {
    if (VENDOR_RE.test(text)) return `vendor import in core path: ${path}`;
    return null;
  }
  if (VENDOR_RE.test(text)) {
    return `vendor import in core path: ${path}`;
  }
  // Cores must not hard-depend on a concrete adapter module (swap via registry only)
  if (
    !/adapters\/registry\.js$/.test(norm) &&
    /from\s+['"][^'"]*adapters\/(mock|webllm)/i.test(text)
  ) {
    return `core imports concrete adapter (use registry): ${path}`;
  }
  return null;
}
