//! Reusable HTML widgets (first-party catalog).

use crate::escape::html_escape;
use crate::page::{MessageView, Role};

/// Circular microphone control for speech-to-text.
pub fn mic_button() -> String {
    String::from(
        "<button type=\"button\" id=\"mic-btn\" aria-label=\"Speak\" title=\"Speak\">mic</button>",
    )
}

/// One chat bubble.
pub fn message_bubble(msg: &MessageView) -> String {
    let role_class = match msg.role {
        Role::User => "user",
        Role::Agent => "agent",
    };
    let label = match msg.role {
        Role::User => "you",
        Role::Agent => "agent",
    };
    format!(
        "<div class=\"bubble {role_class}\" data-role=\"{role_class}\"><div class=\"meta\">{label}</div><div class=\"body\">{}</div></div>",
        html_escape(&msg.text)
    )
}

/// Full transcript region.
pub fn message_list(messages: &[MessageView]) -> String {
    let mut inner = String::new();
    for m in messages {
        inner.push_str(&message_bubble(m));
    }
    if messages.is_empty() {
        inner.push_str(
            "<div class=\"bubble agent\"><div class=\"meta\">agent</div><div class=\"body\">Say hello - type or tap the mic.</div></div>",
        );
    }
    format!(
        "<div class=\"transcript\" id=\"transcript\" role=\"log\" aria-live=\"polite\">{inner}</div>"
    )
}

/// Compose form: mic + textarea + send. JS (`chat.js`) owns Enter/clear/stream.
pub fn compose_form(action: &str) -> String {
    let act = html_escape(action);
    format!(
        "<div class=\"compose-wrap\"><form class=\"compose\" id=\"compose-form\" method=\"post\" action=\"{act}\">\n{}\n<textarea id=\"compose-input\" name=\"text\" rows=\"1\" required placeholder=\"Message...\" autocomplete=\"off\"></textarea>\n<button type=\"submit\" id=\"send-btn\">Send</button>\n</form></div>",
        mic_button()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_has_form_mic_and_action() {
        let h = compose_form("/a/admin-agent/message");
        assert!(h.contains("action=\"/a/admin-agent/message\""));
        assert!(h.contains("id=\"compose-form\""));
        assert!(h.contains("id=\"mic-btn\""));
        assert!(h.contains("id=\"compose-input\""));
        assert!(h.contains("name=\"text\""));
        assert!(!h.contains("hx-post"));
    }

    #[test]
    fn bubble_escapes_html() {
        let m = MessageView {
            role: Role::User,
            text: "<script>".into(),
        };
        let h = message_bubble(&m);
        assert!(h.contains("&lt;script&gt;"));
        assert!(!h.contains("<script>"));
    }
}
