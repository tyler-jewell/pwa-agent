//! Grok Build CLI turn (streaming-json collect).

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use which::which;

use super::util::{enhanced_path, rules_arg, write_prompt_file, PromptFile};

pub(super) fn run(
    prompt: &str,
    session_id: Option<&str>,
    rules: Option<&Path>,
) -> Result<(String, Option<String>), String> {
    let bin = find_grok()?;
    let pf = PromptFile(write_prompt_file(prompt)?);
    let mut cmd = Command::new(bin);
    let _ = cmd
        .arg("--prompt-file")
        .arg(&pf.0)
        .arg("--output-format")
        .arg("streaming-json")
        .env("PATH", enhanced_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(id) = session_id {
        let _ = cmd.arg("--resume").arg(id);
    }
    rules_arg(&mut cmd, "--rules", rules);
    let mut child = cmd.spawn().map_err(|e| format!("spawn grok: {e}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;
    let err_handle = std::thread::spawn(move || super::util::join_stderr(stderr));
    let mut text = String::new();
    let mut new_sid = None;
    for line in std::io::BufReader::new(stdout).lines() {
        let line = line.map_err(|e| format!("grok stdout: {e}"))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            text.push_str(line);
            continue;
        };
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "text" => {
                if let Some(d) = v.get("data").and_then(|d| d.as_str()) {
                    text.push_str(d);
                }
            }
            "end" => {
                new_sid = v
                    .get("sessionId")
                    .and_then(|s| s.as_str())
                    .map(str::to_string);
            }
            "error" => {
                let msg = v
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("grok stream error");
                let _ = child.kill();
                let _ = child.wait();
                return Err(msg.to_string());
            }
            _ => {}
        }
    }
    let status = child.wait().map_err(|e| format!("wait: {e}"))?;
    let stderr = err_handle.join().unwrap_or_default();
    if text.is_empty() {
        return Err(if stderr.is_empty() {
            if status.success() {
                "grok returned empty output".into()
            } else {
                format!("grok exited {status}")
            }
        } else {
            stderr
        });
    }
    Ok((text, new_sid))
}

fn find_grok() -> Result<PathBuf, String> {
    if super::util::force_cli_miss() {
        return Err("grok CLI not found (forced miss)".into());
    }
    if let Ok(p) = which("grok") {
        return Ok(p);
    }
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".grok/bin/grok");
        if p.is_file() {
            return Ok(p);
        }
    }
    Err("grok CLI not found (install Grok Build; or set MSA_WEB_BACKEND=loopback)".into())
}
