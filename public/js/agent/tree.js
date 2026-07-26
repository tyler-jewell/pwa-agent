/** Hierarchical run tree state for UI (RunTreeEvent). */
import { emit, EVT } from "../core/events.js";
import { validateRunTreeEvent } from "../core/schema.js";

export function createRunTree() {
  /** @type {Map<string, object>} */
  const nodes = new Map();
  /** root run ids newest-first */
  let roots = [];

  function emitTree() {
    emit(EVT.RUN_TREE, { roots: listRoots() });
  }

  function listRoots() {
    return roots.map((id) => serialize(id)).filter(Boolean);
  }

  function serialize(id) {
    const n = nodes.get(id);
    if (!n) return null;
    return {
      ...n,
      children: (n.childIds || []).map((c) => serialize(c)).filter(Boolean),
    };
  }

  function push(event) {
    const err = validateRunTreeEvent(event);
    if (err) {
      console.warn("[run-tree]", err, event);
      return;
    }
    let node = nodes.get(event.runId);
    if (!node) {
      node = {
        runId: event.runId,
        parentRunId: event.parentRunId ?? null,
        agentId: event.agentId,
        name: event.name,
        status: event.status,
        ts: event.ts,
        detail: event.detail || {},
        childIds: [],
      };
      nodes.set(event.runId, node);
      if (event.parentRunId) {
        const parent = nodes.get(event.parentRunId);
        if (parent && !parent.childIds.includes(event.runId)) {
          parent.childIds.push(event.runId);
        }
      } else if (!roots.includes(event.runId)) {
        roots = [event.runId, ...roots].slice(0, 40);
      }
    } else {
      node.status = event.status;
      node.ts = event.ts;
      if (event.name) node.name = event.name;
      if (event.detail) node.detail = { ...node.detail, ...event.detail };
    }
    emitTree();
  }

  function clear() {
    nodes.clear();
    roots = [];
    emitTree();
  }

  return { push, listRoots, clear };
}
