//! Isolated CLI for agent logs: list, follow, schema.
//! Agent-first JSONL; human-second pretty lines via `--human`.

use std::io::{self, Write};

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use msa_log::{self, Event, EventKind, Level};

#[derive(Parser, Debug)]
pub struct LogsArgs {
    #[command(subcommand)]
    pub cmd: Option<LogsCmd>,
    /// Agent identity (log partition).
    #[arg(long, global = true, default_value = "admin-agent")]
    pub agent: String,
    /// Human-second one-line format (default is agent-first JSONL).
    #[arg(long, global = true)]
    pub human: bool,
}

#[derive(Subcommand, Debug, Clone)]
pub enum LogsCmd {
    /// Show recent events (default if no subcommand).
    Tail {
        #[arg(long, default_value_t = 50)]
        limit: usize,
        #[arg(long)]
        kind: Option<KindFilter>,
        #[arg(long)]
        level: Option<LevelFilter>,
    },
    /// Stream new events (blocks).
    Follow {
        #[arg(long)]
        kind: Option<KindFilter>,
        #[arg(long)]
        level: Option<LevelFilter>,
    },
    /// Print JSON schema for log records (introspection).
    Schema,
    /// Print path to events.jsonl for this agent.
    Path,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum KindFilter {
    ProcessStart,
    ProcessEnd,
    ChatTurnStart,
    ChatTurnEnd,
    CliSpawn,
    CliExit,
    Quality,
    Note,
}

impl KindFilter {
    fn matches(self, k: EventKind) -> bool {
        matches!(
            (self, k),
            (Self::ProcessStart, EventKind::ProcessStart)
                | (Self::ProcessEnd, EventKind::ProcessEnd)
                | (Self::ChatTurnStart, EventKind::ChatTurnStart)
                | (Self::ChatTurnEnd, EventKind::ChatTurnEnd)
                | (Self::CliSpawn, EventKind::CliSpawn)
                | (Self::CliExit, EventKind::CliExit)
                | (Self::Quality, EventKind::Quality)
                | (Self::Note, EventKind::Note)
        )
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum LevelFilter {
    Debug,
    Info,
    Warn,
    Error,
}

impl LevelFilter {
    fn matches(self, l: Level) -> bool {
        match self {
            Self::Debug => true,
            Self::Info => !matches!(l, Level::Debug),
            Self::Warn => matches!(l, Level::Warn | Level::Error),
            Self::Error => matches!(l, Level::Error),
        }
    }
}

/// Entry point for `msa logs …`.
pub fn run(args: LogsArgs) -> Result<()> {
    let cmd = args.cmd.unwrap_or(LogsCmd::Tail {
        limit: 50,
        kind: None,
        level: None,
    });
    match cmd {
        LogsCmd::Schema => {
            println!("{}", serde_json::to_string_pretty(&msa_log::schema_json())?);
        }
        LogsCmd::Path => {
            let p = msa_log::events_path(&args.agent).context("log path")?;
            println!("{}", p.display());
        }
        LogsCmd::Tail { limit, kind, level } => {
            let events = msa_log::read_recent(&args.agent, limit).context("read logs")?;
            emit(&events, args.human, kind, level)?;
        }
        LogsCmd::Follow { kind, level } => {
            let agent = args.agent.clone();
            let human = args.human;
            eprintln!(
                "# following {} (ctrl-c to stop)",
                msa_log::events_path(&agent)
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|_| "<unknown>".into())
            );
            msa_log::follow(&agent, |e| {
                if let Err(err) = emit_one(&e, human, kind, level) {
                    let _ = writeln!(io::stderr(), "log emit error: {err}");
                }
            })
            .context("follow logs")?;
        }
    }
    Ok(())
}

fn emit(
    events: &[Event],
    human: bool,
    kind: Option<KindFilter>,
    level: Option<LevelFilter>,
) -> Result<()> {
    for e in events {
        emit_one(e, human, kind, level)?;
    }
    Ok(())
}

fn emit_one(
    e: &Event,
    human: bool,
    kind: Option<KindFilter>,
    level: Option<LevelFilter>,
) -> Result<()> {
    if let Some(k) = kind {
        if !k.matches(e.kind) {
            return Ok(());
        }
    }
    if let Some(l) = level {
        if !l.matches(e.level) {
            return Ok(());
        }
    }
    if human {
        println!("{}", e.human_line());
    } else {
        println!("{}", serde_json::to_string(e)?);
    }
    Ok(())
}

/// Fail if agent name empty (reserved).
pub fn validate_agent(agent: &str) -> Result<()> {
    if agent.trim().is_empty() {
        bail!("agent name required");
    }
    Ok(())
}
