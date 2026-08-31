use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Media Lab sidecar: when ~/Library/Application Support/studio.vibex.desktop/
/// medialab.json exists with {"enabled": true, "dir": ..., "python": ...},
/// the shell starts the Media Lab server at launch and stops it on quit.
/// It binds 0.0.0.0 so phones on the same network/tailnet can pair — the
/// "Pair your phone" window (below) hands them the address as a QR code.
fn sidecar_config() -> Option<serde_json::Value> {
    let home = std::env::var("HOME").ok()?;
    let cfg_path = std::path::Path::new(&home)
        .join("Library/Application Support/studio.vibex.desktop/medialab.json");
    let raw = std::fs::read_to_string(cfg_path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn workbench_config() -> Option<serde_json::Value> {
    let home = std::env::var("HOME").ok()?;
    let cfg_path = std::path::Path::new(&home)
        .join("Library/Application Support/studio.vibex.desktop/workbench.json");
    let raw = std::fs::read_to_string(cfg_path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Find a Node runtime: GUI apps don't inherit the shell PATH, so probe the
/// config's "node" hint first, then the usual install locations.
fn find_node(cfg: &serde_json::Value) -> Option<String> {
    if let Some(n) = cfg["node"].as_str() {
        if std::path::Path::new(n).exists() {
            return Some(n.to_string());
        }
    }
    for candidate in [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        if std::path::Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }
    None
}

/// The Workbench: builds, dev servers, and project storage on this
/// computer, remote-controlled by the paired phone (workbench/API.md).
fn spawn_workbench() -> Option<Child> {
    let cfg = workbench_config()?;
    if !cfg["enabled"].as_bool().unwrap_or(false) {
        return None;
    }
    let node = find_node(&cfg)?;
    // server.mjs location: config override first (dev checkouts), else the
    // repo-relative default the setup script records.
    let server = cfg["server"].as_str().map(str::to_string).or_else(|| {
        let home = std::env::var("HOME").ok()?;
        let p = std::path::Path::new(&home).join("Projects/vibexstudio-desktop/workbench/server.mjs");
        p.exists().then(|| p.to_string_lossy().into_owned())
    })?;
    log::info!("starting Workbench sidecar: {node} {server}");
    Command::new(node)
        .arg(&server)
        .spawn()
        .map_err(|e| log::warn!("Workbench failed to start: {e}"))
        .ok()
}

fn spawn_medialab() -> Option<Child> {
    let cfg = sidecar_config()?;
    if !cfg["enabled"].as_bool().unwrap_or(false) {
        return None;
    }
    let dir = cfg["dir"].as_str()?;
    let python = cfg["python"].as_str()?;
    let port = cfg["port"].as_u64().unwrap_or(7863).to_string();
    log::info!("starting Media Lab sidecar from {dir} on port {port}");
    Command::new(python)
        .args(["-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", &port])
        .current_dir(dir)
        .spawn()
        .map_err(|e| log::warn!("Media Lab sidecar failed to start: {e}"))
        .ok()
}

/// The zero-typing pairing screen: a QR of `vibex://pair?url=http://<lan-ip>:<port>`.
/// Scanning it with a phone camera opens VibeXStudio, which pairs automatically.
fn pair_page_html() -> String {
    let port = sidecar_config()
        .and_then(|c| c["port"].as_u64())
        .unwrap_or(7863);
    let sidecar_on = sidecar_config()
        .map(|c| c["enabled"].as_bool().unwrap_or(false))
        .unwrap_or(false);
    let ip = local_ip_address::local_ip()
        .map(|i| i.to_string())
        .unwrap_or_default();

    if ip.is_empty() || !sidecar_on {
        let why = if ip.is_empty() {
            "This computer doesn't seem to be on a network right now."
        } else {
            "Media Lab isn't enabled on this computer yet — run sidecar/setup-medialab.sh once, then relaunch."
        };
        return format!(
            "<!doctype html><html><body style=\"margin:0;display:grid;place-items:center;height:100vh;\
             background:#0B0806;color:rgba(255,255,255,.88);font-family:system-ui;text-align:center;padding:24px\">\
             <div><h2 style=\"color:#5EC2FF\">Can't pair just yet</h2><p style=\"max-width:360px\">{why}</p></div></body></html>"
        );
    }

    // With a Workbench configured, the QR pairs BOTH services (app ≥ build
    // 25 parses this); otherwise the legacy medialab-only payload keeps old
    // builds pairing.
    let target = match workbench_config().filter(|c| c["enabled"].as_bool().unwrap_or(false)) {
        Some(wb) => {
            let wport = wb["port"].as_u64().unwrap_or(8794);
            let token = wb["token"].as_str().unwrap_or("");
            format!(
                "vibex://pair?medialab=http%3A%2F%2F{ip}%3A{port}&workbench=http%3A%2F%2F{ip}%3A{wport}&wbt={token}"
            )
        }
        None => format!("vibex://pair?url=http%3A%2F%2F{ip}%3A{port}"),
    };
    let qr = qrcode::QrCode::new(target.as_bytes())
        .map(|c| {
            c.render::<qrcode::render::svg::Color>()
                .min_dimensions(240, 240)
                .dark_color(qrcode::render::svg::Color("#0B0806"))
                .light_color(qrcode::render::svg::Color("#FFFFFF"))
                .build()
        })
        .unwrap_or_default();

    format!(
        "<!doctype html><html><body style=\"margin:0;display:grid;place-items:center;height:100vh;\
         background:#0B0806;color:rgba(255,255,255,.88);font-family:system-ui;text-align:center\">\
         <div><h2 style=\"color:#5EC2FF;font-weight:600\">Pair your phone</h2>\
         <div style=\"background:#fff;border-radius:16px;padding:14px;display:inline-block\">{qr}</div>\
         <p style=\"max-width:340px;line-height:1.5\">Point your phone's camera at the code —\
         VibeXStudio opens and pairs to this computer — Media Lab, and the Workbench when it's set up.</p>\
         <p style=\"color:rgba(255,255,255,.5);font-size:13px\">Same Wi-Fi or tailnet required · http://{ip}:{port}</p>\
         </div></body></html>"
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar: Mutex<Option<Child>> = Mutex::new(spawn_medialab());
    let workbench: Mutex<Option<Child>> = Mutex::new(spawn_workbench());
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol("vxpair", |_ctx, _request| {
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(pair_page_html().into_bytes())
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
            // App menu: keep the defaults, add Media Lab > Pair your phone.
            let pair = MenuItem::with_id(app, "pair-phone", "Pair your phone…", true, None::<&str>)?;
            let media_menu = Submenu::with_items(app, "Media Lab", true, &[&pair])?;
            let menu = Menu::default(app.handle())?;
            menu.append(&media_menu)?;
            app.set_menu(menu)?;
            app.on_menu_event(|handle, event| {
                if event.id().as_ref() == "pair-phone" {
                    if let Some(w) = handle.get_webview_window("pair") {
                        let _ = w.set_focus();
                        return;
                    }
                    if let Ok(url) = "vxpair://localhost/".parse() {
                        match WebviewWindowBuilder::new(handle, "pair", WebviewUrl::CustomProtocol(url))
                            .title("Pair your phone")
                            .inner_size(420.0, 560.0)
                            .resizable(false)
                            .build()
                        {
                            Ok(_) => {}
                            Err(e) => log::warn!("pair window failed: {e}"),
                        }
                    }
                }
            });
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
            if let Some(mut child) = workbench.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
