/**
 * chat-agent — sole tool principal (FP6).
 * User prompt only: if capability missing → start goal session (background);
 * if plugin ready → use it. Never requires a separate human “/goal” command.
 */
import { runId, nowIso } from "../core/ids.js";
import { emit, EVT } from "../core/events.js";
import { buildPrompt } from "../turn/prompt.js";
import { RuntimeErrorCode } from "../ports/runtime.js";
import { runMaybeCompact } from "./chat-compact.js";
import { isCrewTask, extractCrewGoal } from "./crew-agent.js";
import { buildCapabilitySnapshot } from "../task/capability.js";
import { estimateMessagesTokens } from "../core/tokens.js";
import {
  detectCapabilityNeeds,
  isCalendarQuery,
} from "../plugins/intent.js";

export function createChatAgent({
  bus,
  tree,
  registry,
  transcript,
  memoryStore,
  memoryQueue,
  runQualityGate,
  pluginRegistry,
}) {
  let abortCtrl = null;

  function abortInflight() {
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
  }

  async function handleQualityCommand() {
    if (!runQualityGate) return "Quality gate is not available.";
    const report = await runQualityGate();
    emit(EVT.QUALITY, report);
    const lines = report.results.map((r) => `[${r.level}] ${r.message}`);
    return (
      `Quality gate: ${report.ok ? "PASSED" : "FAILED"}\n` +
      lines.join("\n") +
      "\n\nManual checklist:\n" +
      (report.manual || []).map((m, i) => `${i + 1}. ${m}`).join("\n")
    );
  }

  function pushRoot(rootRun, name, status, detail = {}) {
    tree.push({
      runId: rootRun,
      parentRunId: null,
      agentId: "chat-agent",
      name,
      status,
      ts: nowIso(),
      detail,
    });
  }

  async function streamText(text, onToken) {
    for (const ch of text) onToken?.(ch);
  }

  async function finishAssistant(rootRun, name, text, onToken, meta = {}) {
    await streamText(text, onToken);
    await transcript.append("assistant", text, meta);
    pushRoot(rootRun, name, "ok", meta);
  }

  /** Run one user turn from the prompt alone. */
  async function handleUserMessage(text, { onToken } = {}) {
    const content = (text || "").trim();
    if (!content) return;

    abortInflight();
    abortCtrl = new AbortController();
    const signal = abortCtrl.signal;

    await transcript.append("user", content);
    const rootRun = runId();
    pushRoot(rootRun, "chat turn", "started");

    if (/run pre-commit|quality gate|run quality/i.test(content)) {
      pushRoot(rootRun, "quality gate", "streaming");
      const reportText = await handleQualityCommand();
      await finishAssistant(rootRun, "quality gate", reportText, onToken, {
        quality: true,
      });
      return;
    }

    // Connect calendar (after plugin installed)
    if (
      pluginRegistry &&
      /^(connect|link|authorize)\s+(my\s+)?google\s+calendar/i.test(content)
    ) {
      await runCalendarConnect(rootRun, onToken);
      return;
    }

    // Capability path: calendar (and future plugins) from user prompt only
    const needs = detectCapabilityNeeds(content);
    if (needs.length && pluginRegistry) {
      await runCapabilityTurn({ content, needs, rootRun, onToken });
      return;
    }

    if (isCrewTask(content)) {
      await runCrewTurn({ content, rootRun, onToken });
      return;
    }

    await runModelTurn({ content, rootRun, onToken, signal });
  }

  async function runCapabilityTurn({ content, needs, rootRun, onToken }) {
    let missing = needs.filter((n) => !pluginRegistry.isInstalled(n.pluginId));
    const zeroAuthMissing = missing.filter((n) => n.requiresAuth === false);

    // Zero-auth gaps (e.g. weather): learn + answer in one turn — no human mid-loop
    if (zeroAuthMissing.length) {
      pushRoot(rootRun, "capability goal", "streaming", {
        missing: zeroAuthMissing.map((m) => m.pluginId),
      });
      try {
        const goal = await bus.invoke({
          agentId: "goal-agent",
          name: "capability goal",
          parentRunId: rootRun,
          input: { userText: content, force: true },
        });
        pushRoot(rootRun, "capability goal", goal?.ok === false ? "error" : "ok", {
          plugins: goal?.pluginsInstalled,
          status: goal?.state?.status,
        });
      } catch (e) {
        pushRoot(rootRun, "capability goal", "error", {
          error: String(e?.message || e),
        });
      }
      missing = needs.filter((n) => !pluginRegistry.isInstalled(n.pluginId));
      // Fall through to use plugins that are now installed
    }

    // Installed → use general plugin handleQuery / calendar path
    const readyNeed = needs.find((n) => pluginRegistry.isInstalled(n.pluginId));
    if (readyNeed) {
      const text = await invokePlugin(readyNeed, content, rootRun);
      if (text != null) {
        await finishAssistant(rootRun, `plugin ${readyNeed.pluginId}`, text, onToken, {
          plugin: readyNeed.pluginId,
        });
        bus
          .invoke({
            agentId: "memory-agent",
            name: "reflect",
            parentRunId: rootRun,
            input: { op: "reflect", userText: content, assistantText: text },
          })
          .catch(() => {});
        return;
      }
    }

    // Still missing auth-gated plugins only
    missing = needs.filter((n) => !pluginRegistry.isInstalled(n.pluginId));
    if (!missing.length) {
      await finishAssistant(
        rootRun,
        "capability",
        "Capability is installed but could not produce an answer.",
        onToken,
        { error: true }
      );
      return;
    }

    const titles = missing.map((m) => m.title).join(", ");
    const reply =
      `I can’t do that yet — I don’t have **${titles}** installed.\n\n` +
      `Starting a background **goal session** from your message alone: ` +
      `research → design a **general** plugin → install → verify → ` +
      `**notify you when ready**.` +
      (missing.some((m) => m.requiresAuth)
        ? " Auth-gated plugins may need one connect step after install."
        : "");

    pushRoot(rootRun, "capability gap", "streaming", { missing });
    await finishAssistant(rootRun, "capability gap", reply, onToken, {
      goalStarted: true,
      missing: missing.map((m) => m.pluginId),
    });

    bus
      .invoke({
        agentId: "goal-agent",
        name: "capability goal",
        parentRunId: rootRun,
        input: { userText: content },
      })
      .then((r) => {
        if (r?.pluginsInstalled?.length) {
          emit(EVT.PILL, {
            level: "ok",
            message: `goal complete: ${r.pluginsInstalled.join(", ")}`,
          });
        }
      })
      .catch((e) => {
        emit(EVT.PILL, {
          level: "err",
          message: `goal failed: ${e.message || e}`,
        });
      });
  }

  /** Dispatch installed general plugin by id. */
  async function invokePlugin(need, content, rootRun) {
    const plugin = pluginRegistry.get(need.pluginId);
    if (!plugin) return null;
    pushRoot(rootRun, `plugin ${need.pluginId}`, "streaming", {
      pluginId: need.pluginId,
    });

    if (typeof plugin.handleQuery === "function") {
      const result = await plugin.handleQuery(content);
      if (plugin.formatForecast) return plugin.formatForecast(result);
      if (plugin.formatEvents) return plugin.formatEvents(result);
      return typeof result === "string" ? result : JSON.stringify(result);
    }

    if (need.pluginId === "google-calendar") {
      if (plugin.isAuthed && !(await plugin.isAuthed())) {
        return (
          "Google Calendar plugin is ready (general — any Google user). " +
          "Say **connect google calendar** once, then ask again."
        );
      }
      const days = /\b(week)\b/i.test(content) ? 7 : 3;
      const result = await plugin.listUpcoming({ days });
      return plugin.formatEvents(result);
    }
    return null;
  }

  async function runCalendarConnect(rootRun, onToken) {
    const plugin = pluginRegistry?.get("google-calendar");
    if (!plugin || !pluginRegistry.isInstalled("google-calendar")) {
      const msg =
        "Calendar plugin is not installed yet. Ask about your calendar first " +
        "so a goal session can build the general plugin, wait for the “New plugin ready” notify, then connect.";
      await finishAssistant(rootRun, "connect calendar", msg, onToken, {});
      return;
    }
    pushRoot(rootRun, "connect google calendar", "streaming");
    const r = await plugin.connect({ interactive: true });
    const msg = r.ok
      ? r.mock
        ? "Connected (mock general session). Ask: “anything on my google calendar for the next few days?” — same plugin path for every Google user; set GOOGLE_CLIENT_ID for live OAuth."
        : "Connected. Ask again about the next few days on your calendar."
      : `Connect failed: ${r.error || "unknown"}`;
    await finishAssistant(rootRun, "connect google calendar", msg, onToken, {
      connected: r.ok,
      mock: r.mock,
    });
  }

  async function runCrewTurn({ content, rootRun, onToken }) {
    const goal = extractCrewGoal(content);
    pushRoot(rootRun, "crew loop", "streaming", { goal });
    let crewResult;
    try {
      crewResult = await bus.invoke({
        agentId: "crew-agent",
        name: "task loop",
        parentRunId: rootRun,
        input: { goal },
      });
    } catch (e) {
      const msg = `Crew error: ${e?.message || e}`;
      await finishAssistant(rootRun, "crew loop", msg, onToken, { error: true });
      return;
    }
    const text =
      crewResult?.text ||
      crewResult?.report?.summary ||
      "Crew finished without a report.";
    await finishAssistant(rootRun, "crew loop", text, onToken, {
      crew: true,
      report: crewResult?.report,
    });
    bus
      .invoke({
        agentId: "memory-agent",
        name: "reflect",
        parentRunId: rootRun,
        input: { op: "reflect", userText: content, assistantText: text },
      })
      .catch(() => {});
  }

  async function runModelTurn({ content, rootRun, onToken, signal }) {
    let modelId = registry.getPreferred()?.id || null;
    try {
      const route = await bus.invoke({
        agentId: "router-agent",
        name: "select model",
        parentRunId: rootRun,
        input: { userText: content },
      });
      if (route?.modelId) modelId = route.modelId;
    } catch (e) {
      console.warn("[chat-agent] router failed", e);
    }

    const model = modelId ? registry.get(modelId) : registry.bestReady();
    if (!model) {
      emit(EVT.LIMITED, { reason: "no ready model" });
      await finishAssistant(
        rootRun,
        "chat turn",
        "Limited mode: no model is ready yet.",
        onToken,
        { limited: true }
      );
      return;
    }

    await runMaybeCompact({
      tree,
      transcript,
      memoryStore,
      memoryQueue,
      modelCaps: model.capabilities,
      parentRunId: rootRun,
    });

    const head = memoryStore.getHead();
    const { system, messages } = buildPrompt({
      memoryContent: head.content,
      messages: transcript.getMessages(),
      contextWindowTokens: model.capabilities.contextWindowTokens,
    });

    const tokensUsed = estimateMessagesTokens(messages, [system]);
    const cap = buildCapabilitySnapshot({
      agentId: "chat-agent",
      model,
      system,
      messages,
      tokensUsed,
    });
    pushRoot(rootRun, `stream ${model.label}`, "streaming", {
      modelId: model.id,
      capability: cap,
    });

    const adapter = registry.getAdapterFor(model.id);
    if (!adapter) {
      await finishAssistant(
        rootRun,
        "chat turn",
        "Runtime adapter unavailable.",
        onToken,
        { error: true }
      );
      return;
    }

    let full = "";
    try {
      for await (const token of adapter.chatStream({
        system,
        messages,
        modelId: model.id,
        signal,
      })) {
        full += token;
        onToken?.(token);
      }
      await transcript.append("assistant", full, {
        modelId: model.id,
        capability: cap,
      });
      pushRoot(rootRun, `stream ${model.label}`, "ok", {
        modelId: model.id,
        capability: cap,
      });
    } catch (e) {
      if (e?.code === RuntimeErrorCode.cancelled) {
        if (full) await transcript.append("assistant", full, { cancelled: true });
        pushRoot(rootRun, "chat turn", "error", { error: "cancelled" });
        return;
      }
      const msg = `Inference error: ${e?.message || e}`;
      await transcript.append("assistant", msg, { error: true });
      emit(EVT.PILL, { level: "err", message: msg });
      pushRoot(rootRun, "chat turn", "error", { error: String(e?.message || e) });
      return;
    }

    bus
      .invoke({
        agentId: "memory-agent",
        name: "reflect",
        parentRunId: rootRun,
        input: { op: "reflect", userText: content, assistantText: full },
      })
      .catch((e) => {
        emit(EVT.PILL, {
          level: "err",
          message: `memory failed: ${e.message || e}`,
        });
      });
  }

  return { handleUserMessage, abortInflight, isCrewTask, isCalendarQuery };
}
