//! VibeX Studio Desktop — the native shell.
//!
//! Two sidecars ship inside the bundle (tauri.conf.json → bundle.resources):
//!
//! * the **Workbench** (`workbench/server.mjs`, needs a system Node ≥ 18) —
//!   builds/dev servers/project storage on this computer, driven by the
//!   paired device (workbench/API.md);
//! * **Media Lab** (`resources/media-lab/`, staged by
//!   scripts/stage-medialab.sh, needs a system Python 3) — the FastAPI
//!   studio. It only runs after the user says yes to "Make media on this
//!   computer?"; the venv lives in the app data dir, the data root stays
//!   `~/media-lab-simple` (or `$MEDIA_LAB_HOME`).
//!
//! Config files live in `app.path().app_data_dir()` — on macOS
//! `~/Library/Application Support/studio.vibex.desktop/`:
//!   medialab.json  {enabled, dir, python, port}
//!   workbench.json {enabled, port, token, projectsRoot}
//!   desktop.json   {mediaLabAsked, mediaLabChoice}   (first-launch memory)
//!
//! Secrets never touch these files: the frontend stores them through the
//! `secret_*` commands, which wrap the OS keychain.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const MEDIALAB_PORT: u16 = 7863;
const WORKBENCH_PORT: u16 = 8794;
const MEDIALAB_FALLBACK_PACKAGES: [&str; 4] = ["fastapi", "uvicorn", "pydantic", "python-multipart"];

// ------------------------------------------------------------------ secrets

const SECRET_SERVICE: &str = "studio.vibex.desktop";

/// Only keys inside the VibeXStudio namespace may reach the OS vault, so a
/// compromised page can't read (or clobber) other apps' credentials.
fn valid_secret_key(key: &str) -> bool {
    let exact = matches!(
        key,
        "vibex.github.token" | "vibex.workbench.token" | "vibex.private.installation-proof"
    );
    let scoped = ["vibex.provider.", "vibex.refresh.", "vibex.private-proof."]
        .iter()
        .any(|prefix| key.strip_prefix(prefix).is_some_and(|suffix| !suffix.is_empty()));
    (exact || scoped)
        && key.len() <= 256
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn secret_entry(key: &str) -> Result<keyring::Entry, String> {
    if !valid_secret_key(key) {
        return Err("secret key is outside the VibeXStudio credential namespace".into());
    }
    keyring::Entry::new(SECRET_SERVICE, key)
        .map_err(|error| format!("OS credential vault is unavailable: {error}"))
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        return Err("refusing to store an empty secret".into());
    }
    secret_entry(&key)?
        .set_password(&value)
        .map_err(|error| format!("could not store secret in OS credential vault: {error}"))
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match secret_entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("could not read secret from OS credential vault: {error}")),
    }
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match secret_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("could not delete secret from OS credential vault: {error}")),
    }
}

// ------------------------------------------------------------------ paths + config

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// `~/Library/Application Support/studio.vibex.desktop` on macOS, the OS
/// equivalent elsewhere. Falls back to `~/.vibexstudio` if Tauri can't tell.
fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| home_dir().join(".vibexstudio"))
}

fn medialab_cfg_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("medialab.json")
}
fn workbench_cfg_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("workbench.json")
}
fn desktop_cfg_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("desktop.json")
}

fn read_json(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text + "\n").map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn medialab_config(app: &AppHandle) -> Option<Value> {
    read_json(&medialab_cfg_path(app))
}
fn workbench_config(app: &AppHandle) -> Option<Value> {
    read_json(&workbench_cfg_path(app))
}
fn desktop_config(app: &AppHandle) -> Value {
    read_json(&desktop_cfg_path(app)).unwrap_or_else(|| json!({}))
}

fn enabled(cfg: &Option<Value>) -> bool {
    cfg.as_ref()
        .map(|c| c["enabled"].as_bool().unwrap_or(false))
        .unwrap_or(false)
}

/// 32 hex chars from the OS CSPRNG — the Workbench pairing token.
fn mint_token() -> Result<String, String> {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).map_err(|e| format!("random source unavailable: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

// ------------------------------------------------------------------ locating runtimes

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Walk PATH the way `which` would. GUI apps get a stub PATH on macOS
/// (/usr/bin:/bin:/usr/sbin:/sbin), so this is the last resort.
fn which(name: &str) -> Option<PathBuf> {
    let file = exe_name(name);
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(&file))
            .find(|p| p.is_file())
    })
}

/// Find a Node runtime: the config's "node" hint, the usual install
/// locations, then PATH.
fn find_node(cfg: &Option<Value>) -> Option<PathBuf> {
    if let Some(n) = cfg.as_ref().and_then(|c| c["node"].as_str()) {
        if Path::new(n).is_file() {
            return Some(PathBuf::from(n));
        }
    }
    let home = home_dir();
    let candidates: Vec<PathBuf> = if cfg!(windows) {
        vec![
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            home.join(r"AppData\Roaming\nvm\current\node.exe"),
        ]
    } else {
        vec![
            PathBuf::from("/opt/homebrew/bin/node"),
            PathBuf::from("/usr/local/bin/node"),
            PathBuf::from("/usr/bin/node"),
            home.join(".local/bin/node"),
        ]
    };
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .or_else(|| which("node"))
}

/// Find a Python 3 to build the Media Lab venv with.
fn find_python() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = if cfg!(windows) {
        vec![]
    } else {
        vec![
            PathBuf::from("/opt/homebrew/bin/python3"),
            PathBuf::from("/usr/local/bin/python3"),
            PathBuf::from("/usr/bin/python3"),
        ]
    };
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .or_else(|| which("python3"))
        .or_else(|| which("python"))
}

fn find_uv() -> Option<PathBuf> {
    ["/opt/homebrew/bin/uv", "/usr/local/bin/uv"]
        .iter()
        .map(PathBuf::from)
        .chain(std::iter::once(home_dir().join(".local/bin/uv")))
        .chain(std::iter::once(home_dir().join(".cargo/bin/uv")))
        .find(|p| p.is_file())
        .or_else(|| which("uv"))
}

// ------------------------------------------------------------------ locating bundled resources

/// Where `tauri build` put the bundled files (Contents/Resources on macOS).
fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

/// The dev checkout this crate was compiled from — makes `cargo build` /
/// `tauri dev` find the sidecars without any bundling step.
fn dev_repo_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// server.mjs: bundled resource first, then the config's `server` override
/// (custom checkouts), then the dev repo.
fn workbench_server_path(app: &AppHandle, cfg: &Option<Value>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(r) = resource_dir(app) {
        candidates.push(r.join("workbench/server.mjs"));
        candidates.push(r.join("_up_/workbench/server.mjs"));
    }
    if let Some(s) = cfg.as_ref().and_then(|c| c["server"].as_str()) {
        candidates.push(PathBuf::from(s));
    }
    candidates.push(dev_repo_dir().join("workbench/server.mjs"));
    candidates.push(home_dir().join("Projects/vibexstudio-desktop/workbench/server.mjs"));
    candidates.into_iter().find(|p| p.is_file())
}

/// The staged Media Lab source: bundled resource first, then dev checkouts.
fn medialab_source_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(r) = resource_dir(app) {
        candidates.push(r.join("media-lab"));
        candidates.push(r.join("resources/media-lab"));
    }
    candidates.push(dev_repo_dir().join("src-tauri/resources/media-lab"));
    candidates.push(dev_repo_dir().join("../media-lab-studio"));
    candidates.push(dev_repo_dir().join("../media-lab"));
    candidates.push(home_dir().join("Projects/media-lab-studio"));
    candidates
        .into_iter()
        .find(|p| p.join("app.py").is_file())
        .and_then(|p| p.canonicalize().ok())
}

fn medialab_venv_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("medialab-venv")
}

fn venv_python(venv: &Path) -> PathBuf {
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

/// Media Lab's data root — `$MEDIA_LAB_HOME` wins, else `~/media-lab-simple`.
fn medialab_home() -> PathBuf {
    std::env::var_os("MEDIA_LAB_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join("media-lab-simple"))
}

// ------------------------------------------------------------------ state

#[derive(Default)]
struct Sidecars {
    medialab: Option<Child>,
    workbench: Option<Child>,
    medialab_reason: Option<String>,
    workbench_reason: Option<String>,
}

/// Progress of the opt-in Media Lab setup, read by the first-launch page.
#[derive(Clone, Serialize, Default)]
struct SetupProgress {
    /// idle | venv | installing | starting | ready | error
    phase: String,
    message: String,
    error: Option<String>,
}

#[derive(Default)]
struct AppState {
    sidecars: Mutex<Sidecars>,
    setup: Mutex<SetupProgress>,
}

fn set_phase(app: &AppHandle, phase: &str, message: &str) {
    let state = app.state::<AppState>();
    let mut p = state.setup.lock().unwrap();
    p.phase = phase.into();
    p.message = message.into();
    p.error = None;
    log::info!("media lab setup: {phase} — {message}");
}

fn set_error(app: &AppHandle, error: &str) {
    let state = app.state::<AppState>();
    let mut p = state.setup.lock().unwrap();
    p.phase = "error".into();
    p.message = "Setup didn't finish".into();
    p.error = Some(error.into());
    log::warn!("media lab setup failed: {error}");
}

fn alive(child: &mut Option<Child>) -> bool {
    match child {
        Some(c) => matches!(c.try_wait(), Ok(None)),
        None => false,
    }
}

fn kill(child: &mut Option<Child>) {
    if let Some(mut c) = child.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

// ------------------------------------------------------------------ spawning

/// Runs `python -m uvicorn app:app <args>` and exits (taking uvicorn with
/// it) when the parent process — the shell — goes away. Cross-platform
/// except that Windows keeps reporting the dead parent's pid; there the
/// clean-quit path (RunEvent::Exit) is the only reaper.
const MEDIALAB_SUPERVISOR: &str = r#"
import os, sys, time, subprocess
parent = os.getppid()
child = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", *sys.argv[1:]])
try:
    while True:
        code = child.poll()
        if code is not None:
            sys.exit(code)
        if os.getppid() != parent:
            break
        time.sleep(1)
finally:
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(5)
        except Exception:
            child.kill()
"#;

/// The Workbench: builds, dev servers, and project storage on this
/// computer, remote-controlled by the paired device (workbench/API.md).
fn spawn_workbench(app: &AppHandle) -> Result<Child, String> {
    let cfg = workbench_config(app);
    if cfg.is_none() {
        return Err("not set up yet (no workbench.json)".into());
    }
    if !enabled(&cfg) {
        return Err("disabled in workbench.json".into());
    }
    let node = find_node(&cfg).ok_or_else(|| {
        "Node.js not found — install it from https://nodejs.org (v18+) and relaunch".to_string()
    })?;
    let server = workbench_server_path(app, &cfg)
        .ok_or_else(|| "workbench/server.mjs is missing from this build".to_string())?;
    log::info!("starting Workbench sidecar: {} {}", node.display(), server.display());
    Command::new(&node)
        .arg(&server)
        // server.mjs defaults to the macOS path; point it at ours everywhere.
        .env("WORKBENCH_CONFIG", workbench_cfg_path(app))
        // …and let it notice when the shell dies without a clean quit.
        .env("WORKBENCH_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("Workbench failed to start ({}): {e}", node.display()))
}

fn spawn_medialab(app: &AppHandle) -> Result<Child, String> {
    let cfg = medialab_config(app);
    if cfg.is_none() {
        return Err("not enabled — Media Lab → Make media on this computer…".into());
    }
    if !enabled(&cfg) {
        return Err("disabled in medialab.json".into());
    }
    let cfg = cfg.unwrap();
    let python = PathBuf::from(cfg["python"].as_str().unwrap_or_default());
    if !python.is_file() {
        return Err(format!(
            "Python env missing at {} — run Media Lab → Make media on this computer… again",
            python.display()
        ));
    }
    // `dir` may point at a previous app version's bundle; prefer the live one.
    let dir = medialab_source_dir(app)
        .or_else(|| cfg["dir"].as_str().map(PathBuf::from).filter(|d| d.join("app.py").is_file()))
        .ok_or_else(|| "Media Lab source not found in this build".to_string())?;
    let port = cfg["port"].as_u64().unwrap_or(MEDIALAB_PORT as u64).to_string();
    log::info!("starting Media Lab sidecar from {} on port {port}", dir.display());
    // A tiny supervisor around uvicorn: if the shell dies without a clean
    // quit (crash, force-quit, SIGKILL) the child sees its parent change and
    // stops, instead of squatting on the port until reboot.
    Command::new(&python)
        .arg("-c")
        .arg(MEDIALAB_SUPERVISOR)
        .args(["--host", "0.0.0.0", "--port", &port])
        .current_dir(&dir)
        // Never write .pyc into the (signed, read-only) bundle.
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("MEDIA_LAB_HOME", medialab_home())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("Media Lab sidecar failed to start ({}): {e}", python.display()))
}

fn start_sidecars(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut s = state.sidecars.lock().unwrap();
    if !alive(&mut s.medialab) {
        match spawn_medialab(app) {
            Ok(c) => {
                s.medialab = Some(c);
                s.medialab_reason = None;
            }
            Err(why) => {
                log::info!("Media Lab sidecar not started: {why}");
                s.medialab_reason = Some(why);
            }
        }
    }
    if !alive(&mut s.workbench) {
        match spawn_workbench(app) {
            Ok(c) => {
                s.workbench = Some(c);
                s.workbench_reason = None;
            }
            Err(why) => {
                log::info!("Workbench sidecar not started: {why}");
                s.workbench_reason = Some(why);
            }
        }
    }
}

fn stop_sidecars(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut s = state.sidecars.lock().unwrap();
    kill(&mut s.medialab);
    kill(&mut s.workbench);
}

// ------------------------------------------------------------------ Media Lab setup (opt-in)

fn run_logged(mut cmd: Command, what: &str) -> Result<(), String> {
    let out = cmd
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("{what}: could not run: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let tail: String = String::from_utf8_lossy(&out.stderr)
            .lines()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        Err(format!("{what} failed ({}):\n{tail}", out.status))
    }
}

/// Creates the venv + installs the server's dependencies, seeds the data
/// dir, writes medialab.json (and a workbench.json when none exists and
/// Node is present), then starts everything. Runs on a background thread;
/// progress is polled through `medialab_status`.
fn medialab_setup(app: &AppHandle) -> Result<(), String> {
    let src = medialab_source_dir(app)
        .ok_or("This build doesn't include the Media Lab server (scripts/stage-medialab.sh was not run before building).")?;
    let venv = medialab_venv_dir(app);
    let python = venv_python(&venv);

    // 1. Python env
    if !python.is_file() {
        set_phase(app, "venv", "Creating a Python environment…");
        let sys_python = find_python();
        let uv = find_uv();
        let created = match (&sys_python, &uv) {
            (Some(py), _) => {
                let mut c = Command::new(py);
                c.args(["-m", "venv"]).arg(&venv);
                match run_logged(c, "python3 -m venv") {
                    Ok(()) => Ok(()),
                    Err(e) => match uv {
                        Some(ref u) => {
                            let mut c = Command::new(u);
                            c.arg("venv").arg("-q").arg(&venv);
                            run_logged(c, "uv venv").map_err(|e2| format!("{e}\n{e2}"))
                        }
                        None => Err(e),
                    },
                }
            }
            (None, Some(u)) => {
                let mut c = Command::new(u);
                c.arg("venv").arg("-q").arg(&venv);
                run_logged(c, "uv venv")
            }
            (None, None) => Err(
                "Python 3 not found — install it from https://python.org (or `brew install python`) and try again."
                    .to_string(),
            ),
        };
        created?;
        if !python.is_file() {
            return Err(format!("venv created but {} is missing", python.display()));
        }
    }

    // 2. Dependencies
    set_phase(app, "installing", "Installing the Media Lab server (about a minute)…");
    let req = src.join("requirements.txt");
    let pip_args: Vec<String> = if req.is_file() {
        vec!["-r".into(), req.to_string_lossy().into_owned()]
    } else {
        MEDIALAB_FALLBACK_PACKAGES.iter().map(|s| s.to_string()).collect()
    };
    let mut pip = Command::new(&python);
    pip.args(["-m", "pip", "install", "-q", "--disable-pip-version-check"]).args(&pip_args);
    if let Err(e) = run_logged(pip, "pip install") {
        // uv-made venvs have no pip; uv can install into them directly.
        match find_uv() {
            Some(u) => {
                let mut c = Command::new(u);
                c.args(["pip", "install", "-q", "-p"]).arg(&python).args(&pip_args);
                run_logged(c, "uv pip install").map_err(|e2| format!("{e}\n{e2}"))?;
            }
            None => return Err(e),
        }
    }

    // 3. Data root. The server expects the deployed-tree layout there:
    //    `<root>/static` (the UI it serves), `<root>/prompt-templates` and
    //    `<root>/config` are read at import time — link them to the bundle's
    //    copies so every app update refreshes them. Never `runner/`: that
    //    would make the server treat the read-only bundle as its install root.
    let root = medialab_home();
    std::fs::create_dir_all(root.join("media")).map_err(|e| format!("create {}: {e}", root.display()))?;
    for name in ["static", "prompt-templates", "config"] {
        let link = root.join(name);
        let target = src.join(name);
        if link.symlink_metadata().is_ok() || !target.is_dir() {
            continue;
        }
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&target, &link);
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&target, &link);
        if let Err(e) = linked {
            log::warn!("could not link {} → {}: {e}", link.display(), target.display());
        }
    }

    // 4. Config
    let port = medialab_config(app)
        .and_then(|c| c["port"].as_u64())
        .unwrap_or(MEDIALAB_PORT as u64);
    write_json(
        &medialab_cfg_path(app),
        &json!({
            "enabled": true,
            "dir": src.to_string_lossy(),
            "python": python.to_string_lossy(),
            "port": port,
        }),
    )?;
    if workbench_config(app).is_none() {
        if let Some(node) = find_node(&None) {
            let projects = home_dir().join("VibeXStudio-Projects");
            let _ = std::fs::create_dir_all(&projects);
            write_json(
                &workbench_cfg_path(app),
                &json!({
                    "enabled": true,
                    "port": WORKBENCH_PORT,
                    "token": mint_token()?,
                    "projectsRoot": projects.to_string_lossy(),
                    "node": node.to_string_lossy(),
                }),
            )?;
        } else {
            log::info!("no Node.js found — Workbench not set up (Media Lab still works)");
        }
    }
    remember_choice(app, "yes");

    // 5. Go — "ready" means the port answers, not just that Python launched.
    set_phase(app, "starting", "Starting Media Lab…");
    start_sidecars(app);
    let state = app.state::<AppState>();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        {
            let mut s = state.sidecars.lock().unwrap();
            if let Some(child) = s.medialab.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    s.medialab = None;
                    let why = format!(
                        "Media Lab exited right after starting ({status}). Its output is in the app log; \
                         the usual causes are a missing dependency in the Python env or something else on port {port}."
                    );
                    s.medialab_reason = Some(why.clone());
                    return Err(why);
                }
            } else {
                return Err(s
                    .medialab_reason
                    .clone()
                    .unwrap_or_else(|| "Media Lab did not start".into()));
            }
        }
        if port_answers(port as u16) {
            return Ok(());
        }
        if std::time::Instant::now() > deadline {
            return Err(format!("Media Lab is taking too long to answer on port {port}"));
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

fn port_answers(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(400),
    )
    .is_ok()
}

fn remember_choice(app: &AppHandle, choice: &str) {
    let mut d = desktop_config(app);
    d["mediaLabAsked"] = json!(true);
    d["mediaLabChoice"] = json!(choice);
    if let Err(e) = write_json(&desktop_cfg_path(app), &d) {
        log::warn!("desktop.json: {e}");
    }
}

// ------------------------------------------------------------------ commands

#[derive(Serialize)]
struct ServiceStatus {
    running: bool,
    port: u16,
    reason: Option<String>,
}

#[derive(Serialize)]
struct SidecarStatus {
    workbench: ServiceStatus,
    medialab: ServiceStatus,
}

#[tauri::command]
fn sidecar_status(app: AppHandle, state: State<AppState>) -> SidecarStatus {
    let mut s = state.sidecars.lock().unwrap();
    let wb_port = workbench_config(&app)
        .and_then(|c| c["port"].as_u64())
        .unwrap_or(WORKBENCH_PORT as u64) as u16;
    let ml_port = medialab_config(&app)
        .and_then(|c| c["port"].as_u64())
        .unwrap_or(MEDIALAB_PORT as u64) as u16;
    let wb_running = alive(&mut s.workbench);
    let ml_running = alive(&mut s.medialab);
    SidecarStatus {
        workbench: ServiceStatus {
            running: wb_running,
            port: wb_port,
            reason: if wb_running {
                None
            } else {
                s.workbench_reason.clone().or(Some("exited".into()))
            },
        },
        medialab: ServiceStatus {
            running: ml_running,
            port: ml_port,
            reason: if ml_running {
                None
            } else {
                s.medialab_reason.clone().or(Some("exited".into()))
            },
        },
    }
}

#[derive(Serialize)]
struct MedialabStatus {
    enabled: bool,
    running: bool,
    port: u16,
    #[serde(flatten)]
    setup: SetupProgress,
    #[serde(rename = "pairUrl")]
    pair_url: Option<String>,
}

#[tauri::command]
fn medialab_status(app: AppHandle, state: State<AppState>) -> MedialabStatus {
    let cfg = medialab_config(&app);
    let running = alive(&mut state.sidecars.lock().unwrap().medialab);
    let mut setup = state.setup.lock().unwrap().clone();
    if setup.phase.is_empty() {
        setup.phase = if running { "ready" } else { "idle" }.into();
    }
    MedialabStatus {
        enabled: enabled(&cfg),
        running,
        port: cfg.as_ref().and_then(|c| c["port"].as_u64()).unwrap_or(MEDIALAB_PORT as u64) as u16,
        setup,
        pair_url: running.then(|| pair_link(&app)).flatten(),
    }
}

/// "Yes" on the first-launch page (and the menu item). Kicks off the setup
/// thread; poll `medialab_status` for progress.
#[tauri::command]
fn medialab_enable(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    {
        let p = state.setup.lock().unwrap();
        if matches!(p.phase.as_str(), "venv" | "installing" | "starting") {
            return Ok(()); // already underway
        }
    }
    set_phase(&app, "venv", "Getting ready…");
    let handle = app.clone();
    std::thread::spawn(move || match medialab_setup(&handle) {
        Ok(()) => set_phase(&handle, "ready", "Media Lab is running on this computer."),
        Err(e) => set_error(&handle, &e),
    });
    Ok(())
}

#[tauri::command]
fn medialab_disable(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    kill(&mut state.sidecars.lock().unwrap().medialab);
    if let Some(mut cfg) = medialab_config(&app) {
        cfg["enabled"] = json!(false);
        write_json(&medialab_cfg_path(&app), &cfg)?;
    }
    remember_choice(&app, "no");
    state.setup.lock().unwrap().phase = "idle".into();
    state.sidecars.lock().unwrap().medialab_reason = Some("disabled".into());
    Ok(())
}

/// The first-launch page, once setup is ready: swap itself for the QR window.
#[tauri::command]
fn show_pair_window(app: AppHandle) {
    open_pair_window(&app);
    if let Some(w) = app.get_webview_window("welcome") {
        let _ = w.close();
    }
}

/// "Not now" on the first-launch page: remember it, close the window.
#[tauri::command]
fn medialab_not_now(app: AppHandle) {
    remember_choice(&app, "not-now");
    if let Some(w) = app.get_webview_window("welcome") {
        let _ = w.close();
    }
}

/// New Workbench token: rewrites workbench.json and restarts the sidecar so
/// previously paired devices lose access until they scan the new QR.
#[tauri::command]
fn workbench_rotate_token(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let mut cfg = workbench_config(&app).ok_or("Workbench isn't set up on this computer yet")?;
    cfg["token"] = json!(mint_token()?);
    write_json(&workbench_cfg_path(&app), &cfg)?;
    {
        let mut s = state.sidecars.lock().unwrap();
        kill(&mut s.workbench);
    }
    start_sidecars(&app);
    let s = state.sidecars.lock().unwrap();
    match &s.workbench_reason {
        None => Ok(()),
        Some(why) => Err(why.clone()),
    }
}

// ------------------------------------------------------------------ pages (vxpair://)

fn pair_link(app: &AppHandle) -> Option<String> {
    let ml = medialab_config(app);
    if !enabled(&ml) {
        return None;
    }
    let port = ml.as_ref().and_then(|c| c["port"].as_u64()).unwrap_or(MEDIALAB_PORT as u64);
    let ip = local_ip_address::local_ip().ok()?.to_string();
    // With a Workbench configured, the QR pairs BOTH services (app ≥ build
    // 25 parses this); otherwise the legacy medialab-only payload keeps old
    // builds pairing.
    let wb = workbench_config(app).filter(|c| c["enabled"].as_bool().unwrap_or(false));
    Some(match wb {
        Some(wb) => {
            let wport = wb["port"].as_u64().unwrap_or(WORKBENCH_PORT as u64);
            let token = wb["token"].as_str().unwrap_or("");
            format!("vibex://pair?medialab=http%3A%2F%2F{ip}%3A{port}&workbench=http%3A%2F%2F{ip}%3A{wport}&wbt={token}")
        }
        None => format!("vibex://pair?url=http%3A%2F%2F{ip}%3A{port}"),
    })
}

const PAGE_CSS: &str = "\
:root{color-scheme:dark}\
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0806;color:rgba(255,255,255,.88);\
font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px;box-sizing:border-box}\
h2{color:#5EC2FF;font-weight:600;margin:0 0 12px}p{max-width:340px;line-height:1.5;margin:10px auto}\
.dim{color:rgba(255,255,255,.5);font-size:13px}\
button{font:inherit;font-size:15px;padding:10px 22px;border-radius:10px;border:1px solid rgba(94,194,255,.35);\
background:transparent;color:#5EC2FF;cursor:pointer;margin:6px}\
button.primary{background:#5EC2FF;color:#0B0806;border-color:#5EC2FF;font-weight:600}\
button:disabled{opacity:.5;cursor:default}\
.qr{background:#fff;border-radius:16px;padding:14px;display:inline-block}\
.err{color:#FF8A80;white-space:pre-wrap;font-size:13px;text-align:left;max-width:360px;margin:10px auto}\
.bar{height:3px;width:220px;margin:14px auto;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden}\
.bar i{display:block;height:100%;width:40%;background:#5EC2FF;animation:slide 1.2s infinite ease-in-out}\
@keyframes slide{0%{margin-left:-40%}100%{margin-left:100%}}";

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The zero-typing pairing screen: a QR of the `vibex://pair?…` link.
/// Scanning it with a phone or tablet camera opens VibeXStudio, which pairs automatically.
fn pair_page_html(app: &AppHandle) -> String {
    let ml = medialab_config(app);
    let ip = local_ip_address::local_ip().map(|i| i.to_string()).unwrap_or_default();

    let Some(target) = pair_link(app) else {
        let why = if ip.is_empty() {
            "This computer doesn't seem to be on a network right now."
        } else if !enabled(&ml) {
            "Media Lab isn't enabled on this computer yet — choose Media Lab → Make media on this computer… from the menu."
        } else {
            "Couldn't build the pairing link."
        };
        return format!(
            "<!doctype html><html><head><meta charset=utf-8><style>{PAGE_CSS}</style></head><body>\
             <div><h2>Can't pair just yet</h2><p>{why}</p></div></body></html>"
        );
    };
    let port = ml.as_ref().and_then(|c| c["port"].as_u64()).unwrap_or(MEDIALAB_PORT as u64);
    let qr = qrcode::QrCode::new(target.as_bytes())
        .map(|c| {
            c.render::<qrcode::render::svg::Color>()
                .min_dimensions(240, 240)
                .dark_color(qrcode::render::svg::Color("#0B0806"))
                .light_color(qrcode::render::svg::Color("#FFFFFF"))
                .build()
        })
        .unwrap_or_default();
    let link_js = serde_json::to_string(&target).unwrap_or_default();

    format!(
        "<!doctype html><html><head><meta charset=utf-8><style>{PAGE_CSS}</style></head><body>\
         <div><h2>Pair your device</h2>\
         <div class=qr>{qr}</div>\
         <p>Point your device's camera at the code — VibeXStudio opens and pairs to this computer — \
         Media Lab, and the Workbench when it's set up.</p>\
         <p><button id=copy>Copy link</button></p>\
         <p class=dim>Same Wi-Fi or tailnet required · http://{ip}:{port}</p>\
         </div>\
         <script>\
         const link={link_js};const b=document.getElementById('copy');\
         async function copy(){{try{{await navigator.clipboard.writeText(link);}}catch(e){{\
           const t=document.createElement('textarea');t.value=link;t.style.position='fixed';t.style.opacity='0';\
           document.body.appendChild(t);t.focus();t.select();try{{document.execCommand('copy');}}catch(_){{}}t.remove();}}\
           b.textContent='Copied';setTimeout(()=>b.textContent='Copy link',1500);}}\
         b.addEventListener('click',copy);\
         </script></body></html>"
    )
}

/// First launch: "Make media on this computer?" — Yes runs the setup and
/// hands over to the pairing QR; Not now is remembered in desktop.json.
fn welcome_page_html(app: &AppHandle) -> String {
    let already = enabled(&medialab_config(app));
    let intro = if already {
        "Media Lab is already set up here. Run the setup again to repair the Python environment, or open the pairing code."
    } else {
        "VibeX Studio can run Media Lab right here — images, video and music, made by this computer and \
         paired to your phone or tablet with one scan. It takes about a minute and needs only Python 3 \
         (cloud engines like fal.ai work on any machine; local engines need a GPU)."
    };
    let intro = html_escape(intro);
    format!(
        "<!doctype html><html><head><meta charset=utf-8><style>{PAGE_CSS}</style></head><body>\
         <div id=ask><h2>Make media on this computer?</h2>\
         <p>{intro}</p>\
         <p><button class=primary id=yes>Yes, set it up</button><button id=no>Not now</button></p>\
         <p class=dim>You can change this any time from the Media Lab menu.</p></div>\
         <div id=busy hidden><h2>Setting up Media Lab</h2><div class=bar><i></i></div>\
         <p id=msg>Getting ready…</p><p class=dim>Keep using VibeX Studio — this window updates by itself.</p></div>\
         <div id=fail hidden><h2>Something needs a hand</h2><div class=err id=errtext></div>\
         <p><button class=primary id=retry>Try again</button><button id=later>Not now</button></p></div>\
         <script>\
         const inv=(c,a)=>window.__TAURI__.core.invoke(c,a);\
         const $=(i)=>document.getElementById(i);\
         function show(id){{for(const s of ['ask','busy','fail'])$(s).hidden=s!==id;}}\
         let timer=null;\
         async function poll(){{try{{const st=await inv('medialab_status');\
           if(st.phase==='ready'&&st.running){{clearInterval(timer);inv('show_pair_window');return;}}\
           if(st.phase==='error'){{clearInterval(timer);$('errtext').textContent=st.error||'Unknown error';show('fail');return;}}\
           $('msg').textContent=st.message||'Working…';}}catch(e){{}}}}\
         async function start(){{show('busy');try{{await inv('medialab_enable');}}catch(e){{$('errtext').textContent=String(e);show('fail');return;}}\
           timer=setInterval(poll,1000);poll();}}\
         $('yes').onclick=start;$('retry').onclick=start;\
         $('no').onclick=()=>inv('medialab_not_now');$('later').onclick=()=>inv('medialab_not_now');\
         </script></body></html>"
    )
}

fn open_page(handle: &AppHandle, label: &str, path: &str, title: &str, size: (f64, f64)) {
    if let Some(w) = handle.get_webview_window(label) {
        let _ = w.set_focus();
        return;
    }
    let url = format!("vxpair://localhost{path}");
    if let Ok(url) = url.parse() {
        match WebviewWindowBuilder::new(handle, label, WebviewUrl::CustomProtocol(url))
            .title(title)
            .inner_size(size.0, size.1)
            .resizable(false)
            .build()
        {
            Ok(_) => {}
            Err(e) => log::warn!("{label} window failed: {e}"),
        }
    }
}

fn open_pair_window(handle: &AppHandle) {
    open_page(handle, "pair", "/", "Pair your device", (420.0, 640.0));
}

fn open_welcome_window(handle: &AppHandle) {
    open_page(handle, "welcome", "/welcome", "Media Lab", (440.0, 420.0));
}

/// Ask once: no medialab.json and never answered before.
fn should_ask_first_launch(app: &AppHandle) -> bool {
    medialab_config(app).is_none()
        && !desktop_config(app)["mediaLabAsked"].as_bool().unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_delete,
            sidecar_status,
            medialab_status,
            medialab_enable,
            medialab_disable,
            medialab_not_now,
            show_pair_window,
            workbench_rotate_token,
        ])
        .register_uri_scheme_protocol("vxpair", |ctx, request| {
            let handle = ctx.app_handle();
            let body = match request.uri().path() {
                "/welcome" => welcome_page_html(handle),
                _ => pair_page_html(handle),
            };
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(body.into_bytes())
                .unwrap()
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let handle = app.handle().clone();
            start_sidecars(&handle);

            // App menu: keep the defaults, add the Media Lab submenu.
            let pair = MenuItem::with_id(app, "pair-phone", "Pair your device…", true, None::<&str>)?;
            let make = MenuItem::with_id(app, "make-media", "Make media on this computer…", true, None::<&str>)?;
            let rotate = MenuItem::with_id(app, "rotate-token", "Rotate Workbench token", true, None::<&str>)?;
            let media_menu = Submenu::with_items(app, "Media Lab", true, &[&pair, &make, &rotate])?;
            let menu = Menu::default(app.handle())?;
            menu.append(&media_menu)?;
            app.set_menu(menu)?;
            app.on_menu_event(|handle, event| match event.id().as_ref() {
                "pair-phone" => open_pair_window(handle),
                "make-media" => open_welcome_window(handle),
                "rotate-token" => {
                    let state = handle.state::<AppState>();
                    match workbench_rotate_token(handle.clone(), state) {
                        Ok(()) => {
                            log::info!("Workbench token rotated");
                            // Show the new QR straight away — the old one is dead.
                            if let Some(w) = handle.get_webview_window("pair") {
                                let _ = w.close();
                            }
                            open_pair_window(handle);
                        }
                        Err(e) => log::warn!("rotate token: {e}"),
                    }
                }
                _ => {}
            });

            if should_ask_first_launch(&handle) {
                open_welcome_window(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |handle, event| {
        if let tauri::RunEvent::Exit = event {
            stop_sidecars(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{mint_token, secret_delete, secret_get, secret_set, valid_secret_key};

    #[test]
    fn accepts_only_vibex_secret_namespaces() {
        for key in [
            "vibex.github.token",
            "vibex.workbench.token",
            "vibex.private.installation-proof",
            "vibex.provider.connection-1",
            "vibex.refresh.connection_2",
            "vibex.private-proof.connection.3",
        ] {
            assert!(valid_secret_key(key), "expected allowed key: {key}");
        }
    }

    #[test]
    fn rejects_empty_malformed_and_foreign_keys() {
        for key in [
            "",
            "vibex.provider.",
            "vibex.refresh.",
            "vibex.private-proof.",
            "vibex.provider.bad/slash",
            "vibex.provider.bad space",
            "other.provider.connection",
            "vibex.github.token.extra",
        ] {
            assert!(!valid_secret_key(key), "expected rejected key: {key}");
        }
    }

    #[test]
    fn tokens_are_32_hex_and_unique() {
        let a = mint_token().unwrap();
        let b = mint_token().unwrap();
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    #[ignore = "requires the host OS credential vault"]
    fn host_credential_vault_round_trip() {
        let key = "vibex.provider.desktop-keychain-roundtrip".to_string();
        let value = "vibexstudio-keychain-roundtrip-value".to_string();
        secret_delete(key.clone()).expect("clear stale test credential");
        secret_set(key.clone(), value.clone()).expect("write credential");
        assert_eq!(secret_get(key.clone()).expect("read credential"), Some(value));
        secret_delete(key.clone()).expect("delete credential");
        assert_eq!(secret_get(key).expect("confirm deletion"), None);
    }
}
