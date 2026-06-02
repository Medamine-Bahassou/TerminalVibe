mod pty;

use pty::PtyManager;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn create_terminal(app: tauri::AppHandle, state: tauri::State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<String, String> {
    state.create_terminal(app, id, cols, rows)
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
            // In dev mode, cargo runs from src-tauri/ — walk up to project root
            let mut project_root = std::env::current_dir().unwrap_or_default();
            if !project_root.join("server.js").exists() {
                // Try parent (src-tauri/ -> project root)
                if let Some(parent) = project_root.parent() {
                    if parent.join("server.js").exists() {
                        project_root = parent.to_path_buf();
                    }
                }
            }

            let server_path = project_root.join("server.js");
            eprintln!("[tauri] Starting server from: {:?}", server_path);
            eprintln!("[tauri] Project root: {:?}", project_root);
            eprintln!("[tauri] server.js exists: {}", server_path.exists());

            let child = std::process::Command::new("node")
                .arg(&server_path)
                .current_dir(&project_root)
                .env("TAURI", "1")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::inherit())
                .spawn();

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
