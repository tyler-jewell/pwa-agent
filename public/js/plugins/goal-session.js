/**
 * Capability goal session — starts from a user prompt only.
 * Research → design general plugin → install → verify → notify-ready.
 * Bounded iterations; honest incomplete if budget ends.
 * Pure decision logic + injectable steps (no DOM).
 */

import { detectCapabilityNeeds } from "./intent.js";
import { buildHonestReport } from "../task/report.js";

export const GOAL_STEPS = [
  "detect",
  "research",
  "design",
  "install",
  "verify",
  "notify",
];

/**
 * Create a goal session state from a single user prompt.
 */
export function createGoalFromPrompt(userText, { maxSteps = 12 } = {}) {
  const needs = detectCapabilityNeeds(userText);
  return {
    originPrompt: String(userText || "").trim(),
    needs,
    status: needs.length ? "open" : "noop",
    step: 0,
    maxSteps: Math.max(needs.length * 6, maxSteps),
    /** Next action to run for the current need */
    phase: "research",
    log: [],
    pluginsInstalled: [],
    general: true, // plugins must work for any user of the provider
    items: needs.map((n, i) => ({
      id: `need_${i + 1}`,
      title: `Enable general plugin: ${n.title}`,
      pluginId: n.pluginId,
      capabilityId: n.id,
      status: "pending",
      scopes: n.scopes,
    })),
    handoffs: [],
  };
}

/**
 * Pure next action for the goal session.
 * @returns {{ action: string, item?: object, reason: string }}
 */
export function decideGoalTick(state) {
  if (!state || state.status === "noop") {
    return { action: "noop", reason: "no capability gap in prompt" };
  }
  if (state.status !== "open") {
    return { action: "done", reason: state.status };
  }
  if (state.step >= state.maxSteps) {
    return { action: "exhaust", reason: "max steps" };
  }
  const pending = state.items.filter((i) => i.status === "pending");
  if (!pending.length) {
    return { action: "complete", reason: "all needs met" };
  }
  const item = pending[0];
  const phase = state.phase || "research";
  const reasons = {
    research: "gap detected; research general API",
    design: "design portable plugin (any user)",
    install: "install general plugin module",
    verify: "verify plugin is general + callable",
    notify: "push notify: new plugin ready",
  };
  if (reasons[phase]) {
    return { action: phase, item, reason: reasons[phase] };
  }
  return { action: "research", item, reason: "continue" };
}

function clone(state) {
  return {
    ...state,
    needs: [...(state.needs || [])],
    log: [...(state.log || [])],
    pluginsInstalled: [...(state.pluginsInstalled || [])],
    items: (state.items || []).map((i) => ({ ...i })),
  };
}

/**
 * Run one goal tick with injected handlers.
 */
export async function applyGoalAction(state, decision, handlers = {}) {
  let next = clone(state);
  next.step += 1;
  // Mutate the cloned item, not the prior state's reference
  const item = decision.item
    ? next.items.find((i) => i.id === decision.item.id)
    : null;
  const note = { action: decision.action, reason: decision.reason, at: next.step };

  if (decision.action === "noop" || decision.action === "done") {
    return next;
  }
  if (decision.action === "exhaust") {
    next.status = "exhausted";
    next.log.push(note);
    return next;
  }
  if (decision.action === "complete") {
    next.status = "complete";
    next.log.push(note);
    return next;
  }

  try {
    if (decision.action === "research") {
      const research = handlers.research
        ? await handlers.research(item, next)
        : defaultResearch(item);
      next.log.push({ ...note, research });
      next.phase = "design";
      next.lastResearch = research;
    } else if (decision.action === "design") {
      const design = handlers.design
        ? await handlers.design(item, next)
        : defaultDesign(item, next.lastResearch);
      // Generality guard: design must not bind a single human identity
      if (design.userEmail || design.userId || design.hardcodedAccount) {
        throw new Error("plugin design must be general — no single-user binding");
      }
      next.log.push({ ...note, design });
      next.phase = "install";
      next.lastDesign = design;
    } else if (decision.action === "install") {
      const installed = handlers.install
        ? await handlers.install(item, next.lastDesign, next)
        : { pluginId: item.pluginId, ok: true };
      if (installed && installed.ok === false) {
        throw new Error(installed.error || "install failed");
      }
      next.pluginsInstalled.push(installed?.pluginId || item.pluginId);
      next.log.push({ ...note, installed });
      next.phase = "verify";
    } else if (decision.action === "verify") {
      const v = handlers.verify
        ? await handlers.verify(item, next)
        : { ok: true, general: true };
      if (!v.ok) throw new Error(v.error || "verify failed");
      if (v.general === false) throw new Error("plugin not general");
      next.log.push({ ...note, verify: v });
      next.phase = "notify";
    } else if (decision.action === "notify") {
      const n = handlers.notify
        ? await handlers.notify(item, next)
        : { ok: true };
      next.log.push({ ...note, notify: n });
      if (item) {
        item.status = "done";
        item.note = `plugin ${item.pluginId} ready (general)`;
      }
      if (next.items.some((i) => i.status === "pending")) {
        next.phase = "research";
      } else {
        next.status = "complete";
        next.phase = "done";
      }
    }
  } catch (e) {
    next.log.push({ ...note, error: String(e?.message || e) });
    if (item) {
      item.status = "blocked";
      item.note = String(e?.message || e);
    }
    next.status = "exhausted";
  }
  return next;
}

function defaultResearch(item) {
  return {
    api: item.pluginId === "google-calendar" ? "Google Calendar API v3" : "unknown",
    oauth: "OAuth 2.0 token client (any Google account)",
    scope: item.scopes || [],
    portable: true,
    notes:
      "Use standard Google Identity Services; store per-session tokens only; no hard-coded user.",
  };
}

function defaultDesign(item, research) {
  return {
    pluginId: item.pluginId,
    general: true,
    provider: "google",
    scopes: item.scopes || research?.scope || [],
    entry: `plugins/${item.pluginId}.js`,
    auth: "oauth2-token-client",
    // deliberately no userEmail / userId
  };
}

/**
 * Full goal loop from a user prompt.
 * @param {string} userText
 * @param {object} handlers - research, design, install, verify, notify, onEvent
 */
export async function runCapabilityGoal(userText, handlers = {}) {
  let state = createGoalFromPrompt(userText, {
    maxSteps: handlers.maxSteps ?? 12,
  });
  if (state.status === "noop") {
    return {
      state,
      report: buildHonestReport({
        ...state,
        status: "complete",
        items: [],
      }),
      started: false,
    };
  }

  handlers.onEvent?.({ type: "goal-start", state });

  while (state.status === "open") {
    const decision = decideGoalTick(state);
    handlers.onEvent?.({ type: "goal-tick", decision, step: state.step });
    if (decision.action === "complete") {
      state = { ...state, status: "complete" };
      break;
    }
    if (decision.action === "exhaust") {
      state = { ...state, status: "exhausted" };
      break;
    }
    if (decision.action === "noop" || decision.action === "done") break;
    state = await applyGoalAction(state, decision, handlers);
  }

  const report = buildHonestReport(state, {
    originPrompt: state.originPrompt,
    pluginsInstalled: state.pluginsInstalled,
  });
  handlers.onEvent?.({ type: "goal-end", state, report });
  return { state, report, started: true };
}
