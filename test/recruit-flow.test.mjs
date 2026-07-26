/**
 * Registration + notify/approve → trainer path (shipped modules).
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
import { createRecruiterAgent } from "../public/js/agent/recruiter-agent.js";
import { createTrainerAgent } from "../public/js/agent/trainer-agent.js";
import { createAgentNotify } from "../public/js/notify/agent-notify.js";
import { decideRecruitment } from "../public/js/recruit/decide.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("recruiter + trainer registration", () => {
  it("main.js registers recruiter and trainer and boots recruiter", () => {
    const main = readFileSync(join(root, "public/js/main.js"), "utf8");
    assert.match(main, /bus\.register\("recruiter"/);
    assert.match(main, /bus\.register\("trainer"/);
    assert.match(main, /startRecruiterOnBoot/);
    assert.match(main, /createAgentNotify/);
  });

  it("schema allows recruiter and trainer agent ids", () => {
    const schema = readFileSync(join(root, "public/js/core/schema.js"), "utf8");
    assert.match(schema, /"recruiter"/);
    assert.match(schema, /"trainer"/);
  });

  it("recruiter handler recommends via bus and notify is callable by shared facade", async () => {
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 2 }));
    await registry.discoverAll();

    const notifications = [];
    const notify = createAgentNotify({
      onAction: (a) => notifications.push(a),
    });
    // Stub Notification to avoid browser APIs in Node
    globalThis.Notification = undefined;

    const tree = createRunTree();
    const bus = createBus({ tree });
    const recruiter = createRecruiterAgent({ registry, notify });
    const trainer = createTrainerAgent({ registry, notify });
    bus.register("recruiter", recruiter.handler);
    bus.register("trainer", trainer.handler);

    const result = await bus.invoke({
      agentId: "recruiter",
      name: "scan-models",
      parentRunId: null,
      input: {
        aggression: 5,
        storage: { usage: 1e6, quota: 500e6 },
      },
    });
    assert.equal(result.ok, true);
    assert.ok(result.decision);
    // With mock-large (recruiter candidate) + non-ready progressive + space → add
    assert.equal(result.decision.action, "add");
    assert.ok(result.notified);
    assert.ok(result.notifyId);

    const pending = notify.getPending(result.notifyId);
    assert.ok(pending);
    assert.equal(pending.data.type, "recruit");

    // Approve triggers action path (trainer invoked by boot wire in browser;
    // here we drive trainer handler directly as the shared approval target)
    const train = await bus.invoke({
      agentId: "trainer",
      name: "train-model",
      parentRunId: null,
      input: {
        candidateId: pending.data.candidateId,
        replaceId: pending.data.replaceId,
        candidate: pending.data.candidate,
      },
    });
    assert.equal(train.ok, true);
    assert.ok(train.metrics.smartness >= 1);
    const model = registry.get(train.modelId);
    assert.equal(model.status, "ready");
    assert.ok(model.metrics.benchAt);

    // Shared notify used by recruiter (requireApproval) and trainer (done)
    // Trainer also calls notify — ensure facade is multi-agent
    assert.ok(typeof notify.notify === "function");
  });

  it("decideRecruitment is the pure entry used by recruiter", () => {
    // Structural: recruiter imports decideRecruitment
    const src = readFileSync(
      join(root, "public/js/agent/recruiter-agent.js"),
      "utf8"
    );
    assert.match(src, /decideRecruitment/);
    const d = decideRecruitment({
      installed: [],
      candidates: [],
      storage: { usage: 0, quota: 0 },
      aggression: 3,
    });
    assert.equal(d.action, "none");
  });
});
