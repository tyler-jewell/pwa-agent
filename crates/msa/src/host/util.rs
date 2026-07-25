//! Shared host helpers (process, paths, kcpassword).

use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;

use anyhow::{bail, Context, Result};

use super::{AGENT_USER, VAULT_GROUP};
use crate::paths::vault_dir;

pub(super) fn agent_home_dir() -> Result<PathBuf> {
    let out = Command::new("dscl")
        .args([
            ".",
            "-read",
            &format!("/Users/{AGENT_USER}"),
            "NFSHomeDirectory",
        ])
        .output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for part in text.split_whitespace() {
        if part.starts_with('/') {
            return Ok(PathBuf::from(part));
        }
    }
    Ok(PathBuf::from(format!("/Users/{AGENT_USER}")))
}

pub(super) fn fix_vault_ownership() -> Result<()> {
    let root = vault_dir();
    let root_s = root.to_string_lossy();
    let st = Command::new("sudo")
        .args([
            "chown",
            "-R",
            &format!("root:{VAULT_GROUP}"),
            root_s.as_ref(),
        ])
        .status()
        .context("chown vault")?;
    if !st.success() {
        bail!("chown vault failed: {st}");
    }
    let st = Command::new("sudo")
        .args(["chmod", "2770", root_s.as_ref()])
        .status()
        .context("chmod vault")?;
    if !st.success() {
        bail!("chmod vault failed: {st}");
    }
    let backups = root.join("backups");
    if backups.is_dir() {
        let st = Command::new("sudo")
            .args(["chmod", "2770", &backups.to_string_lossy()])
            .status()
            .context("chmod vault backups")?;
        if !st.success() {
            bail!("chmod vault backups failed: {st}");
        }
    }
    Ok(())
}

/// Write auto-login kcpassword via a unique 0600 temp file, always unlinked.
pub(super) fn write_kcpassword(password: &str) -> Result<()> {
    let key: [u8; 11] = [
        0x7D, 0x89, 0x52, 0x23, 0xD2, 0xBC, 0xDD, 0xEA, 0xA3, 0xB9, 0x1F,
    ];
    let mut data = password.as_bytes().to_vec();
    data.push(0);
    let mut out = Vec::with_capacity(data.len() + key.len());
    for (i, b) in data.iter().enumerate() {
        let k = key.get(i % key.len()).copied().unwrap_or(0);
        out.push(b ^ k);
    }
    while out.len() % key.len() != 0 {
        let idx = out.len() % key.len();
        let b = key.get(idx).copied().unwrap_or(0);
        out.push(b);
    }
    let uniq = format!(
        "msa-kcpassword-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let tmp = std::env::temp_dir().join(uniq);
    struct Unlink(PathBuf);
    impl Drop for Unlink {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let guard = Unlink(tmp.clone());
    {
        use std::fs::OpenOptions;
        use std::io::Write as _;
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).context("create kcpassword temp")?;
        f.write_all(&out)?;
        f.sync_all()?;
    }
    let st = Command::new("sudo")
        .args(["cp", &tmp.to_string_lossy(), "/etc/kcpassword"])
        .status()?;
    if !st.success() {
        bail!("failed to write /etc/kcpassword");
    }
    let st = Command::new("sudo")
        .args(["chmod", "600", "/etc/kcpassword"])
        .status()
        .context("chmod /etc/kcpassword")?;
    if !st.success() {
        bail!("chmod /etc/kcpassword failed: {st}");
    }
    drop(guard);
    Ok(())
}

pub(super) fn is_root() -> bool {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        == Some(0)
}

pub(super) fn run_print(args: &[&str]) -> Result<()> {
    let (bin, rest) = args
        .split_first()
        .ok_or_else(|| anyhow::anyhow!("empty command"))?;
    let out = Command::new(bin).args(rest).output()?;
    io::stdout().write_all(&out.stdout)?;
    io::stderr().write_all(&out.stderr)?;
    Ok(())
}

/// RAII restore of `stty echo` after no-echo password entry.
#[cfg(unix)]
struct EchoGuard {
    active: bool,
}

#[cfg(unix)]
impl EchoGuard {
    fn disable() -> Self {
        let active = Command::new("stty")
            .args(["-echo"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        Self { active }
    }
}

#[cfg(unix)]
impl Drop for EchoGuard {
    fn drop(&mut self) {
        if self.active {
            let _ = Command::new("stty").args(["echo"]).status();
        }
    }
}

/// No-echo password prompt on a TTY (MSA-02/03). Falls back to stdin line.
pub(super) fn prompt_password(prompt: &str) -> Result<String> {
    eprint!("{prompt}");
    io::stderr().flush()?;
    #[cfg(unix)]
    {
        let echo = EchoGuard::disable();
        let mut s = String::new();
        let read = io::stdin().read_line(&mut s);
        drop(echo);
        eprintln!();
        read?;
        let p = s.trim().to_string();
        if p.is_empty() {
            bail!("password required");
        }
        Ok(p)
    }
    #[cfg(not(unix))]
    {
        let mut s = String::new();
        io::stdin().read_line(&mut s)?;
        let p = s.trim().to_string();
        if p.is_empty() {
            bail!("password required");
        }
        Ok(p)
    }
}
