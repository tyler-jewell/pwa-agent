# CONCERNS.md — audit register (temporary; delete when done)

**Lifecycle:** temporary only → fold into decisions / agent memory → **delete**. Not a `docs/` substitute.

**Legend:** **P0** fix-first · **P1** soon · **P2** plan · **P3** note.  
**Sources:** root Q&A · folder subagents (`msa`, `msa-chat`, `msa-log`, `.agents`, infra) · meta-review of this file.

*Detail tables are curated (highest-signal). Subagents produced larger ID ranges; §11 notes dropped IDs.*

---

## 1. User decisions (binding)

| ID | Decision | Follow-up |
|----|----------|-----------|
| D1 | Fake `Cargo.toml` `repository` is **not** best practice | Real URL or omit |
| D2 | Tighten workspace clippy `"allow"`s | Align no-allow story |
| D3 | FileVault Off = **high risk** | Redesign bootstrap recipe |
| D4 | SECURITY “CI runs gitleaks” | Wire CI or unclaim (= GH-01) |
| D5 | ADMIN + README ops overlap | Single human ops SSOT |
| D6 | **Skill curator** owns all skills (global install → grant) | Default grants empty |
| D7 | **Agent curator** creates/evaluates agents | No skills / no agent-mesh by default |
| D8 | Sole model context = one pure-MD **`AGENTS.md` per agent** | No multi-file law dump per turn |
| D9 | This file temporary | Delete when audit complete |

---

## 2. Epics (product direction — not implemented)

| ID | Sev | Epic |
|----|-----|------|
| EPIC-01 | **P0** | Skill curator: catalog, pin, global install, **per-agent grant** (default ∅) |
| EPIC-02 | **P0** | Agent curator: create/update/evaluate agents; **default-deny** peer mesh |
| EPIC-03 | **P0** | Per-agent sole `AGENTS.md` path + harness/msa-chat injection (D8) |
| EPIC-04 | P1 | Multi-agent vault partitions / secret grants (vs shared `admin-agent` vault) |
| EPIC-05 | P1 | Human ops SSOT (merge ADMIN→README or reverse) + honest FileVault story |

Open design (for EPIC-03): live path (`agents/<name>/` vs `~/.config/msa/…`); root `AGENTS.md` = template vs admin-only; msa-chat injects only that file.

---

## 3. Priority backlog (aligned to detail severities)

| Pri | Theme | IDs |
|-----|--------|-----|
| **P0** | Isolation + sole context | CHAT-01, CHAT-02, CHAT-03, CHAT-10, EPIC-01–03, AGENTS-SK-01, AGENTS-SK-02 |
| **P0** | Secret / trust footguns | MSA-01, CHAT-04, GH-01 |
| **P1** | Vault / session / log security | MSA-02–06, MSA-21, MSA-24–25, CHAT-05–08, LOG-01–05 |
| **P1** | Curator vs skill dump / dual paths | AGENTS-SK-03–09, CLAUDE-01, EPIC-04–05 |
| **P1** | Ops honesty / infra truth | D3–D5, LAUNCHD-01, SCHEMA-01 |
| **P2** | Correctness / robustness | MSA-07–20, MSA-22–23, MSA-26–27, CHAT-11–22, CHAT-24, LOG-06–13 |
| **P2** | Lint / CI hygiene | D1–D2, GH-02–03, CARGO-01 |
| **P3** | Polish | LOG-14–16, CHAT-23, CHAT-28, GH-04, LAUNCHD-02–04, SCHEMA-02–03, D9 |

---

## 4. Folder map

| Folder | Role | Section |
|--------|------|---------|
| `crates/msa` | Control plane CLI/lib | §5 |
| `crates/msa-chat` | Shared egui chat | §6 |
| `crates/msa-log` | Typed JSONL | §7 |
| `.agents` | Skill store | §8 |
| `.github` / `.cargo` / `.claude` / `launchd` / `schemas` | Infra | §9 |
| `target/`, `.git/` | Build / VCS | **Skip** |

---

## 5. `crates/msa`

**Purpose:** Vault, host bootstrap, provider capture/materialize, quality, logs CLI.

| ID | Sev | Concern |
|----|-----|---------|
| MSA-01 | **P0** | kcpassword temp not secure create/unlink (`host/util.rs`) |
| MSA-02 | P1 | Password on `sysadminctl` argv |
| MSA-03 | P1 | Env/`--password`/echoed prompt |
| MSA-04 | P1 | `master.key` 0640; group = full vault |
| MSA-05 | P1 | `audit.log` no chmod |
| MSA-06 | P1 | Double Grok refresh → vault desync |
| MSA-07 | P2 | Incomplete OAuth form encoding |
| MSA-08 | P2 | Claude token → shell-exportable env |
| MSA-09 | P2 | Predictable temp basenames |
| MSA-10 | P2 | Secrets in `String` (no zeroize) |
| MSA-11 | P1 | `home_dir` fallback `/` |
| MSA-12 | P1 | Host `Command` status ignored |
| MSA-13 | P1 | Existing user + autologin password mismatch |
| MSA-14 | P2 | Vault `--force` rekey no backup |
| MSA-15 | P2 | Corrupt auth.json drops other providers |
| MSA-16 | P2 | Missing exp always refreshes |
| MSA-17 | P2 | `--token-file` only for Claude |
| MSA-18 | P2 | Doctor: cargo missing not RED |
| MSA-19 | P2 | `Refresh` ≡ materialize all |
| MSA-20 | P2 | No vault file lock |
| MSA-21 | P1 | `acceptance` always wipe, unguarded |
| MSA-22 | P2 | `DebugExpire` unguarded in prod CLI |
| MSA-23 | P2 | Bootstrap no rollback |
| MSA-24 | P1 | Hardcoded `admin-agent` only |
| MSA-25 | P1 | Shared vault ≠ default-deny secrets |
| MSA-26 | P2 | Log agent names unregistered |
| MSA-27 | P2 | `MsaError` stripped by anyhow |
| MSA-31 | P2 | Thin tests |

---

## 6. `crates/msa-chat`

**Purpose:** Shared egui chat; stream CLIs; sessions; compact @ 50%.

| ID | Sev | Concern |
|----|-----|---------|
| CHAT-01 | **P0** | Global `chat-history.json` (not per-agent) |
| CHAT-02 | **P0** | Global session IDs by provider only |
| CHAT-03 | **P0** | No sole `AGENTS.md` injection |
| CHAT-04 | **P0** | Full prompt on CLI **argv** |
| CHAT-05 | P1 | Sessions file no mode 0600 |
| CHAT-06 | P1 | Atomic tmp not chmod before rename |
| CHAT-07 | P1 | Log preview may include history prefix |
| CHAT-08 | P1 | Claude env inject not allowlisted |
| CHAT-09 | P2 | Plaintext full transcript at rest |
| CHAT-10 | **P0** | History fed only when no `session_id` |
| CHAT-11 | P1 | Clear UI clears one provider session only |
| CHAT-12 | P1 | Provider switch while busy |
| CHAT-13 | P1 | Compact fail ignored; flag still true |
| CHAT-14 | P2 | cwd always None |
| CHAT-15 | P2 | Free-form history injection risk |
| CHAT-16 | P2 | Sticky streaming after crash reload |
| CHAT-17 | P1 | Claude dual events → duplicate text |
| CHAT-18 | P1 | Stream read errors swallowed |
| CHAT-19 | P1 | stderr drain deadlock risk |
| CHAT-20 | P2 | Turn tokens ≠ full context fill |
| CHAT-21 | P2 | No kill CLI child on UI exit |
| CHAT-22 | P2 | eframe id always `msa-chat` |
| CHAT-24 | P2 | `app.rs` near 280-line cap |
| CHAT-28 | P3 | Tool/Skill/Subagent parts never produced |

---

## 7. `crates/msa-log`

**Purpose:** Typed JSONL under `~/.config/msa/logs/<agent>/`.

| ID | Sev | Concern |
|----|-----|---------|
| LOG-01 | P1 | Free-text; no library redaction |
| LOG-02 | P1 | `Process.args` full argv |
| LOG-03 | P1 | Plaintext logs outside vault |
| LOG-04 | P1 | Weak dir perms / late chmod |
| LOG-05 | P1 | No flock |
| LOG-06 | P2 | Kind/data unpaired |
| LOG-07 | P2 | Hand schema incomplete |
| LOG-08 | P2 | Bad lines dropped silently |
| LOG-09 | P2 | Empty/sanitize agent path edges |
| LOG-10 | P2 | No rotation; full-file `read_recent` |
| LOG-11 | P2 | `follow` brittle / infinite |
| LOG-12 | P2 | Easy to ignore log errors |
| LOG-13 | P2 | Thin API vs product role |
| LOG-15 | P3 | `human_line` Debug vs serde names |

---

## 8. `.agents/` skills

**Purpose:** Process + vendor skills. Quality **skips** `.agents/**`.

| ID | Sev | Concern |
|----|-----|---------|
| AGENTS-SK-01 | **P0** | Default-deny violated (skills as default load) |
| AGENTS-SK-02 | **P0** | No skill-curator (= EPIC-01) |
| AGENTS-SK-03 | **P0** | `rust-skills` bloat (~265 rules + meta) |
| AGENTS-SK-04 | P1 | Python + nested Cargo in vendor checks |
| AGENTS-SK-05 | P1 | Nested vendor `.github` |
| AGENTS-SK-06 | P1 | Dual path `.agents` vs `.claude` |
| AGENTS-SK-07 | P1 | `skills-lock.json` vendor-only |
| AGENTS-SK-08 | P1 | Vendor teaches `allow`/`todo` vs MSA law |
| AGENTS-SK-09 | P1 | Overlapping rust-* packs |
| AGENTS-SK-10 | P2 | Quality blind spot for skill tree |
| AGENTS-SK-11 | P2 | Nested AGENTS/CLAUDE/README in vendor |
| AGENTS-SK-12 | P2 | msa-* restates STANDARDS (process dupe only) |

---

## 9. Infra

| ID | Sev | Concern |
|----|-----|---------|
| GH-01 | **P0** | No gitleaks in CI; SECURITY false |
| GH-02 | P2 | No least-privilege / concurrency / Dependabot |
| GH-03 | P2 | Release build only `msa` |
| GH-04 | P3 | Linux CI skips host/launchd |
| CARGO-01 | P3 | `cargo qa` ≠ full `msa quality` |
| CLAUDE-01 | P1 | Second skill surface; msa-* missing |
| CLAUDE-02 | P2 | Vendor bloat in Claude tree |
| LAUNCHD-01 | P1 | Hardcoded `/Users/admin-agent` paths |
| LAUNCHD-02 | P2 | Log dir may not exist |
| LAUNCHD-03 | P2 | Materialize every 300s thrash risk |
| SCHEMA-01 | P1 | Schema `providers[]` ≠ code map |
| SCHEMA-02 | P2 | Fictional schema `$id` |
| SCHEMA-03 | P3 | Schema unused |

---

## 10. Root (duplicates D* intentionally cross-linked)

| ID | Sev | Item |
|----|-----|------|
| ROOT-01 | P2 | Placeholder repository (= D1) |
| ROOT-02 | P2 | Workspace clippy allows (= D2) |
| ROOT-03 | P1 | FileVault Off (= D3) |
| ROOT-04 | **P0** | Gitleaks claim (= D4, GH-01) |
| ROOT-05 | P1 | ADMIN vs README (= D5) |

---

## 11. Audit meta

| Scope | Method | Curated IDs | Notes |
|-------|--------|-------------|-------|
| `crates/msa` | explore subagent | MSA-01…27, 31 | Dropped low-signal 28–30, 32–38 |
| `crates/msa-chat` | explore | CHAT-01…22, 24, 28 | Dropped 23, 25–27 |
| `crates/msa-log` | explore | LOG-01…13, 15 | Dropped 14, 16 |
| `.agents` | explore | AGENTS-SK-01…12 | Dropped 13 (folded into EPIC) |
| infra | explore | GH/CARGO/CLAUDE/LAUNCHD/SCHEMA | As listed |
| This file | [reviewer] subagent | — | Fixed priority/ID consistency |

---

## 12. Suggested fix order

1. GH-01 / SECURITY truth  
2. MSA-01 kcpassword temp  
3. CHAT-01, CHAT-02, CHAT-04 isolation + argv  
4. CHAT-03 + CHAT-10 + EPIC-03 sole context  
5. EPIC-01 / AGENTS-SK-01–02 catalog vs grant  
6. MSA-21, MSA-24–25 acceptance + multi-agent vault (EPIC-04)  
7. SCHEMA-01 align or delete  
8. LAUNCHD-01 generate paths  
9. Stream robustness CHAT-13, 17, 19  
10. EPIC-05 ops SSOT + FileVault  
11. D2 workspace allows  
12. D9 delete this file  

---

## 13. Status after concern-fix pass (2026-07-24)

| ID | Status |
|----|--------|
| GH-01 / D4 | **fixed** — gitleaks job in CI + SECURITY text |
| MSA-01 | **fixed** — unique 0600 kcpassword temp + unlink |
| MSA-02/03 | **partial** — no-echo prompt; sysadminctl still needs argv password |
| MSA-05 | **fixed** — audit.log 0600 |
| MSA-06 | **fixed** — single refresh ownership in ops |
| MSA-11 | **fixed** — home_dir fails closed |
| MSA-12 | **fixed** — critical host ops check status |
| MSA-21 | **fixed** — acceptance --execute / env gate |
| CHAT-01/02 | **fixed** — per-agent history/sessions paths |
| CHAT-03 / EPIC-03 | **foundation** — sole AGENTS.md inject + agents/admin-agent |
| CHAT-04 | **fixed** — grok --prompt-file; claude stdin |
| CHAT-05/06 | **fixed** — 0600/0700 atomic write |
| CHAT-07 | **fixed** — log user text only |
| CHAT-08 | **fixed** — claude env allowlist |
| CHAT-10/11 | **fixed** — policy + clear all providers |
| CHAT-12 | **fixed** — provider locked while busy |
| CHAT-13 | **fixed** — compacted only on Ok |
| CHAT-17/18/19/21 | **fixed** — dedupe, IO errors, stderr thread, ChildGuard |
| LOG-01/02/04/05 | **fixed** — caps, perms, lockfile |
| LAUNCHD-01 | **fixed** — placeholders |
| SCHEMA-01 | **fixed** — providers object map |
| D1 | **fixed** — fake repository omitted |
| D3 | **fixed** — FileVault high-risk optional |
| D5 | **fixed** — ADMIN merged into README, deleted |
| AGENTS-SK-01 | **fixed** — default-deny wording |
| EPIC-01/02 full runtime | **deferred** — markdown scaffolds only |
| EPIC-04 multi-vault | **deferred** — document limitation |

*Last updated: concern-fix implementation pass.*
