/**
 * MEMORY.md durable store — head + append-only versions (FP5).
 * Commits use single multi-store transaction (version + head).
 */
import { mvId, nowIso } from "../core/ids.js";
import { SEED_MEMORY, validateMemoryVersion, utf8Bytes, MEMORY_MAX } from "../core/schema.js";
import {
  allMemoryVersions,
  getMemoryVersion,
  commitMemoryHead,
  atomicWipeMemorySeed,
  kvGet,
  HEAD_KEY,
} from "../ports/storage.js";
import { emit, EVT } from "../core/events.js";

export function createMemoryStore() {
  let headId = null;
  let headContent = SEED_MEMORY;
  let versionsCache = [];

  async function load() {
    headId = (await kvGet(HEAD_KEY)) || null;
    versionsCache = await allMemoryVersions();
    if (!headId || !versionsCache.length) {
      await seed();
      return snapshot();
    }
    let head =
      versionsCache.find((v) => v.id === headId) || (await getMemoryVersion(headId));
    if (!head) {
      // Repair: head pointer missing — use newest by createdAt
      const sorted = versionsCache
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      head = sorted[0];
      if (head) {
        headId = head.id;
        headContent = head.content;
        await commitMemoryHead(head); // re-point head atomically
        emit(EVT.PILL, {
          level: "warn",
          message: "memory head repaired from newest version",
        });
      } else {
        await seed();
        return snapshot();
      }
    } else {
      headId = head.id;
      headContent = head.content;
    }
    emit(EVT.MEMORY, snapshot());
    return snapshot();
  }

  async function seed() {
    const v = {
      id: mvId(),
      createdAt: nowIso(),
      content: SEED_MEMORY,
      source: "seed",
      parentId: null,
      summaryWhy: "Initial blank-slate seed",
      diffFromParent: { added: [SEED_MEMORY], removed: [] },
    };
    await atomicWipeMemorySeed(v);
    headId = v.id;
    headContent = v.content;
    versionsCache = [v];
    emit(EVT.MEMORY, snapshot());
    return v;
  }

  function snapshot() {
    return {
      memoryHeadId: headId,
      headContent,
      versions: versionsCache
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    };
  }

  function getHead() {
    return { id: headId, content: headContent };
  }

  function simpleDiff(prev, next) {
    if (prev === next) return { added: [], removed: [] };
    return { added: [next.slice(0, 200)], removed: prev ? [prev.slice(0, 200)] : [] };
  }

  async function commit({ content, source, summaryWhy, parentId }) {
    if (typeof content !== "string") return { ok: false, error: "content required" };
    if (utf8Bytes(content) > MEMORY_MAX) {
      return { ok: false, error: "MEMORY exceeds 64 KiB" };
    }
    const requireWhy =
      source === "reflect" || source === "compact" || source === "router_lesson";
    if (requireWhy && !String(summaryWhy || "").trim()) {
      return { ok: false, error: "summaryWhy required" };
    }
    const normalized = content.endsWith("\n") ? content : content + "\n";
    if (normalized === headContent && (source === "reflect" || source === "user_edit")) {
      return { ok: false, error: "no-op", noop: true };
    }
    const parent = parentId !== undefined ? parentId : headId;
    const version = {
      id: mvId(),
      createdAt: nowIso(),
      content: normalized,
      source,
      parentId: parent,
      summaryWhy: summaryWhy || source,
      diffFromParent: simpleDiff(headContent, normalized),
    };
    const err = validateMemoryVersion(version, { requireWhy });
    if (err) return { ok: false, error: err };

    await commitMemoryHead(version);
    headId = version.id;
    headContent = version.content;
    versionsCache = await allMemoryVersions();
    emit(EVT.MEMORY, snapshot());
    return { ok: true, version };
  }

  async function restore(versionId) {
    const target =
      versionsCache.find((v) => v.id === versionId) || (await getMemoryVersion(versionId));
    if (!target) return { ok: false, error: "version not found" };
    return commit({
      content: target.content,
      source: "restore",
      summaryWhy: `Restored from ${versionId}`,
      parentId: headId,
    });
  }

  /** In-memory hydrate after atomicImportState (no write). */
  async function hydrateFrom(versions, newHeadId) {
    versionsCache = versions.slice();
    const head = versions.find((v) => v.id === newHeadId) || versions[versions.length - 1];
    headId = head.id;
    headContent = head.content;
    emit(EVT.MEMORY, snapshot());
  }

  async function replaceAll(versions, newHeadId) {
    if (!versions?.length) return { ok: false, error: "empty versions" };
    const head = versions.find((v) => v.id === newHeadId) || versions[versions.length - 1];
    // Prefer atomic path via export.importBundle; this remains for tests
    const { atomicImportState } = await import("../ports/storage.js");
    const tr = (await kvGet("transcript")) || { messages: [], updatedAt: nowIso() };
    await atomicImportState({ versions, headId: head.id, transcript: tr });
    await hydrateFrom(versions, head.id);
    return { ok: true };
  }

  async function wipeToSeed() {
    return seed();
  }

  return {
    load,
    seed,
    snapshot,
    getHead,
    commit,
    restore,
    replaceAll,
    wipeToSeed,
    hydrateFrom,
  };
}
