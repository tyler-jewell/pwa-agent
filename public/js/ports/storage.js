/**
 * IndexedDB durable store for MEMORY versions, transcript, prefs.
 * Shared connection; multi-store transactions for atomic commits/import.
 * Constraint: schedule all IDB requests synchronously when opening a tx
 * (do not await non-IDB work mid-transaction — tx may auto-commit).
 */

/** Product id `pwa`. Legacy DB name `pwa-agent` is opened only for one-time migration. */
const DB_NAME = "pwa";
const LEGACY_DB_NAME = "pwa-agent";
const DB_VERSION = 1;
const HEAD_KEY = "memoryHeadId";
const TRANSCRIPT_KEY = "transcript";

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

function ensureStores(db) {
  if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
  if (!db.objectStoreNames.contains("memoryVersions")) {
    db.createObjectStore("memoryVersions", { keyPath: "id" });
  }
}

/** One-time copy from legacy DB name if new DB is empty. */
function migrateLegacyIfEmpty(db) {
  return new Promise((resolve) => {
    const tx = db.transaction(["kv", "memoryVersions"], "readonly");
    const countReq = tx.objectStore("memoryVersions").count();
    countReq.onsuccess = () => {
      if (countReq.result > 0) {
        resolve();
        return;
      }
      const leg = indexedDB.open(LEGACY_DB_NAME, DB_VERSION);
      leg.onerror = () => resolve();
      leg.onsuccess = () => {
        const old = leg.result;
        if (!old.objectStoreNames.contains("memoryVersions")) {
          old.close();
          resolve();
          return;
        }
        const rtx = old.transaction(["kv", "memoryVersions"], "readonly");
        const versions = [];
        rtx.objectStore("memoryVersions").openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (c) {
            versions.push(c.value);
            c.continue();
          }
        };
        const kv = {};
        rtx.objectStore("kv").openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (c) {
            kv[c.key] = c.value;
            c.continue();
          }
        };
        rtx.oncomplete = () => {
          old.close();
          if (!versions.length) {
            resolve();
            return;
          }
          const wtx = db.transaction(["kv", "memoryVersions"], "readwrite");
          for (const v of versions) wtx.objectStore("memoryVersions").put(v);
          for (const [k, val] of Object.entries(kv)) wtx.objectStore("kv").put(val, k);
          wtx.oncomplete = () => resolve();
          wtx.onerror = () => resolve();
        };
      };
    };
    countReq.onerror = () => resolve();
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => ensureStores(req.result);
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      migrateLegacyIfEmpty(db).then(() => resolve(db));
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function reqOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("idb abort"));
  });
}

/** Run fn(stores) with a multi-store transaction; schedule IDB ops synchronously. */
export async function withTransaction(storeNames, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(storeNames, mode);
  const stores = {};
  for (const name of storeNames) stores[name] = tx.objectStore(name);
  fn(stores, tx);
  await txDone(tx);
}

export async function kvGet(key) {
  const db = await openDb();
  const tx = db.transaction("kv", "readonly");
  const result = await reqOf(tx.objectStore("kv").get(key));
  await txDone(tx);
  return result;
}

export async function kvSet(key, value) {
  return withTransaction(["kv"], "readwrite", (s) => {
    s.kv.put(value, key);
  });
}

export async function kvDelete(key) {
  return withTransaction(["kv"], "readwrite", (s) => {
    s.kv.delete(key);
  });
}

export async function putMemoryVersion(v) {
  return withTransaction(["memoryVersions"], "readwrite", (s) => {
    s.memoryVersions.put(v);
  });
}

/** Atomic: write version + head pointer in one transaction. */
export async function commitMemoryHead(version, headKey = HEAD_KEY) {
  return withTransaction(["memoryVersions", "kv"], "readwrite", (s) => {
    s.memoryVersions.put(version);
    s.kv.put(version.id, headKey);
  });
}

export async function getMemoryVersion(id) {
  const db = await openDb();
  const tx = db.transaction("memoryVersions", "readonly");
  const result = await reqOf(tx.objectStore("memoryVersions").get(id));
  await txDone(tx);
  return result;
}

export async function allMemoryVersions() {
  const db = await openDb();
  const tx = db.transaction("memoryVersions", "readonly");
  const result = await reqOf(tx.objectStore("memoryVersions").getAll());
  await txDone(tx);
  return result || [];
}

export async function clearMemoryVersions() {
  return withTransaction(["memoryVersions"], "readwrite", (s) => {
    s.memoryVersions.clear();
  });
}

export async function replaceAllMemoryVersions(versions) {
  return withTransaction(["memoryVersions"], "readwrite", (s) => {
    s.memoryVersions.clear();
    for (const v of versions) s.memoryVersions.put(v);
  });
}

/**
 * Atomic import: replace all memory versions + head + transcript in one tx.
 * All-or-nothing per README AgentExportBundle.
 */
export async function atomicImportState({ versions, headId, transcript }) {
  return withTransaction(["memoryVersions", "kv"], "readwrite", (s) => {
    s.memoryVersions.clear();
    for (const v of versions) s.memoryVersions.put(v);
    s.kv.put(headId, HEAD_KEY);
    s.kv.put(transcript, TRANSCRIPT_KEY);
  });
}

/** Atomic wipe memory head + versions to a seed version. */
export async function atomicWipeMemorySeed(seedVersion) {
  return withTransaction(["memoryVersions", "kv"], "readwrite", (s) => {
    s.memoryVersions.clear();
    s.memoryVersions.put(seedVersion);
    s.kv.put(seedVersion.id, HEAD_KEY);
  });
}

export { HEAD_KEY, TRANSCRIPT_KEY };
