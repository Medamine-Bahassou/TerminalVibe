mod pty;

use pty::PtyManager;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn create_terminal(app: tauri::AppHandle, state: tauri::State<PtyManager>, id: String, cols: u16, rows: u16, cwd: Option<String>) -> Result<String, String> {
    state.create_terminal(app, id, cols, rows, cwd)
}

#[tauri::command]
fn write_terminal(state: tauri::State<PtyManager>, id: String, data: Vec<u8>) -> Result<(), String> {
    state.write(&id, &data)
}

#[tauri::command]
fn resize_terminal(state: tauri::State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(&id, cols, rows)
}

#[tauri::command]
fn close_terminal(state: tauri::State<PtyManager>, id: String) -> Result<(), String> {
    state.close(&id)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::new())
        .manage(Mutex::new(None::<std::process::Child>))
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
        ])
        .setup(|app| {
            // Start the Node.js backend server (WS PTY + HTTP proxy)
            // Try resource dir (AppImage), then fall back to current_dir (dev)
            let (server_path, work_dir) = resolve_server_path(app);

            fn resolve_server_path(app: &tauri::App) -> (std::path::PathBuf, std::path::PathBuf) {
                if let Ok(dir) = app.path().resource_dir() {
                    // Check with server-dist prefix (Tauri preserves relative resource paths)
                    let sd = dir.join("server-dist");
                    let sp = sd.join("server.js");
                    if sp.exists() {
                        return (sp, sd);
                    }
                    // Check without prefix in case Tauri flattens
                    let sp = dir.join("server.js");
                    if sp.exists() {
                        return (sp, dir);
                    }
                }
                // Dev mode fallback
                let mut project_root = std::env::current_dir().unwrap_or_default();
                if !project_root.join("server.js").exists() {
                    if let Some(parent) = project_root.parent() {
                        if parent.join("server.js").exists() {
                            project_root = parent.to_path_buf();
                        }
                    }
                }
                (project_root.join("server.js"), project_root)
            }

            eprintln!("[tauri] Starting server from: {:?}", server_path);
            eprintln!("[tauri] Work dir: {:?}", work_dir);
            eprintln!("[tauri] server.js exists: {}", server_path.exists());

            let child = {
                let mut cmd = std::process::Command::new("node");
                cmd.arg(&server_path)
                    .current_dir(&work_dir)
                    .env("TAURI", "1")
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::inherit());
                // Dev mode: use different ports to avoid conflicts with prod
                if cfg!(debug_assertions) {
                    cmd.env("WS_PORT", "7781")
                       .env("PROXY_PORT", "7782")
                       .env("APP_PORT", "7769");
                }
                cmd.spawn()
            };

            match child {
                Ok(child) => {
                    eprintln!("[tauri] Server started (pid={})", child.id());
                    let state = app.state::<Mutex<Option<std::process::Child>>>();
                    *state.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("[tauri] Failed to start server: {e}");
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill all PTY shell processes
                let pty = window.state::<PtyManager>();
                pty.close_all();

                // Kill Node.js server
                let state = window.state::<Mutex<Option<std::process::Child>>>();
                let child = state.lock().unwrap().take();
                if let Some(mut child) = child {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
