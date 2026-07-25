//! Deterministic quality profiler for admin-agent + all agents.
//!
//! One command: `msa quality`
//! Reports every issue with path and rule id so agents know exactly what to fix.

mod limits;
mod scan;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

pub use limits::{MAX_MD_LINES, MAX_RS_LINES};

/// Full quality profile. Exit non-zero if any check fails.
pub fn run(repo_root: &Path) -> Result<()> {
    println!("msa quality — admin-agent gold standard profile");
    println!("repo: {}", repo_root.display());
    println!("limits: .rs ≤ {MAX_RS_LINES} lines, product .md ≤ {MAX_MD_LINES} lines");
    println!();

    let mut issues = Vec::new();

    // 1) line limits + dead-doc markers + empty files
    issues.extend(scan::scan_product_tree(repo_root)?);

    // 2) rustfmt
    if !run_cargo(repo_root, &["fmt", "--all", "--", "--check"])? {
        issues.push(Issue {
            severity: Severity::Error,
            rule: "fmt".into(),
            path: PathBuf::from("."),
            line: None,
            message: "rustfmt check failed — run: cargo fmt --all".into(),
        });
    }

    // 3) clippy (includes dead_code deny)
    if !run_cargo(
        repo_root,
        &[
            "clippy",
            "--workspace",
            "--all-targets",
            "--all-features",
            "--",
            "-D",
            "warnings",
        ],
    )? {
        issues.push(Issue {
            severity: Severity::Error,
            rule: "clippy".into(),
            path: PathBuf::from("."),
            line: None,
            message: "clippy -D warnings failed — see output above".into(),
        });
    }

    // 4) tests
    if !run_cargo(repo_root, &["test", "--workspace", "--quiet"])? {
        issues.push(Issue {
            severity: Severity::Error,
            rule: "test".into(),
            path: PathBuf::from("."),
            line: None,
            message: "cargo test --workspace failed".into(),
        });
    }

    print_report(&issues);

    let errors = issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .count();
    if errors > 0 {
        bail!("{errors} quality error(s) — fix listed paths before commit");
    }
    println!("OK msa quality GREEN — safe to commit");
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warn,
}

#[derive(Debug, Clone)]
pub struct Issue {
    pub severity: Severity,
    pub rule: String,
    pub path: PathBuf,
    pub line: Option<usize>,
    pub message: String,
}

impl Issue {
    pub fn err(
        rule: impl Into<String>,
        path: PathBuf,
        line: Option<usize>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            severity: Severity::Error,
            rule: rule.into(),
            path,
            line,
            message: message.into(),
        }
    }
}

fn print_report(issues: &[Issue]) {
    println!("=== quality report ===");
    if issues.is_empty() {
        println!("(no issues)");
        return;
    }
    for i in issues {
        let sev = match i.severity {
            Severity::Error => "ERROR",
            Severity::Warn => "WARN ",
        };
        let loc = i.line.map_or_else(
            || i.path.display().to_string(),
            |n| format!("{}:{n}", i.path.display()),
        );
        println!("[{sev}] {loc}  rule={}  {}", i.rule, i.message);
    }
    println!();
    println!("summary: {} issue(s)", issues.len());
}

fn run_cargo(repo_root: &Path, args: &[&str]) -> Result<bool> {
    println!("$ cargo {}", args.join(" "));
    let status = Command::new("cargo")
        .args(args)
        .current_dir(repo_root)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .context("spawn cargo")?;
    println!();
    Ok(status.success())
}

/// Discover repo root (directory containing Cargo.toml workspace).
pub fn find_repo_root() -> Result<PathBuf> {
    let mut dir = std::env::current_dir()?;
    loop {
        if dir.join("Cargo.toml").is_file() && dir.join("crates/msa").is_dir() {
            return Ok(dir);
        }
        if !dir.pop() {
            bail!("not inside mac-studio-agents repo (no Cargo.toml + crates/msa)");
        }
    }
}
