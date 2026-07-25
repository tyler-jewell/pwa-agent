//! `msa` library — vault, providers, host bootstrap, and agent ops.
//!
//! The binary is a thin clap front-end over these modules. All agents must
//! follow project `STANDARDS.md` when extending this crate.

#![forbid(unsafe_code)]

pub mod error;
pub mod host;
pub mod logs_cmd;
pub mod ops;
pub mod paths;
pub mod providers;
pub mod quality;
pub mod setup;
pub mod vault;

pub use error::{MsaError, Result};
pub use paths::{ensure_path_env, home_dir, vault_dir};
pub use vault::Vault;
