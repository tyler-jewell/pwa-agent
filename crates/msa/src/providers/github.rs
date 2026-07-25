use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use chrono::Utc;
use serde_json::json;
use which::which;

use super::{DetectResult, Provider, ProviderBlob};
use crate::error::{MsaError, Result};

pub struct GitHubProvider;

impl Provider for GitHubProvider {
    fn id(&self) -> &'static str {
        "github"
    }

    fn detect(&self, home: &Path) -> DetectResult {
        let Some(gh) = find_gh() else {
            return DetectResult {
                provider_id: self.id().into(),
                present: false,
                usable: false,
                detail: "gh binary not found".into(),
                reason: "missing_binary".into(),
                expires_at: None,
            };
        };
        let out = Command::new(&gh)
            .args(["auth", "status", "-h", "github.com"])
            .env("HOME", home)
            .output();
        match out {
            Ok(o) => {
                let text = String::from_utf8_lossy(&o.stdout).to_string()
                    + &String::from_utf8_lossy(&o.stderr);
                let ok = o.status.success() && text.contains("Logged in");
                DetectResult {
                    provider_id: self.id().into(),
                    present: true,
                    usable: ok,
                    detail: text.lines().next().unwrap_or("gh auth status").into(),
                    reason: if ok { "ok".into() } else { "invalid".into() },
                    expires_at: None,
                }
            }
            Err(e) => DetectResult {
                provider_id: self.id().into(),
                present: false,
                usable: false,
                detail: e.to_string(),
                reason: "error".into(),
                expires_at: None,
            },
        }
    }

    fn wipe(&self, home: &Path) -> Result<()> {
        if let Some(gh) = find_gh() {
            let _ = Command::new(gh)
                .args(["auth", "logout", "-h", "github.com", "-y"])
                .env("HOME", home)
                .status();
        }
        Ok(())
    }

    fn capture(&self, home: &Path) -> Result<ProviderBlob> {
        let gh = find_gh().ok_or_else(|| MsaError::Msg("gh not found".into()))?;
        let out = Command::new(gh)
            .args(["auth", "token", "-h", "github.com"])
            .env("HOME", home)
            .output()?;
        if !out.status.success() {
            return Err(MsaError::Msg(
                "gh auth token failed — complete: gh auth login (HUMAN)".into(),
            ));
        }
        let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if token.is_empty() {
            return Err(MsaError::Msg("empty gh token".into()));
        }
        Ok(ProviderBlob {
            provider_id: self.id().into(),
            data: json!({ "token": token, "host": "github.com" }),
            captured_at: Some(Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        })
    }

    fn materialize(&self, home: &Path, blob: &ProviderBlob) -> Result<()> {
        let token = blob
            .data
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| MsaError::Msg("github blob missing token".into()))?;
        let gh = find_gh().ok_or_else(|| MsaError::Msg("gh not found".into()))?;
        let mut child = Command::new(gh)
            .args(["auth", "login", "--with-token", "-h", "github.com"])
            .env("HOME", home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            writeln!(stdin, "{token}")?;
        }
        let out = child.wait_with_output()?;
        if !out.status.success() {
            return Err(MsaError::Msg(format!(
                "gh auth login --with-token failed: {}",
                String::from_utf8_lossy(&out.stderr)
            )));
        }
        Ok(())
    }

    fn refresh_if_needed(&self, blob: ProviderBlob) -> Result<(ProviderBlob, bool)> {
        Ok((blob, false))
    }
}

fn find_gh() -> Option<std::path::PathBuf> {
    which("gh")
        .ok()
        .or_else(|| {
            let p = std::path::PathBuf::from("/opt/homebrew/bin/gh");
            p.is_file().then_some(p)
        })
        .or_else(|| {
            let p = std::path::PathBuf::from("/usr/local/bin/gh");
            p.is_file().then_some(p)
        })
}
