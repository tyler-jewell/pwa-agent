//! Route handling (pure; no sockets).

use msa_ui::{chat_page, chat_script, message_list, speech_script, stylesheet, ChatPageModel};

use crate::state::AppState;
use crate::stream::{encode_sse, stream_delay_ms, StreamEvent};

/// Parsed HTTP request (minimal).
#[derive(Debug, Clone)]
pub struct HttpRequest {
    /// Method uppercase.
    pub method: String,
    /// Path only (no query).
    pub path: String,
    /// Raw body for POST.
    pub body: String,
    /// True when `HX-Request: true` (legacy partial).
    pub hx_request: bool,
    /// True when client wants SSE stream.
    pub accept_sse: bool,
}

/// HTTP response.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    /// Status code.
    pub status: u16,
    /// Content-Type.
    pub content_type: String,
    /// Body (full) or empty when streaming SSE events.
    pub body: String,
    /// Optional SSE event frames (written with delay).
    pub sse_events: Option<Vec<StreamEvent>>,
    /// Delay between SSE frames (ms).
    pub sse_delay_ms: u64,
}

/// Handle one request against shared state.
pub fn handle_request(state: &AppState, req: &HttpRequest) -> HttpResponse {
    let path = req.path.as_str();
    if req.method == "GET" && path == "/assets/app.css" {
        return text(200, "text/css; charset=utf-8", stylesheet());
    }
    if req.method == "GET" && path == "/assets/speech.js" {
        return text(
            200,
            "application/javascript; charset=utf-8",
            speech_script().into(),
        );
    }
    if req.method == "GET" && path == "/assets/chat.js" {
        return text(
            200,
            "application/javascript; charset=utf-8",
            chat_script().into(),
        );
    }
    if req.method == "GET" && (path == "/" || path == "/health") {
        return text(200, "text/plain; charset=utf-8", "ok msa-web".into());
    }
    if let Some(agent) = path.strip_prefix("/a/").and_then(|rest| {
        if rest.is_empty() {
            return None;
        }
        if let Some((a, tail)) = rest.split_once('/') {
            if tail == "message" && req.method == "POST" {
                return Some((a, "message"));
            }
            if tail == "transcript" && req.method == "GET" {
                return Some((a, "transcript"));
            }
            return None;
        }
        if req.method == "GET" {
            return Some((rest, "page"));
        }
        None
    }) {
        let (agent, kind) = agent;
        let agent = sanitize_agent(agent);
        match kind {
            "message" => {
                let text_body = form_field(&req.body, "text").unwrap_or_default();
                let text_body = text_body.trim();
                if text_body.is_empty() {
                    if req.accept_sse {
                        return sse(vec![]);
                    }
                    return redirect(&format!("/a/{agent}"));
                }
                if req.accept_sse {
                    let events = state.post_user_stream(&agent, text_body);
                    return sse(events);
                }
                state.post_user(&agent, text_body);
                if req.hx_request {
                    let frag = message_list(&state.messages(&agent));
                    return text(200, "text/html; charset=utf-8", frag);
                }
                return redirect(&format!("/a/{agent}"));
            }
            "transcript" => {
                let frag = message_list(&state.messages(&agent));
                return text(200, "text/html; charset=utf-8", frag);
            }
            _ => {
                let model = ChatPageModel {
                    agent: agent.clone(),
                    messages: state.messages(&agent),
                };
                return text(200, "text/html; charset=utf-8", chat_page(&model));
            }
        }
    }
    text(404, "text/plain; charset=utf-8", "not found".into())
}

fn text(status: u16, content_type: &str, body: String) -> HttpResponse {
    HttpResponse {
        status,
        content_type: content_type.into(),
        body,
        sse_events: None,
        sse_delay_ms: 0,
    }
}

fn sse(events: Vec<StreamEvent>) -> HttpResponse {
    let body = encode_sse(&events);
    HttpResponse {
        status: 200,
        content_type: "text/event-stream; charset=utf-8".into(),
        body,
        sse_events: Some(events),
        sse_delay_ms: stream_delay_ms(),
    }
}

fn redirect(location: &str) -> HttpResponse {
    HttpResponse {
        status: 303,
        content_type: "text/plain; charset=utf-8".into(),
        body: location.into(),
        sse_events: None,
        sse_delay_ms: 0,
    }
}

/// Restrict agent path segment to safe chars.
pub fn sanitize_agent(raw: &str) -> String {
    let s: String = raw
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

fn form_field(body: &str, key: &str) -> Option<String> {
    for pair in body.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if percent_decode(k) == key {
                return Some(percent_decode(v));
            }
        }
    }
    None
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let h = hex(bytes[i + 1]);
                let l = hex(bytes[i + 2]);
                if let (Some(h), Some(l)) = (h, l) {
                    out.push((h << 4) | l);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
