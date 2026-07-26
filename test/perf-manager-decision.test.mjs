/**
 * Pure performance-manager decision helpers (shipped modules).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseOpportunities,
  mergeOpportunitySection,
  upsertFromActivity,
  decidePromotion,
  runPerformanceManagerLogic,
  promoteToInstructions,
  parseInstructions,
  THRESHOLDS,
  SECTION_OPP,
} from "../public/js/perf/opportunity.js";
import { buildActivityFromState } from "../public/js/perf/activity.js";

describe("performance opportunity logic", () => {
  it("empty history creates opportunities from activity", () => {
    const { opportunities, changed } = upsertFromActivity({
      existing: [],
      activity: [
        {
          id: "opp-chat-agent-smartness",
          agentId: "chat-agent",
          metric: "smartness",
          title: "Improve chat quality",
          score: 20,
        },
      ],
      now: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(changed, true);
    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0].status, "open");
    assert.equal(opportunities[0].attempts, 1);
  });

  it("enough history + improvement → ready_to_promote", () => {
    let existing = [];
    const scores = [10, 12, 14, 20];
    for (let i = 0; i < scores.length; i++) {
      const r = upsertFromActivity({
        existing,
        activity: [
          {
            id: "opp-x",
            agentId: "chat-agent",
            metric: "smartness",
            title: "Improve chat quality",
            score: scores[i],
          },
        ],
        now: `2026-01-0${i + 1}T00:00:00.000Z`,
      });
      existing = r.opportunities;
    }
    const o = existing.find((x) => x.id === "opp-x");
    assert.ok(o.attempts >= THRESHOLDS.minSamplesForPromote);
    assert.equal(o.status, "ready_to_promote");
    const promo = decidePromotion({ opportunities: existing });
    assert.ok(promo.promote);
    assert.equal(promo.promote.opportunity.id, "opp-x");
  });

  it("insufficient evidence → no promotion", () => {
    const { opportunities } = upsertFromActivity({
      existing: [],
      activity: [
        { id: "opp-y", agentId: "router-agent", metric: "reliability", score: 50 },
        { id: "opp-y", agentId: "router-agent", metric: "reliability", score: 55 },
      ],
    });
    // only last activity wins in one call - need multi-sample in one object
    const multi = upsertFromActivity({
      existing: [],
      activity: [{ id: "opp-y", agentId: "router-agent", metric: "r", score: 50 }],
    });
    let opps = multi.opportunities;
    opps = upsertFromActivity({
      existing: opps,
      activity: [{ id: "opp-y", agentId: "router-agent", metric: "r", score: 52 }],
    }).opportunities;
    const promo = decidePromotion({ opportunities: opps });
    assert.equal(promo.promote, null);
  });

  it("mergeOpportunitySection writes Areas of opportunity", () => {
    const { opportunities } = upsertFromActivity({
      existing: [],
      activity: [
        { id: "opp-a", agentId: "chat-agent", metric: "m", title: "T", score: 1 },
      ],
    });
    const md = mergeOpportunitySection("# Memory\n\n", opportunities);
    assert.match(md, new RegExp(SECTION_OPP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(md, /opp-a/);
    const parsed = parseOpportunities(md);
    assert.equal(parsed.length, 1);
  });

  it("runPerformanceManagerLogic promotes notify flag only when ready", () => {
    let content = "# Memory\n\n";
    let logic;
    for (const score of [10, 15, 20, 30]) {
      logic = runPerformanceManagerLogic({
        memoryContent: content,
        activity: [
          {
            id: "opp-z",
            agentId: "memory-agent",
            metric: "reliability",
            title: "Reduce memory-agent run errors",
            score,
          },
        ],
      });
      content = logic.memoryContent;
    }
    assert.equal(logic.shouldNotify, true);
    assert.ok(logic.promotion.promote);
  });

  it("promoteToInstructions adds standing instructions", () => {
    const md = promoteToInstructions("# Memory\n\n", {
      agentId: "chat-agent",
      instruction: "Improve chat quality",
    });
    const map = parseInstructions(md);
    assert.ok(map["chat-agent"].includes("Improve chat quality"));
  });

  it("buildActivityFromState yields samples", () => {
    const act = buildActivityFromState({
      models: [
        {
          id: "m",
          status: "ready",
          metrics: { smartness: 40 },
        },
      ],
      runRoots: [
        {
          agentId: "recruiter",
          status: "ok",
          children: [{ agentId: "recruiter", status: "error", children: [] }],
        },
      ],
    });
    assert.ok(act.some((a) => a.agentId === "chat-agent"));
  });

  it("merge→parse→merge preserves fields when evidence is empty", () => {
    // Multi-refresh with activity that has no note (empty evidence)
    let content = "# Memory\n\n";
    for (const score of [10, 12, 14]) {
      const logic = runPerformanceManagerLogic({
        memoryContent: content,
        activity: [
          {
            id: "opp-empty-ev",
            agentId: "chat-agent",
            metric: "smartness",
            title: "Improve chat quality",
            score,
            // no note → empty evidence
          },
        ],
        now: `2026-02-0${score}T00:00:00.000Z`,
      });
      content = logic.memoryContent;
    }
    const once = parseOpportunities(content);
    assert.equal(once.length, 1);
    assert.equal(once[0].id, "opp-empty-ev");
    assert.equal(once[0].attempts, 3);
    // empty evidence must not swallow createdAt/updatedAt
    assert.ok(once[0].createdAt && once[0].createdAt !== "-");
    assert.ok(once[0].updatedAt && once[0].updatedAt !== "-");
    assert.notEqual(once[0].evidence, once[0].createdAt);
    assert.ok(!String(once[0].evidence).includes("createdAt"));

    const again = mergeOpportunitySection("# Memory\n\n", once);
    const twice = parseOpportunities(again);
    assert.equal(twice.length, 1);
    assert.equal(twice[0].id, once[0].id);
    assert.equal(twice[0].agentId, once[0].agentId);
    assert.equal(twice[0].title, once[0].title);
    assert.equal(twice[0].status, once[0].status);
    assert.equal(twice[0].attempts, once[0].attempts);
    assert.equal(twice[0].baseline, once[0].baseline);
    assert.equal(twice[0].lastScore, once[0].lastScore);
    assert.deepEqual(twice[0].scores, once[0].scores);
    assert.equal(twice[0].createdAt, once[0].createdAt);
    assert.equal(twice[0].updatedAt, once[0].updatedAt);
  });
});
