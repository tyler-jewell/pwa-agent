/**
 * goal-agent — background (or awaited) capability goal from a single user prompt.
 * Research/learn/install general plugin → notify when ready.
 * Zero-auth plugins (weather) need no human connect step.
 */
import { runCapabilityGoal } from "../plugins/goal-session.js";
import { detectCapabilityNeeds } from "../plugins/intent.js";
import { emit, EVT } from "../core/events.js";

export function createGoalAgent({ pluginRegistry, notify, memoryStore, memoryQueue }) {
  /** @type {Map<string, object>} */
  const running = new Map();

  async function handler({ input = {} } = {}) {
    const userText = String(input.userText || "").trim();
    if (!userText) {
      return { ok: false, error: "userText required" };
    }

    const needs = detectCapabilityNeeds(userText);
    if (!needs.length) {
      return { ok: true, started: false, message: "no capability gap" };
    }

    const missing = needs.filter((n) => !pluginRegistry.isInstalled(n.pluginId));
    if (!missing.length) {
      return {
        ok: true,
        started: false,
        alreadyReady: true,
        plugins: needs.map((n) => n.pluginId),
        message: "plugins already installed",
      };
    }

    const key = missing.map((n) => n.pluginId).sort().join(",");
    if (running.has(key) && !input.force) {
      return {
        ok: true,
        started: false,
        inProgress: true,
        message: "goal session already running for this capability",
      };
    }

    running.set(key, { startedAt: Date.now(), userText });

    const result = await runCapabilityGoal(userText, {
      maxSteps: input.maxSteps ?? 12,
      research: async (item) => researchFor(item),
      design: async (item) => designFor(item),
      install: async (item) => pluginRegistry.install(item.pluginId),
      verify: async (item) => {
        const p = pluginRegistry.get(item.pluginId);
        if (!p) return { ok: false, error: "missing plugin module" };
        if (p.general === false) return { ok: false, error: "not general" };
        if (!pluginRegistry.isInstalled(item.pluginId)) {
          return { ok: false, error: "not installed" };
        }
        return {
          ok: true,
          general: true,
          pluginId: item.pluginId,
          requiresAuth: !!p.requiresAuth,
        };
      },
      notify: async (item, state) => {
        const p = pluginRegistry.get(item.pluginId);
        const noAuth = p && p.requiresAuth === false;
        const title = "New plugin ready";
        const body = noAuth
          ? `${item.title || item.pluginId} installed (general, no login). Your request can be answered now.`
          : `${item.title || item.pluginId} installed (general). Connect once if needed, then retry.`;
        if (notify) {
          await notify.notify({
            title,
            body,
            agentId: "goal-agent",
            tag: `plugin-ready-${item.pluginId}`,
            requireApproval: false,
            data: {
              type: "plugin-ready",
              pluginId: item.pluginId,
              general: true,
              requiresAuth: !noAuth,
              originPrompt: state.originPrompt,
            },
          });
        }
        emit(EVT.PILL, { level: "ok", message: `${title}: ${item.pluginId}` });
        await writeMemoryLesson(item, state, noAuth);
        return { ok: true, title, body };
      },
      onEvent: (ev) => emit(EVT.GOAL || "goal-session", ev),
    });

    running.delete(key);
    return {
      ok: true,
      started: result.started,
      state: result.state,
      report: result.report,
      pluginsInstalled: result.state.pluginsInstalled,
      detail: {
        status: result.state.status,
        plugins: result.state.pluginsInstalled,
        originPrompt: result.state.originPrompt,
      },
    };
  }

  function researchFor(item) {
    if (item.pluginId === "weather") {
      return {
        api: "Open-Meteo geocoding + forecast (no API key)",
        auth: "none",
        portable: true,
        general: true,
        notes: "Any place name; no user account.",
      };
    }
    if (item.pluginId === "google-calendar") {
      return {
        api: "Google Calendar API v3 + OAuth 2.0",
        oauth: "Any Google account; scopes only",
        scopes: item.scopes,
        portable: true,
        general: true,
      };
    }
    return {
      api: "generic",
      portable: true,
      general: true,
      scopes: item.scopes || [],
    };
  }

  function designFor(item) {
    const auth =
      item.pluginId === "weather" || item.requiresAuth === false
        ? "none"
        : "oauth2-token-client";
    return {
      pluginId: item.pluginId,
      general: true,
      provider:
        item.pluginId === "weather"
          ? "open-meteo"
          : item.pluginId.startsWith("google")
            ? "google"
            : "unknown",
      scopes: item.scopes || [],
      auth,
      requiresAuth: auth !== "none",
      entry: `plugins/${item.pluginId}.js`,
    };
  }

  async function writeMemoryLesson(item, state, noAuth) {
    if (!memoryStore || !memoryQueue) return;
    const lesson = noAuth
      ? `When the user asks about weather/forecast, use general plugin \`${item.pluginId}\` (Open-Meteo; any place; no login). Origin: “${(state.originPrompt || "").slice(0, 100)}”.`
      : `When the user asks about ${item.title}, use general plugin \`${item.pluginId}\` (OAuth per user if required). Origin: “${(state.originPrompt || "").slice(0, 100)}”.`;
    await memoryQueue.enqueue(async () => {
      try {
        const head = memoryStore.getHead();
        let content = head.content || "";
        if (content.includes(`\`${item.pluginId}\``) && content.includes("Standing instructions")) {
          return { ok: true, noop: true };
        }
        if (!content.includes("## Standing instructions")) {
          content = content.trimEnd() + "\n\n## Standing instructions\n";
        }
        content = content.trimEnd() + `\n- ${lesson}\n`;
        return memoryStore.commit({
          content,
          source: "router_lesson",
          summaryWhy: `goal-agent installed general plugin ${item.pluginId}`,
        });
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    });
  }

  return { handler, detectCapabilityNeeds };
}
