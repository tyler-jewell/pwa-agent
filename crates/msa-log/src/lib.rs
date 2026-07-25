//! Agent-first structured logging for all MSA agents.
//!
//! - **Agent-first:** every line is one JSON object (JSONL), machine-parseable.
//! - **Human-second:** optional pretty summaries via `msa logs`.
//! - **Typed:** [`EventKind`] + [`EventData`] are serde enums (schema introspectable).
//!
//! Log root: `~/.config/msa/logs/<agent>/events.jsonl`

#![forbid(unsafe_code)]

mod event;
mod lock;
mod path;
mod writer;

pub use event::{Event, EventData, EventKind, Level};
pub use path::{log_dir, log_file};
pub use writer::{append, events_path, follow, read_recent, schema_json, Logger};

/// Schema version for all log records.
pub const SCHEMA_V: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{EventData, EventKind, Level};

    #[test]
    fn append_and_read_roundtrip() {
        let agent = format!("test-agent-{}", uuid::Uuid::new_v4());
        let e = Event::new(
            &agent,
            "test",
            Level::Info,
            EventKind::Note,
            EventData::Note {
                message: "hello".into(),
            },
        );
        assert!(append(&agent, &e).is_ok());
        let recent = read_recent(&agent, 10).unwrap_or_default();
        assert!(!recent.is_empty(), "expected at least one logged event");
        assert_eq!(
            recent.last().map(|ev| ev.agent.as_str()),
            Some(agent.as_str())
        );
        if let Ok(dir) = log_dir(&agent) {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}
