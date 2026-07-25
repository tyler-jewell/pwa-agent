use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::crypto;
use crate::error::{MsaError, Result};

const STORE_VERSION: u32 = 1;
const BACKUP_KEEP: usize = 5;

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Store {
    pub version: u32,
    pub updated_at: String,
    pub providers: serde_json::Map<String, Value>,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            updated_at: now(),
            providers: serde_json::Map::new(),
        }
    }
}

fn now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string()
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn master_key(&self) -> PathBuf {
        self.root.join("master.key")
    }

    pub fn store_enc(&self) -> PathBuf {
        self.root.join("store.enc")
    }

    pub fn recipient_path(&self) -> PathBuf {
        self.root.join("recipient.txt")
    }

    pub fn backups(&self) -> PathBuf {
        self.root.join("backups")
    }

    pub fn audit_path(&self) -> PathBuf {
        self.root.join("audit.log")
    }

    pub fn init(&self, force: bool) -> Result<()> {
        if self.master_key().exists() && !force {
            return Err(MsaError::Msg(format!(
                "vault already initialized at {}",
                self.root.display()
            )));
        }
        fs::create_dir_all(self.backups())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.root, fs::Permissions::from_mode(0o2770));
            let _ = fs::set_permissions(self.backups(), fs::Permissions::from_mode(0o2770));
        }
        let recipient = crypto::keygen(&self.master_key())?;
        fs::write(self.recipient_path(), format!("{recipient}\n"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(self.recipient_path(), fs::Permissions::from_mode(0o640));
        }
        self.write_store(&Store::default())?;
        self.audit("init", "vault created")?;
        Ok(())
    }

    pub fn load(&self) -> Result<Store> {
        if !self.store_enc().exists() {
            return Err(MsaError::Msg(format!(
                "missing store: {}",
                self.store_enc().display()
            )));
        }
        let raw = crypto::decrypt(&self.master_key(), &self.store_enc())?;
        Ok(serde_json::from_slice(&raw)?)
    }

    pub fn save(&self, mut store: Store) -> Result<()> {
        store.updated_at = now();
        self.rotate_backup()?;
        self.write_store(&store)?;
        let keys: Vec<_> = store.providers.keys().cloned().collect();
        self.audit("save", &format!("providers={}", keys.join(",")))?;
        Ok(())
    }

    pub fn status_json(&self) -> Value {
        let mut info = json!({
            "vault_dir": self.root.display().to_string(),
            "exists": self.root.is_dir(),
            "master_key": self.master_key().is_file(),
            "store_enc": self.store_enc().is_file(),
            "providers": [],
        });
        if self.master_key().is_file() && self.store_enc().is_file() {
            match self.load() {
                Ok(s) => {
                    let mut p: Vec<_> = s.providers.keys().cloned().collect();
                    p.sort();
                    info["providers"] = json!(p);
                    info["updated_at"] = json!(s.updated_at);
                }
                Err(e) => {
                    info["load_error"] = json!(e.to_string());
                }
            }
        }
        info
    }

    pub fn audit(&self, event: &str, detail: &str) -> Result<()> {
        let line = format!("{} {event} {detail}\n", now());
        if let Some(parent) = self.audit_path().parent() {
            let _ = fs::create_dir_all(parent);
        }
        let path = self.audit_path();
        let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
        f.write_all(line.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }

    fn write_store(&self, store: &Store) -> Result<()> {
        let recipient = self.recipient()?;
        let payload = serde_json::to_vec_pretty(store)?;
        crypto::encrypt(&payload, &recipient, &self.store_enc())
    }

    fn recipient(&self) -> Result<String> {
        if self.recipient_path().is_file() {
            return Ok(fs::read_to_string(self.recipient_path())?
                .trim()
                .to_string());
        }
        crypto::recipient_from_identity(&self.master_key())
    }

    fn rotate_backup(&self) -> Result<()> {
        if !self.store_enc().exists() {
            return Ok(());
        }
        let _ = fs::create_dir_all(self.backups());
        let ts = Utc::now().format("%Y%m%d-%H%M%S");
        let dest = self.backups().join(format!("store-{ts}.enc"));
        fs::copy(self.store_enc(), &dest)?;
        let mut backups: Vec<_> = fs::read_dir(self.backups())?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                    n.starts_with("store-")
                        && std::path::Path::new(n)
                            .extension()
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("enc"))
                })
            })
            .collect();
        backups.sort();
        while backups.len() > BACKUP_KEEP {
            if let Some(old) = backups.first().cloned() {
                let _ = fs::remove_file(&old);
                backups.remove(0);
            }
        }
        Ok(())
    }
}
