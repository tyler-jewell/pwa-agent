//! Claude Code CLI turn (stream-json collect, no UI channel).

use std::io::{BufRead, Write};
use std::path::Path;
use std::process::{Command, Stdio};

use which::which;

use super::util::{enhanced_path, load_claude_env, rules_arg};

pub(super) fn run(
    prompt: &str,
    session_id: Option<&str>,
    rules: Option<&Path>,
) -> Result<(String, Option<String>), String> {
    if super::util::force_cli_miss() {
        return Err("claude CLI not found (forced miss)".into());
    }
    let bin = which("claude").map_err(|_| {
        "claude CLI not found on PATH (install Claude Code; or MSA_WEB_BACKEND=loopback)"
            .to_string()
    })?;
    let mut cmd = Command::new(bin);
    let _ = cmd
        .arg("-p")
        .arg("--input-format")
        .arg("text")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .env("PATH", enhanced_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(id) = session_id {
        let _ = cmd.arg("--resume").arg(id);
    }
    rules_arg(&mut cmd, "--append-system-prompt-file", rules);
    load_claude_env(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("spawn claude: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("claude stdin: {e}"))?;
    }
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;
    let err_handle = std::thread::spawn(move || super::util::join_stderr(stderr));
    let mut acc = Acc::default();
    for line in std::io::BufReader::new(stdout).lines() {
        let line = line.map_err(|e| format!("claude stdout: {e}"))?;
        acc.feed(line.trim());
    }
    let status = child.wait().map_err(|e| format!("wait: {e}"))?;
    let stderr = err_handle.join().unwrap_or_default();
    acc.finish(status.success(), stderr)
}

#[derive(Default)]
struct Acc {
    text: String,
    session_id: Option<String>,
    last_assistant: String,
    from_delta: bool,
}

impl Acc {
    fn feed(&mut self, line: &str) {
        if line.is_empty() {
            return;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            self.text.push_str(line);
            return;
        };
        match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "assistant" => self.on_assistant(&v),
            "content_block_delta" => self.on_delta(&v),
            "result" => self.on_result(&v),
            "system" => {
                if let Some(s) = v.get("session_id").and_then(|s| s.as_str()) {
                    self.session_id = Some(s.to_string());
                }
            }
            _ => {}
        }
    }

    fn on_assistant(&mut self, v: &serde_json::Value) {
        if !self.from_delta {
            if let Some(chunk) = extract_assistant_text(v) {
                if chunk.starts_with(&self.last_assistant) {
                    let delta = &chunk[self.last_assistant.len()..];
                    if !delta.is_empty() {
                        self.text.push_str(delta);
                    }
                } else if chunk != self.last_assistant {
                    self.text.push_str(&chunk);
                }
                self.last_assistant = chunk;
            }
        }
        if let Some(s) = v.get("session_id").and_then(|s| s.as_str()) {
            self.session_id = Some(s.to_string());
        }
    }

    fn on_delta(&mut self, v: &serde_json::Value) {
        let Some(d) = v
            .pointer("/delta/text")
            .and_then(serde_json::Value::as_str)
            .or_else(|| v.get("text").and_then(serde_json::Value::as_str))
        else {
            return;
        };
        if !self.from_delta {
            self.from_delta = true;
            self.text.clear();
            self.last_assistant.clear();
        }
        self.text.push_str(d);
    }

    fn on_result(&mut self, v: &serde_json::Value) {
        if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
            if self.text.is_empty() {
                self.text = r.to_string();
            }
        }
        if let Some(s) = v.get("session_id").and_then(|s| s.as_str()) {
            self.session_id = Some(s.to_string());
        }
    }

    fn finish(self, ok: bool, stderr: String) -> Result<(String, Option<String>), String> {
        if (!ok && self.text.is_empty()) || self.text.is_empty() {
            return Err(if stderr.is_empty() {
                "claude returned empty output".into()
            } else {
                stderr
            });
        }
        Ok((self.text, self.session_id))
    }
}

fn extract_assistant_text(v: &serde_json::Value) -> Option<String> {
    let content = v.pointer("/message/content")?.as_array()?;
    let mut out = String::new();
    for block in content {
        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}
