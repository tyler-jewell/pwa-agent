/**
 * crew-agent registration + bus path — shipped modules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../public/js/adapters/registry.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";
import { createBus } from "../public/js/agent/bus.js";
import { createRunTree } from "../public/js/agent/tree.js";
import {
  createCrewAgent,
  isCrewTask,
  extractCrewGoal,
} from "../public/js/agent/crew-agent.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("crew-agent registration", () => {
  it("main.js registers crew-agent", () => {
    const main = readFileSync(join(root, "public/js/main.js"), "utf8");
    assert.match(main, /bus\.register\("crew-agent"/);
    assert.match(main, /createCrewAgent/);
  });

  it("schema allows crew-agent agentId", () => {
    const schema = readFileSync(join(root, "public/js/core/schema.js"), "utf8");
    assert.match(schema, /"crew-agent"/);
  });

  it("chat-agent routes task: through crew", () => {
    const chat = readFileSync(join(root, "public/js/agent/chat-agent.js"), "utf8");
    assert.match(chat, /isCrewTask/);
    assert.match(chat, /crew-agent/);
  });
});

describe("isCrewTask / extractCrewGoal", () => {
  it("detects task: and multi-item semicolon goals", () => {
    assert.equal(isCrewTask("task: do a; do b"), true);
    assert.equal(isCrewTask("crew: plan"), true);
    assert.equal(isCrewTask("alpha; beta; gamma"), true);
    assert.equal(isCrewTask("hello"), false);
  });

  it("strips task prefix", () => {
    assert.equal(extractCrewGoal("task: ship it"), "ship it");
  });
});

describe("crew-agent bus loop", () => {
  it("completes multi-item goal and returns honest complete report", async () => {
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 1 }));
    await registry.discoverAll();
    // Force progressive models ready for handoff options
    for (const m of registry.list()) {
      if (m.status !== "ready") {
        await registry.getAdapterFor(m.id)?.load?.(m.id);
        registry.setStatus(m.id, "ready");
      }
    }

    const tree = createRunTree();
    const bus = createBus({ tree });
    const crew = createCrewAgent({ registry });
    bus.register("crew-agent", crew.handler);

    const result = await bus.invoke({
      agentId: "crew-agent",
      name: "task loop",
      parentRunId: null,
      input: { goal: "research; draft; polish", maxSteps: 8 },
    });
    assert.equal(result.ok, true);
    assert.ok(result.report);
    assert.equal(result.report.honest, true);
    assert.equal(result.report.complete, true);
    assert.equal(result.report.achieved.length, 3);
    assert.equal(result.report.notAchieved.length, 0);
    assert.match(result.text, /Outcome: complete/);

    const roots = tree.listRoots();
    assert.ok(roots.some((r) => r.agentId === "crew-agent"));
  });

  it("exhausted steps → incomplete report with notAchieved", async () => {
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
        goal: "one; two; three; four; five",
        maxSteps: 2,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.report.complete, false);
    assert.ok(result.report.notAchieved.length >= 1);
    assert.ok(
      result.report.status === "exhausted" ||
        result.report.status === "incomplete" ||
        result.report.status === "stopped"
    );
    // Tree must show crew ran (not silent drop)
    assert.ok(tree.listRoots().length >= 1);
  });
});
