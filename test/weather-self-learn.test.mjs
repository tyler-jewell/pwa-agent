/**
 * Zero-human-intervention self-learn: weather prompt → goal → plugin → answer.
 * Drives shipped intent, goal-agent, weather plugin, chat-agent.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectCapabilityNeeds,
  extractPlace,
  isWeatherQuery,
} from "../public/js/plugins/intent.js";
import { createWeatherPlugin } from "../public/js/plugins/weather.js";
import { createPluginRegistry } from "../public/js/plugins/registry.js";
import { createGoalAgent } from "../public/js/agent/goal-agent.js";
import { createBus } from "../public/js/agent/bus.js";
import { createRunTree } from "../public/js/agent/tree.js";
import { createChatAgent } from "../public/js/agent/chat-agent.js";
import { createRegistry } from "../public/js/adapters/registry.js";
import { createMockAdapter } from "../public/js/adapters/mock.js";
import { createMemoryQueue } from "../public/js/memory/queue.js";
import { msgId, nowIso } from "../public/js/core/ids.js";
import { SEED_MEMORY } from "../public/js/core/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT = "what's the weather in Paris today?";

function mockFetchWeather() {
  return async (url) => {
    const u = String(url);
    if (u.includes("geocoding-api.open-meteo.com")) {
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              name: u.includes("Tokyo") ? "Tokyo" : "Paris",
              country: u.includes("Tokyo") ? "Japan" : "France",
              latitude: u.includes("Tokyo") ? 35.68 : 48.85,
              longitude: u.includes("Tokyo") ? 139.69 : 2.35,
            },
          ],
        }),
      };
    }
    if (u.includes("api.open-meteo.com")) {
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: u.includes("35.68") ? 22.5 : 18.2,
            weather_code: 1,
            wind_speed_10m: 12,
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function harness(fetchImpl) {
  globalThis.Notification = undefined;
  const tree = createRunTree();
  const bus = createBus({ tree });
  const pluginRegistry = createPluginRegistry();
  pluginRegistry.register(createWeatherPlugin({ fetchImpl }));
  pluginRegistry.register(
    // catalog entry only for calendar; weather is the focus
    { id: "google-calendar", general: true, requiresAuth: true, title: "cal" }
  );

  const notifications = [];
  const notify = {
    notify: async (n) => {
      notifications.push(n);
      return { id: n.tag || "n", ...n };
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

  const msgs = [];
  const transcript = {
    getMessages: () => msgs.slice(),
    append: async (role, content, meta = {}) => {
      const m = { id: msgId(), role, content, createdAt: nowIso(), meta };
      msgs.push(m);
      return m;
    },
    replaceMessages: async () => {},
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

  return {
    chat,
    bus,
    pluginRegistry,
    notifications,
    msgs,
    memoryStore: () => memoryContent,
    tree,
    ready: () => registry.discoverAll(),
  };
}

describe("weather intent from user prompt only", () => {
  it("detects weather need; extractPlace is general", () => {
    assert.equal(isWeatherQuery(PROMPT), true);
    const needs = detectCapabilityNeeds(PROMPT);
    assert.ok(needs.some((n) => n.pluginId === "weather"));
    assert.equal(needs.find((n) => n.pluginId === "weather").requiresAuth, false);
    assert.equal(extractPlace(PROMPT), "Paris");
    assert.equal(extractPlace("weather in Tokyo"), "Tokyo");
    assert.equal(extractPlace("what is the weather in Berlin right now?"), "Berlin");
    assert.equal(extractPlace("what's the weather?"), "London");
  });
});

describe("weather plugin multi-place general", () => {
  it("forecast for two places without user binding", async () => {
    const p = createWeatherPlugin({ fetchImpl: mockFetchWeather() });
    assert.equal(p.general, true);
    assert.equal(p.requiresAuth, false);
    const a = await p.forecast({ place: "Paris" });
    assert.equal(a.ok, true);
    assert.equal(a.place, "Paris");
    assert.equal(a.temperatureC, 18.2);
    assert.ok(a.conditions);
    const b = await p.handleQuery("weather in Tokyo please");
    assert.equal(b.ok, true);
    assert.equal(b.place, "Tokyo");
    assert.equal(b.temperatureC, 22.5);
    const text = p.formatForecast(a);
    assert.match(text, /Paris/);
    assert.match(text, /18\.2/);
    assert.match(text, /any place|general/i);
  });
});

describe("prompt → goal → notify → answer (no human mid-loop)", () => {
  it("uninstalled weather: one user message learns and answers", async () => {
    const h = harness(mockFetchWeather());
    await h.ready();
    assert.equal(h.pluginRegistry.isInstalled("weather"), false);

    await h.chat.handleUserMessage(PROMPT, { onToken: () => {} });

    assert.ok(h.pluginRegistry.isInstalled("weather"));
    assert.ok(
      h.notifications.some(
        (n) =>
          n.data?.pluginId === "weather" && n.data?.type === "plugin-ready"
      )
    );
    const assistant = h.msgs.filter((m) => m.role === "assistant").pop();
    assert.match(assistant.content, /Paris/i);
    assert.match(assistant.content, /18\.2|Temperature|Conditions/i);
    assert.equal(assistant.meta.plugin, "weather");
    // goal ran under chat tree
    const flat = JSON.stringify(h.tree.listRoots());
    assert.match(flat, /goal-agent|capability goal|plugin weather/);
  });

  it("second place reuses same plugin without reinstall / new goal", async () => {
    const h = harness(mockFetchWeather());
    await h.ready();
    await h.chat.handleUserMessage(PROMPT, { onToken: () => {} });
    const notifiesAfterFirst = h.notifications.length;
    assert.ok(h.pluginRegistry.isInstalled("weather"));

    await h.chat.handleUserMessage("weather in Tokyo", { onToken: () => {} });
    const assistant = h.msgs.filter((m) => m.role === "assistant").pop();
    assert.match(assistant.content, /Tokyo/i);
    assert.match(assistant.content, /22\.5/);
    // no second plugin-ready required for new place
    assert.equal(
      h.notifications.filter((n) => n.data?.type === "plugin-ready").length,
      notifiesAfterFirst
    );
  });
});

describe("honest fail when learn cannot install", () => {
  it("install ok:false → chat surfaces Outcome exhausted, not background re-start lie", async () => {
    globalThis.Notification = undefined;
    const tree = createRunTree();
    const bus = createBus({ tree });
    const pluginRegistry = createPluginRegistry();
    // Catalog present but install always fails
    pluginRegistry.register(createWeatherPlugin({ fetchImpl: mockFetchWeather() }));
    const origInstall = pluginRegistry.install.bind(pluginRegistry);
    pluginRegistry.install = async () => ({ ok: false, error: "forced-install-fail" });

    const notifications = [];
    const notify = {
      notify: async (n) => {
        notifications.push(n);
        return { id: "n", ...n };
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
    bus.register(
      "goal-agent",
      createGoalAgent({
        pluginRegistry,
        notify,
        memoryStore,
        memoryQueue: createMemoryQueue(),
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
        msgs.push({ id: msgId(), role, content, createdAt: nowIso(), meta });
      },
      replaceMessages: async () => {},
    };
    const chat = createChatAgent({
      bus,
      tree,
      registry,
      transcript,
      memoryStore,
      memoryQueue: createMemoryQueue(),
      pluginRegistry,
    });

    await chat.handleUserMessage(PROMPT, { onToken: () => {} });
    const assistant = msgs.filter((m) => m.role === "assistant").pop();
    assert.ok(assistant, "assistant reply required");
    assert.match(assistant.content, /Outcome:\s*exhausted/i);
    assert.match(assistant.content, /Not achieved/i);
    assert.ok(!/Starting a background/i.test(assistant.content));
    assert.equal(assistant.meta.goalFailed, true);
    assert.equal(assistant.meta.complete, false);
    assert.equal(pluginRegistry.isInstalled("weather"), false);
    // No false plugin-ready notify on failed install
    assert.ok(
      !notifications.some((n) => n.data?.type === "plugin-ready"),
      "must not notify plugin-ready when install failed"
    );
    // goal-agent tree node should not be silent ok
    const flat = JSON.stringify(tree.listRoots());
    assert.match(flat, /"status":"error"|goalFailed|exhausted/i);
    // restore for cleanliness
    pluginRegistry.install = origInstall;
  });

  it("goal-agent returns ok:false when install fails (bus error status)", async () => {
    const pluginRegistry = createPluginRegistry();
    pluginRegistry.register(createWeatherPlugin({ fetchImpl: mockFetchWeather() }));
    pluginRegistry.install = async () => ({ ok: false, error: "nope" });
    const tree = createRunTree();
    const bus = createBus({ tree });
    bus.register(
      "goal-agent",
      createGoalAgent({
        pluginRegistry,
        notify: { notify: async () => ({ id: "x" }) },
        memoryStore: {
          getHead: () => ({ id: "h", content: SEED_MEMORY }),
          commit: async () => ({ ok: true }),
        },
        memoryQueue: createMemoryQueue(),
      }).handler
    );
    const r = await bus.invoke({
      agentId: "goal-agent",
      name: "capability goal",
      parentRunId: null,
      input: { userText: PROMPT, force: true },
    });
    assert.equal(r.ok, false);
    assert.equal(r.report.complete, false);
    assert.match(r.report.summary || r.error || "", /exhausted|Not achieved|incomplete/i);
    const roots = tree.listRoots();
    const goalNode = roots.find((n) => n.agentId === "goal-agent") || roots[0];
    assert.equal(goalNode.status, "error");
  });
});

describe("shared learn surface", () => {
  it("main registers weather + goal-agent; not calendar-only", () => {
    const main = readFileSync(join(root, "public/js/main.js"), "utf8");
    assert.match(main, /createWeatherPlugin/);
    assert.match(main, /goal-agent/);
    assert.match(main, /createGoogleCalendarPlugin/);
    const intent = readFileSync(join(root, "public/js/plugins/intent.js"), "utf8");
    assert.match(intent, /weather/);
    assert.match(intent, /google-calendar/);
  });
});
