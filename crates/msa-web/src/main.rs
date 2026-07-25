//! `msa-web` binary — pure-Rust agent HTML chat server.

#![forbid(unsafe_code)]

use std::env;
use std::process::ExitCode;
use std::sync::atomic::AtomicBool;

use msa_web::{serve, AppState};

fn main() -> ExitCode {
    let bind = env_flag("--bind").unwrap_or_else(|| "127.0.0.1:7420".into());
    let agent = env_flag("--agent").unwrap_or_else(|| "admin-agent".into());
    println!("default agent hint: {agent}");
    let state = AppState::new();
    let stop = AtomicBool::new(false);
    match serve(&bind, &state, &stop) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("msa-web: {e}");
            ExitCode::FAILURE
        }
    }
}

fn env_flag(name: &str) -> Option<String> {
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == name {
            return args.next();
        }
        if let Some(v) = a.strip_prefix(&format!("{name}=")) {
            return Some(v.to_string());
        }
    }
    None
}
