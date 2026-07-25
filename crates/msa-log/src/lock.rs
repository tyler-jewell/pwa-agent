//! Advisory append lock with PID + stale recovery (no unsafe).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

use crate::writer::LogError;

const LOCK_STALE: Duration = Duration::from_secs(30);

/// Exclusive create of `.events.lock` with PID; reclaim dead/stale holders.
pub struct DirLock(PathBuf);

impl DirLock {
    pub fn acquire(dir: &Path) -> Result<Self, LogError> {
        let lock = dir.join(".events.lock");
        for _ in 0..50 {
            match try_create_lock(&lock) {
                Ok(()) => return Ok(Self(lock)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if try_reclaim_stale(&lock)? {
                        continue;
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                Err(e) => return Err(LogError::Io(e)),
            }
        }
        Err(LogError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "log lock timeout (if stuck: remove ~/.config/msa/logs/<agent>/.events.lock)",
        )))
    }
}

impl Drop for DirLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn try_create_lock(lock: &Path) -> std::io::Result<()> {
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(lock)?;
    writeln!(f, "{}", std::process::id())?;
    f.sync_all()?;
    Ok(())
}

fn try_reclaim_stale(lock: &Path) -> Result<bool, LogError> {
    let Ok(meta) = fs::metadata(lock) else {
        return Ok(true);
    };
    let stale_mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|e| e > LOCK_STALE);
    let pid_dead = fs::read_to_string(lock)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .is_some_and(pid_not_running);
    if stale_mtime || pid_dead {
        let _ = fs::remove_file(lock);
        return Ok(true);
    }
    Ok(false)
}

/// True only when the PID is gone. EPERM / “not permitted” → treat as **alive**
/// (do not steal another uid’s lock). Single-uid admin-agent is the normal case.
fn pid_not_running(pid: u32) -> bool {
    if pid == 0 {
        return true;
    }
    let Ok(out) = Command::new("kill").args(["-0", &pid.to_string()]).output() else {
        // Cannot probe → do not reclaim (assume alive).
        return false;
    };
    if out.status.success() {
        return false;
    }
    let err = String::from_utf8_lossy(&out.stderr).to_ascii_lowercase();
    // ESRCH / “no such process” → dead. EPERM → alive.
    if err.contains("not permitted") || err.contains("permission denied") {
        return false;
    }
    true
}
