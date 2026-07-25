# pwa-agent

Browser PWA personal-agent research: **on-device LLM** comparison bench (WebLLM vs Transformers.js), metrics JSONL, cache/memory measurements.

Migrated from a `pwa-llm` worktree of mac-studio-agents (research isolation). Day-2 MSA product crates may still be present in this tree; the **operator-facing spike** lives under [`pwa-bench/`](./pwa-bench/).

## Quick start (comparison bench)

```bash
cd pwa-bench
npm start
# → http://127.0.0.1:7430/   (not 7420)
```

```bash
cd pwa-bench && npm test
```

## Layout

| Path | Role |
|------|------|
| `pwa-bench/` | Isolated WebLLM / Transformers.js bench, JSONL metrics, charts |
| `PWA_LLM.md` | Architecture research notes for the personal-agent PWA |
| `crates/`, `AGENTS.md`, … | Historical MSA monorepo snapshot carried over with the worktree |

## License

See [LICENSE](./LICENSE).
