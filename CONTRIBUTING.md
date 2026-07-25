# Contributing

## Required reading (humans and agents)

Every change **must** follow:

1. **[STANDARDS.md](STANDARDS.md)** — coding law (no exceptions without human amendment)  
2. **This file** — process and quality gates  
3. **[AGENTS.md](AGENTS.md)** — if you are a coding agent  

Agents: load skill **`msa-coding-standards`** on every edit.

## Quality gates (must pass)

```bash
cargo run -q -p msa -- quality
```

Must print `OK msa quality GREEN`. CI runs the same.

## Absolute bans

- Non-Rust product code  
- `#[allow(...)]` / `#![allow(...)]` / `#[expect(...)]` / test-only allows  
- Dead code, empty files, stub lines  
- Files over 280 (`.rs`) / 300 (product `.md`) lines  
- Secrets in the tree  
- **`docs/`** (or any parallel instruction/doc dump tree) — use code + AGENTS + skills + agent memory  


## Dev setup

```bash
rustup show
cargo build -p msa -p msa-ui -p msa-web
cargo test --workspace
```

## License

MIT.
