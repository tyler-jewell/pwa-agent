/**
 * Progressive Web Agent (pwa) entry — cores, agents, UI, live update, quality.
 */
import { emit, EVT, on } from "./core/events.js";
import { createRegistry } from "./adapters/registry.js";
import { createMockAdapter } from "./adapters/mock.js";
import { createMemoryStore } from "./memory/store.js";
import { createMemoryQueue } from "./memory/queue.js";
import { createTranscript } from "./turn/transcript.js";
import { createRunTree } from "./agent/tree.js";
import { createBus } from "./agent/bus.js";
import { createMemoryAgent } from "./agent/memory-agent.js";
import { createRouterAgent } from "./agent/router-agent.js";
import { createChatAgent } from "./agent/chat-agent.js";
import { createRecruiterAgent } from "./agent/recruiter-agent.js";
import { createTrainerAgent } from "./agent/trainer-agent.js";
import {
  startRecruiterOnBoot,
  wireRecruitApproval,
} from "./agent/recruit-boot.js";
import { createPerformanceManager } from "./agent/performance-manager.js";
import {
  startPerformanceManagerOnBoot,
  wirePerfPromotionApproval,
} from "./agent/perf-boot.js";
import { createCrewAgent } from "./agent/crew-agent.js";
import { createAgentNotify } from "./notify/agent-notify.js";
import { runQualityGate, getFolderBind } from "./quality/gate.js";
import { createVersionPoll } from "./live/poll.js";
import { createSoftReset } from "./live/soft-reset.js";
import { createUpdateBanner } from "./live/banner.js";
import { createLocalWatch } from "./live/local-watch.js";
import { trySubscribePush } from "./live/push-client.js";
import { mountChat } from "./ui/chat.js";
import { wireChromeActions } from "./ui/boot-actions.js";
import {
  mountModelList,
  mountRunTree,
  mountMemoryPanel,
  mountPills,
  mountRuntimeStatus,
  mountAgentNotify,
  mountRoster,
  mountAggressionControl,
} from "./ui/panels.js";

async function boot() {
  emit(EVT.RUNTIME, { text: "booting…", level: "muted" });

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch (e) {
      console.warn("SW register failed", e);
    }
  }

  const registry = createRegistry();
  registry.registerAdapter(createMockAdapter({ progressiveDelayMs: 2800 }));

  const memoryStore = createMemoryStore();
  const memoryQueue = createMemoryQueue();
  const transcript = createTranscript();
  const tree = createRunTree();
  const bus = createBus({ tree });

  const notify = createAgentNotify();
  const memoryAgent = createMemoryAgent({ memoryStore, memoryQueue });
  const routerAgent = createRouterAgent({ registry, memoryStore, memoryQueue });
  const recruiterAgent = createRecruiterAgent({ registry, notify });
  const trainerAgent = createTrainerAgent({ registry, notify });
  const performanceManager = createPerformanceManager({
    memoryStore,
    memoryQueue,
    tree,
    registry,
    notify,
  });
  const crewAgent = createCrewAgent({ registry });
  bus.register("memory-agent", memoryAgent.handler);
  bus.register("router-agent", routerAgent.handler);
  bus.register("recruiter", recruiterAgent.handler);
  bus.register("trainer", trainerAgent.handler);
  bus.register("performance-manager", performanceManager.handler);
  bus.register("crew-agent", crewAgent.handler);

  const chatAgent = createChatAgent({
    bus,
    tree,
    registry,
    transcript,
    memoryStore,
    memoryQueue,
    runQualityGate,
  });

  const recruitUi = wireRecruitApproval({ bus, notify });
  wirePerfPromotionApproval({ notify, performanceManager });

  async function rehydrate() {
    await memoryStore.load();
    await transcript.load();
    await registry.discoverAll();
    emit(EVT.TRANSCRIPT, transcript.snapshot());
    emit(EVT.MEMORY, memoryStore.snapshot());
    // MODELS + RUNTIME from progress ladder (shell → instant → offline-ready)
    registry.refreshProgress();
  }

  await rehydrate();
  registry.startProgressiveLoads();

  // PWA metaphor: when network returns, resume larger-model progressive loads
  window.addEventListener("online", () => {
    registry.resumeProgressiveLoads();
    registry.refreshProgress();
    emit(EVT.PILL, { level: "ok", message: "online — resuming model loads" });
  });
  window.addEventListener("offline", () => {
    registry.refreshProgress();
    emit(EVT.PILL, {
      level: "warn",
      message: "offline — using cached ready models only",
    });
  });

  mountRuntimeStatus(document.getElementById("runtime-status"));
  mountPills(document.getElementById("pills"));
  mountModelList(document.getElementById("model-list"), registry);
  mountRunTree(document.getElementById("run-tree"));
  mountRoster(document.getElementById("roster-out"));
  mountAgentNotify(document.getElementById("agent-notify"), notify);
  mountAggressionControl(document.getElementById("aggression-control"), {
    getAggression: () => recruitUi.getAggression(),
    setAggression: (n) => recruitUi.setAggression(n),
  });
  mountMemoryPanel({
    headEl: document.getElementById("memory-head"),
    listEl: document.getElementById("memory-versions"),
    memoryAgent,
    bus,
  });
  mountChat({
    transcriptEl: document.getElementById("transcript"),
    formEl: document.getElementById("composer-form"),
    inputEl: document.getElementById("composer"),
    sendBtn: document.getElementById("btn-send"),
    chatAgent,
    getMessages: () => transcript.getMessages(),
  });

  // Background agents — one run each per full page load (non-blocking)
  startRecruiterOnBoot({ bus, notify });
  startPerformanceManagerOnBoot({ bus });

  const poll = createVersionPoll({ intervalMs: 30_000 });
  await poll.loadSeen();

  // Console/test remount: rehydrate only (does not load new JS)
  async function remount({ buildId } = {}) {
    await rehydrate();
    emit(EVT.PILL, {
      level: "ok",
      message: `rehydrated${buildId ? ` (${buildId})` : ""}`,
    });
  }

  // Update = cache-bust navigation so latest JS loads; IDB rehydrates on boot
  const soft = createSoftReset({ chatAgent });
  const banner = createUpdateBanner({
    root: document.getElementById("update-banner"),
    onUpdate: async (manifest) => {
      // Do NOT markUpdated before apply — only after successful load (softApplied)
      banner.hide();
      const result = await soft.softReset({ buildId: manifest.buildId });
      // softReset navigates on success (document unloads). If not, do not mark seen.
      if (result && result.ok === false) {
        emit(EVT.PILL, { level: "err", message: `update failed: ${result.error}` });
      }
    },
    onDismiss: async (manifest) => {
      banner.hide();
      await poll.markUpdated(manifest.buildId);
    },
  });

  // Register before full-load check so dismiss-only UPDATE is not dropped (FP11)
  on(EVT.UPDATE, (detail) => banner.show(detail));

  const params = new URLSearchParams(location.search);
  const softApplied = params.get("softApplied") === "1";
  const first = await poll.check({ isFullLoad: true });

  // Soft-apply Update landed: mark seen, hide any transient banner, pill
  if (softApplied && first.manifest?.buildId) {
    await poll.markUpdated(first.manifest.buildId);
    banner.hide();
    params.delete("softApplied");
    const clean = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
    history.replaceState(null, "", clean);
    emit(EVT.PILL, { level: "ok", message: "updated to latest build" });
  } else if (first.changed && first.manifest) {
    // Explicit show: full refresh/reopen → Dismiss-only notice (listener also fires)
    banner.show({
      manifest: first.manifest,
      mode: first.mode || "dismiss-only",
    });
  }

  if (params.has("forceUpdate") && first.manifest) {
    banner.show({ manifest: first.manifest, mode: "update-dismiss" });
  }
  poll.start();

  navigator.serviceWorker?.addEventListener("message", (ev) => {
    if (ev.data?.type === "push-update") poll.check({ isFullLoad: false });
  });

  const localWatch = createLocalWatch({
    onChange: () => soft.softReset({ buildId: `local-${Date.now()}` }),
  });

  wireChromeActions({ memoryStore, transcript, registry, memoryQueue, tree });

  const api = {
    runQualityGate,
    bindProjectFolder: () => getFolderBind().bind(),
    bindLocalWatch: () => localWatch.bind(),
    trySubscribePush,
    registry,
    memoryStore,
    softReset: () => soft.softReset(),
    remount,
    notify,
    runRecruiter: () =>
      bus.invoke({
        agentId: "recruiter",
        name: "scan-models",
        parentRunId: null,
        input: {},
      }),
    runPerformanceManager: () =>
      bus.invoke({
        agentId: "performance-manager",
        name: "review-performance",
        parentRunId: null,
        input: {},
      }),
    runCrew: (goal, opts = {}) =>
      bus.invoke({
        agentId: "crew-agent",
        name: "task loop",
        parentRunId: null,
        input: { goal, ...opts },
      }),
    approveNotify: (id) => notify.approve(id),
    setAggression: (n) => recruitUi.setAggression(n),
    getAggression: () => recruitUi.getAggression(),
  };
  window.__pwa = api;
  window.__pwaAgent = api; // legacy alias

  // Keep progress stage live while progressive loads finish (adapters also emit)
  const modelTimer = setInterval(() => registry.refreshProgress(), 1000);
  setTimeout(() => clearInterval(modelTimer), 20_000);

  trySubscribePush().then((r) => {
    if (r.ok) emit(EVT.PILL, { level: "ok", message: "Web Push subscribed" });
  });
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById("runtime-status");
  if (el) {
    el.textContent = "boot failed";
    el.className = "pill err";
  }
});
