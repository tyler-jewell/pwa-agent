/**
 * chat-agent — sole tool principal (FP6). Stream-first turn lifecycle (FP4).
 * Multi-step crew work → crew-agent loop (FP13–16) under this principal.
 */
import { runId, nowIso } from "../core/ids.js";
import { emit, EVT } from "../core/events.js";
import { buildPrompt } from "../turn/prompt.js";
import { RuntimeErrorCode } from "../ports/runtime.js";
import { runMaybeCompact } from "./chat-compact.js";
import { isCrewTask, extractCrewGoal } from "./crew-agent.js";
import { buildCapabilitySnapshot } from "../task/capability.js";
import { estimateMessagesTokens } from "../core/tokens.js";

export function createChatAgent({
  bus,
  tree,
  registry,
  transcript,
  memoryStore,
  memoryQueue,
  runQualityGate,
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

  /** Run one user turn. Streams tokens via onToken; never awaits reflect. */
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
      for (const ch of reportText) onToken?.(ch);
      await transcript.append("assistant", reportText, { quality: true });
      pushRoot(rootRun, "quality gate", "ok");
      return;
    }

    // Multi-step crew path: army loop under principal
    if (isCrewTask(content)) {
      await runCrewTurn({
        content,
        rootRun,
        onToken,
      });
      return;
    }

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
      await transcript.append(
        "assistant",
        "Limited mode: no model is ready yet. Wait for a tiny/mock model to load, then try again.",
        { limited: true }
      );
      pushRoot(rootRun, "chat turn", "error", { error: "no ready model" });
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
      await transcript.append("assistant", "Runtime adapter unavailable for selected model.");
      pushRoot(rootRun, "chat turn", "error", { error: "no adapter" });
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
        emit(EVT.PILL, { level: "err", message: `memory failed: ${e.message || e}` });
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
      for (const ch of msg) onToken?.(ch);
      await transcript.append("assistant", msg, { error: true });
      pushRoot(rootRun, "crew loop", "error", { error: String(e?.message || e) });
      return;
    }

    const text =
      crewResult?.text ||
      crewResult?.report?.summary ||
      "Crew finished without a report.";
    for (const ch of text) onToken?.(ch);
    await transcript.append("assistant", text, {
      crew: true,
      report: crewResult?.report,
    });
    pushRoot(rootRun, "crew loop", crewResult?.ok === false ? "error" : "ok", {
      report: crewResult?.report,
      complete: crewResult?.report?.complete,
    });

    bus
      .invoke({
        agentId: "memory-agent",
        name: "reflect",
        parentRunId: rootRun,
        input: { op: "reflect", userText: content, assistantText: text },
      })
      .catch((e) => {
        emit(EVT.PILL, { level: "err", message: `memory failed: ${e.message || e}` });
      });
  }

  return { handleUserMessage, abortInflight, isCrewTask };
}
