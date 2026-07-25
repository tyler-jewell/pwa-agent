//! Grok Build / xAI OAuth provider.

mod oauth;
mod parse;

use std::fs;
use std::path::Path;

use chrono::Utc;
use serde_json::{json, Value};

use super::{DetectResult, Provider, ProviderBlob};
use crate::error::{MsaError, Result};
use crate::paths::grok_auth_path;
use oauth::refresh_blob;
use parse::{entry_key, parse_exp, pick_entry, DEFAULT_CLIENT_ID, DEFAULT_ISSUER};

pub struct GrokProvider;

impl Provider for GrokProvider {
    fn id(&self) -> &'static str {
        "xai-oauth"
    }

    fn detect(&self, home: &Path) -> DetectResult {
        let path = grok_auth_path(home);
        if !path.is_file() {
            return DetectResult {
                provider_id: self.id().into(),
                present: false,
                usable: false,
                detail: "missing ~/.grok/auth.json".into(),
                reason: "missing".into(),
                expires_at: None,
            };
        }
        let data: Value = match fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            Some(v) => v,
            None => {
                return DetectResult {
                    provider_id: self.id().into(),
                    present: true,
                    usable: false,
                    detail: "auth.json invalid JSON".into(),
                    reason: "corrupt".into(),
                    expires_at: None,
                };
            }
        };
        let Some(entry) = pick_entry(&data) else {
            return DetectResult {
                provider_id: self.id().into(),
                present: true,
                usable: false,
                detail: "no xAI entry".into(),
                reason: "missing_entry".into(),
                expires_at: None,
            };
        };
        let exp_s = entry
            .get("expires_at")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let has_refresh = entry
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .is_some();
        let has_access = entry
            .get("key")
            .or_else(|| entry.get("access_token"))
            .and_then(|v| v.as_str())
            .is_some();
        let now = Utc::now();
        let exp = parse_exp(exp_s.as_deref());
        let fresh = exp
            .map(|e| e > now + chrono::Duration::minutes(5))
            .unwrap_or(true);
        let usable = has_access && (fresh || has_refresh);
        DetectResult {
            provider_id: self.id().into(),
            present: true,
            usable,
            detail: if usable { "ok".into() } else { "stale".into() },
            reason: if usable {
                "ok".into()
            } else if has_refresh {
                "stale_refreshable".into()
            } else {
                "stale".into()
            },
            expires_at: exp_s,
        }
    }

    fn wipe(&self, home: &Path) -> Result<()> {
        let path = grok_auth_path(home);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    fn capture(&self, home: &Path) -> Result<ProviderBlob> {
        let path = grok_auth_path(home);
        if !path.is_file() {
            return Err(MsaError::Msg(
                "Grok auth.json missing — complete HUMAN OAuth first (ssh -L 56121 + grok)".into(),
            ));
        }
        let data: Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
        let entry = pick_entry(&data).ok_or_else(|| MsaError::Msg("no xAI entry".into()))?;
        let access = entry
            .get("key")
            .or_else(|| entry.get("access_token"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| MsaError::Msg("missing key/access_token".into()))?;
        let refresh = entry
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| MsaError::Msg("missing refresh_token".into()))?;

        let mut out = json!({
            "oidc_issuer": entry.get("oidc_issuer").and_then(|v| v.as_str()).unwrap_or(DEFAULT_ISSUER),
            "oidc_client_id": entry.get("oidc_client_id").and_then(|v| v.as_str()).unwrap_or(DEFAULT_CLIENT_ID),
            "access_token": access,
            "refresh_token": refresh,
            "expires_at": entry.get("expires_at"),
            "email": entry.get("email"),
            "auth_mode": entry.get("auth_mode"),
        });
        if let Some(obj) = out.as_object_mut() {
            for k in PROFILE_KEYS {
                if let Some(v) = entry.get(k) {
                    obj.insert(k.to_string(), v.clone());
                }
            }
        }

        Ok(ProviderBlob {
            provider_id: self.id().into(),
            data: out,
            captured_at: Some(Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        })
    }

    fn materialize(&self, home: &Path, blob: &ProviderBlob) -> Result<()> {
        // Refresh ownership is ops::materialize only (MSA-06); write as given.
        write_auth_json(home, &blob.data)
    }

    fn refresh_if_needed(&self, blob: ProviderBlob) -> Result<(ProviderBlob, bool)> {
        refresh_blob(blob)
    }
}

const PROFILE_KEYS: &[&str] = &[
    "user_id",
    "principal_id",
    "team_id",
    "first_name",
    "last_name",
    "profile_image_asset_id",
    "principal_type",
    "coding_data_retention_opt_out",
    "create_time",
];

fn write_auth_json(home: &Path, d: &Value) -> Result<()> {
    let issuer = d
        .get("oidc_issuer")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_ISSUER);
    let client_id = d
        .get("oidc_client_id")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_CLIENT_ID);
    let key = entry_key(issuer, client_id);
    let access = d
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| MsaError::Msg("blob missing access_token".into()))?;
    let refresh = d
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| MsaError::Msg("blob missing refresh_token".into()))?;

    let mut entry = json!({
        "key": access,
        "refresh_token": refresh,
        "expires_at": d.get("expires_at"),
        "oidc_issuer": issuer,
        "oidc_client_id": client_id,
        "auth_mode": d.get("auth_mode").cloned().unwrap_or_else(|| json!("oauth")),
    });
    if let Some(obj) = entry.as_object_mut() {
        for k in std::iter::once("email").chain(PROFILE_KEYS.iter().copied()) {
            if let Some(v) = d.get(k) {
                obj.insert(k.to_string(), v.clone());
            }
        }
    }

    let path = grok_auth_path(home);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file_obj = if path.is_file() {
        serde_json::from_str(&fs::read_to_string(&path)?).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    file_obj
        .as_object_mut()
        .ok_or_else(|| MsaError::Msg("auth.json root not object".into()))?
        .insert(key, entry);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(&file_obj)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&tmp, &path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}
