---
name: msa-ui-check
description: >
  RETIRED for day-2. After web UI edits: msa quality GREEN + smoke msa web.
  Replaces msa-chat Id-collision checklist.
---

# msa-ui-check (retired)

Use with **`msa-ui-design`**. After `msa-ui` / `msa-web` edits:

1. `cargo run -q -p msa -- quality` → `OK msa quality GREEN`
2. Loopback smoke: `MSA_WEB_BACKEND=loopback msa web` → GET `/health`, HTMX POST
3. Do not reintroduce egui / `msa-chat`
