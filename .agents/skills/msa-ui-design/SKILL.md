---
name: msa-ui-design
description: >
  MSA first-class UI rules: when building or changing any agent web UI, use
  msa-ui/msa-web only. Resolves conflicts among frontend-design, brand-guidelines,
  web-design-guidelines, htmx, and ui-ux-pro-max. Use for every agent surface
  (chat, fleet, settings, tools) — not only chat.
---

# msa-ui-design (project SSOT)

## When this skill wins

If any other design skill conflicts with this file, **this file wins** for mac-studio-agents.

## Product constraints (locked)

| Rule | Decision |
|------|----------|
| Day-2 human UI | `msa web` — pure Rust HTTP + HTML/CSS from `msa-ui` |
| Forbidden day-2 | Telegram, SMS, Twilio, iMessage, egui as SSOT |
| Client | Chrome to localhost; no React/Vue/Next product apps |
| Interactivity | Prefer **HTMX** fragments next; full-page OK until then |
| State | **Server-owned** in Rust (transcript, agent, permissions) |
| Browser-only | Draft text, mic listening, scroll |

## Skill layering (no confusion)

Load in this order when doing UI work:

1. **`msa-ui-design`** (this file) — architecture + crate boundaries  
2. **`frontend-design`** (Anthropic) — visual quality, anti-slop aesthetics  
3. **`web-design-guidelines`** (Vercel) — production web UX  
4. **`brand-guidelines`** (Anthropic) — **not** for MSA chrome colors (that skill is Anthropic corporate brand). For MSA UI use **`msa-ui` tokens only**. Use brand-guidelines only if producing Anthropic-branded collateral.  
5. **`htmx`** — only when implementing partial updates / `hx-*` attributes  
6. **`ui-ux-pro-max`** — optional palette/type **ideas**; never add React/Next/Vue stacks it suggests; codify choices in `msa-ui`  

### Do not

- Apply Anthropic orange/typography from `brand-guidelines` to MSA agent UI  
- Generate React/Tailwind/shadcn apps because community skills suggest them  
- Put design tokens only in skill prose — put them in **`crates/msa-ui`** CSS emitters  
- Use Leptos/Dioxus/egui for day-2 without an explicit human decision to abandon HTML SSOT  
- Use HyperFrames (HTML→video) for interactive agent shells  

## Implementation map

| Need | Crate / path |
|------|----------------|
| Tokens, bubbles, forms, buttons, shells | `crates/msa-ui` |
| HTTP, routes, sessions, HTMX endpoints | `crates/msa-web` |
| CLI entry | `msa web --agent <name> --bind …` |
| Agent owning UI system | `agents/ui-curator/AGENTS.md` |

## HTMX convention (when adding)

- Server returns **HTML fragments** from the same widgets as full pages  
- `hx-post` / `hx-target` / `hx-swap` only; no client state store  
- Stream later via SSE + fragment append, still server-owned transcript  

## Done check

- [ ] Widget lives in `msa-ui` and is reused by path `/a/<agent>/…`  
- [ ] No new messaging or egui day-2 path  
- [ ] `msa quality` GREEN  
