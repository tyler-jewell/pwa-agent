//! Durable per-agent web transcript under the MSA config tree.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use msa_ui::{MessageView, Role};
use serde::{Deserialize, Serialize};

/// Default root: `~/.config/msa`.
pub fn default_data_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config/msa")
}

/// Sanitize agent segment for filesystem paths.
pub fn sanitize_agent(agent: &str) -> String {
    let s: String = agent
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if s.is_empty() {
        "admin-agent".into()
    } else {
        s
    }
}

/// `…/agents/<agent>/web-transcript.json`
pub fn transcript_path(data_root: &Path, agent: &str) -> PathBuf {
    data_root
        .join("agents")
        .join(sanitize_agent(agent))
        .join("web-transcript.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredFile {
    messages: Vec<StoredMsg>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMsg {
    role: String,
    text: String,
}

/// Loaded transcript + optional CLI session.
#[derive(Debug, Clone, Default)]
pub struct Loaded {
    /// Messages oldest → newest.
    pub messages: Vec<MessageView>,
    /// Provider session for resume.
    pub session_id: Option<String>,
}

/// Load transcript for agent (empty if missing/corrupt).
pub fn load(data_root: &Path, agent: &str) -> Loaded {
    let path = transcript_path(data_root, agent);
    let Ok(raw) = fs::read_to_string(&path) else {
        return Loaded::default();
    };
    let Ok(file) = serde_json::from_str::<StoredFile>(&raw) else {
        return Loaded::default();
    };
    let messages = file
        .messages
        .into_iter()
        .filter_map(|m| {
            let role = match m.role.as_str() {
                "user" => Role::User,
                "agent" => Role::Agent,
                _ => return None,
            };
            Some(MessageView { role, text: m.text })
        })
        .collect();
    Loaded {
        messages,
        session_id: file.session_id,
    }
}

/// Atomic private write of transcript + session.
pub fn save(
    data_root: &Path,
    agent: &str,
    messages: &[MessageView],
    session_id: Option<&str>,
) -> Result<(), String> {
    let path = transcript_path(data_root, agent);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let file = StoredFile {
        messages: messages
            .iter()
            .map(|m| StoredMsg {
                role: match m.role {
                    Role::User => "user".into(),
                    Role::Agent => "agent".into(),
                },
                text: m.text.clone(),
            })
            .collect(),
        session_id: session_id.map(str::to_string),
    };
    let raw = serde_json::to_vec_pretty(&file).map_err(|e| format!("serialize: {e}"))?;
    write_atomic_private(&path, &raw)
}

fn write_atomic_private(path: &Path, raw: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    let tmp = path.with_extension("json.tmp");
    {
        let mut opts = OpenOptions::new();
        let _ = opts.write(true).create(true).truncate(true).mode(0o600);
        let mut f = opts
            .open(&tmp)
            .map_err(|e| format!("open tmp {}: {e}", tmp.display()))?;
        f.write_all(raw).map_err(|e| format!("write tmp: {e}"))?;
        f.sync_all().map_err(|e| format!("sync tmp: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_load_roundtrip() {
        let root = std::env::temp_dir().join(format!(
            "msa-web-persist-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&root);
        let agent = "admin-agent";
        let msgs = vec![
            MessageView {
                role: Role::User,
                text: "unique-persist-token-xyz".into(),
            },
            MessageView {
                role: Role::Agent,
                text: "Received: unique-persist-token-xyz".into(),
            },
        ];
        assert!(save(&root, agent, &msgs, Some("sess-1")).is_ok());
        let loaded = load(&root, agent);
        assert_eq!(loaded.messages.len(), 2);
        assert_eq!(loaded.messages[0].text, "unique-persist-token-xyz");
        assert_eq!(
            loaded.messages[1].text,
            "Received: unique-persist-token-xyz"
        );
        assert_eq!(loaded.session_id.as_deref(), Some("sess-1"));
        let _ = fs::remove_dir_all(&root);
    }
}
