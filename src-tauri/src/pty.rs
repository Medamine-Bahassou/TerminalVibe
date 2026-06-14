use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
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
    _tmp_dir: Option<PathBuf>,
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
        cwd: Option<String>,
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
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // ── Shell integration: OSC 7 cwd reporting + shell args ──
        let tmp_dir = setup_shell_integration(&mut cmd, &shell);
        // Only add -l for shells without custom integration
        if tmp_dir.is_none() {
            cmd.arg("-l");
        }

        if let Some(ref cwd_path) = cwd {
            let expanded = if cwd_path.starts_with('~') {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
                format!("{}{}", home, &cwd_path[1..])
            } else {
                cwd_path.clone()
            };
            let p = std::path::PathBuf::from(&expanded);
            if p.is_dir() {
                cmd.cwd(&expanded);
            }
        }

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
                _tmp_dir: tmp_dir,
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
            // Clean up temp shell integration files
            if let Some(dir) = session._tmp_dir.take() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        Ok(())
    }

    pub fn close_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.close_all();
    }
}

static INTEGRATION_CTR: AtomicU32 = AtomicU32::new(0);

/// Set up shell integration (OSC 7 cwd reporting) for the given shell.
/// Returns an optional path to a temp directory that should be cleaned up.
/// The function adds all necessary shell arguments (-l/--rcfile) to `cmd`.
fn setup_shell_integration(cmd: &mut CommandBuilder, shell: &str) -> Option<PathBuf> {
    let shell_name = std::path::Path::new(shell)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let ctr = INTEGRATION_CTR.fetch_add(1, Ordering::Relaxed);

    if shell_name == "bash" {
        // For bash, use --rcfile instead of -l (login shell).
        // Our custom rc file sources ~/.bashrc AND ~/.bash_profile/~/.profile,
        // so the user gets the same environment as a login shell.
        let tmp_dir = std::env::temp_dir().join(format!("tv-sh-{ctr}"));
        let _ = std::fs::create_dir_all(&tmp_dir);
        let rc_path = tmp_dir.join("bashrc");
        let rc_content = format!(
            r#"# TerminalVibe OSC 7 shell integration
[ -f ~/.bashrc ] && source ~/.bashrc 2>/dev/null || true
[ -f ~/.bash_profile ] && source ~/.bash_profile 2>/dev/null || true
[ -f ~/.profile ] && source ~/.profile 2>/dev/null || true

# Report cwd on every prompt via OSC 7
__terminal_vibe_cwd() {{
  printf "\e]7;file://${{HOSTNAME:-localhost}}${{PWD// /%20}}\a"
}}
PROMPT_COMMAND="__terminal_vibe_cwd${{PROMPT_COMMAND:+;$PROMPT_COMMAND}}"
"#
        );
        let _ = std::fs::write(&rc_path, rc_content);
        cmd.arg("--rcfile");
        cmd.arg(rc_path.to_string_lossy().to_string());
        Some(tmp_dir)
    } else if shell_name == "zsh" {
        // For zsh, set ZDOTDIR to a temp dir with a custom .zshrc
        // Keep login shell (-l) since ZDOTDIR works fine with it
        let tmp_dir = std::env::temp_dir().join(format!("tv-zsh-{ctr}"));
        let _ = std::fs::create_dir_all(&tmp_dir);
        let zshrc_path = tmp_dir.join(".zshrc");
        let zshrc_content = format!(
            r#"# TerminalVibe OSC 7 shell integration
[ -f ~/.zshrc ] && source ~/.zshrc 2>/dev/null || true

# Report cwd on every prompt via OSC 7
__terminal_vibe_cwd() {{
  printf "\e]7;file://${{HOST:-localhost}}${{PWD}}\a"
}}
precmd_functions+=(__terminal_vibe_cwd)
"#
        );
        let _ = std::fs::write(&zshrc_path, zshrc_content);
        cmd.env("ZDOTDIR", tmp_dir.to_string_lossy().to_string());
        cmd.arg("-l");
        Some(tmp_dir)
    } else {
        cmd.arg("-l");
        None
    }
}
