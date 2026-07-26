# Progressive Web Agent (`pwa`)

**Day-one goal:** a **Progressive Web Agent** in the browser that grows the way a PWA grows—from thin and immediate to capable and offline—and that you can watch improve itself in one transparent feed.

By day one, **pwa** is built to:

1. **Progressively load models** — start with the **tiniest** on-device model that can answer now, then load **more complex** models in the background and route to the best fit over time (same progressive spirit as shell → network → offline).  
2. **Self-improve core memory** — host-owned **`MEMORY.md`** is always injected, versioned, and rewritten after turns so the agent gets better at *this* human without a cloud brain.  
3. **Create other agents** that can do the same (own memory loop, model progression, transparent work)—orchestrated so capability compounds beyond a single chat surface.  
4. **Show everything in the main agent feed** — hierarchical run tree / feed so routing, memory updates, and child-agent work stay **visible**, not hidden side effects.  
5. **Army of small smart people** — each agent/model is capability- and context-aware, hands unfinished work to a successor with a structured handoff, runs a **bounded loop** until the task finishes or budget ends, and always ends with an **honest report** of achieved vs not-achieved (never silent abandon or unearned success).

Short name / machine id: **`pwa`**. Human product name: **Progressive Web Agent**.

This repository’s **product and engineering law** lives in two files only:

| File | Role |
|------|------|
| **`README.md`** (this file) | What we build, first principles, architecture, contracts, public-complete roadmap + acceptance, standards URLs, **pre-commit checklist** |
| **`AGENTS.md`** | How coding agents implement from an empty tree using this README |

**Every change ready to commit** must pass the [Pre-commit checklist](#pre-commit-checklist). That gate runs **inside the PWA in the browser only** — same origin as the agent. No Node, no npm, no CI server, no separate process. Day-one chat-agent (or Quality UI) must be able to run it.

Product evolution is tracked by **git history** (and optional tags), not by littering docs with release labels. Where scope must be bounded, this file says **public-complete** or **later**. Export bundles use integer `schemaVersion` for data compatibility only.

---

## What this is

A **static, installable Progressive Web Agent** anyone can open in a modern browser that:

1. **Chats immediately** on a **tiny** on-device model, then **progressively** brings larger/more capable models online in the background.  
2. **Self-improves `MEMORY.md`** over time (facts + policy lessons), always injected, always visible, versioned.  
3. **Creates and runs other agents** that can themselves progress models and memory—**transparently in the main agent feed** (today: `chat-agent` → `memory-agent` / `router-agent` / **`recruiter`** / **`trainer`** / **`performance-manager`** / **`crew-agent`**; broader spawn is the product direction).  
4. Treats the roster as an **army of small smart people**: each unit knows its capability class and context budget, **hands off** when it cannot finish, **loops** until complete or exhausted, and **reports honestly** what was and was not achieved.  
5. Stays **local-first** for chat/memory/models: no product accounts, no required chat backend, no telemetry.  
6. **Live update by default** (local | remote): deploys and local edits reach open clients without a manual full refresh when possible.  
7. **Hosts only on Vercel** (public Deploy Button; serverless only for version/Web Push notify).

**Value-add is our core engine** (turn · router · memory · task-loop/handoff · live-update · quality · agent bus). Inference frameworks (WebLLM, Transformers.js, …) and platform APIs are **modular adapters**. HTMX/Alpine/etc. are **not** the live-update engine. If you delete a framework, the core remains; if you delete the core, nothing product-like remains.

**Continuous “to infinity” (honest bound):** one-click Vercel deploy + git `main` → production is the continuous delivery surface; open clients poll `version.json` (and optional push) forever. **Self-improvement is continuous but bounded**—background agents and crew loops re-run on refresh / multi-step work, write MEMORY and honest reports, and **always terminate** (complete or incomplete with reasons). Not unbounded AGI, not infinite unattended training.

### Production readiness (evidence bar — not marketing)

We do **not** claim mathematical 100% certainty or forever-zero defects. We claim a **production modular PWA** when all of the following are true and tested:

| Bar | Meaning | How proven |
|-----|---------|------------|
| **Modular** | Cores (turn · router · memory · agent · task · live · quality) have **no vendor inference/UI SDKs**; models enter only via **RuntimeAdapter** + registry | `checkCorePurityFromText`, `validateRuntimeAdapter`, dual-adapter discover tests |
| **Simple** | Static ES modules under `public/`; zero required npm install for the app; mock chats offline | `package.json` has no deps; mock adapter ready on boot |
| **Novel product shape** | Progressive models + MEMORY self-improve + transparent multi-agent feed + capability handoff/loop/honesty | Day-one goals + matching `test/*.test.mjs` |
| **Improve over time** | Each autonomous cycle can deepen MEMORY / model readiness / honest reports; incomplete work is explicit | performance-manager + crew multi-cycle tests; never silent success |
| **Deployable** | Vercel Deploy Button, no required secrets; live poll learns new `version.json` | tracked `public/` + `vercel.json` + api degrade; poll tests |

**Guaranteed to improve** means: **if the agent runs its bounded loops, durable improvement-oriented state is written or an honest incomplete report is produced**—not that every human goal succeeds or scores only rise forever.

---

## What this is not (public-complete)

| Out of scope until “later” | |
|----------------------------|--|
| Speech STT/TTS | Text chat first |
| Arbitrary tools beyond memory-agent + router-agent | Expand the bus later |
| Full any-agent-calls-any mesh shipped | Product goal is create-other-agents; ships chat-agent + memory/router/**recruiter**/**trainer** with transparent feed; full mesh expands later |
| Multi-cloud hosting (Firebase/CF/Netlify parity) | **Vercel only** for public-complete |
| Chat/inference as a cloud product dependency | On-device default; Vercel serverless only for deploy/version push |
| Accounts, multi-user, telemetry product | Never for this product shape |
| Framework gravity (React required, Electron, OpenClaw wrap) | Vanilla static ES modules |
| HTMX/Vite as required live-update foundation | We own `live/`; no-build libs optional later for UI only |

**Public-complete** means every item in [Public-complete roadmap](#public-complete-roadmap) passes its acceptance on browsers the [matrix](#browser-support-matrix) honestly reports—not identical quality on every device.

---

## First principles (laws — not roadmap rows)

Roadmap items **implement** principles. Principles are not checklist fluff.

| ID | Principle | Meaning |
|----|-----------|---------|
| **FP0** | Core purity | Product semantics in *our* modules. Frameworks are adapters only. No vendor imports inside `core` / turn / memory / router / agent bus. |
| **FP1** | Local-first progressive chat | Primary UX is private chat. Tiny model ASAP; larger models in parallel; never brick the app waiting for a huge download. |
| **FP2** | Equal trio | **Turn · Router · Memory** are peer cores—not plugins of each other. |
| **FP3** | Dynamic capability-aware routing | Models are **discovered**, never a hardcoded catalog in source. Shared capability/constraint measurement. Selection uses device + task; lessons may land in MEMORY.md. |
| **FP4** | Stream-first | Token streaming to the human is not blocked on reflect, download, or subagent bookkeeping (subagents stream into the **tree**). |
| **FP5** | MEMORY as durable self | One `MEMORY.md`: facts + policy lessons. Always injected. Full version history. Visible. Mutated via **memory-agent**. |
| **FP6** | chat-agent is sole tool principal | Only **chat-agent** is the human-facing principal. Bus agents: **memory-agent**, **router-agent**, **recruiter**, **trainer**, **performance-manager**, **crew-agent** (bounded multi-step loops). Host may invoke background bus agents on refresh. Live hierarchical tree. |
| **FP7** | Finite context discipline | Real windows. `estimateTokens`; compact when `T_total >= 0.50 * W`; physical history replace. Every unit of work records tokens used vs window. |
| **FP8** | User sovereignty | Export / import / clear. No telemetry backend. |
| **FP9** | Platform honesty | Offline/install/storage via **[Standards & references](#standards--references-living)**—never freeze API recipes in AGENTS. Matrix is evidence. Progressive degrade is success. |
| **FP10** | Evidence-based readiness | Done = acceptance + browser self-tests + honest matrix. Mock backends prove the engine in-page. |
| **FP11** | Live update by default | Local + remote: detect new code/deploy; notify; **Update** = soft-reset; full load always takes latest without approval; durable state survives soft-apply when possible. |
| **FP12** | Vercel-native delivery | **Only supported host is Vercel.** One-click Deploy Button; git push `main` → production; serverless **only** for version/Web Push notify (optional keys). |
| **FP13** | Capability-aware crew | Agents/models act as an army of small smart people: always cognizant of quality class + context budget; never work “blind” to capacity. |
| **FP14** | Structured handoff | When capacity or context is insufficient, pack a handoff (goal, done so far, remaining, constraints) for a successor—no re-deriving the task from scratch. |
| **FP15** | Loop-to-completion | Multi-step work runs a **bounded** loop (max steps / context fraction): tick → act or hand off → reassess until complete, exhausted, or explicit stop. Open tasks never silently drop. |
| **FP16** | Honest outcomes | Every finished or forced-stop loop yields achieved vs not-achieved (with why when incomplete). Never claim success without matching evidence. |

---

## Architecture

```
git push main ──► Vercel (static public/ + api/ notify) ──► version.json + Web Push
                              │
                              ▼
UI: chat · run tree · MEMORY · model status · update banner
              │
              ▼
┌──────────────────────────────────────────────┐
│  CORE (ours)                                 │
│  turn/ · router/ · memory/ · agent/ · task/  │
│  live/     version poll, soft-reset, banner  │
│  quality/  browser pre-commit gate           │
│  schema/   contracts                         │
└──────┬──────────┬───────────┬────────────────┘
       │          │           │
  inference   storage     platform + push SW
  adapters    (origin)    (standards; Vercel api for push only)
```

**Stack law:** Chat/memory/quality/live-update client logic is **browser-only** (vanilla ES modules). No Node quality CLIs. No required SPA bundler.

**Hosting law:** **Vercel only** for public-complete. Static `public/` + minimal `api/` for subscribe/notify. Agents implementing deploy/UI hosting **must use current Vercel skills** (plugin), not frozen recipes in this file.

**HTMX / no-build note:** HTMX shines at server-driven HTML/SSE swaps—not at watching static repo files. Live update is **our** `live/` module + `version.json` + optional Web Push. Alpine/htmx may appear later as optional UI adapters only.

**Target tree (create when implementing):**

```
vercel.json                 # static + api; Deploy Button safe
api/                        # subscribe + notify-version (push only)
public/
  index.html
  version.json              # buildId + changelog digest (deploy-generated)
  styles.css
  manifest.webmanifest
  sw.js
  js/
    main.js
    core/
    turn/
    router/
    memory/
    agent/
    live/                   # poll, soft-reset, banner
    quality/
    ports/
    adapters/
    ui/
CHANGELOG.md                # human notes → version.json summary
```

---

## Product contracts (binding)

Field names are canonical. When contracts change, update this README in the same change as code; **git history** is the version trail. Use a single integer `schemaVersion` on export bundles only (start at `1`, bump when incompatible).

### Data schemas

#### MemoryVersion

```json
{
  "id": "mv_…",
  "createdAt": "ISO-8601",
  "content": "# Memory\n\n…",
  "source": "reflect | compact | restore | import | seed | user_edit | router_lesson",
  "parentId": "mv_… | null",
  "summaryWhy": "string",
  "diffFromParent": { "added": [], "removed": [] }
}
```

- `content` max **64 KiB** UTF-8; reject oversize.
- Exactly one **head** (`memoryHeadId`). History is **append-only**.
- Seed on first run: empty template `# Memory\n\n_(empty — learn from this human.)_\n`, `source: "seed"`, `parentId: null`.
- `summaryWhy` required non-empty when commit succeeds for `reflect` | `compact` | `router_lesson`.

#### ChatMessage

```json
{
  "id": "msg_…",
  "role": "user | assistant | system | summary",
  "content": "string",
  "createdAt": "ISO-8601",
  "meta": {}
}
```

#### Transcript

```json
{ "messages": [], "updatedAt": "ISO-8601" }
```

After compaction: no pre-compaction user/assistant turns—only system as needed + one `summary` (physical replace).

#### ModelRecord (discovered — never a hardcoded catalog in source)

```json
{
  "id": "model_…",
  "source": "discovered",
  "backendId": "string",
  "label": "string",
  "capabilities": {
    "contextWindowTokens": 1,
    "supportsStreaming": true,
    "modalities": ["text"],
    "qualityClass": "tiny | small | medium | large"
  },
  "constraints": {
    "approxBytes": 0,
    "requiresWebGpu": false,
    "minRamHintMb": 0,
    "offlineReady": false
  },
  "status": "announced | downloading | ready | failed | evicted",
  "metrics": { "latencyP50Ms": null, "failCount": 0, "successCount": 0 }
}
```

Adapters **announce** models into the registry. App code must not ship a frozen list of model IDs as the only catalog (bootstrap discovery from adapters is fine).

#### RunTreeEvent (hierarchical UI)

```json
{
  "runId": "run_…",
  "parentRunId": null,
  "agentId": "chat-agent | memory-agent | router-agent | recruiter | trainer | performance-manager",
  "name": "string",
  "status": "started | streaming | ok | error",
  "ts": "ISO-8601",
  "detail": {}
}
```

#### AgentExportBundle

```json
{
  "schemaVersion": 1,
  "exportedAt": "ISO-8601",
  "app": "pwa",
  "memoryHeadId": "mv_…",
  "memoryVersions": [],
  "transcript": { "messages": [], "updatedAt": "ISO-8601" },
  "modelsSnapshot": [],
  "runtimeHint": { "backendId": "string", "modelId": "string" }
}
```

Import: validate `schemaVersion`; atomic replace of memory + transcript (all or nothing). `runtimeHint` / `modelsSnapshot` soft. Corrupt file → UI error.

---

### Runtime adapter port

Core depends only on this port (conceptual):

```text
RuntimeErrorCode: unavailable | load_failed | oom | cancelled | infer_failed | unsupported

RuntimeAdapter:
  id: string
  discover(): Promise<ModelRecord[]>          # no hardcode in core
  getCapabilities(modelId): … | null
  load(modelId, opts?): Promise<void>
  unload(modelId?): Promise<void>
  chatStream({ system, messages, modelId, signal? }): AsyncIterable<string>
  complete?({ system, messages, modelId, maxTokens?, signal? }): Promise<string>
```

- Ship a **mock** adapter for instant UI and in-browser self-tests.
- Real backends live under `adapters/` and register via discovery.
- Errors surface as `{ code, message }`.

---

### Progressive models

1. On startup, discover models; pick best **ready tiny** (or start its load first).
2. User can chat when any ready model exists.
3. **In parallel**, download/cache larger announced models; update `ModelRecord.status`.
4. **router-agent** (via chat-agent) chooses model per turn from **ready** set using device probes + task complexity + MEMORY lessons + metrics.
5. Never block the send path on a large download finishing.

---

### Agents and bus

| Agent | Role |
|-------|------|
| **chat-agent** | Only principal that talks to the human and may call subagents |
| **memory-agent** | Reflect / validate / commit MEMORY; restore helpers; compaction assist |
| **router-agent** | Probe device; rank models; recommend modelId; may propose MEMORY lessons |

- Human UI cannot call tools except by chatting with chat-agent.
- Every subagent invocation emits **RunTreeEvent**s; UI shows a live tree (root = chat-agent).
- Later, other agents may call agents; keep the same tree model.

---

### Turn lifecycle

```
1. User message → append ChatMessage user
2. chat-agent starts run (tree root)
3. Optional: call router-agent → modelId (tree child); do not block stream setup longer than needed
4. Build prompt: identity system + MEMORY head + transcript (budgeted)
5. chatStream(modelId) → stream assistant tokens to UI; append assistant message when done
6. After stream settles: enqueue memory-agent reflect (serial memory queue) — DO NOT await on stream path
7. Pills: success (diff + why) or error — never silent failure
8. Compaction check at turn start: if T_total >= 0.50 * W → compact job on memory queue
```

**Token estimate (deterministic):** `estimateTokens(text) = max(1, ceil(utf16Length(text) / 4))`
`T_sys` includes MEMORY head; `W` from selected model’s `contextWindowTokens`.

**memoryQueue:** global FIFO; one mutation at a time (reflect, compact, restore, import).

**Restore:** set head content from chosen version; append new version `source: "restore"` (truncate-forward audit, not silent branch). Transcript not auto-rewound.

**Reflect no-op:** equivalent content → no new version, no success pill.
**Reflect fail:** head unchanged, **error pill**.

---

### UX minimum surfaces

- Chat transcript + composer + streaming assistant
- Live agent **run tree**
- MEMORY panel (head always visible) + version list + restore
- Model status (ready / downloading / failed)
- Pills (memory updated / memory failed)
- **Update banner** (version + CHANGELOG summary + expand + Update/Dismiss)
- Export, import, clear/reset (confirm)
- Runtime/limited-mode messaging when no model ready
- Quality gate entry (run pre-commit in-page)

---

### Live update contracts (FP11)

#### `version.json` (served at site root)

```json
{
  "buildId": "string",
  "createdAt": "ISO-8601",
  "channel": "production | preview | local",
  "changelog": {
    "summary": "short digest (from CHANGELOG Unreleased / latest)",
    "full": "longer excerpt for expand"
  }
}
```

Client stores `lastSeenBuildId`. Poll `version.json` (and/or receive Web Push payload with same shape).

#### Soft-reset (Update CTA — not full browser reload)

1. Abort in-flight streams.  
2. Cache-bust / re-import app modules (`?v=buildId`); update SW caches per standards.  
3. Re-mount UI; **rehydrate** MEMORY, transcript, registry metrics from durable storage (do not wipe user data).  
4. Set `lastSeenBuildId`; show Dismiss-only notice if needed.

#### Notification UX

| Situation | UI |
|-----------|-----|
| New version while session open | Banner + Web Push (if permitted): version, summary, expand full notes, CTA **Update** |
| User chooses **Update** | Soft-reset as above |
| User full refresh / reopen | Always load **latest** assets automatically (no approval). Then notice with same content, CTA **Dismiss** only |
| Permission denied | In-app banner only when tab open |

#### Local live update

- **Browser path:** File System Access bind to project; watch `public/**` (poll or platform observer); on change → soft-reset.  
- Optional dev SSE only in development host env—never required for production product identity.  
- **Not** HTMX file-watch (HTMX needs a server event source).

#### Remote live update

- Push to `main` → Vercel production deploy → new `version.json`.  
- Open clients: poll and/or Web Push from `api/notify-version`.  
- Latency = Vercel deploy time + poll interval (document e.g. ≤60s poll) or near-instant push.

#### Web Push (Vercel serverless — only allowed server surface for product)

- `api/subscribe` stores push subscriptions (Vercel KV/Blob or equivalent—document).  
- Deploy hook / deploy completed → `api/notify-version` sends Web Push with version + changelog.  
- **VAPID keys optional for first Deploy Button success**—app runs without push; enable keys later for notifications.  
- SW handles `push` + notificationclick → soft-reset on Update.

---

## Hosting (Vercel only)

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/tyler-jewell/pwa-agent)

Replace `repository-url` if the canonical remote differs. **Must work without required env vars** for a stranger’s first deploy (push optional).

### Operator path

1. Click Deploy Button **or** import repo in Vercel → deploy.  
2. Connect git: pushes to `main` = production.  
3. Optional: set VAPID + deploy hook for Web Push live notify.  
4. Open production URL → install PWA when ready → chat on-device.

### Repo requirements for 100% Deploy Button reliability

- Checked-in `vercel.json` (static `public` + `api`).  
- No mandatory build secrets.  
- No flaky multi-step build; prefer zero/minimal install.  
- Pin any serverless deps with lockfile if introduced.  
- `version.json` produced or committed at deploy so clients can poll.

### Coding agents (hosting / UI deploy)

Use **current Vercel plugin skills** (`vercel-cli`, `deployments-cicd`, `env-vars`, etc.). Re-read skills when they change—do not freeze Vercel CLI folklore in AGENTS.md.

---

## Public-complete roadmap

*Ship checklist. Tick only when acceptance passes. Map every item to a first principle.*

| # | Item | FP | Acceptance (all must pass) |
|---|------|-----|----------------------------|
| 1 | Core layout: turn/router/memory/agent/core/live/quality/ports; no vendor in core | FP0 | Browser self-test + quality gate fail if core imports vendor SDKs |
| 2 | Schemas + `version.json` shape validated | FP0 FP11 | Self-tests for Memory/Chat/Model/RunTree/export + version manifest |
| 3 | Turn loop + streaming chat UI + transcript | FP1 FP4 | Stream tokens (mock OK); transcript durable when storage wired |
| 4 | Model registry via discovery only | FP3 | No sole hardcoded model table in app source |
| 5 | Progressive tiny + background larger models | FP1 FP3 | Chat with tiny/mock; second model can become ready without blocking chat |
| 6 | router-agent selection | FP3 FP6 | modelId under chat-agent; tree node visible |
| 7 | chat-agent sole principal | FP6 | No other entry calls subagents |
| 8 | Subagent bus + live hierarchical tree | FP6 FP4 | Nested runs under chat-agent |
| 9 | memory-agent reflect/commit/validate | FP5 FP6 | Version or error pill; serial queue |
| 10 | MEMORY visible + version restore | FP5 | Restore appends `source: "restore"` |
| 11 | MEMORY always injected | FP5 FP2 | Prompt includes head every turn |
| 12 | Blank-slate seed + identity prompt | FP5 | Seed template; know-nothing until taught |
| 13 | ≥50% compaction | FP7 | Fixture triggers replace; fail leaves state |
| 14 | Non-blocking orchestration | FP4 | Stream not awaiting reflect/download |
| 15 | Error / limited mode UX | FP1 FP9 | No hang when model unavailable |
| 16 | Export / import + clear/reset | FP8 | Round-trip + confirm wipe to seed |
| 17 | Live update: poll + soft-reset + banner Update/Dismiss | FP11 | Detect new buildId; Update soft-applies; full load auto-latest + Dismiss |
| 18 | Web Push + serverless notify (optional keys) | FP11 FP12 | Subscribe when permitted; notify on deploy; degrade to in-app if denied |
| 19 | Local live update (folder watch or dev signal) | FP11 | Edit `public/` → soft apply without manual full refresh |
| 20 | Vercel one-click + offline shell + quality/a11y/matrix | FP12 FP9 FP10 | Deploy Button path works without secrets; offline acceptance; quality in-browser; keyboard paths |

### Later (not public-complete)

Speech STT/TTS · extra tools · multi-agent mesh · multi-cloud hosts · HTMX as default UI kit.

---

## Principle ladder (build order)

Implement → validate acceptance → browser self-tests → only then next phase.

| Phase | Focus | Roadmap # |
|-------|--------|-----------|
| P0 | Core schemas, mock adapter, **`runQualityGate`**, **`live/` stub + version.json** | 1–2 |
| P1 | Turn loop + stream UI | 3, 14 partial |
| P2 | Registry + progressive models | 4–5 |
| P3 | chat-agent, bus, tree; wire pre-commit command | 7–8 |
| P4 | memory-agent + panel + inject + seed | 9–12 |
| P5 | router-agent | 6 |
| P6 | Compaction | 13 |
| P7 | Real on-device adapter(s) + limited mode | 15 |
| P8 | Export/import/reset | 16 |
| P9 | Live poll, soft-reset, banner, SW latest-on-load | 17 |
| P10 | Vercel api push + local folder watch | 18–19 |
| P11 | vercel.json, Deploy Button, offline, matrix, a11y | 20 |

---

## Browser support matrix

| Rule | |
|------|--|
| Cells | `unverified` \| `pass` \| `fail` \| `degraded` \| `n/a` |
| Authority | Measurement only for non-unverified |
| Updater | In-browser measurement / documented protocol (no Node-only matrix CLI as product law) |
| Public-complete | Does not require every cell pass—requires honesty |

| Capability | Chrome/Chromium | Edge | Firefox | Safari (macOS) | Safari (iOS) | Notes |
|------------|-----------------|------|---------|----------------|--------------|-------|
| App shell offline | unverified | unverified | unverified | unverified | unverified | — |
| Model cache / offline infer | unverified | unverified | unverified | unverified | unverified | — |
| GPU / accelerated compute | unverified | unverified | unverified | unverified | unverified | — |
| Install / standalone | unverified | unverified | unverified | unverified | unverified | — |
| Web Push (version notify) | unverified | unverified | unverified | unverified | unverified | iOS: Home Screen PWA |
| Soft live update | unverified | unverified | unverified | unverified | unverified | — |
| Durable / persistent storage | unverified | unverified | unverified | unverified | unverified | — |

*Last updated by automation: never.*

---

## How we stay current (platform)

**Never freeze** PWA/offline/install/storage/speech/GPU **recipes** in AGENTS or as eternal prose. Implement outcomes from this README; choose mechanisms from **[Standards & references](#standards--references-living)**. Grow that list when domains expand. Prefer MDN / web.dev / W3C / vendor docs.

**Do freeze** product contracts and the public-complete checklist here; change them deliberately in git.

---

## Standards & references (living)

### Progressive web apps

| Resource | URL |
|----------|-----|
| MDN — Progressive web apps | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps |
| MDN — PWA guides | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides |
| MDN — Making PWAs installable | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable |
| MDN — Offline and background | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation |
| MDN — Caching | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching |
| web.dev — Learn PWA | https://web.dev/learn/pwa |
| web.dev — Installation | https://web.dev/learn/pwa/installation |
| web.dev — Offline data | https://web.dev/learn/pwa/offline-data |
| web.dev — Service workers | https://web.dev/learn/pwa/service-workers |
| web.dev — Caching | https://web.dev/learn/pwa/caching |
| web.dev — Workbox | https://web.dev/learn/pwa/workbox |
| web.dev — Manifest | https://web.dev/learn/pwa/web-app-manifest |
| What PWA Can Do Today | https://whatpwacando.today/ |
| Offline cookbook | https://jakearchibald.com/2014/offline-cookbook/ |

### Specs

| Resource | URL |
|----------|-----|
| Web App Manifest | https://w3c.github.io/manifest/ |
| Service Workers | https://w3c.github.io/ServiceWorker/ |
| Storage | https://storage.spec.whatwg.org/ |
| File System | https://fs.spec.whatwg.org/ |
| WebGPU | https://www.w3.org/TR/webgpu/ |
| Web Speech (later) | https://webaudio.github.io/web-speech-api/ |

### Service worker / cache / storage

| Resource | URL |
|----------|-----|
| MDN — Service Worker API | https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API |
| MDN — Cache | https://developer.mozilla.org/en-US/docs/Web/API/Cache |
| MDN — StorageManager | https://developer.mozilla.org/en-US/docs/Web/API/StorageManager |
| MDN — persist | https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist |
| MDN — estimate | https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate |
| MDN — quotas / eviction | https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria |
| MDN — IndexedDB | https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API |
| MDN — OPFS | https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system |
| Chrome — Cache models | https://developer.chrome.com/docs/ai/cache-models |
| web.dev — Persistent storage | https://web.dev/articles/persistent-storage |
| Workbox | https://developer.chrome.com/docs/workbox |

### On-device AI

| Resource | URL |
|----------|-----|
| WebLLM | https://github.com/mlc-ai/web-llm |
| Transformers.js | https://huggingface.co/docs/transformers.js |
| web.dev — WebLLM chatbot | https://web.dev/articles/ai-chatbot-webllm |
| web.dev — Client-side AI | https://web.dev/learn/ai/client-side |
| MDN — WebGPU | https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API |
| Can I use — WebGPU | https://caniuse.com/webgpu |

### Accessibility

| Resource | URL |
|----------|-----|
| WCAG 2.2 | https://www.w3.org/TR/WCAG22/ |
| APG | https://www.w3.org/WAI/ARIA/apg/ |
| MDN — Accessibility | https://developer.mozilla.org/en-US/docs/Web/Accessibility |

### Vercel hosting & push

| Resource | URL |
|----------|-----|
| Vercel — Docs | https://vercel.com/docs |
| Vercel — Project configuration | https://vercel.com/docs/project-configuration |
| Vercel — Deployments | https://vercel.com/docs/deployments |
| Vercel — Deploy Button | https://vercel.com/docs/deploy-button |
| Vercel — Functions | https://vercel.com/docs/functions |
| MDN — Push API | https://developer.mozilla.org/en-US/docs/Web/API/Push_API |
| MDN — Notifications | https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API |
| MDN — File System Access | https://developer.mozilla.org/en-US/docs/Web/API/File_System_API |

### Compatibility watch

| Resource | URL |
|----------|-----|
| Can I use | https://caniuse.com/ |
| Chrome Status | https://chromestatus.com/features |
| WebKit Status | https://webkit.org/status/ |
| web.dev — Baseline | https://web.dev/baseline |

*Add rows as the product grows. Replace dead links with canonical pages.*

---

## Pre-commit checklist (browser-only)

### Law

- The quality gate is **part of the PWA**: pure ES modules under `public/js/quality/`.
- Invokable by **chat-agent** (*“run pre-commit checklist”*) and by a **Quality** UI control.
- Returns structured results in-page. **No Node, npm, shell, Python, Docker, or separate server** for the gate.
- Git on a host machine is optional for *recording* commits; it is **not** required to *run* the checklist.

### Project files in the browser

1. **Bind project folder** via File System Access API when available (read; write optional for auto-fix / CHANGELOG). Persist handle when the platform allows.
2. **Without a folder:** run **runtime self-tests** only; mark file-scan checks `skipped — bind project folder`.
3. Never fall back to a Node file walker.

### Automatic — `runQualityGate()`

Returns `{ ok: boolean, results: [{ level: "ok"|"warn"|"fail", message }], manual: string[] }`.  
`ok === false` → not commit-ready.

| Check | Rule |
|-------|------|
| Required docs (folder bound) | `README.md` + `AGENTS.md` at project root |
| No `docs/` tree (folder bound) | Forbidden |
| AGENTS standards | Required sections; max **400** lines; no frozen platform API recipes in AGENTS |
| README standards | Principles, roadmap, pre-commit, contracts, standards, chat-agent, ModelRecord |
| Max source lines (folder bound) | **≤ 280** lines per `public/` app source (`.js`, `.css`, …) |
| Formatting (folder bound) | No trailing whitespace; final newline (auto-fix if write allowed) |
| Core purity | No vendor imports under `public/js/{core,turn,router,memory,agent}/` |
| Contract self-tests | In-browser: schema, tokens, mock stream non-blocking — **no external test runner** |
| CHANGELOG (folder bound) | Ensure `CHANGELOG.md` + `## Unreleased` (create if write allowed) |
| Identity | Timestamp report; **git history** is release identity — no product version spam |

### Manual (always shown after auto — agent MUST complete)

1. Auto section has **zero fails** (`ok === true`).
2. `CHANGELOG.md` → `## Unreleased` describes this change.
3. Roadmap ticks only if acceptance truly passed.
4. No silent memory/reflect failure paths.
5. Stream path still non-blocking.
6. Core purity (vendor only in `adapters/`).
7. No hardcoded model catalog.
8. Platform work followed Standards URLs.
9. AGENTS.md still valid process law.
10. Browser self-tests cover new pure logic.
11. No secrets / telemetry / mandatory cloud chat.
12. Optional host git: clean status; commit message names phase/FP.
13. UI: keyboard path for chat / MEMORY / run tree.

### Build order note

Ship `runQualityGate` in **P0** so day-one *“run pre-commit”* works with mock runtime—before large models.

---

## Performance manager

On each full page refresh, **performance-manager** runs in the background (non-blocking). It monitors agent activity (run tree + model metrics), updates MEMORY’s **Areas of opportunity** section (latest improvement targets + progress scores), and—when history shows evidence of improvement—sends **at most one** shared-notify recommendation to promote a mature opportunity into **Standing instructions** (Approve in Agent proposals). Work appears on the run tree as `performance-manager`.

## Live models roster

The **recruiter** runs once per page refresh (background, non-blocking). With the **aggression** lever (1–5), it may recommend **at most one** model add or replace. Approval (shared agent notify → Approve) starts the **trainer**, which downloads via the registry adapter, runs the **shared benchmark protocol**, and updates the in-app live roster (and `LIVE_MODELS.md` / README markers when a project folder is bound with write access).

<!-- LIVE_MODELS_START -->
## Live models roster

_Auto-generated by Progressive Web Agent trainer after approved recruitment. Capabilities, token rate, storage, and smartness come from the shared benchmark protocol._

| Model | Status | Quality | Smartness | Tokens/s | Storage | RAM hint | Context | Offline |
|-------|--------|---------|-----------|----------|---------|----------|---------|---------|
| _(none trained yet — approve a recruiter proposal after refresh)_ | — | — | — | — | — | — | — | — |

_Updated: bootstrap_
<!-- LIVE_MODELS_END -->

See also in-app **Live roster** panel after training.

---

## Privacy

No accounts. No server-side chat product. No telemetry backend. Origin storage holds chat, memory, models. Export is how the user leaves with data.

---

## License

Add an MIT (or chosen) `LICENSE` when publishing; until then treat contributions as MIT-intent for this personal-agent project.
