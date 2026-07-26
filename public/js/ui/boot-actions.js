/** Wire quality / export / import / reset chrome buttons. */
import { emit, EVT } from "../core/events.js";
import { buildExportBundle, importBundle, downloadJson } from "../core/export.js";
import { getFolderBind, runQualityGate } from "../quality/gate.js";

export function wireChromeActions({
  memoryStore,
  transcript,
  registry,
  memoryQueue,
  tree,
}) {
  const dialog = document.getElementById("quality-dialog");
  const qualityOut = document.getElementById("quality-out");

  async function showQuality(report) {
    qualityOut.textContent =
      `ok=${report.ok}\n\n` +
      report.results.map((r) => `[${r.level}] ${r.message}`).join("\n") +
      `\n\n--- Manual ---\n` +
      report.manual.map((m, i) => `${i + 1}. ${m}`).join("\n");
    dialog.showModal();
  }

  document.getElementById("btn-quality").addEventListener("click", async () => {
    qualityOut.textContent = "Running…";
    dialog.showModal();
    await showQuality(await runQualityGate());
  });

  document.getElementById("btn-quality").addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    try {
      const name = await getFolderBind().bind();
      emit(EVT.PILL, { level: "ok", message: `bound folder: ${name}` });
      await showQuality(await runQualityGate());
    } catch (err) {
      emit(EVT.PILL, { level: "warn", message: String(err.message || err) });
    }
  });

  document.getElementById("btn-export").addEventListener("click", () => {
    downloadJson(
      buildExportBundle({ memoryStore, transcript, registry }),
      `pwa-export-${Date.now()}.json`
    );
    emit(EVT.PILL, { level: "ok", message: "exported" });
  });

  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      await memoryQueue.enqueue(() =>
        importBundle(bundle, { memoryStore, transcript })
      );
      emit(EVT.PILL, { level: "ok", message: "import ok" });
      emit(EVT.TRANSCRIPT, transcript.snapshot());
    } catch (err) {
      emit(EVT.PILL, {
        level: "err",
        message: `import failed: ${err.message || err}`,
      });
    }
    e.target.value = "";
  });

  document.getElementById("btn-reset").addEventListener("click", async () => {
    if (!confirm("Clear all chat + MEMORY and re-seed? This cannot be undone.")) {
      return;
    }
    await memoryQueue.enqueue(async () => {
      await transcript.clear();
      await memoryStore.wipeToSeed();
    });
    tree.clear();
    emit(EVT.PILL, { level: "ok", message: "reset to seed" });
  });
}
