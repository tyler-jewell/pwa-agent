# PWA_LLM — browser personal agent research

**Status:** research synthesis (partial). Not MSA day-2 product path.  
**Date:** 2026-07-25.  
**Goal:** installable PWA with a light local LLM, offline after first visit, same UX in any browser, dead-simple personal agent with host-owned `MEMORY.md`.

**Relation to this repo:** day-2 is `msa web` (Rust server + cloud/loopback turns + `web-transcript.json`). This document is **greenfield client architecture**. Do not reintroduce egui `msa-chat`. OpenClaw is **reference only** (K-WRAP). Shipping this *inside* mac-studio-agents would need a separate product decision (browser JS/WASM stack vs pure-Rust crates law).

---

## Bottom line

Pure client-side PWA:

1. Local LLM in the browser (WebLLM or Transformers.js).  
2. Precache app shell + model (Service Worker + Cache API) so first online visit enables offline use after refresh.  
3. One `MEMORY.md` injected every turn as long-term memory.  
4. Chat history + memory in browser storage (not a server).

Closest prior art: ShadowClaw / OpenClaw-style `MEMORY.md` + async memory pipelines (Codex, ChromeClaw). Strict policies below—auto rewrite after every turn, hard history wipe at ~50% context, non-blocking memory worker—are **design choices you implement**, not a stock product.

---

## Target behavior

| Concern | Policy |
|---------|--------|
| Runtime | Inference on-device in the browser; no chat server required after first model download |
| Offline | After first visit: refresh works with no network (shell + model cached) |
| Identity | Personal assistant; knows nothing until learned; does what the human asks |
| Durable memory | Single `MEMORY.md` always in system context |
| Memory write | Host rewrites `MEMORY.md` after exchanges without blocking main generation |
| Context pressure | When history &gt; ~50% of model window: summarize, update `MEMORY.md`, **physically replace** stored history with summary only |
| Next turn | System (`MEMORY.md`) + remaining context only |

---

## Architecture (implement)

```
Installable PWA (same-origin storage)
├── Service Worker: precache UI shell
├── Cache API (+ storage.persist()): model + large assets
├── Main path: identity + MEMORY.md + budgeted history → local LLM stream
├── Async path: post-turn / idle rewrite of MEMORY.md
│                at >50% window: summarize → rewrite MEMORY.md → replace history
└── Storage: MEMORY.md + transcript (IDB/OPFS); model blobs (Cache)
```

1. **Shell** — installable PWA; SW precache; optional `navigator.storage.persist()`.  
2. **Runtime** — WebLLM (WebGPU, OpenAI-compatible) or Transformers.js (WASM/WebGPU).  
3. **State** — one `MEMORY.md` in durable client storage; transcript separate; re-read memory every invoke.  
4. **Per-turn memory** — background/async rewrite (tool full rewrite, idle pipeline, or host consolidation); never block streaming.  
5. **Compaction gate** — estimate tokens vs window; at threshold, async summarize + full `MEMORY.md` update + replace transcript with summary only.

---

## In-browser model and offline PWA

### WebLLM (mlc-ai/web-llm)

- Inference entirely in browser via WebGPU; OpenAI-compatible chat API; no server required.  
- Model files in Cache API after first download; offline inference from cache.  
- Service Worker API keeps engine across visits; browsers may kill SW — heartbeats / re-init required.  
- Docs: [web-llm](https://github.com/mlc-ai/web-llm), [web.dev chatbot](https://web.dev/articles/ai-chatbot-webllm).

### Transformers.js

- Hugging Face–style models via ONNX Runtime; default WASM/CPU, optional WebGPU.  
- Browser Cache API caching on by default; WASM cache for offline reuse.  
- Stronger **CPU/WASM fallback** when WebGPU is missing.  
- Docs: [Transformers.js](https://huggingface.co/docs/transformers.js/en/index).

### Caching large models

- Chrome: Cache API primary store for large model blobs; prefer over OPFS/IndexedDB for weights (serialize cost).  
- Request persistent storage; quota/eviction is browser-specific.  
- Fully offline after refresh needs **both** model cache **and** SW cache-first app shell (HTML/JS/WASM).  
- Docs: [Cache models](https://developer.chrome.com/docs/ai/cache-models), [PWA caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching).

### Browser reality

- WebGPU is in major browsers but coverage is incomplete by OS/version; “GPU everywhere” is false.  
- For true multi-browser: plan WASM/CPU path (Transformers.js or equivalent) with smaller models.  
- Engine in-memory state may die with SW even when weights remain on disk/cache.

**Pick:** WebLLM when WebGPU chat is the priority; Transformers.js when broader pipeline + WASM fallback matter. No source ranks one universally “best” for personal agents.

---

## MEMORY.md as system prompt and durable memory

### Pattern

- Single long-term file, plain Markdown, no hidden second store.  
- Every agent invoke: re-read file → inject under e.g. `## Persistent Memory`.  
- Pair with token-budgeted chat history from IndexedDB (or OPFS for workspace text).  
- Identity line style (ShadowClaw): personal AI assistant running in the client’s browser.  
- Map target copy to bootstrap: knows nothing until learned; does what the human asks.

### Prior art

| System | Behavior |
|--------|----------|
| **ShadowClaw** | Re-reads `MEMORY.md` each invoke; IndexedDB chat history; OPFS workspace |
| **OpenClaw** | Disk `MEMORY.md` curated long-term memory; inject with per-file/total char budgets; oversized stays on disk, inject may truncate |
| **ChromeClaw** | Chats in IndexedDB; `MEMORY.md` as auto-curated workspace summary |
| **Claude Code** | Live session read/write via normal file tools |
| **Codex** | Background extract → consolidate into `MEMORY.md` / summaries after idle |

OpenClaw memory overview: [docs.openclaw.ai/concepts/memory](https://docs.openclaw.ai/concepts/memory).  
OpenClaw system prompt: [docs.openclaw.ai/concepts/system-prompt](https://docs.openclaw.ai/concepts/system-prompt).

---

## Updating MEMORY.md without blocking the main turn

**Finding:** no inspected product matches “host rewrites `MEMORY.md` after every human+agent exchange on a parallel non-blocking task” exactly.

| System | Write path |
|--------|------------|
| ShadowClaw | Model `update_memory` tool → full rewrite (OPFS); load on later invokes — not automatic post-turn host write |
| ChromeClaw | Journaling often on session end / chat switch |
| Codex | Background after chats idle long enough; two-phase: per-rollout extract, then global consolidate offline from live turn |
| Claude Code | In-session tools; no detached extractor |
| OpenClaw Dreaming | Opt-in cron; deep phase promotes into `MEMORY.md` |
| OpenClaw flush | Silent **pre-compaction** turn reminding model to save — not a Web Worker beside chat |

**Synthesis for this design:** main chat on UI path; separate async path (idle/post-turn worker, tool rewrite, or host consolidation) rewrites `MEMORY.md` so the **next** invoke reloads it. “Every turn, parallel, never slow UI” is **stricter** than most shipping systems — implement as product policy.

“Web Workers” in requirements may mean figurative background work; no primary source proved Workers as the `MEMORY.md` writer for Codex / Claude Code / OpenClaw.

---

## Context pressure, summarization, history replace

### What production systems do

- Usually shrink **what the model sees**, not wipe every stored byte.  
- OpenClaw compaction: summarize older conversation, keep recent messages, **leave full history on disk** by default.  
- Pre-compaction silent memory flush can write durable notes so facts survive summarization.  
- OpenClaw ~50% (`hardClearRatio` default 0.5) is for session pruning of **old tool results** (in-memory), not “summarize all chat and discard transcript.”  
- Docs: [compaction](https://docs.openclaw.ai/concepts/compaction), [session pruning](https://docs.openclaw.ai/concepts/session-pruning).

### Target policy (stricter)

1. Estimate tokens vs model window.  
2. At history &gt; ~50%: non-UI job summarizes full history and comprehensively updates `MEMORY.md`.  
3. **Physically replace** stored transcript with summary only (or empty + summary message).  
4. Following turn: summary + `MEMORY.md` only.

OpenClaw optional `truncateAfterCompaction` creates a successor transcript — still not the same as discarding all prior history so only summary + `MEMORY.md` remain.

---

## What mac-studio-agents does today

| MSA day-2 | This PWA design |
|-----------|-----------------|
| `msa-web` + Grok/Claude (or loopback) server turns | Client-side local model |
| Durable `~/.config/msa/agents/&lt;agent&gt;/web-transcript.json` | Browser IDB/OPFS |
| Append full message list; no context % gate | 50% wipe + summary |
| No `MEMORY.md` background pipeline | Host-owned `MEMORY.md` each turn |
| admin-agent: provider session owns memory after bind | App-owned memory file pipeline |

No Web Workers, post-turn flush, or deferred consolidation in tree. Compact-at-~50% notes referring to removed `msa-chat` must not be treated as live implementation. Building this agent is **greenfield**, not a small extension of `msa-web`.

---

## Suggested build sequence

1. **Spike** — WebLLM (or Transformers.js) PWA shell + small model + Cache API + SW offline smoke.  
2. **Memory v0** — static `MEMORY.md` inject + tool/`update_memory` full rewrite (ShadowClaw-style).  
3. **Memory v1** — post-turn or idle async rewrite; never block streaming.  
4. **Compaction** — token estimate → 50% gate → summarize → replace history.  
5. **Product decision** — stay external greenfield vs new MSA surface (law, packaging, and browser stack).

---

## Coverage gaps and uncertainty

- No universal ranking WebLLM vs Transformers.js for “personal agent.”  
- WebGPU not uniform on every browser/OS; WASM path required for “any browser” claims.  
- Model Cache alone ≠ offline PWA; shell/JS/WASM must be SW-cached too.  
- SW kill + storage eviction without `persist()` remain real failure modes.  
- Exact system-prompt wording “knows nothing… does whatever human asks” not found as a primary quote; closest is ShadowClaw personal-assistant identity.  
- No production source guaranteed automatic `MEMORY.md` rewrite after **every** turn; Codex idle, OpenClaw cron/flush, ShadowClaw tool-driven.  
- Letta-style non-blocking observer patterns cited in proposals; not proven `MEMORY.md` write path.  
- Secondary sources on Codex phases need open-source/config confirm for exact idle defaults.  
- MSA has no remaining `msa-chat` source for historical compact-at-50% behavior.

---

## Primary sources

| Id | Source |
|----|--------|
| S1 | [mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) |
| S2 | [web.dev WebLLM chatbot](https://web.dev/articles/ai-chatbot-webllm) |
| S4 | [Transformers.js](https://huggingface.co/docs/transformers.js/en/index) |
| S5 | [Chrome cache models](https://developer.chrome.com/docs/ai/cache-models) |
| S6 | [MDN PWA caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching) |
| S7–S8 | ShadowClaw invoke / `update_memory` (jsDelivr `xt-ml/shadow-claw`) |
| S9–S10 | OpenClaw [memory](https://docs.openclaw.ai/concepts/memory), [system prompt](https://docs.openclaw.ai/concepts/system-prompt) |
| S11 | [ChromeClaw](https://github.com/algopian/chromeclaw) |
| S12–S13 | Codex memories / agent memory engineering writeups |
| S14 | [Claude Code memory](https://code.claude.com/docs/en/memory) |
| S15–S16 | OpenClaw [dreaming](https://docs.openclaw.ai/concepts/dreaming), memory overview |
| S17–S20 | Local: `agents/admin-agent/AGENTS.md`, `crates/msa-web`, `CONCERNS.md`, STANDARDS |
| S21–S23 | OpenClaw [compaction](https://docs.openclaw.ai/concepts/compaction), [session pruning](https://docs.openclaw.ai/concepts/session-pruning) |

---

## One-line SSOT

**Client PWA + cached local LLM + always-injected `MEMORY.md` + async memory rewrite + hard 50% history replace.** Not `msa web` today; implement as greenfield or explicit new product path.
