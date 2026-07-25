//! MSA first-party design system: Rust emits HTML/CSS (no egui, no JS frameworks).

#![forbid(unsafe_code)]

mod css;
mod escape;
mod page;
mod scripts;
mod widgets;

pub use css::stylesheet;
pub use escape::html_escape;
pub use page::{chat_page, ChatPageModel, MessageView, Role};
pub use scripts::{chat_script, speech_script};
pub use widgets::{compose_form, message_bubble, message_list, mic_button};
