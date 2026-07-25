//! Greenfield Mac Studio setup orchestration (host bootstrap + web UI hint).

use anyhow::Result;

use crate::host;
use crate::paths::vault_dir;

/// Ordered setup step identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupStepId {
    Probe,
    Harden,
    SystemPackages,
    CreateAgentUser,
    VaultInit,
    PathProfile,
    WebUiReady,
}

/// One setup step for planning and reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SetupStep {
    /// Step id.
    pub id: SetupStepId,
    /// Human-readable label.
    pub label: &'static str,
}

/// Canonical ordered steps for greenfield host + day-2 web UI.
pub fn setup_steps() -> &'static [SetupStep] {
    &[
        SetupStep {
            id: SetupStepId::Probe,
            label: "probe host",
        },
        SetupStep {
            id: SetupStepId::Harden,
            label: "harden power",
        },
        SetupStep {
            id: SetupStepId::SystemPackages,
            label: "system packages",
        },
        SetupStep {
            id: SetupStepId::CreateAgentUser,
            label: "create agent user",
        },
        SetupStep {
            id: SetupStepId::VaultInit,
            label: "vault init",
        },
        SetupStep {
            id: SetupStepId::PathProfile,
            label: "path profile",
        },
        SetupStep {
            id: SetupStepId::WebUiReady,
            label: "web UI ready (msa web)",
        },
    ]
}

/// Arguments for [`run_setup`].
#[derive(Debug, Clone)]
pub struct SetupArgs {
    /// Agent user password (host mutation).
    pub password: Option<String>,
    /// Skip OS host mutation.
    pub skip_host: bool,
    /// Plan only.
    pub dry_run: bool,
}

/// Report after setup (or dry-run plan).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupReport {
    /// Steps planned or executed.
    pub steps: Vec<&'static str>,
    /// Whether dry-run only.
    pub dry_run: bool,
    /// Vault path reminder.
    pub vault_dir: String,
}

/// Pure plan of step labels.
pub fn plan_setup(skip_host: bool) -> Vec<&'static str> {
    setup_steps()
        .iter()
        .filter(|s| {
            if skip_host {
                matches!(s.id, SetupStepId::WebUiReady)
            } else {
                true
            }
        })
        .map(|s| s.label)
        .collect()
}

/// Full setup entry.
pub fn run_setup(args: SetupArgs) -> Result<SetupReport> {
    let steps = plan_setup(args.skip_host);
    if args.dry_run {
        return Ok(SetupReport {
            steps,
            dry_run: true,
            vault_dir: vault_dir().display().to_string(),
        });
    }

    if args.skip_host {
        println!("OK skip-host: day-2 UI is `msa web --agent admin-agent`");
        return Ok(SetupReport {
            steps,
            dry_run: false,
            vault_dir: vault_dir().display().to_string(),
        });
    }

    println!("[setup] host bootstrap (pure Rust)");
    host::probe()?;
    host::harden()?;
    host::system_packages()?;
    host::create_admin_agent(args.password)?;
    host::vault_init(false)?;
    host::path_profile()?;

    println!("\n=== setup complete ===");
    println!("Day-2 human path: msa web --bind 127.0.0.1:7420 --agent admin-agent");
    println!("Open Chrome → http://127.0.0.1:7420/a/admin-agent");
    println!("Vault: {}", vault_dir().display());

    Ok(SetupReport {
        steps,
        dry_run: false,
        vault_dir: vault_dir().display().to_string(),
    })
}
