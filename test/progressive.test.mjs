/**
 * Progressive model ladder — PWA shell → network → offline metaphor.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeProgressStage,
  progressiveLoadOrder,
  formatProgressRuntime,
  qualityRank,
} from "../public/js/router/progress.js";
import { rankModels } from "../public/js/router/rank.js";
import { createRegistry } from "../public/js/adapters/registry.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";

function m(id, qualityClass, status, { offlineReady = false } = {}) {
  return {
    id,
    label: id,
    status,
    source: "discovered",
    backendId: "mock",
    capabilities: {
      qualityClass,
      contextWindowTokens: 2048,
      supportsStreaming: true,
      modalities: ["text"],
    },
    constraints: {
      approxBytes: 1e6,
      requiresWebGpu: false,
      minRamHintMb: 64,
      offlineReady,
    },
    metrics: { latencyP50Ms: null, failCount: 0, successCount: 0 },
  };
}

describe("computeProgressStage", () => {
  it("shell when nothing ready", () => {
    const s = computeProgressStage([], { online: true });
    assert.equal(s.stageId, "shell");
  });

  it("instant when only tiny ready", () => {
    const s = computeProgressStage([m("t", "tiny", "ready", { offlineReady: true })], {
      online: false,
    });
    assert.equal(s.stageId, "instant");
  });

  it("enhancing when tiny ready and larger announced online", () => {
    const s = computeProgressStage(
      [m("t", "tiny", "ready", { offlineReady: true }), m("s", "small", "announced")],
      { online: true }
    );
    assert.equal(s.stageId, "enhancing");
  });

  it("enhancing while downloading", () => {
    const s = computeProgressStage(
      [m("t", "tiny", "ready"), m("s", "small", "downloading")],
      { online: true }
    );
    assert.equal(s.stageId, "enhancing");
  });

  it("capable when larger ready but not offline-marked", () => {
    // ready larger without offlineReady still counts as capable if we don't mark offline
    const large = m("s", "small", "ready", { offlineReady: false });
    const s = computeProgressStage(
      [m("t", "tiny", "ready", { offlineReady: true }), large],
      { online: true }
    );
    assert.equal(s.stageId, "capable");
  });

  it("offline when larger model is offline-ready", () => {
    const s = computeProgressStage(
      [
        m("t", "tiny", "ready", { offlineReady: true }),
        m("s", "small", "ready", { offlineReady: true }),
      ],
      { online: false }
    );
    assert.equal(s.stageId, "offline");
  });
});

describe("progressiveLoadOrder", () => {
  it("orders by quality ascending (small before medium)", () => {
    const order = progressiveLoadOrder([
      m("med", "medium", "announced"),
      m("sm", "small", "announced"),
      m("t", "tiny", "ready"),
    ]);
    assert.deepEqual(
      order.map((x) => x.id),
      ["sm", "med"]
    );
  });
});

describe("rankModels offline preference", () => {
  it("prefers offlineReady when device is offline", () => {
    const ready = [
      m("net", "medium", "ready", { offlineReady: false }),
      m("loc", "small", "ready", { offlineReady: true }),
    ];
    const ranked = rankModels(ready, { online: false, webgpu: false }, "medium");
    assert.equal(ranked[0].id, "loc");
  });

  it("prefers higher quality when online", () => {
    const ready = [
      m("t", "tiny", "ready", { offlineReady: true }),
      m("med", "medium", "ready", { offlineReady: true }),
    ];
    const ranked = rankModels(ready, { online: true, webgpu: true }, "high");
    assert.equal(ranked[0].id, "med");
  });
});

describe("mock progressive ladder", () => {
  it("discovers tiny ready + small/medium announced; large is candidate", async () => {
    const adapter = createMockAdapter({ progressiveDelayMs: 5 });
    const found = await adapter.discover();
    assert.ok(found.find((x) => x.id === "mock-tiny" && x.status === "ready"));
    assert.ok(found.find((x) => x.id === "mock-small"));
    assert.ok(found.find((x) => x.id === "mock-medium"));
    const cands = await adapter.discoverCandidates();
    assert.ok(cands.find((x) => x.id === "mock-large"));
    assert.ok(qualityRank(found.find((x) => x.id === "mock-medium")) > 0);
  });

  it("startProgressive loads small then medium sequentially offline-ready", async () => {
    const adapter = createMockAdapter({ progressiveDelayMs: 15 });
    const statuses = [];
    adapter.startProgressive((id, status) => statuses.push({ id, status }), {
      online: true,
    });
    // Wait for sequential loads
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(statuses.some((s) => s.id === "mock-small" && s.status === "ready"));
    assert.ok(statuses.some((s) => s.id === "mock-medium" && s.status === "ready"));
    // large not auto-loaded
    assert.ok(!statuses.some((s) => s.id === "mock-large"));
  });

  it("startProgressive skips when offline", async () => {
    const adapter = createMockAdapter({ progressiveDelayMs: 5 });
    const statuses = [];
    adapter.startProgressive((id, status) => statuses.push({ id, status }), {
      online: false,
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(statuses.length, 0);
  });

  it("registry progressSnapshot reflects ladder", async () => {
    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 10 }));
    await registry.discoverAll();
    const early = registry.progressSnapshot();
    assert.ok(["instant", "enhancing"].includes(early.stageId));
    registry.startProgressiveLoads();
    await new Promise((r) => setTimeout(r, 80));
    const late = registry.progressSnapshot();
    assert.ok(["capable", "offline", "enhancing"].includes(late.stageId));
    const rt = formatProgressRuntime(late);
    assert.ok(rt.text.length > 0);
  });
});
