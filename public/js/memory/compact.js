/**
 * Compaction at ≥50% context window (FP7).
 * Physically replaces history with system + one summary message.
 */
import { estimateTokens, estimateMessagesTokens } from "../core/tokens.js";
import { msgId, nowIso } from "../core/ids.js";

/**
 * @returns {{ needed: boolean, T_total: number, W: number }}
 */
export function compactionNeeded(messages, memoryContent, contextWindowTokens) {
  const W = contextWindowTokens || 2048;
  const T_total = estimateMessagesTokens(messages, [memoryContent || ""]);
  return { needed: T_total >= 0.5 * W, T_total, W };
}

/**
 * Build a compact summary of older turns.
 */
export function buildSummaryContent(messages) {
  const lines = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role;
    const clip = (m.content || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (clip) lines.push(`- ${role}: ${clip}`);
  }
  const body = lines.length
    ? lines.slice(-40).join("\n")
    : "_(no prior turns)_";
  return `# Conversation summary\n\nCompacted at ${nowIso()}.\n\n${body}\n`;
}

/**
 * Apply physical replace: keep optional identity systems out; one summary.
 * @returns {{ messages, summaryMessage }}
 */
export function applyCompaction(messages) {
  const summaryMessage = {
    id: msgId(),
    role: "summary",
    content: buildSummaryContent(messages),
    createdAt: nowIso(),
    meta: { compacted: true },
  };
  return {
    messages: [summaryMessage],
    summaryMessage,
  };
}

/**
 * Also propose MEMORY note about compaction lesson (optional assist).
 */
export function memoryNoteAfterCompact(T_total, W) {
  return {
    contentAppend:
      `\n## Session note\n- Context compacted at ~${Math.round((T_total / W) * 100)}% of window (${T_total}/${W} est. tokens).\n`,
    summaryWhy: `Recorded compaction at ${T_total}/${W} tokens`,
  };
}

export { estimateTokens };
