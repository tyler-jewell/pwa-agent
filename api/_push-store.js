/**
 * Shared push subscription store for subscribe + notify-version.
 * Prefer Vercel KV / Upstash REST when env is set; else in-memory dev fallback.
 *
 * - One key per endpoint (no payload RMW races).
 * - Index via Redis SET (SADD/SREM/SMEMBERS) when KV supports it; else list fallback.
 */

const INDEX_KEY = "pwa:push-sub-index";
const PREFIX = "pwa:push-sub:";

/** @type {Map<string, object>} */
const memory = globalThis.__pwaPushSubs || (globalThis.__pwaPushSubs = new Map());

function kvConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function subKey(endpoint) {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (Math.imul(31, h) + endpoint.charCodeAt(i)) | 0;
  return `${PREFIX}${(h >>> 0).toString(16)}`;
}

async function kvFetch(path, init = {}) {
  const base = process.env.KV_REST_API_URL.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}

/** Upstash command API — atomic SADD/SREM vs list RMW. */
async function kvCmd(args) {
  const base = process.env.KV_REST_API_URL.replace(/\/$/, "");
  const res = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`kv cmd ${res.status}`);
  return res.json();
}

export function storageMode() {
  return kvConfigured() ? "vercel-kv" : "memory-dev-fallback";
}

async function kvGetJson(key) {
  const res = await kvFetch(`/get/${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const raw = data?.result;
  if (raw == null) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function kvSetJson(key, value) {
  await kvFetch(`/set/${encodeURIComponent(key)}`, {
    method: "POST",
    body: JSON.stringify(value),
  });
}

async function kvDel(key) {
  await kvFetch(`/del/${encodeURIComponent(key)}`, { method: "POST" });
}

async function indexAdd(endpoint) {
  try {
    await kvCmd(["SADD", INDEX_KEY, endpoint]);
  } catch {
    // Fallback list (best-effort) if SET commands unavailable
    const index = (await kvGetJson(INDEX_KEY)) || [];
    if (!index.includes(endpoint)) {
      index.push(endpoint);
      await kvSetJson(INDEX_KEY, index);
    }
  }
}

async function indexRemove(endpoint) {
  try {
    await kvCmd(["SREM", INDEX_KEY, endpoint]);
  } catch {
    const index = ((await kvGetJson(INDEX_KEY)) || []).filter((e) => e !== endpoint);
    await kvSetJson(INDEX_KEY, index);
  }
}

async function indexMembers() {
  try {
    const data = await kvCmd(["SMEMBERS", INDEX_KEY]);
    const result = data?.result;
    if (Array.isArray(result)) return result;
  } catch {
    /* fall through */
  }
  const list = await kvGetJson(INDEX_KEY);
  return Array.isArray(list) ? list : [];
}

export async function loadSubscriptions() {
  if (kvConfigured()) {
    try {
      const index = await indexMembers();
      const map = new Map();
      for (const endpoint of index) {
        const sub = await kvGetJson(subKey(endpoint));
        if (sub?.endpoint) map.set(sub.endpoint, sub);
      }
      memory.clear();
      for (const [k, v] of map) memory.set(k, v);
      return map;
    } catch {
      return new Map(memory);
    }
  }
  return new Map(memory);
}

export async function addSubscription(sub) {
  memory.set(sub.endpoint, sub);
  if (kvConfigured()) {
    try {
      await kvSetJson(subKey(sub.endpoint), sub);
      await indexAdd(sub.endpoint);
    } catch (e) {
      console.error("[push-store] kv add failed", e);
    }
  }
  return memory.size;
}

export async function removeSubscription(endpoint) {
  memory.delete(endpoint);
  if (kvConfigured()) {
    try {
      await kvDel(subKey(endpoint));
      await indexRemove(endpoint);
    } catch (e) {
      console.error("[push-store] kv remove failed", e);
    }
  }
}
