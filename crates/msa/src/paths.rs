//! Canonical filesystem locations and PATH fixups for non-login shells.

use std::env;
use std::path::{Path, PathBuf};

use crate::error::{MsaError, Result};

/// Default vault directory (override with `MSA_VAULT_DIR`).
pub fn vault_dir() -> PathBuf {
    env::var_os("MSA_VAULT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/var/lib/msa-vault"))
}

/// Home directory for materialize/detect (override with `MSA_HOME`).
/// Fails closed when home cannot be resolved (no `/` fallback).
pub fn home_dir() -> Result<PathBuf> {
    if let Some(p) = env::var_os("MSA_HOME") {
        return Ok(PathBuf::from(p));
    }
    dirs::home_dir().ok_or_else(|| MsaError::Msg("home directory not found".into()))
}

/// Path to Grok Build native auth file.
pub fn grok_auth_path(home: &Path) -> PathBuf {
    home.join(".grok").join("auth.json")
}

/// Path to Claude setup-token env file.
pub fn claude_env_path(home: &Path) -> PathBuf {
    home.join(".config").join("msa").join("claude.env")
}

/// Absolute path prefixes required on non-login SSH shells.
pub fn path_prepends() -> [&'static str; 3] {
    ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"]
}

/// Ensure brew / cargo / agent bins are on `PATH` (login-independent).
pub fn ensure_path_env() {
    let mut ordered: Vec<String> = path_prepends().map(str::to_string).to_vec();

    if let Ok(home) = env::var("HOME") {
        ordered.push(format!("{home}/.local/bin"));
        ordered.push(format!("{home}/.cargo/bin"));
        ordered.push(format!("{home}/.grok/bin"));
    }

    let rest = env::var("PATH").unwrap_or_default();
    for seg in rest.split(':').filter(|s| !s.is_empty()) {
        if !ordered.iter().any(|o| o == seg) {
            ordered.push(seg.to_string());
        }
    }

    // SAFETY: PATH is process-local configuration for CLI tooling.
    env::set_var("PATH", ordered.join(":"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grok_path_under_home() {
        let p = grok_auth_path(Path::new("/Users/admin-agent"));
        assert_eq!(p, PathBuf::from("/Users/admin-agent/.grok/auth.json"));
    }
}
