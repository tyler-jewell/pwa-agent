//! Agent-facing operations: doctor, capture, materialize, wipe, acceptance.

use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use clap::ValueEnum;
use serde_json::{json, Value};

use crate::paths::{home_dir, vault_dir};
use crate::providers::{self, resolve_list, ProviderBlob, DAY1};
use crate::vault::Vault;

/// Scope of [`doctor`] checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum DoctorLevel {
    /// Binaries + vault only.
    Host,
    /// Provider auth usability only.
    Auth,
    /// Host + auth.
    All,
}

/// Run health checks. Returns `Ok` only when green.
pub fn doctor(as_json: bool, level: DoctorLevel) -> Result<()> {
    let home = home_dir().map_err(anyhow::Error::msg)?;
    let mut checks: Vec<Value> = Vec::new();
    let mut ok = true;
    let mut reason = "ok".to_string();

    let want_host = matches!(level, DoctorLevel::Host | DoctorLevel::All);
    let want_auth = matches!(level, DoctorLevel::Auth | DoctorLevel::All);

    if want_host {
        push_bin_check(&mut checks, &mut ok, &mut reason, "gh");
        push_bin_check(&mut checks, &mut ok, &mut reason, "cargo");

        let vinfo = Vault::new(vault_dir()).status_json();
        let vault_ok = vinfo["master_key"].as_bool().unwrap_or(false)
            && vinfo["store_enc"].as_bool().unwrap_or(false);
        checks.push(json!({
            "check": "vault",
            "ok": vault_ok,
            "detail": vinfo["vault_dir"],
            "providers": vinfo["providers"],
        }));
        if !vault_ok {
            ok = false;
            if reason == "ok" {
                reason = "vault_missing".into();
            }
        }
    }

    if want_auth {
        for id in DAY1 {
            let p = providers::get(id).map_err(anyhow::Error::msg)?;
            let d = p.detect(&home);
            checks.push(json!({
                "check": format!("auth.{}", d.provider_id),
                "ok": d.usable,
                "present": d.present,
                "detail": d.detail,
                "reason": d.reason,
                "expires_at": d.expires_at,
            }));
            if !d.usable {
                ok = false;
                if reason == "ok" {
                    reason = d.reason;
                }
            }
        }
    }

    let payload = json!({
        "ok": ok,
        "reason": reason,
        "home": home.display().to_string(),
        "checks": checks,
    });

    if as_json {
        println!("{}", serde_json::to_string_pretty(&payload)?);
    } else {
        println!(
            "msa doctor: {} (MSA_REASON={reason})",
            if ok { "GREEN" } else { "RED" }
        );
        for c in &checks {
            let mark = if c["ok"].as_bool().unwrap_or(false) {
                "✓"
            } else {
                "✗"
            };
            println!(
                "  {mark} {}: {}",
                c["check"].as_str().unwrap_or("?"),
                c["detail"]
            );
        }
        println!("MSA_REASON={reason}");
    }

    if !ok {
        bail!("doctor RED");
    }
    Ok(())
}

fn push_bin_check(checks: &mut Vec<Value>, ok: &mut bool, reason: &mut String, label: &str) {
    let brew = Path::new("/opt/homebrew/bin").join(label);
    let exists = brew.is_file() || which::which(label).is_ok();
    checks.push(json!({
        "check": format!("bin.{label}"),
        "ok": exists,
        "detail": if exists { "found" } else { "missing" }
    }));
    if !exists && label == "gh" {
        *ok = false;
        if reason.as_str() == "ok" {
            *reason = "missing_binary".into();
        }
    }
}

/// Capture provider secrets into the vault.
pub fn capture(provider: &str, token_file: Option<&Path>) -> Result<()> {
    let v = Vault::new(vault_dir());
    let mut store = v.load().map_err(anyhow::Error::msg)?;
    let home = home_dir().map_err(anyhow::Error::msg)?;
    for p in resolve_list(provider).map_err(anyhow::Error::msg)? {
        let blob = if p.id() == "claude-code" {
            if let Some(tf) = token_file {
                let token = fs::read_to_string(tf).context("read token file")?;
                providers::capture_token(&token)
            } else {
                p.capture(&home).map_err(anyhow::Error::msg)?
            }
        } else {
            p.capture(&home).map_err(anyhow::Error::msg)?
        };
        store.providers.insert(
            p.id().to_string(),
            json!({
                "schema": 1,
                "captured_at": blob.captured_at,
                "data": blob.data,
            }),
        );
        println!("captured {}", p.id());
    }
    v.save(store).map_err(anyhow::Error::msg)?;
    println!(
        "vault saved (HUMAN: copy {} offline now)",
        vault_dir().display()
    );
    Ok(())
}

/// Materialize vault secrets into tool-native stores (refresh if needed).
pub fn materialize(provider: &str) -> Result<()> {
    let v = Vault::new(vault_dir());
    let mut store = v.load().map_err(anyhow::Error::msg)?;
    let home = home_dir().map_err(anyhow::Error::msg)?;
    let mut changed = false;
    for p in resolve_list(provider).map_err(anyhow::Error::msg)? {
        let entry = store
            .providers
            .get(p.id())
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("{} not in vault — capture first", p.id()))?;
        let data = entry
            .get("data")
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("missing data for {}", p.id()))?;
        let blob = ProviderBlob {
            provider_id: p.id().into(),
            data,
            captured_at: entry
                .get("captured_at")
                .and_then(|x| x.as_str())
                .map(str::to_string),
        };
        let (new_blob, did) = p.refresh_if_needed(blob).map_err(anyhow::Error::msg)?;
        if did {
            if let Some(e) = store.providers.get_mut(p.id()) {
                if let Some(obj) = e.as_object_mut() {
                    obj.insert("data".into(), new_blob.data.clone());
                }
            }
            changed = true;
            println!("refreshed {}", p.id());
        }
        p.materialize(&home, &new_blob)
            .map_err(anyhow::Error::msg)?;
        println!("materialized {}", p.id());
    }
    if changed {
        v.save(store).map_err(anyhow::Error::msg)?;
    }
    Ok(())
}

/// Wipe tool-native auth. Requires `execute` to actually delete.
pub fn wipe(provider: &str, execute: bool) -> Result<()> {
    if !execute {
        println!("dry-run: pass --execute to wipe tool-native auth (vault untouched)");
        for p in resolve_list(provider).map_err(anyhow::Error::msg)? {
            println!("  would wipe {}", p.id());
        }
        return Ok(());
    }
    let home = home_dir().map_err(anyhow::Error::msg)?;
    for p in resolve_list(provider).map_err(anyhow::Error::msg)? {
        p.wipe(&home).map_err(anyhow::Error::msg)?;
        println!("wiped {}", p.id());
    }
    Ok(())
}

/// Set provider `expires_at` in the past (test-only).
pub fn debug_expire(provider: &str) -> Result<()> {
    let v = Vault::new(vault_dir());
    let mut store = v.load().map_err(anyhow::Error::msg)?;
    let p = providers::get(provider).map_err(anyhow::Error::msg)?;
    let entry = store
        .providers
        .get_mut(p.id())
        .ok_or_else(|| anyhow::anyhow!("provider not in vault"))?;
    let past = (chrono::Utc::now() - chrono::Duration::hours(2))
        .format("%Y-%m-%dT%H:%M:%S%.6fZ")
        .to_string();
    if let Some(obj) = entry.get_mut("data").and_then(|d| d.as_object_mut()) {
        obj.insert("expires_at".into(), json!(past));
    } else {
        bail!("provider entry missing data object");
    }
    v.save(store).map_err(anyhow::Error::msg)?;
    println!("set {} expires_at to past", p.id());
    Ok(())
}

/// Full rehydrate proof: wipe → materialize → doctor → expire drill.
/// Requires `--execute` (or `MSA_ACCEPTANCE_EXECUTE=1`) so wipe is not accidental.
pub fn acceptance(execute: bool) -> Result<()> {
    let env_ok = std::env::var("MSA_ACCEPTANCE_EXECUTE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !execute && !env_ok {
        eprintln!("acceptance is destructive (wipes tool-native auth then materializes).");
        eprintln!("pass --execute or set MSA_ACCEPTANCE_EXECUTE=1 to run.");
        eprintln!("MSA_REASON=acceptance_needs_execute");
        bail!("acceptance requires --execute (or MSA_ACCEPTANCE_EXECUTE=1)");
    }
    println!("[AGENT] acceptance: rehydrate without browser");
    let v = Vault::new(vault_dir());
    v.load().map_err(|_| anyhow::anyhow!("vault not ready"))?;

    println!("--- wipe tool-native auth ---");
    wipe("all", true)?;
    println!("--- materialize ---");
    materialize("all")?;
    println!("--- doctor ---");
    doctor(false, DoctorLevel::All)?;
    println!("--- expire drill (xai-oauth) ---");
    debug_expire("xai-oauth")?;
    wipe("xai-oauth", true)?;
    materialize("xai-oauth")?;
    doctor(false, DoctorLevel::Auth)?;
    println!("OK ACCEPTANCE PASSED — admin-agent can rehydrate without human browser");
    println!("MSA_REASON=ok");
    Ok(())
}
