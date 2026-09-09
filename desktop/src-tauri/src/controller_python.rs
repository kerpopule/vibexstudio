//! Read-only selection of an installed interpreter for the controller locks.
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const PROBE: &str = "import platform,sys; s=platform.system(); m=platform.machine().lower(); v=sys.version_info[:2]; sys.exit(0 if ((s=='Darwin' and m in ('arm64','x86_64') and v==(3,14)) or (s=='Linux' and m in ('arm64','aarch64') and v==(3,12))) else 1)";

/// Probe without user site packages, output, downloads or changes to PATH.
/// Both individual attempts and the whole discovery pass have deadlines.
pub fn find(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = HashSet::new();
    for candidate in candidates {
        if Instant::now() >= deadline { break; }
        if !candidate.is_file() { continue; }
        let identity = candidate.canonicalize().unwrap_or_else(|_| candidate.clone());
        if !seen.insert(identity) { continue; }
        let Ok(mut child) = Command::new(&candidate).args(["-I", "-c", PROBE])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else { continue; };
        let attempt_deadline = deadline.min(Instant::now() + Duration::from_secs(2));
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if status.success() { return Some(candidate); }
                    break;
                }
                Ok(None) if Instant::now() < attempt_deadline => std::thread::sleep(Duration::from_millis(20)),
                _ => { let _ = child.kill(); let _ = child.wait(); break; }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_interpreters_are_not_selected() {
        assert!(find([PathBuf::from("/no-such-vibex-python")]).is_none());
    }
    #[test]
    #[cfg(unix)]
    fn stalled_interpreter_is_stopped_within_discovery_budget() {
        use std::os::unix::fs::PermissionsExt;
        let name = format!("vibex-python-probe-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, "#!/bin/sh\nexec /bin/sleep 30\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        let started = Instant::now();
        let selected = find([path.clone()]);
        std::fs::remove_file(path).unwrap();
        assert!(selected.is_none());
        assert!(started.elapsed() < Duration::from_secs(8));
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn installed_macos_interpreters_are_checked_before_selection() {
        let supported = PathBuf::from("/opt/homebrew/bin/python3.14");
        if !supported.is_file() { return; }
        // The system Python may exist but is older; select the tested runtime.
        assert_eq!(find([PathBuf::from("/usr/bin/python3"), supported.clone()]), Some(supported));
    }
}
