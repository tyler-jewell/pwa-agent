//! Power and system package host setup.

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};

/// Apply always-on power settings (uses sudo).
pub fn harden() -> Result<()> {
    println!("[ROOT] applying always-on pmset");
    let state_dir = Path::new("/var/lib/msa-host");
    let _ = std::fs::create_dir_all(state_dir);
    if let Ok(out) = Command::new("pmset").args(["-g", "custom"]).output() {
        let _ = std::fs::write(state_dir.join("pmset-before.txt"), out.stdout);
    }
    let status = Command::new("sudo")
        .args([
            "pmset",
            "-a",
            "sleep",
            "0",
            "disksleep",
            "0",
            "displaysleep",
            "0",
            "autorestart",
            "1",
            "tcpkeepalive",
            "1",
        ])
        .status()
        .context("pmset")?;
    if !status.success() {
        bail!("pmset failed");
    }
    println!("OK pmset always-on applied");
    Ok(())
}

/// Install system formulae required by agents (`gh`). HOST-ADMIN only.
pub fn system_packages() -> Result<()> {
    let brew = which::which("brew").context("brew not found — install Homebrew first")?;
    println!("[HOST-ADMIN] brew install gh (vault crypto is pure Rust; age CLI optional)");
    let _ = Command::new(&brew).args(["install", "gh"]).status();
    if which::which("cargo").is_err() {
        println!("NOTE: install Rust via https://rustup.rs for admin-agent builds");
    }
    if which::which("gh").is_err() {
        bail!("gh still missing after brew install");
    }
    println!("OK gh={}", which::which("gh")?.display());
    Ok(())
}
