//! Full chat page document.

use crate::widgets::{compose_form, message_list};

/// Speaker role in the transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Human.
    User,
    /// Agent.
    Agent,
}

/// One message for rendering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageView {
    /// Who said it.
    pub role: Role,
    /// Plain text body.
    pub text: String,
}

/// Model for the single-page chat shell.
#[derive(Debug, Clone)]
pub struct ChatPageModel {
    /// Agent name (path segment).
    pub agent: String,
    /// Messages oldest → newest.
    pub messages: Vec<MessageView>,
}

/// Render complete HTML document for agent chat.
pub fn chat_page(model: &ChatPageModel) -> String {
    let agent = crate::escape::html_escape(&model.agent);
    let action = format!("/a/{}/message", model.agent);
    let list = message_list(&model.messages);
    let form = compose_form(&action);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{agent} — MSA</title>
<link rel="stylesheet" href="/assets/app.css"/>
</head>
<body>
<main class="shell">
  <div class="column">
    <div class="brand">MSA · {agent}</div>
    {list}
  </div>
</main>
{form}
<script src="/assets/chat.js" defer></script>
<script src="/assets/speech.js" defer></script>
</body>
</html>"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_wires_agent_and_widgets() {
        let html = chat_page(&ChatPageModel {
            agent: "admin-agent".into(),
            messages: vec![MessageView {
                role: Role::User,
                text: "hi".into(),
            }],
        });
        assert!(html.contains("MSA · admin-agent"));
        assert!(html.contains(r#"action="/a/admin-agent/message""#));
        assert!(html.contains("id=\"mic-btn\""));
        assert!(html.contains("id=\"transcript\""));
        assert!(html.contains("/assets/speech.js"));
        assert!(html.contains("/assets/chat.js"));
        assert!(html.contains("hi"));
        assert!(!html.contains("htmx.org"));
    }
}
