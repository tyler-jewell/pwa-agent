//! Design tokens and stylesheet emission.

/// Full app stylesheet for the agent chat shell.
pub fn stylesheet() -> String {
    r#"
:root {
  --bg: #0f1115;
  --surface: #1a1d24;
  --border: #2a2f3a;
  --text: #e8eaed;
  --muted: #9aa0a6;
  --user: #1e4d7b;
  --agent: #243028;
  --accent: #5b9fd4;
  --danger: #c45c5c;
  --radius: 16px;
  --maxw: 32rem;
  --font: system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); }
.shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.25rem 1rem 6.5rem;
}
.column { width: 100%; max-width: var(--maxw); display: flex; flex-direction: column; gap: 0.75rem; }
.brand { text-align: center; color: var(--muted); font-size: 0.85rem; letter-spacing: 0.04em; margin-bottom: 0.5rem; }
.transcript {
  display: flex; flex-direction: column; gap: 0.65rem;
  flex: 1; min-height: 40vh;
}
.bubble {
  max-width: 92%; padding: 0.7rem 0.9rem; border-radius: var(--radius);
  border: 1px solid var(--border); line-height: 1.45; white-space: pre-wrap; word-break: break-word;
}
.bubble.user { align-self: flex-end; background: var(--user); }
.bubble.agent { align-self: flex-start; background: var(--agent); }
.bubble .meta { font-size: 0.7rem; color: var(--muted); margin-bottom: 0.25rem; }
.compose-wrap {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; justify-content: center;
  padding: 0.75rem 1rem 1.25rem;
  background: linear-gradient(transparent, var(--bg) 30%);
}
.compose {
  width: 100%; max-width: var(--maxw);
  display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: end;
  background: var(--surface); border: 1px solid var(--border); border-radius: 999px;
  padding: 0.4rem 0.45rem 0.4rem 0.4rem;
}
#compose-input {
  border: 0; outline: 0; background: transparent; color: var(--text);
  font: inherit; resize: none; min-height: 2.5rem; max-height: 7rem; padding: 0.55rem 0.25rem;
  width: 100%;
}
#mic-btn {
  width: 2.75rem; height: 2.75rem; border-radius: 50%; border: 2px solid var(--accent);
  background: var(--bg); color: var(--accent); cursor: pointer; font-size: 1.1rem;
  display: grid; place-items: center;
}
#mic-btn.listening { background: var(--danger); border-color: var(--danger); color: #fff; }
#send-btn {
  border: 0; border-radius: 999px; background: var(--accent); color: #0b0d10;
  font-weight: 600; padding: 0.65rem 1rem; cursor: pointer; font: inherit;
}
#send-btn:disabled, #mic-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.bubble.agent .body[data-thinking="1"] { color: var(--muted); font-style: italic; }
"#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stylesheet_has_tokens_and_mic() {
        let s = stylesheet();
        assert!(s.contains("--maxw"));
        assert!(s.contains("#mic-btn"));
        assert!(s.contains(".bubble.user"));
    }
}
