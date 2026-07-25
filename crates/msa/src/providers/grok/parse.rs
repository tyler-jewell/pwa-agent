//! Grok auth.json parsing helpers.

use chrono::{DateTime, Utc};
use serde_json::Value;

pub(super) const DEFAULT_ISSUER: &str = "https://auth.x.ai";
pub(super) const DEFAULT_CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";

pub(super) fn entry_key(issuer: &str, client_id: &str) -> String {
    format!("{issuer}::{client_id}")
}

pub(super) fn pick_entry(data: &Value) -> Option<&Value> {
    let preferred = entry_key(DEFAULT_ISSUER, DEFAULT_CLIENT_ID);
    if let Some(e) = data.get(&preferred) {
        return Some(e);
    }
    if let Some(obj) = data.as_object() {
        for (k, v) in obj {
            if k.contains("auth.x.ai")
                || v.get("oidc_issuer").and_then(|x| x.as_str()) == Some(DEFAULT_ISSUER)
            {
                return Some(v);
            }
        }
        if obj.len() == 1 {
            return obj.values().next();
        }
    }
    None
}

pub(super) fn parse_exp(s: Option<&str>) -> Option<DateTime<Utc>> {
    let s = s?;
    let s = s.replace('Z', "+00:00");
    DateTime::parse_from_rfc3339(&s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(
                s.trim_end_matches("+00:00"),
                "%Y-%m-%dT%H:%M:%S%.f",
            )
            .ok()
            .map(|n| n.and_utc())
        })
}
