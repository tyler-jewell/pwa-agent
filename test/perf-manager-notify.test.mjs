/**
 * performance-manager: ≤1 notify per run via shared notify facade.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgentNotify } from "../public/js/notify/agent-notify.js";
import { createPerformanceManager } from "../public/js/agent/performance-manager.js";
import { createMemoryStore } from "../public/js/memory/store.js";
import { createMemoryQueue } from "../public/js/memory/queue.js";
import { createRunTree } from "../public/js/agent/tree.js";
import { createRegistry } from "../public/js/adapters/registry.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";
import { createBus } from "../public/js/agent/bus.js";

// Node has no Notification
globalThis.Notification = undefined;

function fakeMemoryStore(initial = "# Memory\n\n") {
  let content = initial;
  let headId = "h1";
  return {
    getHead: () => ({ id: headId, content }),
    commit: async ({ content: c, source }) => {
      content = c.endsWith("\n") ? c : c + "\n";
      headId = `h-${Date.now()}`;
      return { ok: true, version: { id: headId, content, source } };
    },
    snapshot: () => ({ memoryHeadId: headId, headContent: content, versions: [] }),
  };
}

describe("performance-manager notify", () => {
  it("notifies at most once when promotion warranted", async () => {
    let notifyCount = 0;
    const real = createAgentNotify();
    const notify = {
      notify: async (n) => {
        notifyCount += 1;
        return real.notify(n);
      },
      approve: (id) => real.approve(id),
      dismiss: (id) => real.dismiss(id),
      getPending: (id) => real.getPending(id),
    };

    const memoryStore = fakeMemoryStore();
    const memoryQueue = {
      enqueue: (fn) => fn(),
    };
    const tree = createRunTree();
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 1 }));
    await registry.discoverAll();

    const pm = createPerformanceManager({
      memoryStore,
      memoryQueue,
      tree,
      registry,
      notify,
    });

    // Feed enough improving samples via input.activity override
    let last;
    for (const score of [10, 20, 30, 40]) {
      last = await pm.handler({
        input: {
          activity: [
            {
              id: "opp-chat-agent-smartness",
              agentId: "chat-agent",
              metric: "smartness",
              title: "Improve chat quality via better models",
              score,
            },
          ],
        },
      });
    }
    assert.equal(last.ok, true);
    assert.equal(last.notifyCount, 1);
    assert.equal(last.notified, true);
    assert.equal(notifyCount, 1);
    assert.ok(last.notifyId);
    const pending = notify.getPending(last.notifyId);
    assert.equal(pending.data.type, "perf-promote");
  });

  it("zero notify when insufficient evidence", async () => {
    let notifyCount = 0;
    const real = createAgentNotify();
    const notify = {
      notify: async (n) => {
        notifyCount += 1;
        return real.notify(n);
      },
      approve: real.approve.bind(real),
      dismiss: real.dismiss.bind(real),
      getPending: real.getPending.bind(real),
    };
    const pm = createPerformanceManager({
      memoryStore: fakeMemoryStore(),
      memoryQueue: { enqueue: (fn) => fn() },
      tree: createRunTree(),
      registry: createRegistry(),
      notify,
    });
    const r = await pm.handler({
      input: {
        activity: [
          {
            id: "opp-x",
            agentId: "chat-agent",
            metric: "smartness",
            score: 10,
          },
        ],
      },
    });
    assert.equal(r.notified, false);
    assert.equal(r.notifyCount, 0);
    assert.equal(notifyCount, 0);
  });

  it("applyPromotion migrates instruction on approval path", async () => {
    const memoryStore = fakeMemoryStore(
      "# Memory\n\n## Areas of opportunity\n\n### opp-1 | chat-agent | Improve X\n- status: ready_to_promote\n- attempts: 4\n- baseline: 10\n- lastScore: 40\n- scores: 10,20,30,40\n- evidence: e\n- createdAt: t\n- updatedAt: t\n"
    );
    const pm = createPerformanceManager({
      memoryStore,
      memoryQueue: { enqueue: (fn) => fn() },
      tree: createRunTree(),
      registry: createRegistry(),
      notify: createAgentNotify(),
    });
    const r = await pm.applyPromotion({
      agentId: "chat-agent",
      instruction: "Improve X",
      opportunityId: "opp-1",
    });
    assert.equal(r.ok, true);
    assert.match(memoryStore.getHead().content, /Standing instructions/);
    assert.match(memoryStore.getHead().content, /Improve X/);
    assert.match(memoryStore.getHead().content, /status: promoted/);
  });
});
