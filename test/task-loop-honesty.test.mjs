/**
 * Bounded loop + honest report — drives shipped runTaskLoop / buildHonestReport.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTaskState,
  decideTick,
  runTaskLoop,
  applyActResult,
  markExhausted,
  DEFAULT_MAX_STEPS,
} from "../public/js/task/loop.js";
import { buildHonestReport, formatReportForChat } from "../public/js/task/report.js";
import { buildCapabilitySnapshot } from "../public/js/task/capability.js";
import { packHandoff } from "../public/js/task/handoff.js";

describe("decideTick", () => {
  it("acts on next pending when capacity ok", () => {
    const state = createTaskState({
      goal: "one; two",
      maxSteps: 5,
    });
    const snap = buildCapabilitySnapshot({
      model: {
        id: "m1",
        capabilities: { qualityClass: "small", contextWindowTokens: 8000 },
      },
      tokensUsed: 10,
    });
    const d = decideTick(state, snap);
    assert.equal(d.action, "act");
    assert.equal(d.item.title, "one");
  });

  it("hands off when context is exhausted", () => {
    const state = createTaskState({ goal: "a; b", maxSteps: 5 });
    const snap = buildCapabilitySnapshot({
      model: {
        id: "m1",
        capabilities: { qualityClass: "tiny", contextWindowTokens: 100 },
      },
      tokensUsed: 90,
    });
    const d = decideTick(state, snap);
    assert.equal(d.action, "handoff");
    assert.ok(d.handoff);
    assert.equal(d.handoff.schema, "pwa.handoff.v1");
    assert.ok(d.handoff.remaining.length >= 1);
  });

  it("exhausts when max steps reached with work left", () => {
    let state = createTaskState({ goal: "a; b; c", maxSteps: 1 });
    state = applyActResult(state, "item_1", { ok: true });
    // step is 1, maxSteps 1 → next tick exhausts
    const d = decideTick(state, {
      needsHandoff: false,
      modelId: "m",
      qualityClass: "small",
    });
    assert.equal(d.action, "exhaust");
  });
});

describe("runTaskLoop honest paths", () => {
  it("(a) completes within budget → report marks achieved", async () => {
    const state = createTaskState({
      goal: "alpha; beta",
      maxSteps: 6,
    });
    const { report, state: final } = await runTaskLoop({
      state,
      getSnapshot: async () =>
        buildCapabilitySnapshot({
          model: {
            id: "mock-small",
            capabilities: { qualityClass: "small", contextWindowTokens: 8000 },
          },
          tokensUsed: 5,
        }),
      act: async (item) => ({ ok: true, note: `did ${item.title}` }),
    });
    assert.equal(final.status, "complete");
    assert.equal(report.status, "complete");
    assert.equal(report.complete, true);
    assert.equal(report.honest, true);
    assert.equal(report.achieved.length, 2);
    assert.equal(report.notAchieved.length, 0);
    assert.ok(report.achieved.some((a) => a.title === "alpha"));
    assert.ok(report.achieved.some((a) => a.title === "beta"));
    assert.match(report.summary, /Outcome: complete/);
    assert.match(formatReportForChat(report), /Achieved \(2\)/);
  });

  it("(b) budget/steps exhausted mid-task → incomplete with remaining", async () => {
    const state = createTaskState({
      goal: "one; two; three; four",
      maxSteps: 2,
    });
    const { report, state: final } = await runTaskLoop({
      state,
      getSnapshot: async () =>
        buildCapabilitySnapshot({
          model: {
            id: "mock-tiny",
            capabilities: { qualityClass: "tiny", contextWindowTokens: 8000 },
          },
          tokensUsed: 1,
        }),
      act: async (item) => ({ ok: true, note: item.title }),
    });
    assert.equal(final.status, "exhausted");
    assert.equal(report.status, "exhausted");
    assert.equal(report.complete, false);
    assert.equal(report.honest, true);
    assert.equal(report.achieved.length, 2);
    assert.equal(report.notAchieved.length, 2);
    assert.ok(report.notAchieved.every((n) => n.why));
    assert.match(report.summary, /Not achieved \(2\)/);
    assert.match(report.summary, /budget exhausted|pending/i);
  });

  it("context handoff then stop without successor → not silent ok", async () => {
    let calls = 0;
    const state = createTaskState({ goal: "x; y", maxSteps: 8 });
    const { report } = await runTaskLoop({
      state,
      getSnapshot: async () => {
        calls += 1;
        // Always over context → force handoff path
        return buildCapabilitySnapshot({
          model: {
            id: "tiny",
            capabilities: { qualityClass: "tiny", contextWindowTokens: 40 },
          },
          tokensUsed: 39,
        });
      },
      act: async () => ({ ok: true }),
      onHandoff: async () => null, // no successor
      continueAfterHandoff: true,
    });
    assert.ok(calls >= 1);
    assert.equal(report.complete, false);
    assert.ok(report.notAchieved.length >= 1);
    assert.ok(
      report.status === "stopped" ||
        report.status === "incomplete" ||
        report.status === "exhausted"
    );
    assert.notEqual(report.status, "complete");
  });

  it("buildHonestReport never claims complete with pending items", () => {
    const state = markExhausted(
      createTaskState({ goal: "left; right", maxSteps: 1 })
    );
    // leave both pending
    const report = buildHonestReport(state);
    assert.equal(report.complete, false);
    assert.notEqual(report.status, "complete");
    assert.equal(report.notAchieved.length, 2);
  });
});

describe("packHandoff used by loop decision", () => {
  it("decideTick handoff remaining matches packHandoff", () => {
    const state = createTaskState({ goal: "a; b; c", maxSteps: 5 });
    state.items[0].status = "done";
    state.doneSoFar = ["a"];
    const snap = buildCapabilitySnapshot({
      model: {
        id: "m",
        capabilities: { qualityClass: "tiny", contextWindowTokens: 50 },
      },
      tokensUsed: 48,
    });
    const d = decideTick(state, snap);
    assert.equal(d.action, "handoff");
    const manual = packHandoff({
      goal: state.goal,
      items: state.items,
      snapshot: snap,
    });
    assert.deepEqual(d.handoff.remaining, manual.remaining);
    assert.deepEqual(d.handoff.doneSoFar, manual.doneSoFar);
  });
});

describe("defaults", () => {
  it("DEFAULT_MAX_STEPS is finite and positive", () => {
    assert.ok(DEFAULT_MAX_STEPS > 0);
    assert.ok(DEFAULT_MAX_STEPS < 1000);
  });
});
