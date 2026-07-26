/**
 * Production modularity + improve-over-time — drives shipped purity + port + cycles.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkCorePurityFromText,
  CORE_PATH_RE,
} from "../public/js/quality/selftests.js";
import { validateRuntimeAdapter } from "../public/js/ports/runtime.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";
import { createWebLlmStubAdapter } from "../public/js/adapters/webllm-stub.js";
import { createRegistry } from "../public/js/adapters/registry.js";
import { createBus } from "../public/js/agent/bus.js";
import { createRunTree } from "../public/js/agent/tree.js";
import { createMemoryQueue } from "../public/js/memory/queue.js";
import { createPerformanceManager } from "../public/js/agent/performance-manager.js";
import { createCrewAgent } from "../public/js/agent/crew-agent.js";
import { extractSection, SECTION_OPP } from "../public/js/perf/opportunity-md.js";
import { parseOpportunityBlocks } from "../public/js/perf/opportunity-md.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsRoot = join(root, "public/js");

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkJs(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

function fakeMemoryStore(initial = "# Memory\n\n") {
  let content = initial;
  let headId = "h0";
  const versions = [{ id: headId, content, source: "seed" }];
  return {
    getHead: () => ({ id: headId, content }),
    commit: async ({ content: c, source }) => {
      content = c.endsWith("\n") ? c : c + "\n";
      headId = `h${versions.length}`;
      versions.push({ id: headId, content, source });
      return { ok: true, version: { id: headId, content, source } };
    },
    _versions: versions,
  };
}

describe("core modularity / purity (FP0)", () => {
  it("CORE_PATH_RE covers task and agent cores", () => {
    assert.match("public/js/task/loop.js", CORE_PATH_RE);
    assert.match("public/js/agent/chat-agent.js", CORE_PATH_RE);
    assert.match("public/js/ports/runtime.js", CORE_PATH_RE);
  });

  it("every core/module file passes checkCorePurityFromText (shipped)", () => {
    const files = walkJs(jsRoot);
    const failures = [];
    for (const abs of files) {
      const rel = relative(root, abs).replace(/\\/g, "/");
      // Skip adapters (vendor dynamic import allowed only here later)
      if (rel.includes("/adapters/")) continue;
      if (rel.includes("/ui/")) continue; // UI is product chrome, not inference vendor
      const text = readFileSync(abs, "utf8");
      const hit = checkCorePurityFromText(rel, text);
      if (hit) failures.push(hit);
    }
    assert.deepEqual(failures, [], failures.join("\n"));
  });

  it("checkCorePurityFromText rejects vendor and concrete adapter imports", () => {
    assert.match(
      checkCorePurityFromText("public/js/turn/prompt.js", "import x from '@mlc-ai/web-llm'") || "",
      /vendor/
    );
    assert.match(
      checkCorePurityFromText(
        "public/js/agent/chat-agent.js",
        "import { createMockAdapter } from '../adapters/mock.js'"
      ) || "",
      /concrete adapter/
    );
    assert.equal(
      checkCorePurityFromText(
        "public/js/turn/prompt.js",
        "export function buildPrompt() {}"
      ),
      null
    );
  });

  it("mock + webllm-stub satisfy validateRuntimeAdapter port", () => {
    const mock = createMockAdapter({ progressiveDelayMs: 1 });
    const stub = createWebLlmStubAdapter();
    assert.equal(validateRuntimeAdapter(mock), null);
    assert.equal(validateRuntimeAdapter(stub), null);
    assert.match(validateRuntimeAdapter({ id: "x" }) || "", /discover/);
    assert.match(validateRuntimeAdapter(null) || "", /not an object/);
  });

  it("registry swaps adapters without core rewrite (dual discover)", async () => {
    const registry = createRegistry();
    const mock = createMockAdapter({ progressiveDelayMs: 1 });
    const stub = createWebLlmStubAdapter();
    assert.equal(validateRuntimeAdapter(mock), null);
    registry.registerAdapter(mock);
    registry.registerAdapter(stub);
    assert.equal(registry.listAdapters().length, 2);
    await registry.discoverAll();
    const models = registry.list();
    assert.ok(models.some((m) => m.backendId === "mock"));
    // stub may be failed without WebGPU — still discovered
    assert.ok(models.some((m) => m.backendId === "webllm-stub"));
    // Chat path still has a ready mock-tiny
    assert.ok(registry.bestReady()?.id === "mock-tiny" || registry.readyModels().length >= 1);
  });
});

describe("guaranteed improve-over-time (bounded measurable)", () => {
  it("two autonomous refresh cycles deepen MEMORY opportunities without human mid-loop", async () => {
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 5 }));
    await registry.discoverAll();
    registry.startProgressiveLoads();

    const memoryStore = fakeMemoryStore();
    const memoryQueue = createMemoryQueue();
    const tree = createRunTree();
    const bus = createBus({ tree });
    const pm = createPerformanceManager({
      memoryStore,
      memoryQueue,
      tree,
      registry,
      notify: null,
    });
    bus.register("performance-manager", pm.handler);
    bus.register("crew-agent", createCrewAgent({ registry }).handler);

    const r1 = await bus.invoke({
      agentId: "performance-manager",
      name: "review-performance",
      parentRunId: null,
      input: {
        activity: [
          {
            id: "opp-chat-agent-smartness",
            agentId: "chat-agent",
            metric: "smartness",
            title: "Improve chat quality via better models",
            score: 12,
          },
        ],
      },
    });
    assert.equal(r1.ok, true);
    const after1 = memoryStore.getHead().content;
    assert.match(after1, /Areas of opportunity/);
    const blocks1 = parseOpportunityBlocks(extractSection(after1, SECTION_OPP));
    assert.ok(blocks1.length >= 1);
    const attempts1 = blocks1[0].attempts;

    // Second cycle — higher score (measurable improvement signal)
    const r2 = await bus.invoke({
      agentId: "performance-manager",
      name: "review-performance",
      parentRunId: null,
      input: {
        activity: [
          {
            id: "opp-chat-agent-smartness",
            agentId: "chat-agent",
            metric: "smartness",
            title: "Improve chat quality via better models",
            score: 28,
          },
        ],
      },
    });
    assert.equal(r2.ok, true);
    const after2 = memoryStore.getHead().content;
    const blocks2 = parseOpportunityBlocks(extractSection(after2, SECTION_OPP));
    assert.ok(blocks2[0].attempts > attempts1 || blocks2[0].lastScore >= 28);
    assert.ok(blocks2[0].scores.length >= blocks1[0].scores.length);
    // Durable history grew
    assert.ok(memoryStore._versions.length >= 3); // seed + 2 performance commits

    // Progressive models advanced without human
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(registry.readyModels().length >= 1);

    // Honest incomplete still available when budget tight
    const crew = await bus.invoke({
      agentId: "crew-agent",
      name: "task loop",
      parentRunId: null,
      input: { goal: "a; b; c; d", maxSteps: 1 },
    });
    assert.equal(crew.report.honest, true);
    assert.equal(crew.report.complete, false);
    assert.ok(crew.report.notAchieved.length >= 1);
  });
});

describe("production identity (simple static modular PWA)", () => {
  it("package has no framework dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.dependencies, undefined);
    assert.ok(!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0);
  });

  it("README states modular adapters + improve bound + production evidence bar", () => {
    const md = readFileSync(join(root, "README.md"), "utf8");
    assert.match(md, /modular adapters/i);
    assert.match(md, /bounded/i);
    assert.match(md, /honest/i);
    assert.match(md, /Production readiness|evidence bar|claim.code/i);
  });
});
