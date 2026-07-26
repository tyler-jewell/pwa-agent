/**
 * Recruiter decision — drives shipped decideRecruitment.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideRecruitment, clampAggression } from "../public/js/recruit/decide.js";

function model(id, qualityClass, status, bytes) {
  return {
    id,
    label: id,
    status,
    capabilities: {
      qualityClass,
      supportsStreaming: true,
      contextWindowTokens: qualityClass === "medium" ? 8192 : 2048,
      modalities: ["text"],
    },
    constraints: {
      approxBytes: bytes,
      minRamHintMb: 64,
      offlineReady: status === "ready",
      requiresWebGpu: false,
    },
    metrics: {},
  };
}

describe("decideRecruitment", () => {
  it("recommends add when free space and value-add candidate", () => {
    const d = decideRecruitment({
      installed: [model("tiny", "tiny", "ready", 1e6)],
      candidates: [model("med", "medium", "announced", 5e6)],
      storage: { usage: 10e6, quota: 100e6 },
      aggression: 3,
    });
    assert.equal(d.action, "add");
    assert.equal(d.candidate.id, "med");
    assert.equal(d.replaceId, null);
  });

  it("recommends replace when tight space and aggression high enough", () => {
    const d = decideRecruitment({
      installed: [
        model("tiny", "tiny", "ready", 20e6),
        model("small", "small", "ready", 10e6),
      ],
      candidates: [model("med", "medium", "announced", 25e6)],
      storage: { usage: 95e6, quota: 100e6 },
      aggression: 4,
    });
    assert.equal(d.action, "replace");
    assert.equal(d.candidate.id, "med");
    assert.ok(d.replaceId === "tiny" || d.replaceId === "small");
  });

  it("returns none when no value-add", () => {
    const d = decideRecruitment({
      installed: [model("med", "medium", "ready", 5e6)],
      candidates: [model("tiny2", "tiny", "announced", 1e6)],
      storage: { usage: 1e6, quota: 100e6 },
      aggression: 3,
    });
    assert.equal(d.action, "none");
  });

  it("aggression changes outcomes under tight space", () => {
    const base = {
      installed: [model("tiny", "tiny", "ready", 40e6)],
      candidates: [model("med", "medium", "announced", 30e6)],
      storage: { usage: 90e6, quota: 100e6 },
    };
    const low = decideRecruitment({ ...base, aggression: 1 });
    const high = decideRecruitment({ ...base, aggression: 5 });
    assert.equal(low.action, "none");
    assert.ok(high.action === "replace" || high.action === "add");
  });

  it("clampAggression bounds 1..5", () => {
    assert.equal(clampAggression(0), 1);
    assert.equal(clampAggression(9), 5);
    assert.equal(clampAggression(2.6), 3);
  });
});
