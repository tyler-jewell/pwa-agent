/**
 * memory-agent — reflect / validate / commit / restore / compact assist.
 * Invoked only via bus from chat-agent.
 */
import { emit, EVT } from "../core/events.js";

const FACT_HINTS = [
  /\bmy name is\b/i,
  /\bi (?:am|live|work|prefer|like|hate|use)\b/i,
  /\bcall me\b/i,
  /\bremember that\b/i,
  /\bI'?m\b.+\b(?:engineer|developer|designer|teacher|student)\b/i,
];

function extractFacts(userText, _assistantText) {
  // Learn from the human only — never treat assistant echo as facts
  const facts = [];
  const blob = userText || "";
  for (const line of blob.split(/\n+/)) {
    const t = line.trim();
    if (t.length < 8 || t.length > 240) continue;
    if (FACT_HINTS.some((re) => re.test(t))) facts.push(t);
  }
  const rem = blob.match(/remember(?: that)?[:\s]+(.+)/i);
  if (rem?.[1]) facts.push(rem[1].trim().replace(/\.$/, ""));
  return [...new Set(facts)].slice(0, 5);
}

export function createMemoryAgent({ memoryStore, memoryQueue }) {
  async function reflect({ userText, assistantText }) {
    return memoryQueue.enqueue(async () => {
      try {
        const facts = extractFacts(userText, assistantText);
        if (!facts.length) {
          return { ok: true, noop: true };
        }
        const head = memoryStore.getHead();
        let content = head.content || "";
        const additions = [];
        for (const f of facts) {
          if (content.includes(f)) continue;
          additions.push(`- ${f}`);
        }
        if (!additions.length) return { ok: true, noop: true };

        if (!content.includes("## Learned")) {
          content = content.trimEnd() + "\n\n## Learned\n";
        }
        content = content.trimEnd() + "\n" + additions.join("\n") + "\n";
        const result = await memoryStore.commit({
          content,
          source: "reflect",
          summaryWhy: `Learned ${additions.length} fact(s) from turn`,
        });
        if (result.noop) return { ok: true, noop: true };
        if (!result.ok) {
          emit(EVT.PILL, { level: "err", message: `memory failed: ${result.error}` });
          return { ok: false, error: result.error };
        }
        emit(EVT.PILL, {
          level: "ok",
          message: `memory updated: ${result.version.summaryWhy}`,
        });
        return { ok: true, version: result.version, detail: { versionId: result.version.id } };
      } catch (e) {
        emit(EVT.PILL, { level: "err", message: `memory failed: ${e.message || e}` });
        return { ok: false, error: String(e.message || e) };
      }
    });
  }

  async function restore(versionId) {
    return memoryQueue.enqueue(async () => {
      const result = await memoryStore.restore(versionId);
      if (!result.ok) {
        emit(EVT.PILL, { level: "err", message: `restore failed: ${result.error}` });
        return result;
      }
      emit(EVT.PILL, { level: "ok", message: `memory restored → ${result.version.id}` });
      return result;
    });
  }

  async function compactAssist({ T_total, W, note }) {
    return memoryQueue.enqueue(async () => {
      try {
        const head = memoryStore.getHead();
        let content = head.content;
        if (note?.contentAppend && !content.includes("Context compacted")) {
          content = content.trimEnd() + note.contentAppend;
          const result = await memoryStore.commit({
            content,
            source: "compact",
            summaryWhy: note.summaryWhy || `Compaction at ${T_total}/${W}`,
          });
          if (result.ok) {
            emit(EVT.PILL, { level: "ok", message: "memory: compaction noted" });
          } else if (!result.noop) {
            emit(EVT.PILL, { level: "err", message: `compact memory: ${result.error}` });
          }
          return result;
        }
        return { ok: true, noop: true };
      } catch (e) {
        emit(EVT.PILL, { level: "err", message: `compact memory: ${e.message || e}` });
        return { ok: false, error: String(e.message || e) };
      }
    });
  }

  function handler({ input }) {
    const op = input?.op || "reflect";
    if (op === "restore") return restore(input.versionId);
    if (op === "compact") return compactAssist(input);
    return reflect(input);
  }

  return { reflect, restore, compactAssist, handler };
}
