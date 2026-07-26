/** Canonical id prefixes per README contracts. */
let _n = 0;
function rand() {
  return Math.random().toString(36).slice(2, 10);
}

export function newId(prefix) {
  _n += 1;
  return `${prefix}_${Date.now().toString(36)}_${rand()}_${_n}`;
}

export const msgId = () => newId("msg");
export const mvId = () => newId("mv");
export const runId = () => newId("run");
export const modelId = () => newId("model");

export function nowIso() {
  return new Date().toISOString();
}
