//! Route + post/stream path tests (public `handle_request`).

use crate::state::AppState;
use crate::stream::StreamEvent;
use crate::{handle_request, HttpRequest};

fn temp_state() -> AppState {
    let root = std::env::temp_dir().join(format!(
        "msa-web-route-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let _ = std::fs::create_dir_all(&root);
    AppState::loopback_at(root)
}

fn req(method: &str, path: &str, body: &str, sse: bool) -> HttpRequest {
    HttpRequest {
        method: method.into(),
        path: path.into(),
        body: body.into(),
        hx_request: false,
        accept_sse: sse,
    }
}

#[test]
fn get_page_and_post_full() {
    let state = temp_state();
    let get = handle_request(&state, &req("GET", "/a/admin-agent", "", false));
    assert_eq!(get.status, 200);
    assert!(get.body.contains("compose-input"));
    assert!(get.body.contains("/assets/chat.js"));
    assert!(get.body.contains("chat.js") || get.body.contains("compose-form"));

    let post = handle_request(
        &state,
        &req("POST", "/a/admin-agent/message", "text=hello+world", false),
    );
    assert_eq!(post.status, 303);

    let get2 = handle_request(&state, &req("GET", "/a/admin-agent", "", false));
    assert!(get2.body.contains("hello world"));
    assert!(get2.body.contains("Received: hello world"));
    let _ = std::fs::remove_dir_all(state.data_root());
}

#[test]
fn sse_post_thinking_then_tokens() {
    let state = temp_state();
    let post = handle_request(
        &state,
        &req("POST", "/a/admin-agent/message", "text=stream+me", true),
    );
    assert_eq!(post.status, 200);
    assert!(post.content_type.contains("event-stream"));
    let events = post.sse_events.expect("sse events");
    assert!(matches!(events.first(), Some(StreamEvent::Thinking)));
    assert!(matches!(events.last(), Some(StreamEvent::Done { .. })));
    assert!(post.body.contains("event: thinking"));
    assert!(post.body.contains("event: token"));
    assert!(post.body.contains("event: done"));
    let think = post.body.find("event: thinking").unwrap();
    let token = post.body.find("event: token").unwrap();
    let done = post.body.find("event: done").unwrap();
    assert!(think < token && token < done);
    assert!(post.body.contains("stream me") || post.body.contains("Received:"));
    let msgs = state.messages("admin-agent");
    assert!(msgs.iter().any(|m| m.text.contains("stream me")));
    let _ = std::fs::remove_dir_all(state.data_root());
}

#[test]
fn assets_css_js_chat_speech() {
    let state = temp_state();
    let css = handle_request(&state, &req("GET", "/assets/app.css", "", false));
    assert!(css.body.contains("#mic-btn"));
    assert!(css.body.contains("data-thinking"));
    let js = handle_request(&state, &req("GET", "/assets/speech.js", "", false));
    assert!(js.body.contains("SpeechRecognition"));
    let chat = handle_request(&state, &req("GET", "/assets/chat.js", "", false));
    assert!(chat.body.contains("Thinking"));
    assert!(chat.body.contains("text/event-stream"));
    assert!(chat.body.contains("Enter"));
    let _ = std::fs::remove_dir_all(state.data_root());
}

#[test]
fn handle_request_persists_for_reload() {
    let root = std::env::temp_dir().join(format!("msa-web-handle-persist-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let token = "handle-persist-token-zz9";
    {
        let s1 = AppState::loopback_at(root.clone());
        let post = handle_request(
            &s1,
            &req(
                "POST",
                "/a/admin-agent/message",
                &format!("text={token}"),
                false,
            ),
        );
        assert_eq!(post.status, 303);
    }
    let s2 = AppState::loopback_at(root.clone());
    let get = handle_request(&s2, &req("GET", "/a/admin-agent", "", false));
    assert!(
        get.body.contains(token),
        "missing after reload: {}",
        get.body
    );
    assert!(get.body.contains(&format!("Received: {token}")));
    let _ = std::fs::remove_dir_all(&root);
}
