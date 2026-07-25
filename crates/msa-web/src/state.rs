//! Server-owned transcript + session per agent (memory + durable load/save).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use msa_ui::{MessageView, Role};

use crate::agent_turn::{agent_rules_path, BackendMode};
use crate::persist::{self, default_data_root};
use crate::stream::{self, StreamEvent};

/// Shared server state.
#[derive(Debug)]
pub struct AppState {
    mode: BackendMode,
    data_root: PathBuf,
    inner: Mutex<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    /// Agents already hydrated from disk (or empty).
    loaded: HashMap<String, bool>,
    messages: HashMap<String, Vec<MessageView>>,
    sessions: HashMap<String, String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::from_env()
    }
}

impl AppState {
    /// Day-2 default: env backend + `~/.config/msa`.
    pub fn new() -> Self {
        Self::from_env()
    }

    /// Forced loopback (unit tests) with default data root.
    pub fn loopback() -> Self {
        Self::with_mode_root(BackendMode::Loopback, default_data_root())
    }

    /// Loopback + isolated data root (durability tests).
    pub fn loopback_at(data_root: PathBuf) -> Self {
        Self::with_mode_root(BackendMode::Loopback, data_root)
    }

    /// Explicit mode at default data root.
    pub fn with_mode(mode: BackendMode) -> Self {
        Self::with_mode_root(mode, default_data_root())
    }

    /// Explicit mode and data root.
    pub fn with_mode_root(mode: BackendMode, data_root: PathBuf) -> Self {
        Self {
            mode,
            data_root,
            inner: Mutex::new(Inner::default()),
        }
    }

    fn from_env() -> Self {
        let root = std::env::var("MSA_WEB_DATA_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| default_data_root());
        Self::with_mode_root(BackendMode::from_env(), root)
    }

    /// Active backend mode.
    pub fn mode(&self) -> BackendMode {
        self.mode
    }

    /// Data root used for durable transcripts.
    pub fn data_root(&self) -> &std::path::Path {
        &self.data_root
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn ensure_loaded(&self, agent: &str) {
        {
            let g = self.lock();
            if g.loaded.get(agent).copied().unwrap_or(false) {
                return;
            }
        }
        let loaded = persist::load(&self.data_root, agent);
        let mut g = self.lock();
        if g.loaded.get(agent).copied().unwrap_or(false) {
            return;
        }
        if !loaded.messages.is_empty() {
            let _ = g.messages.insert(agent.to_string(), loaded.messages);
        }
        if let Some(s) = loaded.session_id {
            let _ = g.sessions.insert(agent.to_string(), s);
        }
        let _ = g.loaded.insert(agent.to_string(), true);
    }

    /// Messages for agent (clone; loads durable file once).
    pub fn messages(&self, agent: &str) -> Vec<MessageView> {
        self.ensure_loaded(agent);
        self.lock().messages.get(agent).cloned().unwrap_or_default()
    }

    /// Append user text, full agent reply, and persist (non-stream clients).
    pub fn post_user(&self, agent: &str, text: &str) {
        let _ = self.post_user_stream(agent, text);
    }

    /// Append user, produce Thinking→token→done events, persist final agent text.
    pub fn post_user_stream(&self, agent: &str, text: &str) -> Vec<StreamEvent> {
        self.ensure_loaded(agent);
        let user = MessageView {
            role: Role::User,
            text: text.to_string(),
        };
        {
            let mut g = self.lock();
            g.messages.entry(agent.to_string()).or_default().push(user);
        }
        let sid = self.lock().sessions.get(agent).cloned();
        let rules = agent_rules_path(agent);
        let events = stream::events_for_turn(self.mode, text, sid.as_deref(), rules.as_deref());
        let (full, new_sid) = final_from_events(&events);
        if let Some(s) = new_sid {
            let _ = self.lock().sessions.insert(agent.to_string(), s);
        }
        let agent_msg = MessageView {
            role: Role::Agent,
            text: full,
        };
        let msgs = {
            let mut g = self.lock();
            g.messages
                .entry(agent.to_string())
                .or_default()
                .push(agent_msg);
            g.messages.get(agent).cloned().unwrap_or_default()
        };
        let sess = self.lock().sessions.get(agent).cloned();
        let _ = persist::save(&self.data_root, agent, &msgs, sess.as_deref());
        events
    }
}

fn final_from_events(events: &[StreamEvent]) -> (String, Option<String>) {
    for ev in events.iter().rev() {
        if let StreamEvent::Done { full, session_id } = ev {
            return (full.clone(), session_id.clone());
        }
    }
    (String::new(), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_turn::BackendMode;
    use crate::persist;

    #[test]
    fn durable_across_new_state_instance() {
        let root = std::env::temp_dir().join(format!(
            "msa-web-state-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&root);
        let agent = "admin-agent";
        let token = "durable-state-token-abc123";
        {
            let s1 = AppState::loopback_at(root.clone());
            s1.post_user(agent, token);
            assert!(s1.messages(agent).iter().any(|m| m.text.contains(token)));
        }
        let s2 = AppState::loopback_at(root.clone());
        let msgs = s2.messages(agent);
        assert!(
            msgs.iter().any(|m| m.text == token),
            "user msg missing: {msgs:?}"
        );
        assert!(
            msgs.iter().any(|m| m.text == format!("Received: {token}")),
            "agent reply missing: {msgs:?}"
        );
        assert!(persist::transcript_path(&root, agent).is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn claude_and_grok_modes_construct() {
        let root = std::env::temp_dir().join(format!("msa-web-modes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let c = AppState::with_mode_root(BackendMode::Claude, root.clone());
        let g = AppState::with_mode_root(BackendMode::Grok, root.clone());
        assert_eq!(c.mode(), BackendMode::Claude);
        assert_eq!(g.mode(), BackendMode::Grok);
        assert_eq!(c.mode().label(), "claude");
        assert_eq!(g.mode().label(), "grok");
        let _ = std::fs::remove_dir_all(&root);
    }
}
