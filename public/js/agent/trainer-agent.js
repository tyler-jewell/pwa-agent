/**
 * Trainer — after user approves recruiter proposal: download + benchmark + roster.
 */
import {
  runBenchmarkProtocol,
  applyBenchmarkMetrics,
  renderLiveModelsMarkdown,
} from "../train/benchmark.js";
import { emit, EVT } from "../core/events.js";
import { getFolderBind } from "../quality/gate.js";

export function createTrainerAgent({ registry, notify }) {
  async function handler({ input = {} } = {}) {
    const candidateId = input.candidateId || input.candidate?.id;
    const replaceId = input.replaceId || null;
    if (!candidateId) {
      return { ok: false, error: "candidateId required" };
    }

    // Ensure candidate is in registry
    let model = registry.get(candidateId);
    if (!model && input.candidate) {
      registry.upsert({
        ...input.candidate,
        status: "announced",
        source: "discovered",
      });
      model = registry.get(candidateId);
    }
    if (!model) {
      return { ok: false, error: `unknown model ${candidateId}` };
    }

    if (replaceId) {
      const adapterOld = registry.getAdapterFor(replaceId);
      try {
        await adapterOld?.unload?.(replaceId);
      } catch {
        /* ignore */
      }
      registry.setStatus(replaceId, "evicted");
    }

    registry.setStatus(candidateId, "downloading");
    const adapter = registry.getAdapterFor(candidateId);
    if (!adapter) {
      registry.setStatus(candidateId, "failed");
      return { ok: false, error: "no adapter for model" };
    }

    try {
      await adapter.load(candidateId);
      registry.setStatus(candidateId, "ready");
    } catch (e) {
      registry.setStatus(candidateId, "failed");
      return { ok: false, error: String(e.message || e) };
    }

    model = registry.get(candidateId);
    let metrics;
    try {
      metrics = await runBenchmarkProtocol(model, adapter);
    } catch (e) {
      return {
        ok: false,
        error: `benchmark failed: ${e.message || e}`,
        downloaded: true,
      };
    }

    const updated = applyBenchmarkMetrics(model, metrics);
    registry.upsert(updated);
    registry.setPreferred(candidateId);

    const rosterMd = renderLiveModelsMarkdown(registry.list());
    emit(EVT.ROSTER, { markdown: rosterMd, models: registry.list() });
    emit(EVT.MODELS, { models: registry.list() });

    // Persist live models markdown when project folder is bound
    let readmeWritten = false;
    try {
      const folder = getFolderBind();
      if (folder.isBound?.() && typeof folder.writeText === "function") {
        await folder.writeText(["LIVE_MODELS.md"], rosterMd);
        // Patch README live section if present
        if (typeof folder.readText === "function") {
          const readme = await folder.readText(["README.md"]);
          if (readme && readme.includes("<!-- LIVE_MODELS_START -->")) {
            const next = patchReadmeLiveSection(readme, rosterMd);
            await folder.writeText(["README.md"], next);
            readmeWritten = true;
          }
        }
      }
    } catch {
      /* folder write optional */
    }

    if (notify) {
      await notify.notify({
        title: "Model trained",
        body: `${updated.label || candidateId}: smartness ${metrics.smartness}, ${metrics.tokenRate} tok/s`,
        requireApproval: false,
        agentId: "trainer",
        data: { type: "train-done", candidateId, metrics },
      });
    }

    return {
      ok: true,
      modelId: candidateId,
      metrics,
      rosterMd,
      readmeWritten,
      replaced: replaceId,
    };
  }

  return { handler };
}

export function patchReadmeLiveSection(readme, rosterMd) {
  const start = "<!-- LIVE_MODELS_START -->";
  const end = "<!-- LIVE_MODELS_END -->";
  const block = `${start}\n${rosterMd.trim()}\n${end}`;
  if (readme.includes(start) && readme.includes(end)) {
    const re = /<!-- LIVE_MODELS_START -->[\s\S]*?<!-- LIVE_MODELS_END -->/;
    return readme.replace(re, block);
  }
  return `${readme.trimEnd()}\n\n${block}\n`;
}
