//! `msa` CLI — thin front-end over the `msa` library.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use msa::logs_cmd::{self, LogsArgs};
use msa::ops::{self, DoctorLevel};
use msa::paths::{ensure_path_env, vault_dir};
use msa::setup::{self, SetupArgs};
use msa::vault::Vault;

#[derive(Parser, Debug)]
#[command(
    name = "msa",
    version,
    about = "Mac Studio Agents — pure Rust host, vault, local web UI"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Greenfield setup: host + vault; day-2 is msa web
    Setup {
        #[arg(long, env = "MSA_AGENT_PASSWORD")]
        password: Option<String>,
        #[arg(long)]
        skip_host: bool,
        #[arg(long)]
        dry_run: bool,
    },
    /// Day-2 human UI: pure-Rust HTML/CSS server (open in Chrome)
    Web {
        #[arg(long, default_value = "127.0.0.1:7420")]
        bind: String,
        #[arg(long, default_value = "admin-agent")]
        agent: String,
    },
    Vault {
        #[command(subcommand)]
        cmd: VaultCmd,
    },
    Doctor {
        #[arg(long)]
        json: bool,
        #[arg(long, value_enum, default_value_t = DoctorLevel::All)]
        level: DoctorLevel,
    },
    Capture {
        #[arg(default_value = "all")]
        provider: String,
        #[arg(long)]
        token_file: Option<PathBuf>,
    },
    Materialize {
        #[arg(default_value = "all")]
        provider: String,
    },
    Wipe {
        #[arg(default_value = "all")]
        provider: String,
        #[arg(long)]
        execute: bool,
    },
    Refresh,
    Acceptance {
        #[arg(long)]
        execute: bool,
    },
    Host {
        #[command(subcommand)]
        cmd: HostCmd,
    },
    Quality,
    Logs {
        #[command(flatten)]
        args: LogsArgs,
    },
}

#[derive(Subcommand, Debug)]
enum VaultCmd {
    Init {
        #[arg(long)]
        force: bool,
    },
    Status,
    DebugExpire {
        provider: String,
    },
}

#[derive(Subcommand, Debug)]
enum HostCmd {
    Probe,
    Harden,
    SystemPackages,
    CreateAdminAgent {
        #[arg(long, env = "MSA_AGENT_PASSWORD")]
        password: Option<String>,
    },
    VaultInit {
        #[arg(long)]
        force: bool,
    },
    PathProfile,
    Bootstrap {
        #[arg(long, env = "MSA_AGENT_PASSWORD")]
        password: Option<String>,
    },
}

fn main() -> ExitCode {
    ensure_path_env();
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> anyhow::Result<()> {
    match cli.cmd {
        Commands::Setup {
            password,
            skip_host,
            dry_run,
        } => {
            let report = setup::run_setup(SetupArgs {
                password,
                skip_host,
                dry_run,
            })?;
            if dry_run {
                println!("dry_run=true steps={}", report.steps.len());
                for s in &report.steps {
                    println!("step={s}");
                }
            }
        }
        Commands::Web { bind, agent } => {
            // AppState::new reads MSA_WEB_BACKEND + MSA_WEB_DATA_ROOT.
            let state = msa_web::AppState::new();
            println!("agent={agent}");
            println!("backend={}", state.mode().label());
            println!("data_root={}", state.data_root().display());
            println!("open http://{bind}/a/{agent}");
            let stop = std::sync::atomic::AtomicBool::new(false);
            msa_web::serve(&bind, &state, &stop).map_err(|e| anyhow::anyhow!(e))?;
        }
        Commands::Vault { cmd } => match cmd {
            VaultCmd::Init { force } => {
                let v = Vault::new(vault_dir());
                v.init(force).map_err(anyhow::Error::msg)?;
                println!("vault initialized at {}", v.root().display());
            }
            VaultCmd::Status => {
                let v = Vault::new(vault_dir());
                let info = v.status_json();
                println!("{}", serde_json::to_string_pretty(&info)?);
                let complete = info["master_key"].as_bool() == Some(true)
                    && info["store_enc"].as_bool() == Some(true);
                if !complete {
                    anyhow::bail!("vault incomplete");
                }
            }
            VaultCmd::DebugExpire { provider } => ops::debug_expire(&provider)?,
        },
        Commands::Doctor { json, level } => ops::doctor(json, level)?,
        Commands::Capture {
            provider,
            token_file,
        } => ops::capture(&provider, token_file.as_deref())?,
        Commands::Materialize { provider } => ops::materialize(&provider)?,
        Commands::Wipe { provider, execute } => ops::wipe(&provider, execute)?,
        Commands::Refresh => ops::materialize("all")?,
        Commands::Acceptance { execute } => ops::acceptance(execute)?,
        Commands::Host { cmd } => match cmd {
            HostCmd::Probe => msa::host::probe()?,
            HostCmd::Harden => msa::host::harden()?,
            HostCmd::SystemPackages => msa::host::system_packages()?,
            HostCmd::CreateAdminAgent { password } => msa::host::create_admin_agent(password)?,
            HostCmd::VaultInit { force } => msa::host::vault_init(force)?,
            HostCmd::PathProfile => msa::host::path_profile()?,
            HostCmd::Bootstrap { password } => msa::host::bootstrap(password)?,
        },
        Commands::Quality => {
            let root = msa::quality::find_repo_root()?;
            msa::quality::run(&root)?;
        }
        Commands::Logs { args } => {
            logs_cmd::validate_agent(&args.agent)?;
            logs_cmd::run(args)?;
        }
    }
    Ok(())
}
