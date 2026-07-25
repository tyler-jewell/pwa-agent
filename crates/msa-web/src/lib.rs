//! Pure-Rust HTTP agent UI server (HTML/CSS from `msa-ui`; no egui).

#![forbid(unsafe_code)]

mod agent_turn;
mod http;
mod persist;
mod routes;
mod state;
mod stream;

#[cfg(test)]
mod route_tests;

pub use agent_turn::{BackendMode, TurnOut};
pub use http::serve;
pub use persist::{default_data_root, load as load_transcript, save as save_transcript};
pub use routes::{handle_request, HttpRequest, HttpResponse};
pub use state::AppState;
pub use stream::{encode_sse, events_for_turn, StreamEvent};
