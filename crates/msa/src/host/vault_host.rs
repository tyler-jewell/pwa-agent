//! Vault init and agent PATH profile on the host.

use std::process::Command;

use anyhow::{bail, Result};

use super::util::{agent_home_dir, fix_vault_ownership, is_root};
use super::AGENT_USER;
use crate::paths::{path_prepends, vault_dir};
use crate::vault::Vault;

/// Initialize vault directory (uses sudo when under `/var`).
pub fn vault_init(force: bool) -> Result<()> {
    let root = vault_dir();
    println!("[ROOT] vault init at {}", root.display());
    if !is_root() && root.starts_with("/var/") {
        let exe = std::env::current_exe()?;
        let mut cmd = Command::new("sudo");
        cmd.arg("-E").arg(exe).args(["vault", "init"]);
        if force {
            cmd.arg("--force");
        }
        cmd.env("MSA_VAULT_DIR", &root);
        let st = cmd.status()?;
        if !st.success() {
            bail!("sudo msa vault init failed");
        }
        fix_vault_ownership()?;
        return Ok(());
    }
    let v = Vault::new(&root);
    v.init(force).map_err(|e| anyhow::anyhow!(e))?;
    fix_vault_ownership()?;
    println!("OK vault initialized");
    Ok(())
}

/// Install PATH snippet into admin-agent `~/.zshenv`.
pub fn path_profile() -> Result<()> {
    let agent_home = agent_home_dir()?;
    let zshenv = agent_home.join(".zshenv");
    let snippet = format!(
        r#"
# >>> msa path >>>
# Managed by msa (Rust). Do not set bare PATH= without brew.
for _msa_p in {} "$HOME/.local/bin" "$HOME/.cargo/bin" "$HOME/.grok/bin"; do
  case ":$PATH:" in *":$_msa_p:"*) ;; *) PATH="$_msa_p:$PATH" ;; esac
done
export PATH
unset _msa_p
# <<< msa path <<<
"#,
        path_prepends().join(" ")
    );
    let existing = std::fs::read_to_string(&zshenv).unwrap_or_default();
    if existing.contains(">>> msa path >>>") {
        println!("OK zshenv already has msa path");
        return Ok(());
    }
    let content = format!("{existing}{snippet}");
    let uniq = format!("msa-zshenv-{}", std::process::id());
    let tmp = std::env::temp_dir().join(uniq);
    std::fs::write(&tmp, content)?;
    let st = Command::new("sudo")
        .args(["cp", &tmp.to_string_lossy(), &zshenv.to_string_lossy()])
        .status()?;
    let _ = std::fs::remove_file(&tmp);
    if !st.success() {
        bail!("sudo cp zshenv failed: {st}");
    }
    let st = Command::new("sudo")
        .args([
            "chown",
            &format!("{AGENT_USER}:staff"),
            &zshenv.to_string_lossy(),
        ])
        .status()?;
    if !st.success() {
        bail!("sudo chown zshenv failed: {st}");
    }
    println!("OK path profile for {AGENT_USER}");
    Ok(())
}
