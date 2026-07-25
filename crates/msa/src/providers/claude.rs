use std::fs;
use std::path::Path;

use chrono::Utc;
use serde_json::json;

use super::{DetectResult, Provider, ProviderBlob};
use crate::error::{MsaError, Result};
use crate::paths::claude_env_path;

pub struct ClaudeProvider;

impl Provider for ClaudeProvider {
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn detect(&self, home: &Path) -> DetectResult {
        let path = claude_env_path(home);
        let token = read_token(&path).or_else(|| std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok());
        match token {
            Some(t) if t.len() > 20 => DetectResult {
                provider_id: self.id().into(),
                present: true,
                usable: true,
                detail: "env token present".into(),
                reason: "ok".into(),
                expires_at: None,
            },
            Some(_) => DetectResult {
                provider_id: self.id().into(),
                present: true,
                usable: false,
                detail: "token too short".into(),
                reason: "invalid".into(),
                expires_at: None,
            },
            None => DetectResult {
                provider_id: self.id().into(),
                present: false,
                usable: false,
                detail: "no CLAUDE_CODE_OAUTH_TOKEN / claude.env".into(),
                reason: "missing".into(),
                expires_at: None,
            },
        }
    }

    fn wipe(&self, home: &Path) -> Result<()> {
        let path = claude_env_path(home);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    fn capture(&self, home: &Path) -> Result<ProviderBlob> {
        let path = claude_env_path(home);
        let token = read_token(&path)
            .or_else(|| std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok())
            .ok_or_else(|| {
                MsaError::Msg(
                    "No Claude token. Run: claude setup-token, then write ~/.config/msa/claude.env"
                        .into(),
                )
            })?;
        Ok(ProviderBlob {
            provider_id: self.id().into(),
            data: json!({
                "token": token.trim(),
                "preferred_materialization": "env_token"
            }),
            captured_at: Some(Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        })
    }

    fn materialize(&self, home: &Path, blob: &ProviderBlob) -> Result<()> {
        let token = blob
            .data
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| MsaError::Msg("claude blob missing token".into()))?;
        let path = claude_env_path(home);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let quoted = token.replace('\'', "'\"'\"'");
        let content = format!(
            "# Managed by msa (Rust) — do not commit\nexport CLAUDE_CODE_OAUTH_TOKEN='{quoted}'\n"
        );
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, content)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        }
        fs::rename(&tmp, &path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }

    fn refresh_if_needed(&self, blob: ProviderBlob) -> Result<(ProviderBlob, bool)> {
        Ok((blob, false))
    }
}

fn read_token(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some(rest) = line.strip_prefix("CLAUDE_CODE_OAUTH_TOKEN=") {
            return Some(
                rest.trim()
                    .trim_matches(|c| c == '\'' || c == '"')
                    .to_string(),
            );
        }
    }
    None
}

/// Capture from explicit token string (CLI --token-file).
pub fn capture_token(token: &str) -> ProviderBlob {
    ProviderBlob {
        provider_id: "claude-code".into(),
        data: json!({
            "token": token.trim(),
            "preferred_materialization": "env_token"
        }),
        captured_at: Some(Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
    }
}
