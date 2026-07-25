//! Headless agent turns for day-2 web (Grok / Claude CLIs).

mod claude;
mod grok;
mod util;

pub use util::agent_rules_path;

use std::path::Path;

/// Result of one user→agent turn.
#[derive(Debug, Clone)]
pub struct TurnOut {
    /// Agent reply text (errors are prefixed with `(agent error)`).
    pub text: String,
    /// Harness session id for resume, if known.
    pub session_id: Option<String>,
}

/// Server-owned backend selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BackendMode {
    /// Deterministic echo (tests / offline).
    Loopback,
    /// Grok Build CLI (default).
    #[default]
    Grok,
    /// Claude Code CLI.
    Claude,
}

impl BackendMode {
    /// Parse `MSA_WEB_BACKEND` value (`loopback`/`echo`/`grok`/`claude`).
    pub fn from_env_value(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "loopback" | "echo" => Self::Loopback,
            "claude" => Self::Claude,
            _ => Self::Grok,
        }
    }

    /// Short label for CLI logging.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Loopback => "loopback",
            Self::Grok => "grok",
            Self::Claude => "claude",
        }
    }

    /// Read `MSA_WEB_BACKEND` (default Grok).
    pub fn from_env() -> Self {
        std::env::var("MSA_WEB_BACKEND").map_or(Self::Grok, |v| Self::from_env_value(&v))
    }
}

/// Dispatch one turn; missing CLI becomes error text (no panic).
pub fn run_turn(
    mode: BackendMode,
    prompt: &str,
    session_id: Option<&str>,
    rules: Option<&Path>,
) -> TurnOut {
    match mode {
        BackendMode::Loopback => TurnOut {
            text: format!("Received: {prompt}"),
            session_id: None,
        },
        BackendMode::Grok => wrap(grok::run(prompt, session_id, rules), session_id),
        BackendMode::Claude => wrap(claude::run(prompt, session_id, rules), session_id),
    }
}

fn wrap(r: Result<(String, Option<String>), String>, prev: Option<&str>) -> TurnOut {
    match r {
        Ok((text, sid)) => TurnOut {
            text,
            session_id: sid,
        },
        Err(e) => TurnOut {
            text: format!("(agent error) {e}"),
            session_id: prev.map(str::to_string),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_env_dispatch() {
        assert_eq!(
            BackendMode::from_env_value("loopback"),
            BackendMode::Loopback
        );
        assert_eq!(BackendMode::from_env_value("echo"), BackendMode::Loopback);
        assert_eq!(BackendMode::from_env_value("claude"), BackendMode::Claude);
        assert_eq!(BackendMode::from_env_value("grok"), BackendMode::Grok);
        assert_eq!(BackendMode::from_env_value("unknown"), BackendMode::Grok);
    }

    #[test]
    fn loopback_turn_and_missing_cli_error_path() {
        let lb = run_turn(BackendMode::Loopback, "hi", None, None);
        assert_eq!(lb.text, "Received: hi");

        // Drive real Grok/Claude dispatch arms; force finders to miss (no spawn).
        util::set_force_cli_miss(true);
        let g = run_turn(BackendMode::Grok, "x", None, None);
        let c = run_turn(BackendMode::Claude, "x", None, None);
        util::set_force_cli_miss(false);
        assert!(g.text.starts_with("(agent error)"), "got {}", g.text);
        assert!(c.text.starts_with("(agent error)"), "got {}", c.text);
        assert!(g.text.contains("grok"));
        assert!(c.text.contains("claude"));
    }
}
