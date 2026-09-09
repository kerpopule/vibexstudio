//! VibeX Studio Desktop — the native shell.
//!
//! Two sidecars ship inside the bundle (tauri.conf.json → bundle.resources):
//!
//! * the **Workbench** (`workbench/server.mjs`, needs a system Node ≥ 18) —
//!   builds/dev servers/project storage on this computer, driven by the
//!   paired device (workbench/API.md);
//! * **Media Lab** (`resources/media-lab/`, staged by
//!   scripts/stage-medialab.sh, needs a system Python 3) — the FastAPI
//!   legacy studio, retained for existing configurations and repair only.
//!   Fresh setups select an independent installation or a server connection.
//!   The legacy venv lives in the app data dir, the data root stays
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

mod controller_python;
mod tailnet_services;
mod agent_transport;
mod folder_sync;
mod device_pairing_ui;
mod file_export;

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const MEDIALAB_PORT: u16 = 7863;
const WORKBENCH_PORT: u16 = 8794;
const MEDIALAB_FALLBACK_PACKAGES: [&str; 4] = ["fastapi", "uvicorn", "pydantic", "python-multipart"];

// ------------------------------------------------------------------ secrets

/// Only keys inside the VibeXStudio namespace may reach the OS vault, so a
/// compromised page can't read (or clobber) other apps' credentials.
fn valid_secret_key(key: &str) -> bool {
    let exact = matches!(
        key,
        "vibex.github.token" | "vibex.workbench.token" | "vibex.private.installation-proof"
    );
    let scoped = ["vibex.provider.", "vibex.refresh.", "vibex.private-proof.", "vibex.library.", "vibex.agent-connect.credential."]
        .iter()
        .any(|prefix| key.strip_prefix(prefix).is_some_and(|suffix| !suffix.is_empty()));
    (exact || scoped)
        && key.len() <= 256
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn secret_entry(app: &AppHandle, key: &str) -> Result<keyring::Entry, String> {
    if !valid_secret_key(key) {
        return Err("secret key is outside the VibeXStudio credential namespace".into());
    }
    keyring::Entry::new(&app.config().identifier, key)
        .map_err(|error| format!("OS credential vault is unavailable: {error}"))
}

/// Linux desktops without a Secret Service (sway, Hyprland, a bare X session,
/// a container) have no OS vault at all. Secrets then live in files under the
/// app's config directory, readable only by the user (0600), so pairing and
/// providers still work; the vault is used whenever it answers. macOS and
/// Windows always have a vault, so they never reach this path.
fn vault_unavailable(error: &keyring::Error) -> bool {
    cfg!(target_os = "linux")
        && matches!(error, keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_))
}

fn secret_file(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !valid_secret_key(key) {
        return Err("secret key is outside the VibeXStudio credential namespace".into());
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("app config directory is unavailable: {error}"))?
        .join("secrets");
    Ok(dir.join(key))
}

fn secret_file_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let path = secret_file(app, key)?;
    let dir = path.parent().ok_or("secret path has no parent")?;
    std::fs::create_dir_all(dir).map_err(|error| format!("could not create the secrets folder: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    let tmp = dir.join(format!(".{key}.tmp"));
    {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp).map_err(|error| format!("could not write the secret file: {error}"))?;
        use std::io::Write;
        file.write_all(value.as_bytes()).map_err(|error| format!("could not write the secret file: {error}"))?;
        file.sync_all().ok();
    }
    std::fs::rename(&tmp, &path).map_err(|error| format!("could not place the secret file: {error}"))
}

fn secret_file_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    match std::fs::read_to_string(secret_file(app, key)?) {
        Ok(value) if value.is_empty() => Ok(None),
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read the secret file: {error}")),
    }
}

fn secret_file_delete(app: &AppHandle, key: &str) -> Result<(), String> {
    match std::fs::remove_file(secret_file(app, key)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not delete the secret file: {error}")),
    }
}

#[tauri::command]
async fn secret_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if value.is_empty() {
            return Err("refusing to store an empty secret".into());
        }
        match secret_entry(&app, &key)?.set_password(&value) {
            Ok(()) => Ok(()),
            Err(error) if vault_unavailable(&error) => secret_file_set(&app, &key, &value),
            Err(error) => Err(format!("could not store secret in OS credential vault: {error}")),
        }
    }).await.map_err(|_| "Credential operation could not finish".to_string())?
}

#[tauri::command]
async fn secret_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match secret_entry(&app, &key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => secret_file_get(&app, &key),
            Err(error) if vault_unavailable(&error) => secret_file_get(&app, &key),
            Err(error) => Err(format!("could not read secret from OS credential vault: {error}")),
        }
    }).await.map_err(|_| "Credential operation could not finish".to_string())?
}

#[tauri::command]
async fn secret_delete(app: AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = match secret_entry(&app, &key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) if vault_unavailable(&error) => Ok(()),
            Err(error) => Err(format!("could not delete secret from OS credential vault: {error}")),
        };
        vault.and_then(|()| secret_file_delete(&app, &key))
    }).await.map_err(|_| "Credential operation could not finish".to_string())?
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
    let mut cfg = read_json(&medialab_cfg_path(app))?;
    if cfg["runtime"].as_str() == Some("independent-studio") && cfg.get("port").is_none() {
        cfg["port"] = json!(7864);
    }
    Some(cfg)
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

fn find_controller_python() -> Option<PathBuf> {
    let version = if cfg!(target_os = "macos") { "python3.14" } else { "python3.12" };
    let names = [version, "python3", "python"];
    let mut directories = vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin"), home_dir().join(".local/bin"), PathBuf::from("/usr/bin")];
    if cfg!(target_os = "macos") {
        directories.push(PathBuf::from("/Library/Frameworks/Python.framework/Versions/3.14/bin"));
    }
    if let Some(paths) = std::env::var_os("PATH") { directories.extend(std::env::split_paths(&paths)); }
    controller_python::find(names.into_iter().flat_map(|name| directories.iter().map(move |dir| dir.join(name))))
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
        if let Some(input) = c.stdin.take() {
            drop(input);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(7);
            while std::time::Instant::now() < deadline {
                match c.try_wait() {
                    Ok(Some(_)) => return,
                    Err(_) => break,
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                }
            }
        }
        let _ = c.kill();
        let _ = c.wait();
    }
}

// ------------------------------------------------------------------ spawning

/// The owned stdin pipe closes on clean shutdown or desktop process death.
/// The supervisor then terminates and reaps its server child.
const MEDIALAB_SUPERVISOR: &str = include_str!("sidecar_supervisor.py");

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
        return Err("disabled".into());
    }
    let cfg = cfg.unwrap();
    if cfg["runtime"].as_str() == Some("independent-studio") {
        return spawn_independent_medialab(&cfg);
    }
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
    // Keep an owned pipe open for the supervisor. Closing it requests cleanup,
    // including when the desktop dies without a clean quit.
    Command::new(&python)
        .arg("-c")
        .arg(MEDIALAB_SUPERVISOR)
        .args(["-m", "uvicorn", "app:app"])
        .args(["--host", "0.0.0.0", "--port", &port])
        .current_dir(&dir)
        // Never write .pyc into the (signed, read-only) bundle.
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("MEDIA_LAB_HOME", medialab_home())
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Media Lab sidecar failed to start ({}): {e}", python.display()))
}

/// Explicit development configuration uses its own installed source and host.
/// It never enters the legacy dependency installer or data directory.
fn desktop_controller_origin() -> &'static str {
    if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" }
}

fn spawn_independent_medialab(cfg: &Value) -> Result<Child, String> {
    let installation = cfg["installation"].as_str()
        .map(PathBuf::from).filter(|path| path.is_absolute())
        .ok_or("Independent Media Lab requires an absolute installation directory")?;
    let python = venv_python(&installation.join("venv"));
    if !python.is_file() {
        return Err("Independent Media Lab's installed Python is missing".into());
    }
    let port = cfg["port"].as_u64().unwrap_or(7864);
    if !(1..=65535).contains(&port) {
        return Err("Independent Media Lab port must be between 1 and 65535".into());
    }
    let mut command = Command::new(&python);
    command
        .arg("-I").arg("-c").arg(MEDIALAB_SUPERVISOR)
        .args(["-I", "-c", include_str!("independent_bootstrap.py")])
        .arg(include_str!("../../scripts/install-independent-controller.py"))
        .arg(&installation).arg("serve")
        .args(["--port", &port.to_string()])
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped());
    if cfg["desktopOriginAllowed"].as_bool() == Some(true) {
        command.args(["--origin", desktop_controller_origin()]);
    }
    command.spawn()
        .map_err(|error| format!("Independent Media Lab failed to start: {error}"))
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
    if medialab_config(app).is_none() {
        return Err("Fresh setups use an independent installation or a connected server. The legacy installer is only available to repair an existing configuration.".into());
    }
    if medialab_config(app).as_ref().and_then(|cfg| cfg["runtime"].as_str()) == Some("independent-studio") {
        return Err("An independent controller is selected. Manage its installation separately; the legacy installer cannot update it.".into());
    }
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

fn controller_installation_unavailable(os: &str, arch: &str, packaged: bool) -> Option<&'static str> {
    if !packaged {
        return Some("This desktop build has no bundled controller installer. Connect your Media Lab server below, or use a build containing the independent controller package.");
    }
    if !((os == "macos" && (arch == "aarch64" || arch == "x86_64")) || (os == "linux" && arch == "aarch64")) {
        return Some("Local Media Lab installation is currently available on Macs and ARM Linux computers. Intel Mac support is a development preview. On this computer, connect to your own Media Lab server below. You can still build projects and use your AI APIs.");
    }
    None
}

#[derive(Serialize)]
struct MedialabStatus {
    #[serde(rename = "installationAvailable")]
    installation_available: bool,
    #[serde(rename = "installationMessage")]
    installation_message: Option<String>,
    configured: bool,
    independent: bool,
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
    let unavailable = controller_installation_unavailable(std::env::consts::OS, std::env::consts::ARCH, !env!("VIBEX_CONTROLLER_PACKAGE_SHA256").is_empty());
    MedialabStatus {
        installation_available: unavailable.is_none(),
        installation_message: unavailable.map(str::to_owned).or_else(|| {
            if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
                Some("Intel Mac setup is a development preview tested through Rosetta. Physical Intel Mac and local model qualification are still pending. Requires Python 3.14 and uv.".into())
            } else { None }
        }),
        configured: cfg.is_some(),
        independent: cfg.as_ref().and_then(|c| c["runtime"].as_str()) == Some("independent-studio"),
        enabled: enabled(&cfg),
        running,
        port: cfg.as_ref().and_then(|c| c["port"].as_u64()).unwrap_or(MEDIALAB_PORT as u64) as u16,
        setup,
        // Invitations are issued only by an explicit pairing-window action.
        pair_url: None,
    }
}

#[derive(Serialize)]
struct LocalControllerConnection { url: String, code: String }

/// Install only the resource package pinned into this particular native build.
#[tauri::command]
async fn install_bundled_controller(app: AppHandle, window: tauri::WebviewWindow, resume: bool) -> Result<String, String> {
    let page = window.url().map_err(|_| "Cannot verify the Studio window")?;
    let packaged = (page.scheme() == "tauri" && page.host_str() == Some("localhost"))
        || (cfg!(windows) && page.scheme() == "http" && page.host_str() == Some("tauri.localhost"));
    if window.label() != "main" || !packaged || page.port().is_some() || !page.username().is_empty() || page.password().is_some() {
        return Err("Installation requires the packaged desktop app".into());
    }
    if medialab_config(&app).is_some() { return Err("A controller is already configured. Use its existing controls".into()); }
    let digest = env!("VIBEX_CONTROLLER_PACKAGE_SHA256");
    if let Some(reason) = controller_installation_unavailable(std::env::consts::OS, std::env::consts::ARCH, !digest.is_empty()) {
        return Err(reason.into());
    }
    let resource = resource_dir(&app).ok_or("Cannot locate app resources")?.join("independent-controller");
    let destination = app.path().app_data_dir().map_err(|_| "Cannot locate app data")?.join("independent-controller");
    tauri::async_runtime::spawn_blocking(move || {
        let python = find_controller_python().ok_or("No compatible Python was found. Local setup needs Python 3.14 on Mac or Python 3.12 on ARM Linux. Install that version and retry, or connect your server below.")?;
        let uv = find_uv().ok_or("Install uv (the Python dependency installer) and retry, or connect your server below.")?;
        let mut command = Command::new(python.clone());
        command.args(["-I", "-c", include_str!("../../scripts/install-desktop-package.py")])
            .arg("--package").arg(resource).arg("--package-sha256").arg(digest)
            .arg("--destination").arg(&destination).arg("--python").arg(python).arg("--uv").arg(uv)
            .stdout(Stdio::null()).stderr(Stdio::null());
        if resume { command.arg("--resume"); }
        let status = command.status().map_err(|_| "Could not start the controller installer")?;
        if !status.success() { return Err("Installation did not finish. Its files are preserved; retry setup or inspect the installation receipt".into()); }
        configure_independent_installation(&app, &destination)?;
        Ok(destination.to_string_lossy().into_owned())
    }).await.map_err(|_| "Controller installation task failed")?
}

fn read_tailscale_status()->Result<Value,String>{
        let executable = if cfg!(target_os = "macos") && Path::new("/Applications/Tailscale.app/Contents/MacOS/Tailscale").exists() {
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
        } else { "tailscale" };
        let mut child = Command::new(executable).args(["status", "--json"])
            .stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
            .map_err(|_| "Install and sign into Tailscale on this computer, or enter your server address")?;
        // Drain stdout while the child runs so large inventories cannot fill the pipe.
        let stdout = child.stdout.take().ok_or("Cannot read Tailscale output")?;
        let reader = std::thread::spawn(move || {
            use std::io::Read;
            let mut bytes = Vec::new();
            stdout.take(1_000_001).read_to_end(&mut bytes).map(|_| bytes)
        });
        let started = std::time::Instant::now();
        loop {
            if child.try_wait().map_err(|_| "Could not read Tailscale status")?.is_some() { break; }
            if started.elapsed() > std::time::Duration::from_secs(5) {
                let _ = child.kill(); let _ = child.wait();
                return Err("Tailscale did not respond. Enter your server address instead".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let exit = child.wait().map_err(|_| "Could not read Tailscale devices")?;
        let bytes = reader.join().map_err(|_| "Could not collect Tailscale devices")?
            .map_err(|_| "Could not read Tailscale output")?;
        if !exit.success() || bytes.len() > 1_000_000 { return Err("Tailscale is unavailable. Check that it is signed in".into()); }
        let status: Value = serde_json::from_slice(&bytes).map_err(|_| "Tailscale returned an invalid device list")?;
        if status["BackendState"].as_str() != Some("Running") { return Err("Sign into Tailscale before finding devices".into()); }
        Ok(status)
}

/// Read the user's existing tailnet inventory; never scan addresses or alter Tailscale.
#[tauri::command]
async fn tailscale_devices(window: tauri::WebviewWindow) -> Result<Value, String> {
    let page = window.url().map_err(|_| "Cannot verify the Studio window")?;
    let packaged = (page.scheme() == "tauri" && page.host_str() == Some("localhost"))
        || (cfg!(windows) && page.scheme() == "http" && page.host_str() == Some("tauri.localhost"));
    if window.label() != "main" || !packaged || page.port().is_some() || !page.username().is_empty() || page.password().is_some() {
        return Err("Device discovery requires the packaged desktop app".into());
    }
    tauri::async_runtime::spawn_blocking(|| {
        let status=read_tailscale_status()?;
        let devices: Vec<Value> = status["Peer"].as_object().into_iter().flat_map(|peers| peers.values()).take(500).filter_map(|peer| {
            let address = peer["TailscaleIPs"].as_array()?.iter().filter_map(|ip| ip.as_str()).find(|ip| ip.starts_with("100."))?;
            Some(json!({"name":peer["HostName"].as_str().unwrap_or("Device"), "address":address, "online":peer["Online"].as_bool().unwrap_or(false)}))
        }).collect();
        Ok(json!(devices))
    }).await.map_err(|_| "Device discovery failed")?
}

/// Check only an explicitly selected current peer, without credentials or redirects.
#[tauri::command]
async fn tailscale_media_services(window: tauri::WebviewWindow, address:String) -> Result<Vec<String>,String> {
    let page=window.url().map_err(|_| "Cannot verify the Studio window")?;
    let packaged=(page.scheme()=="tauri"&&page.host_str()==Some("localhost"))
        ||(cfg!(windows)&&page.scheme()=="http"&&page.host_str()==Some("tauri.localhost"));
    if window.label()!="main"||!packaged||page.port().is_some()||!page.username().is_empty()||page.password().is_some(){
        return Err("Service discovery requires the packaged desktop app".into());
    }
    let status=tauri::async_runtime::spawn_blocking(read_tailscale_status).await.map_err(|_|"Device discovery failed")??;
    let targets=tailnet_services::candidates(&status,&address)?;
    tailnet_services::probe(targets).await
}

/// Return the private local pairing material only to the packaged main window.
#[tauri::command]
async fn medialab_local_connection(app: AppHandle, window: tauri::WebviewWindow) -> Result<LocalControllerConnection, String> {
    let page = window.url().map_err(|_| "Cannot verify the Studio window")?;
    let packaged = (page.scheme() == "tauri" && page.host_str() == Some("localhost"))
        || (cfg!(windows) && page.scheme() == "http" && page.host_str() == Some("tauri.localhost"));
    if window.label() != "main" || !packaged || page.port().is_some() || !page.username().is_empty() || page.password().is_some() {
        return Err("Local pairing is available only in the packaged Studio window".into());
    }
    let cfg = medialab_config(&app).filter(|cfg| cfg["runtime"].as_str() == Some("independent-studio")
        && cfg["desktopOriginAllowed"].as_bool() == Some(true))
        .ok_or("Select an updated independent installation from the Media Lab menu first")?;
    if !alive(&mut app.state::<AppState>().sidecars.lock().unwrap().medialab) {
        return Err("Start the controller from the Media Lab menu first".into());
    }
    let installation = PathBuf::from(cfg["installation"].as_str().ok_or("Installation path is missing")?);
    let output = Command::new(venv_python(&installation.join("venv")))
        .args(["-I", "-c", include_str!("independent_bootstrap.py")])
        .arg(include_str!("../../scripts/install-independent-controller.py"))
        .arg(&installation).arg("pair").stdin(Stdio::null()).output()
        .map_err(|_| "Could not read the local pairing code")?;
    if !output.status.success() { return Err("Verify the independent installation before pairing".into()); }
    let code = String::from_utf8(output.stdout).map_err(|_| "Invalid local pairing code")?.trim().to_string();
    if code.len() != 64 || !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid local pairing code".into());
    }
    let port = cfg["port"].as_u64().filter(|port| (1..=65535).contains(port)).ok_or("Invalid local controller port")?;
    Ok(LocalControllerConnection { url: format!("http://127.0.0.1:{port}"), code })
}

/// Select an already installed independent controller for a fresh desktop setup.
/// Selection validates files but leaves the controller stopped until Start.
#[tauri::command]
async fn medialab_select_installation(app: AppHandle) -> Result<bool, String> {
    if medialab_config(&app).is_some() {
        return Err("A controller is already configured. Changing an existing installation is not supported here yet.".into());
    }
    let Some(selected) = app.dialog().file().set_title("Choose your independent Media Lab installation").blocking_pick_folder() else {
        return Ok(false);
    };
    let installation = selected.into_path().map_err(|_| "Choose a local installation folder")?
        .canonicalize().map_err(|_| "The selected folder is unavailable")?;
    configure_independent_installation(&app, &installation)
}

fn configure_independent_installation(app: &AppHandle, installation: &Path) -> Result<bool, String> {
    let python = venv_python(&installation.join("venv"));
    let mut check = Command::new(&python);
    check.args(["-I", "-c", include_str!("independent_bootstrap.py")])
        .arg(include_str!("../../scripts/install-independent-controller.py"))
        .arg(&installation).args(["inspect-desktop", desktop_controller_origin()]);
    run_logged(check, "Independent installation check")?;
    // Recheck after the dialog and validation; never replace another setup.
    let state = app.state::<AppState>();
    let mut sidecars = state.sidecars.lock().unwrap();
    if medialab_config(&app).is_some() || alive(&mut sidecars.medialab) {
        return Err("A controller was configured while the folder was being checked. Close and reopen this window.".into());
    }
    write_json(&medialab_cfg_path(&app), &json!({
        "enabled": false, "runtime": "independent-studio",
        "installation": installation.to_string_lossy(), "port": 7864, "desktopOriginAllowed": true,
    }))?;
    sidecars.medialab_reason = Some("disabled".into());
    remember_choice(&app, "independent");
    Ok(true)
}

/// "Yes" on the first-launch page (and the menu item). Kicks off the setup
/// thread; poll `medialab_status` for progress.
#[tauri::command]
fn medialab_enable(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    if medialab_config(&app).is_none() {
        return Err("Choose an independent installation first, or connect to your server in Studio.".into());
    }
    if let Some(mut cfg) = medialab_config(&app).filter(|cfg| cfg["runtime"].as_str() == Some("independent-studio")) {
        let mut sidecars = state.sidecars.lock().unwrap();
        if alive(&mut sidecars.medialab) {
            return Ok(());
        }
        let child = spawn_independent_medialab(&cfg)?;
        let mut owned = Some(child);
        cfg["enabled"] = json!(true);
        if let Err(error) = write_json(&medialab_cfg_path(&app), &cfg) {
            kill(&mut owned);
            return Err(error);
        }
        sidecars.medialab = owned;
        sidecars.medialab_reason = None;
        return Ok(());
    }
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
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
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

fn build_pair_link(ip:&str,media_port:Option<u64>,workbench:Option<(u64,&str)>)->Option<String>{
    if media_port.is_none() && workbench.is_none(){return None;}
    let host=if ip.contains(':'){format!("[{ip}]")}else{ip.to_string()};
    let mut target=tauri::Url::parse("vibex://pair").ok()?;
    {
        let mut query=target.query_pairs_mut();
        if let Some(port)=media_port{query.append_pair("medialab",&format!("http://{host}:{port}"));}
        if let Some((port,token))=workbench{query.append_pair("workbench",&format!("http://{host}:{port}"));query.append_pair("wbi",token);}
    }
    Some(target.to_string())
}
#[cfg(test)]
mod pair_link_tests {
    #[test]
    fn build_server_pairs_without_media_lab(){
        let link=super::build_pair_link("192.168.1.4",None,Some((8794,"test token"))).unwrap();
        let url=tauri::Url::parse(&link).unwrap();let values:std::collections::HashMap<_,_>=url.query_pairs().into_owned().collect();
        assert_eq!(values.get("workbench").unwrap(),"http://192.168.1.4:8794");assert_eq!(values.get("wbi").unwrap(),"test token");assert!(!values.contains_key("medialab"));
        assert!(super::build_pair_link("192.168.1.4",None,None).is_none());
    }
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
fn pair_page_html(_app: &AppHandle) -> String {
    include_str!("device_pairing.html").replace("__PAGE_CSS__", PAGE_CSS)
}

/// Fresh setups choose an independent installation or continue into Studio.
/// Existing legacy configurations retain their explicit repair screen.
fn welcome_page_html(app: &AppHandle) -> String {
    if medialab_config(app).as_ref().and_then(|cfg| cfg["runtime"].as_str()) == Some("independent-studio") {
        return include_str!("independent_status.html").replace("__PAGE_CSS__", PAGE_CSS);
    }
    if medialab_config(app).is_none() {
        return include_str!("independent_welcome.html").replace("__PAGE_CSS__", PAGE_CSS);
    }
    let intro = "This computer has an existing legacy Media Lab configuration. Repair reinstalls its server dependencies. It does not switch to the independent controller or verify generation engines.";
    let intro = html_escape(intro);
    format!(
        "<!doctype html><html><head><meta charset=utf-8><style>{PAGE_CSS}</style></head><body>\
         <div id=ask><h2>Repair existing Media Lab</h2>\
         <p>{intro}</p>\
         <p><button class=primary id=yes>Repair installation</button><button id=no>Not now</button></p>\
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
            .resizable(true)
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
    open_page(handle, "welcome", "/welcome", "Media Lab", (460.0, 540.0));
}

/// Ask once: no medialab.json and never answered before.
fn should_ask_first_launch(app: &AppHandle) -> bool {
    medialab_config(app).is_none()
        && !desktop_config(app)["mediaLabAsked"].as_bool().unwrap_or(false)
}

// ------------------------------------------------------------------ updates
//
// The updater reads `plugins.updater.endpoints` from tauri.conf.json (the
// monorepo's `releases/latest/download/latest.json`) and only accepts a
// bundle whose `.sig` verifies against the embedded pubkey. Two callers:
// a silent check 3 s after launch (errors are logged, never shown) and the
// "Check for updates…" menu item / `check_for_updates` command, which also
// report "up to date" and errors in a dialog.

/// What a check found. Also the return value of the `check_for_updates`
/// command so the web frontend can render its own banner.
#[derive(Serialize, Clone, Debug)]
struct UpdateCheck {
    /// The running version.
    current: String,
    /// A newer build is on the endpoint (and, if the user said yes, is
    /// being installed right now).
    available: bool,
    version: Option<String>,
    notes: Option<String>,
    /// Why the check failed (offline, no latest.json yet, bad signature…).
    error: Option<String>,
}

fn update_check_result(app: &AppHandle) -> UpdateCheck {
    UpdateCheck {
        current: app.package_info().version.to_string(),
        available: false,
        version: None,
        notes: None,
        error: None,
    }
}

/// Set `VIBEX_NO_UPDATE_CHECK=1` to skip the launch check (tests, CI).
fn update_checks_disabled() -> bool {
    std::env::var_os("VIBEX_NO_UPDATE_CHECK").is_some_and(|v| !v.is_empty() && v != "0")
}

fn message_dialog(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .message(body)
        .title(title)
        .kind(tauri_plugin_dialog::MessageDialogKind::Info)
        .blocking_show();
}

/// Runs the whole check → ask → download → install → relaunch flow.
/// Blocks its thread (dialogs + download), so call it off the main thread.
fn run_update_check(app: &AppHandle, interactive: bool) -> UpdateCheck {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use tauri_plugin_updater::UpdaterExt;

    let mut result = update_check_result(app);
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            let why = format!("updater is not configured: {e}");
            log::warn!("update check: {why}");
            if interactive {
                message_dialog(app, "Check for updates", &format!("Couldn't check for updates.\n\n{why}"));
            }
            result.error = Some(why);
            return result;
        }
    };

    let update = match tauri::async_runtime::block_on(updater.check()) {
        Ok(Some(update)) => update,
        Ok(None) => {
            log::info!("update check: {} is up to date", result.current);
            if interactive {
                message_dialog(
                    app,
                    "Check for updates",
                    &format!("You're up to date.\n\nVibeX Studio {} is the newest version.", result.current),
                );
            }
            return result;
        }
        Err(e) => {
            // No release yet, offline, GitHub down, malformed latest.json —
            // all routine. Log it; only the menu item gets a dialog.
            let why = e.to_string();
            log::warn!("update check failed: {why}");
            if interactive {
                message_dialog(
                    app,
                    "Check for updates",
                    &format!("Couldn't check for updates right now.\n\n{why}\n\nYou're on VibeX Studio {}.", result.current),
                );
            }
            result.error = Some(why);
            return result;
        }
    };

    result.available = true;
    result.version = Some(update.version.clone());
    result.notes = update.body.clone();
    log::info!("update available: {} → {}", result.current, update.version);

    let notes = update
        .body
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| format!("\n\n{n}"))
        .unwrap_or_default();
    let yes = app
        .dialog()
        .message(format!(
            "VibeX Studio {} is ready (you have {}).{notes}",
            update.version, result.current
        ))
        .title("Update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Update now".into(), "Later".into()))
        .blocking_show();
    if !yes {
        log::info!("update {}: user chose Later", update.version);
        return result;
    }

    let version = update.version.clone();
    let mut received: u64 = 0;
    let mut last_logged_pct: u64 = 0;
    let installed = tauri::async_runtime::block_on(update.download_and_install(
        |chunk, total| {
            received += chunk as u64;
            if let Some(total) = total {
                let pct = received * 100 / total.max(1);
                if pct >= last_logged_pct + 10 || pct == 100 {
                    last_logged_pct = pct;
                    log::info!("update {version}: downloaded {pct}% ({received}/{total} bytes)");
                }
            }
        },
        || log::info!("update {version}: download complete, installing"),
    ));
    match installed {
        Ok(()) => {
            log::info!("update {version}: installed, relaunching");
            app.restart();
        }
        Err(e) => {
            let why = format!("update to {version} failed: {e}");
            log::error!("{why}");
            message_dialog(
                app,
                "Update failed",
                &format!("{why}\n\nYou can keep using this version or download the release by hand from github.com/kerpopule/vibexstudio/releases."),
            );
            result.error = Some(why);
            result
        }
    }
}

/// Frontend-triggered check: shows the same dialogs as the menu item and
/// returns what it found.
#[tauri::command]
async fn check_for_updates(app: AppHandle) -> UpdateCheck {
    tauri::async_runtime::spawn_blocking(move || run_update_check(&app, true))
        .await
        .unwrap_or_else(|e| {
            let mut r = UpdateCheck {
                current: String::new(),
                available: false,
                version: None,
                notes: None,
                error: None,
            };
            r.error = Some(format!("update check panicked: {e}"));
            r
        })
}

fn spawn_update_check(app: &AppHandle, interactive: bool, delay: std::time::Duration) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        run_update_check(&handle, interactive);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .manage(file_export::FileExports::default())
        .manage(agent_transport::AgentTransport::default())
        .manage(agent_transport::RemoteAgent::default())
        .manage(folder_sync::FolderSync::default())
        .invoke_handler(tauri::generate_handler![
            file_export::file_export_begin,
            file_export::file_export_write,
            file_export::file_export_finish,
            file_export::file_export_abort,
            device_pairing_ui::device_pairing_manage,
            folder_sync::sync_folder_pick,
            folder_sync::sync_folder_status,
            folder_sync::sync_folder_disconnect,
            folder_sync::sync_folder_request,
            folder_sync::sync_server_configure,
            agent_transport::agent_transport_start,
            agent_transport::agent_transport_poll,
            agent_transport::agent_transport_reply,
            agent_transport::agent_transport_stop,
            agent_transport::agent_device_identity,
            agent_transport::agent_remote_start,
            agent_transport::agent_remote_status,
            agent_transport::agent_remote_stop,
            secret_set,
            secret_get,
            secret_delete,
            sidecar_status,
            medialab_status,
            medialab_enable,
            medialab_select_installation,
            medialab_local_connection,
            tailscale_devices,
            tailscale_media_services,
            install_bundled_controller,
            medialab_disable,
            medialab_not_now,
            show_pair_window,
            workbench_rotate_token,
            check_for_updates,
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
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
            // The default menu on Linux and Windows already ends with a Help
            // submenu; put Media Lab before it (20gh: appending gave
            // "Edit Window Help Media Lab Help" on Debian).
            let default_help = menu
                .items()?
                .into_iter()
                .filter_map(|item| item.as_submenu().cloned())
                .find(|sub| sub.text().map(|text| text == "Help").unwrap_or(false));
            match menu.items()?.iter().position(|item| {
                item.as_submenu()
                    .and_then(|sub| sub.text().ok())
                    .map(|text| text == "Help")
                    .unwrap_or(false)
            }) {
                Some(index) => menu.insert(&media_menu, index)?,
                None => menu.append(&media_menu)?,
            }
            // "Check for updates…": under the app menu (VibeX Studio → …) on
            // macOS, right after About; in the Help menu elsewhere.
            let check = MenuItem::with_id(app, "check-updates", "Check for updates…", true, None::<&str>)?;
            let app_menu = if cfg!(target_os = "macos") {
                menu.items()?.into_iter().next().and_then(|item| item.as_submenu().cloned())
            } else {
                None
            };
            match (app_menu, default_help) {
                (Some(sub), _) => {
                    sub.insert(&PredefinedMenuItem::separator(app)?, 1)?;
                    sub.insert(&check, 2)?;
                }
                (None, Some(help)) => help.append(&check)?,
                (None, None) => menu.append(&Submenu::with_items(app, "Help", true, &[&check])?)?,
            }
            app.set_menu(menu)?;
            app.on_menu_event(|handle, event| match event.id().as_ref() {
                "check-updates" => spawn_update_check(handle, true, std::time::Duration::ZERO),
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

            // Silent update check once the window is up. Failures (no
            // release yet, offline) only reach the log.
            if update_checks_disabled() {
                log::info!("update check on launch skipped (VIBEX_NO_UPDATE_CHECK)");
            } else {
                spawn_update_check(&handle, false, std::time::Duration::from_secs(3));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |handle, event| {
        if let tauri::RunEvent::Exit = event {
            handle.state::<agent_transport::RemoteAgent>().stop();
            handle.state::<agent_transport::AgentTransport>().stop();
            stop_sidecars(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{controller_installation_unavailable, mint_token, valid_secret_key};

    #[test]
    fn accepts_only_vibex_secret_namespaces() {
        for key in [
            "vibex.github.token",
            "vibex.workbench.token",
            "vibex.private.installation-proof",
            "vibex.provider.connection-1",
            "vibex.refresh.connection_2",
            "vibex.private-proof.connection.3",
            "vibex.library.a123abc",
            "vibex.agent-connect.credential.a123abc",
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
            "vibex.library.",
            "vibex.agent-connect.credential.",
            "vibex.provider.bad/slash",
            "vibex.provider.bad space",
            "other.provider.connection",
            "vibex.github.token.extra",
        ] {
            assert!(!valid_secret_key(key), "expected rejected key: {key}");
        }
    }

    #[test]
    fn controller_installation_reports_supported_package_targets() {
        assert!(controller_installation_unavailable("macos", "aarch64", true).is_none());
        assert!(controller_installation_unavailable("linux", "aarch64", true).is_none());
        assert!(controller_installation_unavailable("macos", "x86_64", true).is_none());
        for (os, arch) in [("windows", "x86_64"), ("windows", "aarch64"), ("linux", "x86_64")] {
            assert!(controller_installation_unavailable(os, arch, true).unwrap().contains("connect to your own Media Lab server"));
        }
        assert!(controller_installation_unavailable("macos", "aarch64", false).unwrap().contains("no bundled controller installer"));
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
        // Exercise the host vault in a dedicated test namespace. Native command
        // authorization and app-specific isolation require packaged-app acceptance.
        let key = format!("roundtrip-{}", mint_token().unwrap());
        let entry = keyring::Entry::new("studio.vibex.test.credential-vault", &key).unwrap();
        let value = "vibexstudio-keychain-roundtrip-value";
        entry.set_password(value).expect("write credential");
        let read = entry.get_password();
        entry.delete_credential().expect("delete credential");
        assert_eq!(read.expect("read credential"), value);
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
