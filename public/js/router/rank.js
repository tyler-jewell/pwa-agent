/** Rank discovered ready models — no hardcoded catalog. Prefers offline when offline. */
import { qualityRank } from "./progress.js";

export function rankModels(ready, device, complexity) {
  const score = (m) => {
    let s = 0;
    const qRank = qualityRank(m);
    s += 10 + qRank * 10;
    if (complexity === "low" && qRank === 0) s += 15;
    if (complexity === "high" && qRank >= 1) s += 12;
    if (complexity === "medium" && qRank >= 1) s += 6;
    if (m.constraints.requiresWebGpu && !device.webgpu) s -= 100;
    if (
      device.deviceMemoryGb != null &&
      m.constraints.minRamHintMb > device.deviceMemoryGb * 512
    ) {
      s -= 20;
    }
    // PWA-style: when offline, prefer models that already work offline
    if (device.online === false) {
      if (m.constraints?.offlineReady) s += 30;
      else s -= 40;
    }
    s += Math.min(10, (m.metrics?.successCount || 0) / 5);
    s -= (m.metrics?.failCount || 0) * 5;
    if (complexity !== "low") {
      s += Math.min(10, (m.capabilities.contextWindowTokens || 0) / 1000);
    }
    return s;
  };
  return ready
    .map((m) => ({ m, s: score(m) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}
