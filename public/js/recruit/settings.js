/**
 * Recruiter aggressiveness lever (1–5), durable via storage kv.
 */
import { kvGet, kvSet } from "../ports/storage.js";
import { clampAggression } from "./decide.js";

const KEY = "recruiterAggression";

export async function loadAggression(defaultValue = 3) {
  try {
    const v = await kvGet(KEY);
    if (v == null) return clampAggression(defaultValue);
    return clampAggression(v);
  } catch {
    return clampAggression(defaultValue);
  }
}

export async function saveAggression(value) {
  const n = clampAggression(value);
  await kvSet(KEY, n);
  return n;
}

export { clampAggression };
