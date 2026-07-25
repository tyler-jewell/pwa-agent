//! Log filesystem layout.

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum PathError {
    #[error("home directory not found")]
    NoHome,
}

/// `~/.config/msa/logs/<agent>/`
pub fn log_dir(agent: &str) -> Result<PathBuf, PathError> {
    let home = dirs::home_dir().ok_or(PathError::NoHome)?;
    let safe = sanitize_agent(agent);
    Ok(home.join(".config/msa/logs").join(safe))
}

/// `~/.config/msa/logs/<agent>/events.jsonl`
pub fn log_file(agent: &str) -> Result<PathBuf, PathError> {
    Ok(log_dir(agent)?.join("events.jsonl"))
}

fn sanitize_agent(agent: &str) -> String {
    let s: String = agent
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() {
        "agent".into()
    } else {
        s
    }
}
