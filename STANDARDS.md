# STANDARDS.md — Admin Agent Gold Standard

**Every agent inherits these standards.** No looser local style. No shortcuts.

Skill: `.agents/skills/msa-coding-standards` (load on every edit).

---

## 0. Language

| Allowed | Forbidden |
|---------|-----------|
| Rust in `crates/` (`msa`, `msa-ui`, `msa-web`, `msa-log`, …) | Python, JS frameworks (React/Vue), TS product apps |
| Pure Rust HTTP serving **first-party HTML/CSS** | Electron/Tauri shells, OpenClaw/Open WebUI |
| `Command` to OS tools | Shell product implementation layers |
| Tiny speech-bridge asset served by Rust | Building UI in egui as day-2 SSOT |

### Human day-2 channel (local web UI)

Humans use **`msa web`**: pure-Rust server emits HTML/CSS from **`msa-ui`** (design system / widgets). Open Chrome to `http://127.0.0.1:<port>/a/<agent>`. **Not** Telegram, SMS, iMessage, or egui. Optional minimal browser script for Web Speech only. CLI remains for install/dev/quality.

### No product `msa chat` / egui shell

Day-2 is **`msa web` only**. Do not ship, document, or reintroduce egui `msa-chat`. Human UI crates: **`msa-ui`** + **`msa-web`**.

### Agent-first logs (required for all agents)

| Item | Detail |
|------|--------|
| Format | JSONL, one typed `Event` per line |
| Path | `~/.config/msa/logs/<agent>/events.jsonl` |
| Crate | `msa-log` (`EventKind` + `EventData` enums only) |
| CLI | `msa logs`, `msa logs follow`, `msa logs schema` |
| Policy | Agent-first JSON; `--human` optional; never log secrets |

New subsystems emit typed events via **`msa-log` code** — no parallel log guides.

---

## 1. One profiler: `msa quality`

```bash
cargo run -q -p msa -- quality
# after install:
msa quality
```

Must print **`OK msa quality GREEN`** before any commit.

| Check | Rule ids | Fix |
|-------|----------|-----|
| rustfmt | `fmt` | `cargo fmt --all` |
| clippy `-D warnings` (incl. dead code) | `clippy` | Fix listed rustc/clippy diagnostics |
| tests | `test` | Fix failing tests |
| Rust file length | `max_lines_rs` | Split module (max **280** lines) |
| Markdown length | `max_lines_md` | Split/delete (max **300** lines) |
| Empty files | `empty_file` | Delete or fill |
| Stub/dead lines | `dead_line` | Finish or delete the line |
| Lint overrides | `lint_override` | Remove `allow`/`expect`; fix code |
| Forbidden `docs/` tree | `no_docs_dir` | Delete `docs/`; never reintroduce |

Output format: `[ERROR] path:line  rule=…  message` — go fix that path.

---

## 2. Max file lines (frontier models, one tool call)

**Research basis:** tool output caps (~40k chars), attention dilution on long single files, ~40–80 tokens/line of Rust. **280 lines ≈ 11–22k tokens** leaves room for system prompt + other files + reply on Claude / Grok / Codex-class agents.

| File kind | Max lines | Hard fail |
|-----------|-----------|-----------|
| Product `*.rs` under `crates/` | **280** | yes |
| Root product `*.md` (STANDARDS, AGENTS, …; not `.agents/skills` vendor) | **300** | yes |

Never grow past the limit; split first. **Do not** add a `docs/` tree to “hold overflow.”

---

## 3. Zero dead content

- **Dead Rust:** `dead_code = deny` + clippy deny warnings  
- **Dead lines:** stub-intent lines (`TODO`, `FIXME`, `TBD`, …)  
- **Dead markdown:** empty files, unfinished sections  
- **No** half-written work in tree  

Production code also denies: unwrap/expect, panic, `todo!`, `dbg!`, `unsafe`.

### No lint / compiler overrides (absolute)

**Never** add, leave, or merge:

| Forbidden | Examples |
|-----------|----------|
| Attribute allows | `#[allow(...)]`, `#[expect(...)]` |
| Crate/module allows | `#![allow(...)]`, `#![cfg_attr(..., allow(...))]` |
| Selective silence | `#[allow(dead_code)]`, `clippy::unwrap_used`, `unused`, etc. |
| “Just for tests” allows | Same rules in `#[cfg(test)]` modules |

**Fix the code** so the lint is clean. Prefer using the value, deleting dead code, or restructuring — not silencing the compiler.

`#![forbid(unsafe_code)]` is required. Workspace lints stay **deny**-level; agents must not weaken them.

---

## 4. Strict typing & structure

- `#![forbid(unsafe_code)]`  
- Enums over stringly modes at APIs  
- `Result` + `?` + context; fail closed on auth  
- Lib + thin bin; logic not only in `main`  
- Functions ≤ ~100 lines (`too_many_lines`)  
- Prefer small modules over megafiles  

### Rust practices we require

- Explicit ownership; avoid needless clone  
- Typed errors at library boundary (`MsaError`)  
- No silent catch-alls that hide failures  
- Secrets never in logs or git  

### Core anti-pattern: in-repo `docs/*` (and instruction dumps)

**Never create or keep a `docs/` directory** (or parallel “design dump” trees) in this repo.

| Why banned | Detail |
|------------|--------|
| Not all agents load it | Harnesses differ; `docs/` is not universal context |
| Dual maintenance | Code changes then require doc rewrites agents skip |
| Wrong layer | Product narrative belongs in **code**, **AGENTS.md**, **skills**, and the agent’s **memory/context/tools** — not a second library of markdown |

**Canonical bad example (never re-introduce):**

```
docs/gui-chat.md
docs/logging.md
docs/architecture.md
docs/design.md
docs/…
```

Or any workflow that says “update `docs/*` when UX changes.” **Update code + agent core files/skills/memory instead.**

### DRY anti-patterns (broader)

| Anti-pattern | Do this instead |
|--------------|-----------------|
| Feature lists in STANDARDS/AGENTS/skills (buttons, thresholds, glyphs) | Implement in code; agents read the crate |
| Same behavior restated in N markdown files | One agent-facing surface (AGENTS) + code |
| Ephemeral knobs as “always” skill rules | Knobs live in code only |

**Canonical bad example:**  
`- UI: stream text, 👍👎 copy share, collapsible metrics (default closed), unique ids`  
in a skill/STANDARDS. That is product detail, not coding law — and it is not fixed by inventing `docs/gui-chat.md` either.

---

## 5. Toolchain lock-in

| File | Role |
|------|------|
| `rust-toolchain.toml` | stable + rustfmt + clippy |
| `rustfmt.toml` | format |
| `clippy.toml` + workspace lints | deny-by-default |
| `msa quality` | single report |
| CI | runs `msa quality` |

---

## 6. Skills (catalog + default-deny grants)

Skills live under `.agents/skills/`. They are a **catalog**, not a default load list.

| Rule | Detail |
|------|--------|
| **Default-deny** | Agents receive **no** skills until explicitly granted (skill-curator / human grant) |
| Process only | Skills = process; not product manuals or feature dumps |
| Catalog examples | `msa-coding-standards`, `msa-ui-design`, vendor `rust-*` packs |
| Grants | Empty by default; do **not** instruct “load all skills” |
| Dual paths | Prefer `.agents/skills`; do not assume `.claude` mirrors grants |

Admin coding sessions still **must** apply **msa-coding-standards** when editing this repo (grant is implied for admin work on STANDARDS). Web UI work needs **msa-ui-design**. Other packs load only when granted.

---

## 7. Governance for every code change

Any edit to this repo (admin-agent or any future agent) **must**:

1. Follow **STANDARDS.md** (this file) completely  
2. Follow **CONTRIBUTING.md** process and gates  
3. Apply skill **msa-coding-standards**  
4. Pass **`msa quality` GREEN** before claiming done or committing  
5. Prefer updating **code**, **AGENTS.md**, **skills**, and agent **memory/context** — never `docs/`  

If a change conflicts with STANDARDS, **change the code**, not the standard — unless the human explicitly amends STANDARDS in the same change.

## 8. Done checklist

1. [ ] `msa quality` GREEN  
2. [ ] No max_lines / dead_line / empty_file / **no_docs_dir** issues  
3. [ ] **Zero** `allow` / `expect` lint overrides in the diff  
4. [ ] No secrets  
5. [ ] No new instruction/docs trees; agent context updated only where agents actually load it  

Rogue style is not allowed on this host.
