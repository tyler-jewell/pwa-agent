/**
 * Boot registration for performance-manager.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRunTreeEvent } from "../public/js/core/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("performance-manager registration", () => {
  it("main.js registers and boots performance-manager", () => {
    const main = readFileSync(join(root, "public/js/main.js"), "utf8");
    assert.match(main, /bus\.register\("performance-manager"/);
    assert.match(main, /startPerformanceManagerOnBoot/);
    assert.match(main, /wirePerfPromotionApproval/);
    assert.match(main, /createPerformanceManager/);
  });

  it("schema allows performance-manager agentId", () => {
    const err = validateRunTreeEvent({
      runId: "r1",
      parentRunId: null,
      agentId: "performance-manager",
      name: "review",
      status: "started",
      ts: new Date().toISOString(),
      detail: {},
    });
    assert.equal(err, null);
  });

  it("perf-boot invokes bus agent performance-manager", () => {
    const boot = readFileSync(
      join(root, "public/js/agent/perf-boot.js"),
      "utf8"
    );
    assert.match(boot, /agentId:\s*"performance-manager"/);
  });
});
