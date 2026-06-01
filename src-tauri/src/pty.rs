use std::collections::HashMap;
use std::io::{Read, Write};
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── Event payloads ──

#[derive(Clone, Serialize)]
pub struct PtyOutputPayload {
    pub id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
pub struct PtyExitPayload {
    pub id: String,
    pub code: Option<i32>,
}

// ── Session ──

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn ChildKiller + Send + Sync>,
}

// ── Manager ──

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn create_terminal(
        &self,
        app: AppHandle,
        id: String,
        cols: u16,
        rows: u16,
    ) -> Result<String, String> {
        // Don't create duplicate sessions
        if self.sessions.lock().contains_key(&id) {
            return Ok(id);
        }

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader failed: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer failed: {e}"))?;

        let master = pair.master;

        let child_killer = child.clone_killer();
        let mut child_waiter = child;
        let id_clone = id.clone();

        // Background thread: read PTY output → emit to frontend
        thread::spawn(move || {
            let mut buf = [0u8; 65536];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = app.emit(
                            "pty://output",
                            PtyOutputPayload {
                                id: id_clone.clone(),
                                data: buf[..n].to_vec(),
                            },
                        );
                    }
                    Err(_) => break,
                }
            }

            let code = child_waiter.wait().ok().map(|s| s.exit_code() as i32);
            let _ = app.emit(
                "pty://exit",
                PtyExitPayload {
                    id: id_clone,
                    code,
                },
            );
        });

        self.sessions.lock().insert(
            id.clone(),
            PtySession {
                writer,
                master,
                child: child_killer,
            },
        );

        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions.get_mut(id).ok_or("terminal not found")?;
        session
            .writer
            .write_all(data)
            .map_err(|e| format!("write failed: {e}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let session = sessions.get(id).ok_or("terminal not found")?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        if let Some(mut session) = sessions.remove(id) {
            let _ = session.child.kill();
        }
        Ok(())
    }
}
