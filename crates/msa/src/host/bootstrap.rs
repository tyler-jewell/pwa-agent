//! Full host bootstrap orchestration.

use anyhow::Result;

use super::power::{harden, system_packages};
use super::probe::probe;
use super::user::create_admin_agent;
use super::vault_host::{path_profile, vault_init};
use super::AGENT_USER;
use crate::paths::vault_dir;

/// Full host bootstrap sequence.
pub fn bootstrap(password: Option<String>) -> Result<()> {
    println!("[HOST-ADMIN] msa host bootstrap (pure Rust)");
    probe()?;
    harden()?;
    system_packages()?;
    create_admin_agent(password)?;
    vault_init(false)?;
    path_profile()?;
    println!("\n=== HUMAN next ===");
    println!("1. ssh {AGENT_USER}@HOST");
    println!("2. cargo install --path /path/to/mac-studio-agents/crates/msa");
    println!("3. OAuth once (README), then: msa capture all");
    println!("4. Offline vault copy of {}", vault_dir().display());
    println!("5. msa acceptance --execute");
    Ok(())
}
