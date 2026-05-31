use std::fs::OpenOptions;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // Auto-start the Node.js backend if not already running
            if TcpStream::connect("127.0.0.1:7681").is_err() {
                let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                let project_root = manifest.parent().unwrap_or(&manifest).to_path_buf();
                let server = project_root.join("server.js");

                if server.exists() {
                    let log_path = project_root.join("server.log");
                    let log_file = OpenOptions::new()
                        .create(true)
                        .truncate(true)
                        .write(true)
                        .open(&log_path)
                        .unwrap();

                    match Command::new("node")
                        .arg(&server)
                        .current_dir(&project_root)
                        .env("TAURI", "1")
                        .stdout(Stdio::from(log_file.try_clone().unwrap()))
                        .stderr(Stdio::from(log_file))
                        .spawn()
                    {
                        Ok(_) => {
                            eprintln!("server.js spawned, waiting for port 7681...");
                        }
                        Err(e) => {
                            eprintln!("Failed to spawn server.js: {}", e);
                        }
                    }
                } else {
                    eprintln!("server.js not found at {:?}", server);
                }

                // Wait for the server to be ready (up to 10 seconds)
                for i in 0..100 {
                    if TcpStream::connect("127.0.0.1:7681").is_ok() {
                        eprintln!("server ready after {}ms", i * 100);
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            } else {
                eprintln!("server already running on port 7681");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
