//! Shared CLI helpers for agent turns.

use std::io::Write;
use std::path::{Path, PathBuf};

const CLAUDE_ENV_KEYS: &[&str] = &[
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
];

/// Locate `agents/<name>/AGENTS.md` walking up from cwd.
pub fn agent_rules_path(agent: &str) -> Option<PathBuf> {
    let safe: String = agent
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let Ok(cwd) = std::env::current_dir() else {
        return None;
    };
    let mut dir = cwd;
    for _ in 0..10 {
        let candidate = dir.join("agents").join(&safe).join("AGENTS.md");
        if candidate.is_file() {
            return Some(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

use std::sync::atomic::{AtomicBool, Ordering};

/// Test hook: when true, CLI finders fail without spawning.
static FORCE_CLI_MISS: AtomicBool = AtomicBool::new(false);

/// When force flag or `MSA_WEB_FORCE_CLI_MISS=1`, CLI finders fail.
pub(super) fn force_cli_miss() -> bool {
    FORCE_CLI_MISS.load(Ordering::SeqCst)
        || matches!(
            std::env::var("MSA_WEB_FORCE_CLI_MISS").as_deref(),
            Ok("1" | "true")
        )
}

/// Test-only: toggle forced CLI miss (serialized by callers).
#[cfg(test)]
pub(super) fn set_force_cli_miss(v: bool) {
    FORCE_CLI_MISS.store(v, Ordering::SeqCst);
}

pub(super) fn enhanced_path() -> String {
    let mut parts = vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into()];
    if let Some(home) = dirs::home_dir() {
        parts.push(format!("{}/.grok/bin", home.display()));
        parts.push(format!("{}/.local/bin", home.display()));
        parts.push(format!("{}/.cargo/bin", home.display()));
    }
    if let Ok(p) = std::env::var("PATH") {
        parts.push(p);
    }
    parts.join(":")
}

pub(super) fn write_prompt_file(prompt: &str) -> Result<PathBuf, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::os::unix::fs::OpenOptionsExt;
    let mut last = String::from("prompt temp exhausted");
    for _ in 0..8 {
        let mut h = DefaultHasher::new();
        std::process::id().hash(&mut h);
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
            .hash(&mut h);
        let path = std::env::temp_dir().join(format!(
            "msa-web-prompt-{}-{}.txt",
            std::process::id(),
            h.finish()
        ));
        let mut opts = std::fs::OpenOptions::new();
        let _ = opts.write(true).create_new(true).mode(0o600);
        match opts.open(&path) {
            Ok(mut f) => {
                f.write_all(prompt.as_bytes())
                    .map_err(|e| format!("prompt write: {e}"))?;
                f.sync_all().map_err(|e| format!("prompt sync: {e}"))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                last = format!("exists {}", path.display());
            }
            Err(e) => return Err(format!("prompt create: {e}")),
        }
    }
    Err(last)
}

pub(super) struct PromptFile(pub PathBuf);
impl Drop for PromptFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Inject allowlisted Claude token env keys from `~/.config/msa/claude.env`.
pub(super) fn load_claude_env(cmd: &mut std::process::Command) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let Ok(text) = std::fs::read_to_string(home.join(".config/msa/claude.env")) else {
        return;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some((k, v)) = line.split_once('=') {
            let k = k.trim();
            if CLAUDE_ENV_KEYS.contains(&k) {
                let _ = cmd.env(k, v.trim().trim_matches(|c| c == '\'' || c == '"'));
            }
        }
    }
}

pub(super) fn join_stderr(stderr: std::process::ChildStderr) -> String {
    use std::io::BufRead;
    std::io::BufReader::new(stderr)
        .lines()
        .collect::<Result<Vec<_>, _>>()
        .unwrap_or_default()
        .join("\n")
}

/// Ensure path type is used for rules args.
pub(super) fn rules_arg(cmd: &mut std::process::Command, flag: &str, rules: Option<&Path>) {
    if let Some(r) = rules {
        let _ = cmd.arg(flag).arg(r);
    }
}
