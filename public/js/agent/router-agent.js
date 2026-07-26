/**
 * router-agent — uses router/ core (probe + rank); invoked only via bus.
 * MEMORY lesson failures always surface as pills (never silent).
 */
import { probeDevice, taskComplexity } from "../router/probe.js";
import { rankModels } from "../router/rank.js";
import { emit, EVT } from "../core/events.js";

export function createRouterAgent({ registry, memoryStore, memoryQueue }) {
  async function recommend({ userText }) {
    const device = probeDevice();
    const complexity = taskComplexity(userText);
    const ready = registry.readyModels();
    if (!ready.length) {
      return { modelId: null, reason: "no ready models", device, complexity };
    }
    const ranked = rankModels(ready, device, complexity);
    const pick = ranked[0];
    registry.setPreferred(pick.id);
    const lesson = `Prefer ${pick.label} for ${complexity} tasks when ready.`;
    return {
      modelId: pick.id,
      reason: `ranked ${ranked.length} ready; complexity=${complexity}`,
      device,
      complexity,
      lesson,
      detail: { modelId: pick.id, complexity },
    };
  }

  function maybeLesson(lesson) {
    if (!lesson) return;
    memoryQueue
      .enqueue(async () => {
        try {
          const head = memoryStore.getHead();
          if (head.content.includes(lesson)) return { ok: true, noop: true };
          let content = head.content;
          if (!content.includes("## Routing lessons")) {
            content = content.trimEnd() + "\n\n## Routing lessons\n";
          }
          content = content.trimEnd() + `\n- ${lesson}\n`;
          const result = await memoryStore.commit({
            content,
            source: "router_lesson",
            summaryWhy: "Router capability lesson",
          });
          if (result.ok === false && !result.noop) {
            emit(EVT.PILL, {
              level: "err",
              message: `memory failed (router lesson): ${result.error}`,
            });
          }
          return result;
        } catch (e) {
          emit(EVT.PILL, {
            level: "err",
            message: `memory failed (router lesson): ${e.message || e}`,
          });
          return { ok: false, error: String(e.message || e) };
        }
      })
      .catch((e) => {
        emit(EVT.PILL, {
          level: "err",
          message: `memory failed (router lesson): ${e.message || e}`,
        });
      });
  }

  function handler({ input }) {
    return recommend(input || {}).then((r) => {
      maybeLesson(r.lesson);
      return r;
    });
  }

  return { probeDevice, recommend, handler };
}
