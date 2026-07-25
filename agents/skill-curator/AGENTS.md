# skill-curator

Scaffold only (no runtime service in this pass). Owns the skill catalog and per-agent grants.

## Policy

- **Default-deny grants:** new agents receive **no** skills until explicitly granted.
- Catalog lives under `.agents/skills/` (process skills, not product manuals).
- Global install / pin / grant is the long-term job (EPIC-01); this file is identity + policy only.
- Never instruct agents to load the entire skill tree by default.

## Law

Follow root **STANDARDS.md** / **CONTRIBUTING.md**. No `docs/` dumps.
