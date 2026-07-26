/**
 * Capability snapshot + handoff — drives shipped pure modules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCapabilitySnapshot,
  applyCapabilityNeed,
  capabilityInsufficient,
  CONTEXT_HANDOFF_FRACTION,
} from "../public/js/task/capability.js";
import {
  packHandoff,
  receiveHandoff,
  shouldHandoff,
} from "../public/js/task/handoff.js";

function model(qualityClass, windowTokens) {
  return {
    id: `m-${qualityClass}`,
    capabilities: {
      qualityClass,
      contextWindowTokens: windowTokens,
    },
  };
}

describe("buildCapabilitySnapshot", () => {
  it("records model quality and context budget", () => {
    const snap = buildCapabilitySnapshot({
      agentId: "crew-agent",
      model: model("tiny", 100),
      system: "sys",
      messages: [{ content: "hello world" }],
      tokensUsed: 20,
    });
    assert.equal(snap.agentId, "crew-agent");
    assert.equal(snap.modelId, "m-tiny");
    assert.equal(snap.qualityClass, "tiny");
    assert.equal(snap.contextWindowTokens, 100);
    assert.equal(snap.tokensUsed, 20);
    assert.equal(snap.tokensRemaining, 80);
    assert.equal(snap.needsHandoff, false);
    assert.equal(snap.canContinue, true);
  });

  it("needs handoff when context fraction >= threshold", () => {
    const window = 100;
    const used = Math.ceil(window * CONTEXT_HANDOFF_FRACTION);
    const snap = buildCapabilitySnapshot({
      model: model("small", window),
      tokensUsed: used,
    });
    assert.ok(snap.contextFraction >= CONTEXT_HANDOFF_FRACTION);
    assert.equal(snap.needsHandoff, true);
    assert.equal(snap.canContinue, false);
    assert.equal(snap.handoffReason, "context");
    assert.equal(shouldHandoff(snap), true);
  });

  it("capabilityInsufficient compares quality classes", () => {
    assert.equal(capabilityInsufficient("tiny", "medium"), true);
    assert.equal(capabilityInsufficient("large", "small"), false);
  });

  it("applyCapabilityNeed forces handoff when too weak", () => {
    const snap = buildCapabilitySnapshot({
      model: model("tiny", 10_000),
      tokensUsed: 10,
    });
    const next = applyCapabilityNeed(snap, "medium");
    assert.equal(next.needsHandoff, true);
    assert.equal(next.handoffReason, "capability");
  });
});

describe("packHandoff / receiveHandoff", () => {
  it("packs goal, done so far, remaining, constraints for successor", () => {
    const items = [
      { id: "a", title: "research", status: "done" },
      { id: "b", title: "write", status: "pending" },
      { id: "c", title: "review", status: "pending" },
    ];
    const snap = buildCapabilitySnapshot({
      agentId: "crew-agent",
      model: model("tiny", 100),
      tokensUsed: 90,
    });
    const h = packHandoff({
      goal: "Ship the doc",
      items,
      snapshot: snap,
      reason: "context",
      constraints: { maxSteps: 6, minQualityClass: "small", step: 2 },
    });
    assert.equal(h.schema, "pwa.handoff.v1");
    assert.equal(h.goal, "Ship the doc");
    assert.deepEqual(h.doneSoFar, ["research"]);
    assert.deepEqual(h.remaining, ["write", "review"]);
    assert.equal(h.from.modelId, "m-tiny");
    assert.equal(h.from.qualityClass, "tiny");
    assert.equal(h.reason, "context");
    assert.equal(h.constraints.maxSteps, 6);

    const recv = receiveHandoff(h, { maxSteps: 6 });
    assert.equal(recv.ok, true);
    assert.equal(recv.state.goal, "Ship the doc");
    assert.equal(recv.state.items.length, 2);
    assert.ok(recv.state.items.every((i) => i.status === "pending"));
    assert.deepEqual(recv.state.doneSoFar, ["research"]);
    assert.equal(recv.state.handoffs.length, 1);
  });

  it("low context path produces handoff payload via shouldHandoff", () => {
    const snap = buildCapabilitySnapshot({
      model: model("tiny", 50),
      tokensUsed: 49,
    });
    assert.equal(shouldHandoff(snap), true);
    const h = packHandoff({
      goal: "finish checklist",
      items: [
        { id: "1", title: "A", status: "done" },
        { id: "2", title: "B", status: "pending" },
      ],
      snapshot: snap,
    });
    assert.ok(h.remaining.includes("B"));
    assert.ok(!h.remaining.includes("A"));
    assert.equal(h.from.tokensUsed, 49);
  });
});
