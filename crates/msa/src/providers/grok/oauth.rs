//! xAI OAuth token refresh.

use chrono::{Duration, Utc};
use serde_json::{json, Value};

use super::parse::{parse_exp, DEFAULT_CLIENT_ID, DEFAULT_ISSUER};
use crate::error::{MsaError, Result};
use crate::providers::ProviderBlob;

const SKEW_SECS: i64 = 3600;

pub(super) fn refresh_blob(mut blob: ProviderBlob) -> Result<(ProviderBlob, bool)> {
    let exp = parse_exp(blob.data.get("expires_at").and_then(|v| v.as_str()));
    let now = Utc::now();
    if let Some(e) = exp {
        if e > now + Duration::seconds(SKEW_SECS) {
            return Ok((blob, false));
        }
    }
    let refresh = blob
        .data
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| MsaError::Msg("no refresh_token".into()))?
        .to_string();
    let client_id = blob
        .data
        .get("oidc_client_id")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_CLIENT_ID)
        .to_string();
    let issuer = blob
        .data
        .get("oidc_issuer")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_ISSUER)
        .to_string();

    let token_url = discover_token_endpoint(&issuer);
    let body = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        urlencoding_minimal(&refresh),
        urlencoding_minimal(&client_id)
    );
    let resp = ureq::post(&token_url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body)
        .map_err(|e| MsaError::Msg(format!("xAI refresh network: {e}")))?;
    if !(200..300).contains(&resp.status()) {
        return Err(MsaError::Msg(format!("xAI refresh HTTP {}", resp.status())));
    }
    let payload: Value = resp
        .into_json()
        .map_err(|e| MsaError::Msg(format!("xAI refresh json: {e}")))?;
    let access = payload
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| MsaError::Msg("refresh missing access_token".into()))?;
    if let Some(obj) = blob.data.as_object_mut() {
        obj.insert("access_token".into(), json!(access));
        if let Some(r) = payload.get("refresh_token").and_then(|v| v.as_str()) {
            obj.insert("refresh_token".into(), json!(r));
        }
        if let Some(secs) = payload.get("expires_in").and_then(|v| v.as_u64()) {
            let secs_i = i64::try_from(secs).unwrap_or(i64::MAX);
            let exp = now + Duration::seconds(secs_i);
            obj.insert(
                "expires_at".into(),
                json!(exp.format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string()),
            );
        }
    }
    Ok((blob, true))
}

fn discover_token_endpoint(issuer: &str) -> String {
    let url = format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    );
    if let Ok(resp) = ureq::get(&url).call() {
        if let Ok(doc) = resp.into_json::<Value>() {
            if let Some(ep) = doc.get("token_endpoint").and_then(|v| v.as_str()) {
                return ep.to_string();
            }
        }
    }
    format!("{}/oauth/token", issuer.trim_end_matches('/'))
}

fn urlencoding_minimal(s: &str) -> String {
    s.replace('+', "%2B")
        .replace('&', "%26")
        .replace('=', "%3D")
}
