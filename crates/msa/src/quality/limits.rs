//! File size limits tuned so frontier coding models can load a whole file in one tool call.
//!
//! ## Research summary (2026 agent tooling)
//!
//! | Constraint | Implication |
//! |------------|-------------|
//! | Shell/tool output caps (~40k chars common) | ~500–1000 dense lines before truncation risk |
//! | Attention / “lost in the middle” | Smaller units → better edit accuracy |
//! | Typical Rust ~40–80 tokens/line | 280 lines ≈ 11–22k tokens — room left for prompt + other files |
//! | Multi-file agent turns need headroom | One file must not dominate context |
//!
//! **Policy (hard fail in `msa quality`):**
//! - Rust sources: **≤ 280 lines**
//! - Product markdown (repo root only; **no `docs/`** tree; not vendor skills): **≤ 300 lines**
//!
//! Prefer splitting modules early; never grow past these limits.

/// Max lines for product `*.rs` files under `crates/`.
pub const MAX_RS_LINES: usize = 280;

/// Max lines for product `*.md` files (excludes `.agents/skills` vendor packs).
pub const MAX_MD_LINES: usize = 300;
