//! Ordered chat stream events (Thinking → tokens → done).

use crate::agent_turn::{run_turn, BackendMode, TurnOut};

/// One server→client stream frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    /// Agent placeholder before first token.
    Thinking,
    /// One output chunk (append to agent bubble).
    Token(String),
    /// Turn finished; full text for persistence.
    Done {
        /// Full agent reply.
        full: String,
        /// Optional harness session.
        session_id: Option<String>,
    },
}

/// Build Thinking → token chunks → Done for a completed turn.
pub fn events_from_reply(reply: &str, session_id: Option<String>) -> Vec<StreamEvent> {
    let mut out = vec![StreamEvent::Thinking];
    for chunk in chunk_text(reply) {
        out.push(StreamEvent::Token(chunk));
    }
    out.push(StreamEvent::Done {
        full: reply.to_string(),
        session_id,
    });
    out
}

/// Run backend and produce ordered stream events (loopback chunks deterministically).
pub fn events_for_turn(
    mode: BackendMode,
    prompt: &str,
    session_id: Option<&str>,
    rules: Option<&std::path::Path>,
) -> Vec<StreamEvent> {
    let turn: TurnOut = run_turn(mode, prompt, session_id, rules);
    events_from_reply(&turn.text, turn.session_id)
}

/// Split reply into streamable pieces (words for loopback observability).
pub fn chunk_text(reply: &str) -> Vec<String> {
    if reply.is_empty() {
        return Vec::new();
    }
    let parts: Vec<&str> = reply.split_whitespace().collect();
    if parts.is_empty() {
        return vec![reply.to_string()];
    }
    let mut out = Vec::with_capacity(parts.len());
    for (i, w) in parts.iter().enumerate() {
        if i == 0 {
            out.push((*w).to_string());
        } else {
            out.push(format!(" {w}"));
        }
    }
    out
}

/// Format one SSE frame (`event` + `data`).
pub fn format_sse(event: &str, data: &str) -> String {
    let mut s = String::new();
    s.push_str("event: ");
    s.push_str(event);
    s.push('\n');
    for line in data.lines() {
        s.push_str("data: ");
        s.push_str(line);
        s.push('\n');
    }
    if data.is_empty() {
        s.push_str("data: \n");
    }
    s.push('\n');
    s
}

/// Encode stream events as SSE bytes (no inter-event delay).
pub fn encode_sse(events: &[StreamEvent]) -> String {
    let mut body = String::new();
    for ev in events {
        match ev {
            StreamEvent::Thinking => {
                body.push_str(&format_sse("thinking", "Thinking…"));
            }
            StreamEvent::Token(t) => {
                body.push_str(&format_sse("token", t));
            }
            StreamEvent::Done { full, .. } => {
                body.push_str(&format_sse("done", full));
            }
        }
    }
    body
}

/// Delay between SSE frames from env `MSA_WEB_STREAM_DELAY_MS` (default 0).
pub fn stream_delay_ms() -> u64 {
    std::env::var("MSA_WEB_STREAM_DELAY_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thinking_then_tokens_then_done() {
        let ev = events_from_reply("Received: hello world", None);
        assert!(matches!(ev.first(), Some(StreamEvent::Thinking)));
        assert!(matches!(ev.last(), Some(StreamEvent::Done { .. })));
        let tokens: Vec<_> = ev
            .iter()
            .filter_map(|e| match e {
                StreamEvent::Token(t) => Some(t.as_str()),
                _ => None,
            })
            .collect();
        assert!(!tokens.is_empty());
        let joined: String = tokens.concat();
        assert_eq!(joined, "Received: hello world");
        let sse = encode_sse(&ev);
        assert!(sse.contains("event: thinking"));
        assert!(sse.contains("event: token"));
        assert!(sse.contains("event: done"));
        let think_pos = sse.find("event: thinking").unwrap();
        let token_pos = sse.find("event: token").unwrap();
        let done_pos = sse.find("event: done").unwrap();
        assert!(think_pos < token_pos && token_pos < done_pos);
    }

    #[test]
    fn loopback_turn_stream_order() {
        let ev = events_for_turn(BackendMode::Loopback, "ping", None, None);
        assert!(matches!(ev[0], StreamEvent::Thinking));
        let full = match ev.last() {
            Some(StreamEvent::Done { full, .. }) => full.clone(),
            _ => panic!("missing done"),
        };
        assert_eq!(full, "Received: ping");
    }
}
