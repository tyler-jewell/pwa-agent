//! Pure-Rust age encryption (no age CLI subprocess).

use std::fs::{self, File};
use std::io::{Read, Write};
use std::iter;
use std::path::Path;

use age::secrecy::ExposeSecret;
use age::{x25519, Decryptor, Encryptor};

use crate::error::{MsaError, Result};

pub(super) fn keygen(identity_path: &Path) -> Result<String> {
    let id = x25519::Identity::generate();
    let recipient = id.to_public().to_string();
    let secret_holder = id.to_string();
    let secret = secret_holder.expose_secret().to_owned();
    if let Some(parent) = identity_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = File::create(identity_path)?;
    writeln!(
        f,
        "# created by msa (pure Rust age)\n# public key: {recipient}\n{secret}"
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(identity_path, fs::Permissions::from_mode(0o640))?;
    }
    Ok(recipient)
}

pub(super) fn recipient_from_identity(identity_path: &Path) -> Result<String> {
    let text = fs::read_to_string(identity_path)?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# public key:") {
            return Ok(rest.trim().to_string());
        }
    }
    for line in text.lines() {
        if line.starts_with("AGE-SECRET-KEY-") {
            let id: x25519::Identity = line
                .parse()
                .map_err(|e| MsaError::Age(format!("parse secret: {e}")))?;
            return Ok(id.to_public().to_string());
        }
    }
    Err(MsaError::Age("could not derive recipient".into()))
}

pub(super) fn encrypt(plaintext: &[u8], recipient_str: &str, out_path: &Path) -> Result<()> {
    let recipient: x25519::Recipient = recipient_str
        .parse()
        .map_err(|e| MsaError::Age(format!("bad recipient: {e}")))?;
    let encryptor = Encryptor::with_recipients(iter::once(&recipient as &dyn age::Recipient))
        .map_err(|_| MsaError::Age("encryptor".into()))?;

    let tmp = out_path.with_extension(format!("tmp.{}", std::process::id()));
    {
        let mut file = File::create(&tmp)?;
        let mut writer = encryptor
            .wrap_output(&mut file)
            .map_err(|e| MsaError::Age(format!("wrap: {e}")))?;
        writer.write_all(plaintext)?;
        writer
            .finish()
            .map_err(|e| MsaError::Age(format!("finish: {e}")))?;
    }
    fs::rename(&tmp, out_path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(out_path, fs::Permissions::from_mode(0o640))?;
    }
    Ok(())
}

pub(super) fn decrypt(identity_path: &Path, enc_path: &Path) -> Result<Vec<u8>> {
    let id_text = fs::read_to_string(identity_path)?;
    let mut identities: Vec<x25519::Identity> = Vec::new();
    for line in id_text.lines() {
        if line.starts_with("AGE-SECRET-KEY-") {
            let id: x25519::Identity = line
                .parse()
                .map_err(|e| MsaError::Age(format!("parse: {e}")))?;
            identities.push(id);
        }
    }
    if identities.is_empty() {
        return Err(MsaError::Age("no AGE-SECRET-KEY in master.key".into()));
    }

    let file = File::open(enc_path)?;
    let decryptor = Decryptor::new(file).map_err(|e| MsaError::Age(format!("decryptor: {e}")))?;
    let mut reader = decryptor
        .decrypt(identities.iter().map(|i| i as &dyn age::Identity))
        .map_err(|e| MsaError::Age(format!("decrypt: {e}")))?;
    let mut out = Vec::new();
    reader.read_to_end(&mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let dir = std::env::temp_dir().join(format!("msa-age-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert!(fs::create_dir_all(&dir).is_ok());
        let key = dir.join("master.key");
        let enc = dir.join("store.enc");
        let recipient = keygen(&key);
        assert!(recipient.is_ok());
        if let Ok(recipient) = recipient {
            assert!(encrypt(b"{\"ok\":true}", &recipient, &enc).is_ok());
            let plain = decrypt(&key, &enc);
            assert!(plain.is_ok());
            if let Ok(plain) = plain {
                assert_eq!(plain, b"{\"ok\":true}");
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
