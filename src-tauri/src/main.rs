// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio};
use std::net::TcpStream;
use std::path::PathBuf;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|_app| {
            // Auto-start the Node.js backend if not already running
            if TcpStream::connect("127.0.0.1:7681").is_err() {
                let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                let project_root = manifest.parent().unwrap_or(&manifest);
                let server = project_root.join("server.js");

                if server.exists() {
                    Command::new("node")
                        .arg(&server)
                        .current_dir(project_root)
                        .env("TAURI", "1")
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                        .expect("Failed to start server.js");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
