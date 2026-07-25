//! Append-only JSONL writer + read/follow helpers.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::thread;
use std::time::Duration;

use thiserror::Error;

use crate::event::{Event, EventData};
use crate::lock::DirLock;
use crate::path::{log_dir, log_file, PathError};

const PREVIEW_CAP: usize = 200;
const ARG_CAP: usize = 80;
const ARG_LIST_CAP: usize = 32;

#[derive(Debug, Error)]
pub enum LogError {
    #[error(transparent)]
    Path(#[from] PathError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Logger bound to one agent identity.
#[derive(Debug, Clone)]
pub struct Logger {
    agent: String,
}

impl Logger {
    pub fn new(agent: impl Into<String>) -> Self {
        Self {
            agent: agent.into(),
        }
    }

    pub fn agent(&self) -> &str {
        &self.agent
    }

    pub fn log(&self, event: &Event) -> Result<(), LogError> {
        append(&self.agent, event)
    }
}

fn clip(s: &mut String, cap: usize) {
    if s.chars().count() > cap {
        *s = s.chars().take(cap).collect::<String>() + "…";
    }
}

/// Cap free-text fields before write (LOG-01/02).
fn redact_event(mut event: Event) -> Event {
    match &mut event.data {
        EventData::Process { args, .. } => {
            if args.len() > ARG_LIST_CAP {
                args.truncate(ARG_LIST_CAP);
                args.push("…".into());
            }
            for a in args.iter_mut() {
                clip(a, ARG_CAP);
            }
        }
        EventData::ChatTurn {
            prompt_preview,
            error,
            ..
        } => {
            clip(prompt_preview, PREVIEW_CAP);
            if let Some(e) = error {
                clip(e, PREVIEW_CAP);
            }
        }
        EventData::Cli {
            args_preview,
            stderr_preview,
            ..
        } => {
            if args_preview.len() > ARG_LIST_CAP {
                args_preview.truncate(ARG_LIST_CAP);
                args_preview.push("…".into());
            }
            for a in args_preview.iter_mut() {
                clip(a, ARG_CAP);
            }
            if let Some(s) = stderr_preview {
                clip(s, PREVIEW_CAP);
            }
        }
        EventData::Quality { detail, .. } => clip(detail, PREVIEW_CAP),
        EventData::Note { message } => clip(message, PREVIEW_CAP),
    }
    event
}

/// Append one event as a single JSON line (atomic-ish: write line + flush).
pub fn append(agent: &str, event: &Event) -> Result<(), LogError> {
    let event = redact_event(event.clone());
    let dir = log_dir(agent)?;
    fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
    }
    let _lock = DirLock::acquire(&dir)?;
    let path = log_file(agent)?;
    let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }
    let mut line = serde_json::to_string(&event)?;
    line.push('\n');
    f.write_all(line.as_bytes())?;
    f.flush()?;
    Ok(())
}

/// Read up to `limit` most recent events (from end of file).
pub fn read_recent(agent: &str, limit: usize) -> Result<Vec<Event>, LogError> {
    let path = log_file(agent)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let file = File::open(&path)?;
    let reader = BufReader::new(file);
    let mut all = Vec::new();
    for line in reader.lines() {
        let line = line?;
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if let Ok(e) = serde_json::from_str::<Event>(t) {
            all.push(e);
        }
    }
    if all.len() > limit {
        let start = all.len() - limit;
        Ok(all.split_off(start))
    } else {
        Ok(all)
    }
}

/// Follow new lines (agent stream). Blocks; calls `on_event` for each new record.
pub fn follow<F>(agent: &str, mut on_event: F) -> Result<(), LogError>
where
    F: FnMut(Event),
{
    let path = log_file(agent)?;
    while !path.is_file() {
        thread::sleep(Duration::from_millis(200));
    }
    let mut file = File::open(&path)?;
    file.seek(SeekFrom::End(0))?;
    let mut reader = BufReader::new(file);
    let mut buf = String::new();
    loop {
        buf.clear();
        let n = reader.read_line(&mut buf)?;
        if n == 0 {
            thread::sleep(Duration::from_millis(150));
            if let Ok(meta) = fs::metadata(&path) {
                let pos = reader.stream_position()?;
                if pos > meta.len() {
                    let f = File::open(&path)?;
                    reader = BufReader::new(f);
                }
            }
            continue;
        }
        let t = buf.trim();
        if t.is_empty() {
            continue;
        }
        if let Ok(e) = serde_json::from_str::<Event>(t) {
            on_event(e);
        }
    }
}

/// Export a JSON Schema-like document describing event shapes (for agents).
pub fn schema_json() -> serde_json::Value {
    serde_json::json!({
        "title": "msa-log Event",
        "version": crate::SCHEMA_V,
        "description": "One JSONL line per event. Agent-first structured log.",
        "required": ["v", "ts", "level", "agent", "component", "kind", "trace_id", "data"],
        "properties": {
            "v": { "type": "integer", "const": crate::SCHEMA_V },
            "ts": { "type": "string", "format": "date-time" },
            "level": { "enum": ["debug", "info", "warn", "error"] },
            "agent": { "type": "string" },
            "component": { "type": "string" },
            "kind": {
                "enum": [
                    "process_start", "process_end",
                    "chat_turn_start", "chat_turn_end",
                    "cli_spawn", "cli_exit",
                    "quality", "note"
                ]
            },
            "trace_id": { "type": "string", "format": "uuid" },
            "parent_trace_id": { "type": ["string", "null"], "format": "uuid" },
            "data": {
                "oneOf": [
                    { "properties": { "type": { "const": "process" } } },
                    { "properties": { "type": { "const": "chat_turn" } } },
                    { "properties": { "type": { "const": "cli" } } },
                    { "properties": { "type": { "const": "quality" } } },
                    { "properties": { "type": { "const": "note" } } }
                ]
            }
        },
        "path": "~/.config/msa/logs/<agent>/events.jsonl"
    })
}

/// Path helper for CLI display.
pub fn events_path(agent: &str) -> Result<std::path::PathBuf, LogError> {
    Ok(log_file(agent)?)
}
