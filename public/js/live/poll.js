/** Remote live update: poll version.json (FP11). Default ≤60s. */
import { validateVersionManifest } from "../core/schema.js";
import { kvGet, kvSet } from "../ports/storage.js";
import { emit, EVT } from "../core/events.js";

const SEEN_KEY = "lastSeenBuildId";
const POLL_MS = 30_000;

/**
 * @param {object} [opts]
 * @param {string} [opts.url]
 * @param {number} [opts.intervalMs]
 * @param {{ get: (k:string)=>Promise<any>, set: (k:string,v:any)=>Promise<void> }} [opts.storage]
 *        Optional storage (tests / non-IDB). Defaults to ports/storage kv.
 */
export function createVersionPoll({
  url = "/version.json",
  intervalMs = POLL_MS,
  storage = null,
} = {}) {
  let timer = null;
  let lastSeen = null;
  let currentManifest = null;
  /** Emit UPDATE once per buildId until Dismiss/Update. */
  let notifiedBuildId = null;

  async function storeGet(key) {
    if (storage?.get) return storage.get(key);
    return kvGet(key);
  }

  async function storeSet(key, value) {
    if (storage?.set) return storage.set(key, value);
    return kvSet(key, value);
  }

  async function loadSeen() {
    lastSeen = (await storeGet(SEEN_KEY)) || null;
  }

  async function setSeen(buildId) {
    lastSeen = buildId;
    await storeSet(SEEN_KEY, buildId);
  }

  async function fetchVersion() {
    const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`version.json ${res.status}`);
    const data = await res.json();
    const err = validateVersionManifest(data);
    if (err) throw new Error(err);
    return data;
  }

  async function check({ isFullLoad = false } = {}) {
    try {
      const data = await fetchVersion();
      currentManifest = data;
      if (!lastSeen) {
        await setSeen(data.buildId);
        return { changed: false, manifest: data, mode: null };
      }
      if (data.buildId !== lastSeen) {
        if (isFullLoad) {
          await setSeen(data.buildId);
          const mode = "dismiss-only";
          if (notifiedBuildId !== data.buildId) {
            notifiedBuildId = data.buildId;
            emit(EVT.UPDATE, {
              manifest: data,
              mode,
              reason: "full-load-latest",
            });
          }
          return { changed: true, manifest: data, mode };
        }
        if (notifiedBuildId !== data.buildId) {
          notifiedBuildId = data.buildId;
          emit(EVT.UPDATE, {
            manifest: data,
            mode: "update-dismiss",
            reason: "poll",
          });
        }
        return { changed: true, manifest: data, mode: "update-dismiss" };
      }
      return { changed: false, manifest: data, mode: null };
    } catch (e) {
      console.warn("[live/poll]", e);
      return { changed: false, error: e, mode: null };
    }
  }

  function start() {
    stop();
    timer = setInterval(() => check({ isFullLoad: false }), intervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function getManifest() {
    return currentManifest;
  }

  async function markUpdated(buildId) {
    const id = buildId || currentManifest?.buildId;
    await setSeen(id);
    notifiedBuildId = id;
  }

  return {
    loadSeen,
    check,
    start,
    stop,
    getManifest,
    markUpdated,
    get lastSeen() {
      return lastSeen;
    },
  };
}
