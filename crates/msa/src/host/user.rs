//! Create admin-agent user, groups, auto-login, SSH keys.

use std::process::Command;

use anyhow::{bail, Context, Result};

use super::util::{agent_home_dir, prompt_password, write_kcpassword};
use super::{AGENT_USER, VAULT_GROUP};

/// Create `admin-agent`, vault group, SSH access, auto-login.
pub fn create_admin_agent(password: Option<String>) -> Result<()> {
    let password = resolve_password(password)?;
    ensure_vault_group()?;
    ensure_agent_user(&password)?;
    add_user_to_group(AGENT_USER, VAULT_GROUP)?;
    // SSH group is best-effort on hosts without the Apple group.
    if let Err(e) = add_user_to_group(AGENT_USER, "com.apple.access_ssh") {
        eprintln!("warn: ssh group: {e:#}");
    }
    enable_autologin(&password)?;
    copy_authorized_keys()?;
    println!("OK admin-agent ready (auto-login ON)");
    Ok(())
}

fn resolve_password(password: Option<String>) -> Result<String> {
    if let Some(p) = password {
        if p.is_empty() {
            bail!("password required");
        }
        return Ok(p);
    }
    prompt_password(&format!("Password for {AGENT_USER}: "))
}

fn ensure_vault_group() -> Result<()> {
    let st = Command::new("sudo")
        .args(["dseditgroup", "-o", "create", "-q", VAULT_GROUP])
        .status()
        .context("dseditgroup create vault group")?;
    // Already-exists is success-ish; fail only on hard error codes when group missing.
    if !st.success() {
        let check = Command::new("dseditgroup")
            .args(["-o", "read", VAULT_GROUP])
            .status()
            .context("read vault group")?;
        if !check.success() {
            bail!("failed to create group {VAULT_GROUP}: {st}");
        }
    }
    Ok(())
}

fn ensure_agent_user(password: &str) -> Result<()> {
    if Command::new("id").arg(AGENT_USER).status()?.success() {
        println!("OK user {AGENT_USER} exists");
        return Ok(());
    }
    // sysadminctl requires -password on argv (MSA-02: unavoidable for this tool).
    let st = Command::new("sudo")
        .args([
            "sysadminctl",
            "-addUser",
            AGENT_USER,
            "-fullName",
            "Admin Agent",
            "-password",
            password,
            "-shell",
            "/bin/zsh",
        ])
        .status()?;
    if !st.success() {
        bail!("sysadminctl -addUser failed");
    }
    Ok(())
}

fn add_user_to_group(user: &str, group: &str) -> Result<()> {
    let st = Command::new("sudo")
        .args(["dseditgroup", "-o", "edit", "-a", user, "-t", "user", group])
        .status()
        .with_context(|| format!("add {user} to {group}"))?;
    if !st.success() {
        bail!("dseditgroup add {user} → {group} failed: {st}");
    }
    Ok(())
}

fn enable_autologin(password: &str) -> Result<()> {
    let st = Command::new("sudo")
        .args([
            "sysadminctl",
            "-autologin",
            "set",
            "-userName",
            AGENT_USER,
            "-password",
            password,
        ])
        .status();
    if st.is_ok_and(|s| s.success()) {
        println!("OK auto-login via sysadminctl");
        return Ok(());
    }
    let st = Command::new("sudo")
        .args([
            "defaults",
            "write",
            "/Library/Preferences/com.apple.loginwindow",
            "autoLoginUser",
            "-string",
            AGENT_USER,
        ])
        .status()
        .context("set autoLoginUser")?;
    if !st.success() {
        bail!("defaults write autoLoginUser failed: {st}");
    }
    write_kcpassword(password)?;
    println!("OK autoLoginUser + kcpassword");
    Ok(())
}

fn copy_authorized_keys() -> Result<()> {
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let keys = home.join(".ssh/authorized_keys");
    if !keys.is_file() {
        return Ok(());
    }
    let agent_home = agent_home_dir()?;
    let dest_dir = agent_home.join(".ssh");
    let dest = dest_dir.join("authorized_keys");
    run_checked("mkdir", &["mkdir", "-p", &dest_dir.to_string_lossy()])?;
    run_checked(
        "cp authorized_keys",
        &["cp", &keys.to_string_lossy(), &dest.to_string_lossy()],
    )?;
    run_checked(
        "chown .ssh",
        &[
            "chown",
            "-R",
            &format!("{AGENT_USER}:staff"),
            &dest_dir.to_string_lossy(),
        ],
    )?;
    run_checked("chmod .ssh", &["chmod", "700", &dest_dir.to_string_lossy()])?;
    run_checked("chmod keys", &["chmod", "600", &dest.to_string_lossy()])?;
    println!("OK authorized_keys → {AGENT_USER}");
    Ok(())
}

fn run_checked(label: &str, args: &[&str]) -> Result<()> {
    let st = Command::new("sudo")
        .args(args)
        .status()
        .with_context(|| format!("sudo {label}"))?;
    if !st.success() {
        bail!("sudo {label} failed: {st}");
    }
    Ok(())
}
