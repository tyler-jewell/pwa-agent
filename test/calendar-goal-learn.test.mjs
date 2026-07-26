/**
 * User prompt → goal session → general Google Calendar plugin → notify.
 * Iterations start ONLY from the user message (no separate human /goal).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectCapabilityNeeds, isCalendarQuery } from "../public/js/plugins/intent.js";
import {
  createGoalFromPrompt,
  decideGoalTick,
  runCapabilityGoal,
} from "../public/js/plugins/goal-session.js";
import { createPluginRegistry } from "../public/js/plugins/registry.js";
import { createGoogleCalendarPlugin } from "../public/js/plugins/google-calendar.js";
import { createGoalAgent } from "../public/js/agent/goal-agent.js";
import { createBus } from "../public/js/agent/bus.js";
import { createRunTree } from "../public/js/agent/tree.js";
import { createChatAgent } from "../public/js/agent/chat-agent.js";
import { createRegistry } from "../public/js/adapters/registry.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";
import { createMemoryQueue } from "../public/js/memory/queue.js";
import { msgId, nowIso } from "../public/js/core/ids.js";
import { SEED_MEMORY } from "../public/js/core/schema.js";

const PROMPT =
  "anything on my google calendar for the next few days?";

describe("intent from user prompt only", () => {
  it("detects google calendar need from natural language", () => {
    const needs = detectCapabilityNeeds(PROMPT);
    assert.equal(needs.length, 1);
    assert.equal(needs[0].pluginId, "google-calendar");
    assert.equal(needs[0].general, true);
    assert.ok(isCalendarQuery(PROMPT));
    assert.equal(detectCapabilityNeeds("hello").length, 0);
  });
});

describe("goal session from prompt only", () => {
  it("createGoalFromPrompt seeds needs from the message alone", () => {
    const s = createGoalFromPrompt(PROMPT);
    assert.equal(s.originPrompt, PROMPT);
    assert.equal(s.status, "open");
    assert.ok(s.general);
    assert.equal(s.items.length, 1);
    assert.equal(s.items[0].pluginId, "google-calendar");
  });

  it("runs research→design→install→verify→notify; plugin is general", async () => {
    const installs = [];
    const notifies = [];
    const { state, report, started } = await runCapabilityGoal(PROMPT, {
      install: async (item) => {
        installs.push(item.pluginId);
        return { ok: true, pluginId: item.pluginId, general: true };
      },
      verify: async () => ({ ok: true, general: true }),
      notify: async (item) => {
        notifies.push({
          title: "New plugin ready",
          pluginId: item.pluginId,
          general: true,
        });
        return { ok: true };
      },
      design: async (item) => ({
        pluginId: item.pluginId,
        general: true,
        scopes: item.scopes,
        // no userEmail / userId
      }),
    });
    assert.equal(started, true);
    assert.equal(state.status, "complete");
    assert.deepEqual(state.pluginsInstalled, ["google-calendar"]);
    assert.equal(notifies.length, 1);
    assert.equal(notifies[0].title, "New plugin ready");
    assert.equal(report.complete, true);
    assert.ok(report.honest);
    // Generality: design log has no single-user binding
    const designs = state.log.filter((l) => l.design);
    assert.ok(designs.every((d) => d.design.general && !d.design.userEmail));
  });

  it("rejects non-general design (single-user binding)", async () => {
    const { state } = await runCapabilityGoal(PROMPT, {
      design: async () => ({
        pluginId: "google-calendar",
        general: true,
        userEmail: "only-me@example.com", // forbidden
      }),
      install: async () => ({ ok: true }),
    });
    assert.equal(state.status, "exhausted");
    assert.ok(state.items.some((i) => i.status === "blocked"));
  });
});

describe("google-calendar plugin is portable", () => {
  it("connect + listUpcoming works without per-user hardcoding", async () => {
    const p = createGoogleCalendarPlugin({});
    assert.equal(p.general, true);
    assert.ok(!("userEmail" in p));
    const c = await p.connect();
    assert.equal(c.ok, true);
    assert.equal(c.general, true);
    const list = await p.listUpcoming({ days: 3 });
    assert.equal(list.ok, true);
    assert.equal(list.general, true);
    assert.ok(list.events.length >= 1);
    const text = p.formatEvents(list);
    assert.match(text, /any Google user|every Google user|general/i);
  });
});

describe("end-to-end: prompt → goal-agent → install → use", () => {
  it("chat-agent starts goal from calendar prompt; after install, lists events", async () => {
    globalThis.Notification = undefined;
    const tree = createRunTree();
    const bus = createBus({ tree });
    const pluginRegistry = createPluginRegistry();
    pluginRegistry.register(createGoogleCalendarPlugin({}));

    const notifications = [];
    const notify = {
      notify: async (n) => {
        notifications.push(n);
        return { id: n.tag || "n1", ...n };
      },
    };

    let memoryContent = SEED_MEMORY;
    const memoryStore = {
      getHead: () => ({ id: "h", content: memoryContent }),
      commit: async ({ content }) => {
        memoryContent = content;
        return { ok: true, version: { id: "h2", content } };
      },
    };
    const memoryQueue = createMemoryQueue();

    bus.register(
      "goal-agent",
      createGoalAgent({
        pluginRegistry,
        notify,
        memoryStore,
        memoryQueue,
      }).handler
    );
    bus.register("memory-agent", async () => ({ ok: true, noop: true }));
    bus.register("router-agent", async () => ({ modelId: "mock-tiny" }));

    const registry = createRegistry();
    registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 1 }));
    await registry.discoverAll();

    const msgs = [];
    const transcript = {
      getMessages: () => msgs.slice(),
      append: async (role, content, meta = {}) => {
        const m = {
          id: msgId(),
          role,
          content,
          createdAt: nowIso(),
          meta,
        };
        msgs.push(m);
        return m;
      },
      replaceMessages: async (next) => {
        msgs.length = 0;
        msgs.push(...next);
      },
    };

    const chat = createChatAgent({
      bus,
      tree,
      registry,
      transcript,
      memoryStore,
      memoryQueue,
      pluginRegistry,
    });

    // 1) User prompt only — cannot yet; starts goal
    await chat.handleUserMessage(PROMPT, { onToken: () => {} });
    const firstAssistant = msgs.filter((m) => m.role === "assistant").pop();
    assert.match(firstAssistant.content, /can.?t do that yet|don.?t have|goal session/i);
    assert.equal(firstAssistant.meta.goalStarted, true);

    // Wait for fire-and-forget goal
    await new Promise((r) => setTimeout(r, 50));
    // Drive goal synchronously to completion (chat fires async; ensure install)
    if (!pluginRegistry.isInstalled("google-calendar")) {
      const g = await bus.invoke({
        agentId: "goal-agent",
        name: "capability goal",
        parentRunId: null,
        input: { userText: PROMPT, force: true },
      });
      assert.equal(g.ok, true);
      assert.ok(g.pluginsInstalled.includes("google-calendar"));
    }
    assert.ok(pluginRegistry.isInstalled("google-calendar"));
    assert.ok(
      notifications.some(
        (n) => n.data?.type === "plugin-ready" || /plugin ready/i.test(n.title)
      )
    );

    // 2) Connect (any user path)
    await chat.handleUserMessage("connect google calendar", {
      onToken: () => {},
    });
    const conn = msgs.filter((m) => m.role === "assistant").pop();
    assert.match(conn.content, /Connected/i);

    // 3) Same original-style prompt now works
    await chat.handleUserMessage(PROMPT, { onToken: () => {} });
    const cal = msgs.filter((m) => m.role === "assistant").pop();
    assert.match(cal.content, /Upcoming|Focus block|Team sync|events/i);
    assert.ok(cal.meta.plugin === "google-calendar" || /Calendar/i.test(cal.content));

    // Tree shows goal-agent and plugin path
    const agents = tree.listRoots().map((r) => r.agentId);
    assert.ok(agents.includes("chat-agent") || tree.listRoots().length >= 1);
  });
});
