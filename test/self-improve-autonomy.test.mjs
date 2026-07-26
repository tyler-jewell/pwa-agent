/**
 * Autonomous self-improvement loop (bounded) — shipped agents only.
 * No human re-entry mid-loop; incomplete ends honestly (not silent ok).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../public/js/adapters/registry.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";
import { createBus } from "../public/js/agent/bus.js";
import { createRunTree } from "../public/js/agent/tree.js";
import { createMemoryQueue } from "../public/js/memory/queue.js";
import { createMemoryAgent } from "../public/js/agent/memory-agent.js";
import { createPerformanceManager } from "../public/js/agent/performance-manager.js";
import { createCrewAgent } from "../public/js/agent/crew-agent.js";
import { createAgentNotify } from "../public/js/notify/agent-notify.js";
import { extractSection, SECTION_OPP } from "../public/js/perf/opportunity-md.js";
import { computeProgressStage } from "../public/js/router/progress.js";

globalThis.Notification = undefined;

function fakeMemoryStore(initial = "# Memory\n\n_(empty — learn from this human.)_\n") {
  let content = initial;
  let headId = "mv_seed";
  const versions = [{ id: headId, content, source: "seed" }];
  return {
    getHead: () => ({ id: headId, content }),
    commit: async ({ content: c, source }) => {
      content = c.endsWith("\n") ? c : c + "\n";
      headId = `mv_${versions.length + 1}`;
      versions.push({ id: headId, content, source });
      return { ok: true, version: { id: headId, content, source } };
    },
    snapshot: () => ({
      memoryHeadId: headId,
      headContent: content,
      versions: versions.slice(),
    }),
    _versions: versions,
  };
}

describe("autonomous self-improve path (no mid-loop human)", () => {
  it("refresh-style cycle: progressive models + perf MEMORY + crew report", async () => {
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 8 }));
    await registry.discoverAll();
    registry.startProgressiveLoads();

    const memoryStore = fakeMemoryStore();
    const memoryQueue = createMemoryQueue();
    const tree = createRunTree();
    const bus = createBus({ tree });
    const notify = createAgentNotify();

    const memoryAgent = createMemoryAgent({ memoryStore, memoryQueue });
    const performanceManager = createPerformanceManager({
      memoryStore,
      memoryQueue,
      tree,
      registry,
      notify,
    });
    const crew = createCrewAgent({ registry });

    bus.register("memory-agent", memoryAgent.handler);
    bus.register("performance-manager", performanceManager.handler);
    bus.register("crew-agent", crew.handler);

    // Background agents as on boot — no human clicks
    const perf = await bus.invoke({
      agentId: "performance-manager",
      name: "review-performance",
      parentRunId: null,
      input: {},
    });
    assert.equal(perf.ok, true);

    // Wait progressive ladder progress
    await new Promise((r) => setTimeout(r, 50));
    const stage = registry.progressSnapshot();
    assert.ok(
      ["instant", "enhancing", "capable", "offline"].includes(stage.stageId),
      `stage=${stage.stageId}`
    );

    // MEMORY should gain Areas of opportunity from performance-manager
    const head = memoryStore.getHead().content;
    assert.match(head, /Areas of opportunity/);
    const opp = extractSection(head, SECTION_OPP);
    assert.ok(opp != null);
    assert.ok(memoryStore._versions.length >= 2); // seed + performance commit

    // Multi-step crew without human mid-loop
    const crewResult = await bus.invoke({
      agentId: "crew-agent",
      name: "task loop",
      parentRunId: null,
      input: { goal: "scan; plan; ship", maxSteps: 8 },
    });
    assert.equal(crewResult.ok, true);
    assert.equal(crewResult.report.honest, true);
    assert.equal(crewResult.report.complete, true);
    assert.equal(crewResult.report.notAchieved.length, 0);

    // Memory reflect learns a fact autonomously after crew
    const reflect = await bus.invoke({
      agentId: "memory-agent",
      name: "reflect",
      parentRunId: null,
      input: {
        op: "reflect",
        userText: "Remember that I prefer local-first agents.",
        assistantText: crewResult.text,
      },
    });
    assert.equal(reflect.ok, true);
    assert.match(memoryStore.getHead().content, /local-first agents|Learned/i);

    // Run tree shows multi-agent work (transparent feed)
    const roots = tree.listRoots();
    const ids = roots.map((r) => r.agentId);
    assert.ok(ids.includes("performance-manager"));
    assert.ok(ids.includes("crew-agent"));
    assert.ok(ids.includes("memory-agent"));
  });

  it("exhausted crew path is honest incomplete — never silent success", async () => {
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 1 }));
    await registry.discoverAll();
    const tree = createRunTree();
    const bus = createBus({ tree });
    bus.register("crew-agent", createCrewAgent({ registry }).handler);

    const result = await bus.invoke({
      agentId: "crew-agent",
      name: "task loop",
      parentRunId: null,
      input: {
        goal: "a; b; c; d; e",
        maxSteps: 2,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.report.honest, true);
    assert.equal(result.report.complete, false);
    assert.ok(result.report.notAchieved.length >= 1);
    assert.ok(result.report.achieved.length <= 2);
    assert.notEqual(result.report.status, "complete");
    assert.match(result.text, /Not achieved|Outcome: exhausted|Outcome: incomplete|Outcome: stopped/i);
  });

  it("memory reflect is noop without learnable facts (no fake improvement)", async () => {
    const memoryStore = fakeMemoryStore();
    const memoryQueue = createMemoryQueue();
    const agent = createMemoryAgent({ memoryStore, memoryQueue });
    const r = await agent.handler({
      input: {
        op: "reflect",
        userText: "hi",
        assistantText: "hello",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.noop, true);
    assert.equal(memoryStore._versions.length, 1);
  });

  it("progressive stage advances as models become ready (autonomous)", async () => {
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 12 }));
    await registry.discoverAll();
    const early = computeProgressStage(registry.list(), { online: true });
    assert.ok(["instant", "enhancing"].includes(early.stageId));
    registry.startProgressiveLoads();
    await new Promise((r) => setTimeout(r, 80));
    const late = registry.progressSnapshot();
    assert.ok(
      ["enhancing", "capable", "offline"].includes(late.stageId),
      late.stageId
    );
    assert.ok(registry.readyModels().length >= 1);
  });
});
