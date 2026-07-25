//! Host bootstrap operations (invoke macOS system tools from pure Rust).

mod bootstrap;
mod power;
mod probe;
mod user;
mod util;
mod vault_host;

pub use bootstrap::bootstrap;
pub use power::{harden, system_packages};
pub use probe::probe;
pub use user::create_admin_agent;
pub use vault_host::{path_profile, vault_init};

pub(crate) const AGENT_USER: &str = "admin-agent";
pub(crate) const VAULT_GROUP: &str = "msa-vault";
