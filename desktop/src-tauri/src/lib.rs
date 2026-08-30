use std::process::{Child, Command};
use std::sync::Mutex;

/// Media Lab sidecar: when ~/Library/Application Support/studio.vibex.desktop/
/// medialab.json exists with {"enabled": true, "dir": ..., "python": ...},
/// the shell starts the Media Lab FastAPI server on localhost at launch and
/// stops it on quit. Pairing inside the app then points at 127.0.0.1:<port>.
fn spawn_medialab() -> Option<Child> {
    let home = std::env::var("HOME").ok()?;
    let cfg_path = std::path::Path::new(&home)
        .join("Library/Application Support/studio.vibex.desktop/medialab.json");
    let raw = std::fs::read_to_string(cfg_path).ok()?;
    let cfg: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if !cfg["enabled"].as_bool().unwrap_or(false) {
        return None;
    }
    let dir = cfg["dir"].as_str()?;
    let python = cfg["python"].as_str()?;
    let port = cfg["port"].as_u64().unwrap_or(7863).to_string();
    log::info!("starting Media Lab sidecar from {dir} on port {port}");
    Command::new(python)
        .args(["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", &port])
        .current_dir(dir)
        .spawn()
        .map_err(|e| log::warn!("Media Lab sidecar failed to start: {e}"))
        .ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar: Mutex<Option<Child>> = Mutex::new(spawn_medialab());
    let app = tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(mut child) = sidecar.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
