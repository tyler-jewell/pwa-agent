import { on, EVT } from "../core/events.js";
import { clear, escapeHtml } from "./render.js";

export function mountModelList(el, registry) {
  function render(detail) {
    const models = detail?.models || registry.list();
    const progress = detail?.progress || registry.progressSnapshot?.();
    clear(el);
    if (progress) {
      const stage = document.createElement("li");
      stage.className = "model-stage";
      stage.innerHTML =
        `<span class="stage-label">Stage: ${escapeHtml(progress.label)}</span>` +
        `<span class="pill ${progress.stageId === "enhancing" || progress.stageId === "shell" ? "warn" : "ok"}">${escapeHtml(progress.stageId)}</span>`;
      el.appendChild(stage);
    }
    // Quality ladder order: tiny → large
    const order = { tiny: 0, small: 1, medium: 2, large: 3 };
    const sorted = [...models].sort(
      (a, b) =>
        (order[a.capabilities?.qualityClass] ?? 9) -
        (order[b.capabilities?.qualityClass] ?? 9)
    );
    for (const m of sorted) {
      const li = document.createElement("li");
      const q = m.capabilities?.qualityClass || "?";
      const offline = m.constraints?.offlineReady ? " · offline" : "";
      li.innerHTML =
        `<span><strong>${escapeHtml(q)}</strong> ${escapeHtml(m.label)}${escapeHtml(offline)}</span>` +
        `<span class="pill ${statusClass(m.status)}">${escapeHtml(m.status)}</span>`;
      el.appendChild(li);
    }
    if (!models.length) {
      const li = document.createElement("li");
      li.textContent = "No models discovered yet";
      el.appendChild(li);
    }
  }
  on(EVT.MODELS, render);
  render({ models: registry.list(), progress: registry.progressSnapshot?.() });
}

function statusClass(s) {
  if (s === "ready") return "ok";
  if (s === "failed") return "err";
  if (s === "downloading") return "warn";
  return "muted";
}

export function mountRunTree(el) {
  function render(roots) {
    clear(el);
    if (!roots?.length) {
      el.textContent = "No runs yet";
      return;
    }
    for (const r of roots) el.appendChild(nodeEl(r, 0));
  }
  function nodeEl(n, depth) {
    const div = document.createElement("div");
    div.className = `run-node ${n.status}`;
    div.setAttribute("role", "treeitem");
    div.style.marginLeft = `${depth * 8}px`;
    div.textContent = `${n.agentId}: ${n.name} [${n.status}]`;
    for (const c of n.children || []) div.appendChild(nodeEl(c, depth + 1));
    return div;
  }
  on(EVT.RUN_TREE, (d) => render(d.roots));
}

/**
 * Restore goes through memory-agent (queue + pills). Prefer bus when provided
 * so the run tree records the restore child; else memoryAgent.restore.
 */
export function mountMemoryPanel({ headEl, listEl, memoryAgent, bus }) {
  function render(snap) {
    headEl.textContent = snap.headContent || "";
    clear(listEl);
    for (const v of snap.versions || []) {
      const li = document.createElement("li");
      const meta = document.createElement("span");
      meta.textContent = `${v.source} · ${v.id.slice(0, 14)}…`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = "Restore";
      btn.addEventListener("click", async () => {
        try {
          if (bus) {
            await bus.invoke({
              agentId: "memory-agent",
              name: "restore",
              parentRunId: null,
              input: { op: "restore", versionId: v.id },
            });
          } else if (memoryAgent) {
            await memoryAgent.restore(v.id);
          }
        } catch (e) {
          // bus/agent already emit error pills for structured failures
          console.error("[memory restore]", e);
        }
      });
      li.append(meta, btn);
      listEl.appendChild(li);
    }
  }
  on(EVT.MEMORY, render);
}

export function mountPills(el) {
  on(EVT.PILL, ({ level, message }) => {
    const span = document.createElement("span");
    span.className = `pill ${level === "ok" ? "ok" : level === "err" ? "err" : "warn"}`;
    span.textContent = message;
    el.appendChild(span);
    setTimeout(() => span.remove(), 8000);
  });
}

/** Agent notify cards with Approve / Dismiss (shared for all agents). */
export function mountAgentNotify(el, notify) {
  if (!el || !notify) return;
  on(EVT.AGENT_NOTIFY, (payload) => {
    if (!payload?.requireApproval) return;
    const card = document.createElement("div");
    card.className = "notify-card";
    card.dataset.notifyId = payload.id;
    card.innerHTML = `
      <strong>${escapeHtml(payload.title)}</strong>
      <p>${escapeHtml(payload.body)}</p>
      <div class="actions">
        <button type="button" class="btn primary" data-act="approve">Approve</button>
        <button type="button" class="btn" data-act="dismiss">Dismiss</button>
      </div>`;
    card.querySelector('[data-act="approve"]').addEventListener("click", () => {
      notify.approve(payload.id);
      card.remove();
    });
    card.querySelector('[data-act="dismiss"]').addEventListener("click", () => {
      notify.dismiss(payload.id);
      card.remove();
    });
    el.prepend(card);
  });
}

/** Live models roster panel (benchmark metrics). */
export function mountRoster(el) {
  if (!el) return;
  function render(detail) {
    if (detail?.markdown) {
      el.textContent = detail.markdown;
      return;
    }
    const models = detail?.models || [];
    if (!models.length) {
      el.textContent = "No trained models yet — recruiter may propose one after refresh.";
      return;
    }
    el.textContent = models
      .map((m) => {
        const s = m.metrics?.smartness ?? "—";
        const r = m.metrics?.tokenRate ?? "—";
        return `${m.label || m.id}: ${m.status} · smart ${s} · ${r} tok/s`;
      })
      .join("\n");
  }
  on(EVT.ROSTER, render);
  on(EVT.MODELS, (d) => {
    if (d?.models?.some((m) => m.metrics?.benchAt)) {
      render({ models: d.models });
    }
  });
}

/** Aggression lever (1–5) for recruiter. */
export function mountAggressionControl(el, { getAggression, setAggression }) {
  if (!el) return;
  el.innerHTML = `
    <label for="aggression-range">Recruiter aggression</label>
    <input id="aggression-range" type="range" min="1" max="5" step="1" />
    <span id="aggression-val" class="pill muted">3</span>`;
  const range = el.querySelector("#aggression-range");
  const val = el.querySelector("#aggression-val");
  getAggression?.().then((n) => {
    range.value = String(n);
    val.textContent = String(n);
  });
  range.addEventListener("input", () => {
    val.textContent = range.value;
  });
  range.addEventListener("change", async () => {
    const n = await setAggression?.(Number(range.value));
    val.textContent = String(n ?? range.value);
    emitPillOk(`Recruiter aggression → ${n ?? range.value}`);
  });
}

function emitPillOk(message) {
  // lazy import avoided — use dynamic event
  import("../core/events.js").then(({ emit, EVT }) => {
    emit(EVT.PILL, { level: "ok", message });
  });
}

export function mountRuntimeStatus(el) {
  on(EVT.RUNTIME, ({ text, level }) => {
    el.textContent = text;
    el.className = `pill ${level || "muted"}`;
  });
  on(EVT.LIMITED, ({ reason }) => {
    el.textContent = `limited: ${reason}`;
    el.className = "pill warn";
  });
}
