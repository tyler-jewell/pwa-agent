# AGENTS.md — coding agent brief

## Mandatory on every session and every edit

Before writing or changing **any** code or product markdown:

1. Read **`STANDARDS.md`** (authoritative law)  
2. Read **`CONTRIBUTING.md`** (process + gates)  
3. Apply skill **`msa-coding-standards`** (granted for admin coding on this repo)  
4. Then use this file for product commands/context  

**If you skip STANDARDS or CONTRIBUTING, stop.** Do not land the change.

After edits:

```bash
cargo run -q -p msa -- quality
```

Must print **`OK msa quality GREEN`**.

---

## Hard rules (summary)

- **Rust only** (`crates/msa`, `msa-ui`, `msa-web`, `msa-log`)  
- **`msa quality` GREEN** before commit  
- Max **280** lines/`.rs`, **300** lines/root product `.md`  
- Zero dead code / dead stub lines  
- **No lint overrides** — never `#[allow]`, `#![allow]`, `#[expect]`, or test-only allows  
- No unwrap/panic/todo/unsafe (tests: `assert!` / `if let`)  
- **No `docs/` tree** — never add instruction dumps; use code + this file + skills + agent memory/context  
- **Web UI changes:** load **`msa-ui-design`**; edit **`crates/msa-ui`** + **`crates/msa-web`** only  
- **Ask, don’t list questions** — when you need the user to choose among options or answer decision questions, **always** use the **`ask_user_question` tool**. Never dump a bullet list of questions in chat prose.

Full text: **STANDARDS.md**. Process: **CONTRIBUTING.md**.

---

## Skills (default-deny)

| Concept | Rule |
|---------|------|
| Catalog | `.agents/skills/*` is a catalog, not auto-load |
| Grants | **Empty by default** (skill-curator owns grants; D6) |
| Admin edit | `msa-coding-standards` required when changing this repo |
| **Web UI edit** | **`msa-ui-design` first** (SSOT), then `frontend-design` + `web-design-guidelines`; `htmx` only for fragments; `ui-ux-pro-max` ideas only; **not** `brand-guidelines` for MSA chrome |
| Never | “Load all skills” / bulk vendor dumps / React stacks / reintroduce egui `msa-chat` |

Scaffold identities (markdown only): `agents/skill-curator/AGENTS.md`, `agents/agent-curator/AGENTS.md`.  
Sole per-agent context: `agents/<name>/AGENTS.md` (e.g. `agents/admin-agent/AGENTS.md`).

---

## Commands

```bash
cargo run -q -p msa -- quality   # required gate
cargo build -p msa -p msa-ui -p msa-web
./scripts/setup-mac-studio.sh
msa web --bind 127.0.0.1:7420 --agent admin-agent   # day-2 UI
# Chrome → http://127.0.0.1:7420/a/admin-agent
msa logs --agent admin-agent
msa doctor
```

## Architecture

```
Chrome ──HTTP──► msa-web (pure Rust)
                    └── msa-ui (HTML/CSS widgets)
                           │
                    Grok/Claude turn (or MSA_WEB_BACKEND=loopback)
                    durable ~/.config/msa/agents/<agent>/
                    age vault + msa-log
```

| File | Role |
|------|------|
| STANDARDS.md | Coding law |
| CONTRIBUTING.md | Gates / process |
| README.md | Greenfield + web UI day-2 SSOT |
| crates/msa-ui | Design system / widgets |
| crates/msa-web | HTTP + turns + durable transcript |
| agents/*/AGENTS.md | Sole per-agent model context |

## Locked decisions

| ID | Decision |
|----|----------|
| K-RUST | Pure Rust only |
| K-QA | `msa quality` required |
| K-LINES | ≤280 rs / ≤300 md |
| K-DEAD | No dead code/lines |
| K-ALLOW | No lint allow overrides |
| K-NODOCS | No `docs/` or in-repo instruction dumps |
| K-WEB | Day-2 = `msa web` HTML/CSS; not egui, not Telegram/SMS |
| K-UI | First-party `msa-ui` widget catalog |
| K-LOG | Typed JSONL via `msa-log` |
| K-SKILL | Skills default-deny |
| K-WRAP | No OpenClaw / Open WebUI / Electron product path |

Do not invent looser standards. Match admin-agent or do not land the change.
