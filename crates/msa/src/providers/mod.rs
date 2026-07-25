mod claude;
mod github;
mod grok;

use std::path::Path;

use serde_json::Value;

use crate::error::Result;

pub use claude::{capture_token, ClaudeProvider};
pub use github::GitHubProvider;
pub use grok::GrokProvider;

pub const DAY1: &[&str] = &["xai-oauth", "claude-code", "github"];

#[derive(Debug, Clone)]
pub struct DetectResult {
    pub provider_id: String,
    pub present: bool,
    pub usable: bool,
    pub detail: String,
    pub reason: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderBlob {
    /// Canonical provider id (e.g. `xai-oauth`).
    pub provider_id: String,
    /// Opaque provider-specific secret payload (never log).
    pub data: Value,
    /// Capture timestamp (ISO-8601), if known.
    pub captured_at: Option<String>,
}

impl ProviderBlob {
    /// Provider id for logging (no secrets).
    #[must_use]
    pub fn id(&self) -> &str {
        &self.provider_id
    }
}

pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;
    fn detect(&self, home: &Path) -> DetectResult;
    fn wipe(&self, home: &Path) -> Result<()>;
    fn capture(&self, home: &Path) -> Result<ProviderBlob>;
    fn materialize(&self, home: &Path, blob: &ProviderBlob) -> Result<()>;
    /// Refresh tokens in-place if needed. Returns (blob, did_refresh).
    fn refresh_if_needed(&self, blob: ProviderBlob) -> Result<(ProviderBlob, bool)>;
}

pub fn get(name: &str) -> Result<&'static dyn Provider> {
    Ok(match name {
        "xai-oauth" | "grok" => &GrokProvider as &dyn Provider,
        "claude-code" | "claude" => &ClaudeProvider as &dyn Provider,
        "github" | "gh" => &GitHubProvider as &dyn Provider,
        other => {
            return Err(crate::error::MsaError::Msg(format!(
                "unknown provider {other:?}; known: {}",
                DAY1.join(", ")
            )));
        }
    })
}

pub fn resolve_list(name: &str) -> Result<Vec<&'static dyn Provider>> {
    if name == "all" || name == "*" {
        let mut out = Vec::with_capacity(DAY1.len());
        for id in DAY1 {
            out.push(get(id)?);
        }
        return Ok(out);
    }
    Ok(vec![get(name)?])
}
