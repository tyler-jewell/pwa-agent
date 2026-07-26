/**
 * Compaction job for chat-agent — runs on memoryQueue (no nested enqueue).
 * Emits run-tree + pills; MEMORY note is queue-internal by design.
 */
import { runId, nowIso } from "../core/ids.js";
import { emit, EVT } from "../core/events.js";
import {
  compactionNeeded,
  applyCompaction,
  memoryNoteAfterCompact,
} from "../memory/compact.js";

export async function runMaybeCompact({
  tree,
  transcript,
  memoryStore,
  memoryQueue,
  modelCaps,
  parentRunId = null,
}) {
  const messages = transcript.getMessages();
  const head = memoryStore.getHead();
  const W = modelCaps?.contextWindowTokens || 2048;
  const check = compactionNeeded(messages, head.content, W);
  if (!check.needed) return;

  const compactRun = runId();
  tree.push({
    runId: compactRun,
    parentRunId,
    agentId: "chat-agent",
    name: "compact",
    status: "started",
    ts: nowIso(),
    detail: { T_total: check.T_total, W: check.W },
  });

  await memoryQueue.enqueue(async () => {
    try {
      const { messages: next } = applyCompaction(transcript.getMessages());
      await transcript.replaceMessages(next);
      emit(EVT.PILL, { level: "ok", message: "transcript compacted (≥50% context)" });
      const note = memoryNoteAfterCompact(check.T_total, check.W);
      const h = memoryStore.getHead();
      if (!h.content.includes("Context compacted")) {
        const result = await memoryStore.commit({
          content: h.content.trimEnd() + note.contentAppend,
          source: "compact",
          summaryWhy: note.summaryWhy,
        });
        if (result.ok) {
          emit(EVT.PILL, { level: "ok", message: "memory: compaction noted" });
        } else if (!result.noop) {
          emit(EVT.PILL, { level: "err", message: `compact memory: ${result.error}` });
        }
      }
      tree.push({
        runId: compactRun,
        parentRunId,
        agentId: "chat-agent",
        name: "compact",
        status: "ok",
        ts: nowIso(),
        detail: {},
      });
    } catch (e) {
      emit(EVT.PILL, { level: "err", message: `compaction failed: ${e.message || e}` });
      tree.push({
        runId: compactRun,
        parentRunId,
        agentId: "chat-agent",
        name: "compact",
        status: "error",
        ts: nowIso(),
        detail: { error: String(e?.message || e) },
      });
    }
  });
}
