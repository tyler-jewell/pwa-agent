/**
 * Progressive capability ladder — same spirit as PWA shell → network → offline.
 * Pure functions only (no DOM, no adapters).
 */

export const QUALITY_RANK = { tiny: 0, small: 1, medium: 2, large: 3 };

/** Ordered stages: each step unlocks more capability without blocking prior ones. */
export const STAGES = [
  {
    id: "shell",
    label: "shell",
    hint: "App shell only — no model ready yet",
  },
  {
    id: "instant",
    label: "instant",
    hint: "Tiny model ready — chat works now (like offline shell)",
  },
  {
    id: "enhancing",
    label: "enhancing",
    hint: "Network download — larger model loading in background",
  },
  {
    id: "capable",
    label: "capable",
    hint: "Larger model ready — better answers when routed",
  },
  {
    id: "offline",
    label: "offline-ready",
    hint: "Larger model cached — works offline like a installed PWA",
  },
];

export function qualityRank(m) {
  return QUALITY_RANK[m?.capabilities?.qualityClass] ?? 0;
}

export function isLarger(m) {
  return qualityRank(m) > 0;
}

/**
 * Compute current progressive stage from discovered models + online flag.
 * @param {object[]} models
 * @param {{ online?: boolean }} [opts]
 */
export function computeProgressStage(models, opts = {}) {
  const online = opts.online !== false;
  const list = Array.isArray(models) ? models : [];
  const ready = list.filter((m) => m.status === "ready");
  const downloading = list.some((m) => m.status === "downloading");
  const largerReady = ready.filter(isLarger);
  const largerOffline = largerReady.some((m) => m.constraints?.offlineReady);

  let stage = STAGES[0];
  if (largerOffline) stage = STAGES[4];
  else if (largerReady.length) stage = STAGES[3];
  else if (downloading || (online && ready.length && list.some((m) => m.status === "announced" && isLarger(m)))) {
    stage = STAGES[2];
  } else if (ready.length) stage = STAGES[1];

  const best = [...ready].sort((a, b) => qualityRank(b) - qualityRank(a))[0] || null;
  return {
    stageId: stage.id,
    label: stage.label,
    hint: stage.hint,
    online,
    readyCount: ready.length,
    largerReadyCount: largerReady.length,
    downloading,
    bestReadyId: best?.id || null,
    bestReadyLabel: best?.label || null,
    bestQuality: best?.capabilities?.qualityClass || null,
  };
}

/**
 * Sort models for progressive load order: lower quality first (tiny already ready).
 * Only non-ready models that should auto-load.
 */
export function progressiveLoadOrder(models) {
  return [...(models || [])]
    .filter((m) => m.status !== "ready" && m.status !== "failed" && m.status !== "evicted")
    .sort((a, b) => qualityRank(a) - qualityRank(b));
}

/** Runtime status line for topbar. */
export function formatProgressRuntime(snap) {
  if (!snap) return { text: "…", level: "muted" };
  const parts = [snap.label];
  if (snap.bestReadyLabel) parts.push(snap.bestReadyLabel);
  if (snap.downloading) parts.push("loading…");
  if (!snap.online) parts.push("offline");
  const level =
    snap.stageId === "shell" ? "warn" : snap.stageId === "enhancing" ? "warn" : "ok";
  return { text: parts.join(" · "), level };
}
