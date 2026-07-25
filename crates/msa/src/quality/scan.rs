//! Static scans: line limits, dead-doc markers, empty files.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;
use walkdir::WalkDir;

use super::limits::{MAX_MD_LINES, MAX_RS_LINES};
use super::Issue;

/// Stub markers that make a *line* dead when they are the line's intent.
/// Matching is whole-line / comment-prefix only (not prose that forbids them).
const DEAD_LINE_PREFIXES: &[&str] = &[
    "TODO",
    "FIXME",
    "XXX",
    "HACK",
    "TBD",
    "PLACEHOLDER",
    "COMING SOON",
    "NOT IMPLEMENTED",
    "WRITE ME",
    "FILL IN",
    "LOREM IPSUM",
];

pub(super) fn scan_product_tree(repo_root: &Path) -> Result<Vec<Issue>> {
    let mut issues = Vec::new();

    // Core ban: no docs/ tree (product narrative does not live in-repo).
    let docs_dir = repo_root.join("docs");
    if docs_dir.is_dir() {
        issues.push(Issue::err(
            "no_docs_dir",
            PathBuf::from("docs"),
            None,
            "forbidden docs/ tree — delete it; use code + AGENTS/STANDARDS/skills/memory only",
        ));
    }

    for entry in WalkDir::new(repo_root)
        .into_iter()
        .filter_entry(|e| !is_excluded(e.path(), repo_root))
    {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let rel = path.strip_prefix(repo_root).unwrap_or(path).to_path_buf();

        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let ext_l = ext.to_ascii_lowercase();
        if ext_l != "rs" && ext_l != "md" {
            continue;
        }
        if rel.starts_with(".agents") {
            continue;
        }

        let text = match fs::read_to_string(path) {
            Ok(t) => t,
            Err(e) => {
                issues.push(Issue::err(
                    "read",
                    rel,
                    None,
                    format!("cannot read file: {e}"),
                ));
                continue;
            }
        };

        let lines: Vec<&str> = text.lines().collect();
        let n = lines.len();

        if n == 0 || text.trim().is_empty() {
            issues.push(Issue::err(
                "empty_file",
                rel.clone(),
                None,
                "empty file is dead content — delete or fill",
            ));
            continue;
        }

        match ext_l.as_str() {
            "rs" if n > MAX_RS_LINES => {
                issues.push(Issue::err(
                    "max_lines_rs",
                    rel.clone(),
                    Some(n),
                    format!("Rust file has {n} lines (max {MAX_RS_LINES}) — split module"),
                ));
            }
            "md" if n > MAX_MD_LINES => {
                issues.push(Issue::err(
                    "max_lines_md",
                    rel.clone(),
                    Some(n),
                    format!(
                        "Markdown has {n} lines (max {MAX_MD_LINES}) — split or remove archive"
                    ),
                ));
            }
            _ => {}
        }

        for (idx, line) in lines.iter().enumerate() {
            if let Some(marker) = dead_intent_line(line) {
                issues.push(Issue::err(
                    "dead_line",
                    rel.clone(),
                    Some(idx + 1),
                    format!("dead/stub line intent `{marker}` — finish or delete"),
                ));
            }
            if ext_l == "rs" {
                if let Some(attr) = forbidden_lint_override(line) {
                    issues.push(Issue::err(
                        "lint_override",
                        rel.clone(),
                        Some(idx + 1),
                        format!("forbidden lint override `{attr}` — fix code, never allow/expect"),
                    ));
                }
            }
        }
    }

    Ok(issues)
}

/// True when the line is a stub, not prose discussing standards.
fn dead_intent_line(line: &str) -> Option<&'static str> {
    let mut t = line.trim();
    if t.is_empty() || t.starts_with("```") {
        return None;
    }
    // strip common comment / list prefixes
    for prefix in ["//", "///", "//!", "#", "*", "-", "<!--"] {
        if let Some(rest) = t.strip_prefix(prefix) {
            t = rest.trim();
            if let Some(rest) = t.strip_suffix("-->") {
                t = rest.trim();
            }
            break;
        }
    }
    // strip trailing colon/ellipsis
    let core = t.trim_end_matches(['.', ':', '!', '-', '…']).trim();
    let upper = core.to_ascii_uppercase();
    for marker in DEAD_LINE_PREFIXES {
        if upper == *marker || upper.starts_with(&format!("{marker} ")) {
            // "TODO implement X" is dead; "todo!" macro mention is lowercase with bang only in prose
            return Some(*marker);
        }
    }
    None
}

/// Detect real lint-override attributes. Needles are built at runtime so this
/// scanner source never contains a forbidden attribute substring.
fn forbidden_lint_override(line: &str) -> Option<&'static str> {
    let t = line.trim();
    let allow = "allow";
    let expect = "expect";
    // Outer and inner attribute openers for the allow lint name.
    let outer_allow = format!("#[{allow}(");
    let inner_allow = format!("#![{allow}(");
    if t.contains(&outer_allow) || t.contains(&inner_allow) {
        return Some("allow");
    }
    // Outer and inner attribute openers for the expect lint name.
    let outer_expect = format!("#[{expect}(");
    let inner_expect = format!("#![{expect}(");
    if t.contains(&outer_expect) || t.contains(&inner_expect) {
        return Some("expect");
    }
    // cfg_attr form that enables an allow on the same line.
    if t.contains("cfg_attr") {
        let allow_call = format!("{allow}(");
        if t.contains(&allow_call) {
            return Some("allow");
        }
    }
    None
}

fn is_excluded(path: &Path, root: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    rel.components().any(|c| {
        let s = c.as_os_str();
        s == ".git"
            || s == "target"
            || s == ".venv"
            || s == "node_modules"
            || s == ".claude"
            || s == ".pytest_cache"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_todo_comment() {
        assert_eq!(dead_intent_line("// TODO fix this"), Some("TODO"));
        assert_eq!(dead_intent_line("# TBD"), Some("TBD"));
    }

    #[test]
    fn ignores_policy_prose() {
        assert_eq!(
            dead_intent_line("Deny `todo!` macros in production code."),
            None
        );
        assert_eq!(
            dead_intent_line("See STANDARDS for forbidden stub markers."),
            None
        );
    }

    #[test]
    fn detects_allow_attr() {
        // Assemble markers so this file never contains a forbidden attribute substring.
        let name = "allow";
        let a = format!("    #[{name}(dead_code)]");
        let cfg = format!("cfg_attr(test, {name}(clippy::unwrap_used))");
        let b = format!("#![{cfg}]");
        assert_eq!(forbidden_lint_override(&a), Some("allow"));
        assert_eq!(forbidden_lint_override(&b), Some("allow"));
        assert_eq!(forbidden_lint_override("let x = allow(y);"), None);
        let expect_name = "expect";
        let c = format!("#[{expect_name}(unused)]");
        assert_eq!(forbidden_lint_override(&c), Some("expect"));
    }
}
