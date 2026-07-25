---
name: msa-coding-standards
description: >
  Mandatory coding standards for mac-studio-agents. Use on every edit to Rust or root
  product markdown. Always follow STANDARDS.md and CONTRIBUTING.md. Enforces pure Rust,
  max file lines, zero dead code, no lint overrides, no docs/ tree, DRY agent context,
  and msa quality before commit.
---

# msa-coding-standards

You are coding on **mac-studio-agents**. The admin agent is the gold standard. **No shortcuts.**

## Before you write anything

1. Read **`STANDARDS.md`** (authoritative law).
2. Read **`CONTRIBUTING.md`** (process + gates).
3. Read **`AGENTS.md`** (commands / agent context).
4. Prefer extending existing crates (`msa`, `msa-ui`, `msa-web`, `msa-log`).

**Every change must follow STANDARDS + CONTRIBUTING.**

## Hard rules

### Language

- **Rust only** for product code (`crates/`).
- No Python, JS, TS, Dart, shell implementation layers.
- OS tools only via `std::process::Command`.

### File size

| Kind | Max lines |
|------|-----------|
| `*.rs` | **280** |
| root product `*.md` | **300** |

Split first if a change would exceed the limit.

### Zero dead content / no lint overrides

- `dead_code = deny`, no stub lines, no empty files  
- Never `#[allow]` / `#[expect]` / test-only allows — fix the design  

### No in-repo docs dumps

- **Never** create or restore a **`docs/`** directory  
- Product behavior lives in **code**; agent process in **AGENTS / skills / memory / tools**  
- See STANDARDS § *Core anti-pattern: in-repo docs/**  

### Ask the user (never list questions in prose)

- When you need the user to pick among options or answer decision questions, **always** use the **`ask_user_question` tool**  
- **Never** dump a bullet list of questions in chat prose  
- Same rule is locked in **`AGENTS.md`**  

### Structure

- Business logic in `lib`, not fat `main`  
- Day-2 UI: **`crates/msa-ui`** + **`crates/msa-web`**; skill **msa-ui-design**  
- Logging: **`msa-log`** only; extend typed enums in code  

## One command before commit

```bash
msa quality
```

Must print **`OK msa quality GREEN`**.

## Done checklist

- [ ] STANDARDS + CONTRIBUTING followed  
- [ ] `msa quality` green (includes **no_docs_dir**)  
- [ ] Zero allow/expect attributes  
- [ ] No new instruction/`docs/` trees  
