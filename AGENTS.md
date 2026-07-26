# AGENTS.md — sole process law for coding agents

You are implementing **Progressive Web Agent** (`pwa`) from an empty or near-empty tree.  
**Product law** is only in **`README.md`**. This file is **process**: how to build, test, and not corrupt the design.

Day-one product story (README): progressive tiny→complex models, self-improving MEMORY, create other agents with the same capabilities, transparent main-agent feed, and an **army of small smart people**—capability/context aware, structured handoff, bounded loop-to-completion, honest achieved/not-achieved reports.

| File | Role |
|------|------|
| **`README.md`** | Principles, architecture, contracts, roadmap, browser pre-commit, **Vercel hosting**, live update |
| **`AGENTS.md`** | How *you* work (this file) |

Do **not** create a `docs/` dump or a third product SSOT.  
**Git history** is product timeline—not marketing version tags in code. `schemaVersion` on exports is data compatibility only.

---

## Runtime law: browser client + Vercel host

### In the browser (product)

After assets load:

- Inference, UI, memory, routing, subagents, **quality gate**, and **live-update client** run **in the browser**.  
- **Forbidden for quality/app logic:** Node/npm quality CLIs, Python, shell runners that the in-browser agent cannot invoke.  
- *“Run pre-commit checklist”* → `runQualityGate()` in-page.  
- *“Check for updates”* / automatic poll → `live/` module.

### On Vercel (only supported host)

- Public-complete delivery is **Vercel only** (Deploy Button + git `main`).  
- **Only** allowed server surface: serverless **version/Web Push notify** (`api/subscribe`, `api/notify-version`). Chat/memory stay on-device.  
- For deploy, env, project config, and hosting UX: **read current Vercel plugin skills** (`vercel-cli`, `deployments-cicd`, `env-vars`, etc.) and follow them. When skills update, follow the updates—**do not freeze Vercel recipes here**.

### HTMX / no-build frameworks

HTMX is great for server HTML/SSE swaps—not for watching static repo files. **Do not** implement live update as “just add HTMX.” Own `live/` + `version.json` + soft-reset. Optional no-build UI libs later only as adapters.

---

## Pre-commit (browser-only)

Full rules: **README → Pre-commit checklist (browser-only)**.

1. Run **in-browser** quality gate (UI or chat-agent).  
2. Auto must pass (`ok === true`).  
3. Complete every **Manual** item printed by the gate.  
4. Then record git commit on a host if you use git (optional plumbing).

Never reintroduce `npm run quality` / Node pre-commit as product law.

---

## Mission

Build a **fully functioning** public PWA on Vercel that meets every **public-complete** roadmap row (acceptance must pass), including **live update** and optional Web Push version notify.

---

## Non-negotiables

1. **README.md is law** (FP0–FP12, contracts, roadmap, hosting).  
2. **Browser client** for app + quality + live-update client.  
3. **Vercel only** for public-complete hosting; use **Vercel skills** for deploy work.  
4. **Core purity (FP0):** no vendor SDKs in turn/router/memory/agent/core/live (push SW glue may call platform APIs).  
5. **Equal trio (FP2)** + **live/** as first-class.  
6. **No hardcoded model catalog (FP3).**  
7. **chat-agent** sole human principal; bus agents: memory-agent, router-agent, **recruiter**, **trainer**, **performance-manager**, **crew-agent** (bounded multi-step loops under the principal). Recruiter + performance-manager run once per refresh in background.  
8. **Stream-first (FP4).**  
9. **No silent memory failures.**  
10. **Platform how** = README standards URLs.  
11. **Live update (FP11):** version poll/push, soft-reset on Update, auto-latest on full load, Dismiss-only after refresh.  
12. **Pre-commit** in-browser every commit-ready change.  
13. **Deploy Button** must work without required secrets (push optional).  
14. **Crew discipline (FP13–16):** every multi-step unit records capability + context; hand off when over limit; bounded loop; honest report—never silent drop or unearned success.

---

## Bootstrap from empty tree

1. Read entire README (including live update + Vercel hosting).  
2. Create `public/` + `js/` per tree (`quality/`, `live/` early).  
3. Add `vercel.json` + minimal `api/` when implementing push (optional until roadmap 18).  
4. Mock runtime + `runQualityGate` + version poll stub before heavy models.  
5. Principle ladder; browser quality after each phase.  
6. Hosting/deploy: Vercel skills + Deploy Button path.  
7. Never multi-host “support” for public-complete.

---

## Principle ladder

| Phase | Build | Roadmap |
|-------|--------|---------|
| P0 | core schemas, mock adapter, quality gate, live stub + version.json | 1–2 |
| P1 | turn + stream UI | 3, 14 |
| P2 | registry + progressive models | 4–5 |
| P3 | chat-agent, bus, tree, pre-commit command | 7–8 |
| P4 | memory-agent + panel + inject | 9–12 |
| P5 | router-agent | 6 |
| P6 | compaction | 13 |
| P7 | real on-device adapter(s) | 15 |
| P8 | export/import/reset | 16 |
| P9 | soft-reset + banner Update/Dismiss + poll | 17 |
| P10 | Web Push api + local folder watch | 18–19 |
| P11 | Vercel one-click, offline shell, matrix, a11y | 20 |

---

## Implementation rules (short)

- **Soft-reset:** abort streams → re-import cache-busted modules → rehydrate durable state → never wipe MEMORY on update.  
- **Notifications:** summary from CHANGELOG; expand full; Update vs Dismiss per README table.  
- **Local live:** File System Access watch on `public/**` preferred pure-browser path.  
- **Remote live:** `version.json` after Vercel deploy; push if keys configured.  
- **Adapters only** for WebLLM/etc.; **Vercel api** only for push/version.  
- **Self-tests** in browser; no Node test runner as law.

### What not to do

- Node quality CLI  
- Multi-cloud hosting as public-complete  
- HTMX as hot-reload foundation  
- Required VAPID for first Deploy Button success  
- Silent memory failures; blocking stream on reflect  
- Invent schemas vs README  

---

## Debug map

| Symptom | Check |
|---------|--------|
| “Need Node for quality” | Wrong—fix browser gate |
| No remote update | version.json deploy? poll? SW cache too sticky? |
| Push silent | permission, VAPID, subscribe API, iOS Home Screen |
| Soft-reset loses MEMORY | rehydrate path; durable storage |
| Deploy Button fails | secrets required? wrong root? build command? |
| Local no hot apply | folder not bound; watch not started |

---

## Done checklist (every session)

- [ ] Mapped to roadmap # / phase  
- [ ] README contracts honored (or README updated same change)  
- [ ] Acceptance verified  
- [ ] In-browser quality auto PASSED + manual list done  
- [ ] Live-update behavior not broken if you touched shell/SW  
- [ ] Vercel work used **current Vercel skills**  
- [ ] No Node quality CLI  
- [ ] No vendor in core  
- [ ] Stream non-blocking; no silent memory fail  
- [ ] Commit message (if any) names phase/FP  

---

## One-line law

**Browser-only agent cores + live update; Vercel-only public host with optional serverless push; quality and “run pre-commit” in-page; Vercel skills for deploy—README is product law, git is version history.**
