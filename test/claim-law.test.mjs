/**
 * Claim–code honesty: every day-one goal + key FP either has shipped proof
 * (test file or module) or an explicit later/non-goal mark in product law.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function testNames() {
  return readdirSync(join(root, "test")).filter((f) => f.endsWith(".test.mjs"));
}

describe("claim–code honesty (day-one + continuous deploy)", () => {
  const readme = read("README.md");
  const tests = testNames().join(" ");

  it("day-one goals still named in README lead", () => {
    const lead = readme.slice(0, 4000);
    assert.match(lead, /[Pp]rogressively load models/);
    assert.match(lead, /MEMORY|Self-improve core memory/i);
    assert.match(lead, /Create other agents/i);
    assert.match(lead, /transparent|main agent feed/i);
    assert.match(lead, /Army of small smart people/i);
    assert.match(lead, /handoff/i);
    assert.match(lead, /honest report/i);
  });

  it("FP13–16 and continuous deploy principles present", () => {
    assert.match(readme, /\*\*FP13\*\*/);
    assert.match(readme, /\*\*FP14\*\*/);
    assert.match(readme, /\*\*FP15\*\*/);
    assert.match(readme, /\*\*FP16\*\*/);
    assert.match(readme, /\*\*FP11\*\*/);
    assert.match(readme, /\*\*FP12\*\*/);
    assert.match(readme, /Continuous .to infinity|continuous deploy|bounded/i);
  });

  it("full mesh / unbounded paths explicitly later or non-goal", () => {
    assert.match(readme, /Full any-agent|mesh shipped|later/i);
    assert.match(readme, /Not unbounded AGI|bounded/);
  });

  it("each day-one claim has a corresponding test suite file", () => {
    const required = [
      ["progressive", "progressive models"],
      ["perf-manager", "MEMORY self-improve / performance"],
      ["crew-agent", "multi-agent / crew"],
      ["task-loop", "loop honesty"],
      ["handoff", "capability handoff"],
      ["deploy-surface", "vercel continuous deploy"],
      ["self-improve", "autonomous self-improve cycle"],
      ["modularity-production", "core purity + adapter port + improve cycles"],
      ["brand", "product identity"],
    ];
    for (const [part, label] of required) {
      assert.ok(
        tests.includes(part),
        `missing test coverage for ${label} (expect *${part}*.test.mjs among ${tests})`
      );
    }
  });

  it("shipped modules exist for progressive, task, live, quality", () => {
    const paths = [
      "public/js/router/progress.js",
      "public/js/task/loop.js",
      "public/js/task/handoff.js",
      "public/js/task/report.js",
      "public/js/task/capability.js",
      "public/js/live/poll.js",
      "public/js/live/soft-reset.js",
      "public/js/quality/gate.js",
      "public/js/agent/crew-agent.js",
      "public/js/agent/performance-manager.js",
      "public/version.json",
      "vercel.json",
    ];
    for (const p of paths) {
      assert.ok(existsSync(join(root, p)), `missing ${p}`);
    }
  });

  it("quality gate entry is wired for in-browser pre-commit", () => {
    const main = read("public/js/main.js");
    const gate = read("public/js/quality/gate.js");
    assert.match(main, /runQualityGate/);
    assert.match(gate, /export async function runQualityGate/);
    assert.match(read("public/js/ui/boot-actions.js"), /runQualityGate/);
  });
});
