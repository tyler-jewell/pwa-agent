# mac-studio-agents

**Pure Rust** Mac Studio host: vaulted cloud CLIs (Claude/Grok) + **local HTML/CSS web UI** as the human day-2 path.

| Principle | Rule |
|-----------|------|
| Runtime | **Rust only** (`crates/msa`, `msa-ui`, `msa-web`, `msa-log`) |
| Day-2 UI | **`msa web`** — Rust serves HTML/CSS; open Chrome (not egui, not Telegram/SMS) |
| Design system | First-party **`msa-ui`** widgets/tokens (reusable across agents) |
| Quality | `msa quality` → `OK msa quality GREEN` |

Coding agents: **STANDARDS.md** → **AGENTS.md** → skill `msa-coding-standards`.

---

## Greenfield (one entry)

```bash
./scripts/setup-mac-studio.sh
# or: cargo install --path crates/msa && msa setup --skip-host --dry-run
```

Host bootstrap still available via `msa setup` (optional flags). **Human day-2 does not use messaging apps.**

---

## Day-2: local web chat (SSOT)

```bash
msa web --bind 127.0.0.1:7420 --agent admin-agent
# Chrome → http://127.0.0.1:7420/a/admin-agent
```

- Centered chat transcript + text form + **circular mic** (browser speech → text).
- Each send runs **Grok** (default) or **Claude** (`MSA_WEB_BACKEND=claude`); session + transcript persist under `~/.config/msa/agents/<agent>/web-transcript.json`.
- Offline/tests: `MSA_WEB_BACKEND=loopback` echoes `Received: …`. Optional `MSA_WEB_DATA_ROOT` overrides config root.
- No React/Node/egui for this path. HTML/CSS emitted by `msa-ui`.

HTMX: form posts return transcript fragments (`HX-Request`); full-page still works without JS.

---

## Develop

```bash
cargo run -q -p msa -- quality
cargo test -p msa-ui -p msa-web
msa web --bind 127.0.0.1:7420 --agent admin-agent
```

## License

MIT — [`LICENSE`](LICENSE)
