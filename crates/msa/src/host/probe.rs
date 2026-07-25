//! Read-only host inventory.

use anyhow::Result;

use super::util::run_print;
use crate::paths::vault_dir;
use crate::vault::Vault;

/// Read-only host inventory (no secrets).
pub fn probe() -> Result<()> {
    println!("=== msa host probe (Rust) ===");
    println!("date: {}", chrono::Utc::now().to_rfc3339());
    run_print(&["sw_vers"])?;
    run_print(&["uname", "-m"])?;
    println!("\n=== FileVault ===");
    let _ = run_print(&["fdesetup", "status"]);
    println!("\n=== pmset ===");
    let _ = run_print(&["pmset", "-g", "custom"]);
    println!("\n=== tools ===");
    for bin in ["brew", "gh", "cargo", "rustc", "claude", "grok"] {
        match which::which(bin) {
            Ok(p) => println!("{bin}: {}", p.display()),
            Err(_) => println!("{bin}: MISSING"),
        }
    }
    let path = std::env::var("PATH").unwrap_or_default();
    println!("\n=== PATH ===\n{path}");
    println!("\n=== vault ===");
    let v = Vault::new(vault_dir());
    println!("{}", serde_json::to_string_pretty(&v.status_json())?);
    Ok(())
}
