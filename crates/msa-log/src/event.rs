//! Strongly typed log events (agent introspection via serde JSON Schema-ish dump).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Severity. Agents filter on this first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

/// Stable event names. Extend only by adding variants (no free-string events).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    /// Process / binary started.
    ProcessStart,
    /// Process exiting.
    ProcessEnd,
    /// Chat turn accepted from human.
    ChatTurnStart,
    /// Chat turn finished (ok or error).
    ChatTurnEnd,
    /// External CLI spawn (claude/grok/gh/…).
    CliSpawn,
    /// External CLI finished.
    CliExit,
    /// Quality gate step.
    Quality,
    /// Generic structured note (prefer specific kinds).
    Note,
}

/// Typed payloads. One variant per kind group; agents match on `kind` then `data`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventData {
    Process {
        binary: String,
        pid: u32,
        args: Vec<String>,
    },
    ChatTurn {
        provider: String,
        /// Redacted/short prompt preview (never full secrets).
        prompt_preview: String,
        /// Optional full reply length only (not full text in logs by default).
        reply_chars: Option<usize>,
        ok: bool,
        error: Option<String>,
        duration_ms: Option<u64>,
    },
    Cli {
        program: String,
        args_preview: Vec<String>,
        exit_code: Option<i32>,
        duration_ms: Option<u64>,
        stdout_chars: Option<usize>,
        stderr_preview: Option<String>,
        ok: bool,
    },
    Quality {
        rule: String,
        ok: bool,
        detail: String,
    },
    Note {
        message: String,
    },
}

/// One JSONL record. Field order is stable for agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    /// Schema version.
    pub v: u32,
    pub ts: DateTime<Utc>,
    pub level: Level,
    /// Agent identity (e.g. admin-agent).
    pub agent: String,
    /// Subsystem (msa-web, msa, backend.grok, …).
    pub component: String,
    pub kind: EventKind,
    /// Correlates a turn / operation.
    pub trace_id: Uuid,
    /// Optional parent span.
    pub parent_trace_id: Option<Uuid>,
    pub data: EventData,
}

impl Event {
    pub fn new(
        agent: impl Into<String>,
        component: impl Into<String>,
        level: Level,
        kind: EventKind,
        data: EventData,
    ) -> Self {
        Self {
            v: crate::SCHEMA_V,
            ts: Utc::now(),
            level,
            agent: agent.into(),
            component: component.into(),
            kind,
            trace_id: Uuid::new_v4(),
            parent_trace_id: None,
            data,
        }
    }

    pub fn with_trace(mut self, trace_id: Uuid) -> Self {
        self.trace_id = trace_id;
        self
    }

    pub fn with_parent(mut self, parent: Uuid) -> Self {
        self.parent_trace_id = Some(parent);
        self
    }

    /// Compact human-second one-liner (agents should prefer full JSON).
    pub fn human_line(&self) -> String {
        let preview = match &self.data {
            EventData::ChatTurn {
                provider,
                prompt_preview,
                ok,
                error,
                duration_ms,
                ..
            } => format!(
                "chat {provider} ok={ok} {duration_ms:?}ms preview={prompt_preview:?} err={error:?}"
            ),
            EventData::Cli {
                program,
                exit_code,
                duration_ms,
                ok,
                stderr_preview,
                ..
            } => format!(
                "cli {program} ok={ok} exit={exit_code:?} {duration_ms:?}ms stderr={stderr_preview:?}"
            ),
            EventData::Process { binary, pid, .. } => format!("process {binary} pid={pid}"),
            EventData::Quality { rule, ok, detail } => format!("quality {rule} ok={ok} {detail}"),
            EventData::Note { message } => message.clone(),
        };
        let ts = self.ts.to_rfc3339();
        format!(
            "{ts} {:?} {}/{} {:?} {preview}",
            self.level, self.agent, self.component, self.kind
        )
    }
}
