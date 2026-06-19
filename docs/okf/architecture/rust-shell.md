---
type: Architecture Layer
title: Rust Shell Layer
description: Tauri 2.x shell managing PTY sessions via portable-pty, IPC commands, and Node.js server lifecycle.
tags: [rust, tauri, pty, ipc]
resource: src-tauri/src/
timestamp: 2026-06-19T00:00:00Z
---

# Rust Shell Layer

The Tauri 2.x Rust shell handles PTY management, IPC with the frontend, and spawning the Node.js backend.

## Source Files

| File | Role |
|------|------|
| `main.rs` | Entry point — calls `terminalvibe::run()` |
| `lib.rs` | Tauri commands, PtyManager state, Node.js server lifecycle |
| `pty.rs` | `PtyManager` — portable-pty integration with OSC 7 shell integration |

## PtyManager

Uses `portable-pty` + `parking_lot::Mutex<HashMap<String, PtySession>>`.

### PtySession

- `writer` — PTY master writer for stdin
- `master` — PTY master reader for stdout
- `child` — Killable child process

### Commands

| Command | Description |
|---------|-------------|
| `create_terminal` | Opens PTY pair, spawns `$SHELL -l` with `TERM=xterm-256color`, starts background reader thread |
| `write_terminal` | Writes bytes to PTY master writer |
| `resize_terminal` | Sends resize signal to PTY |
| `close_terminal` | Kills child, cleans up session |

### Events

| Event | Payload | When |
|-------|---------|------|
| `pty://output` | `{id, data}` | PTY master has output |
| `pty://exit` | `{id, code}` | Process exited or EOF |

## Server Lifecycle

`setup()` spawns `node server.js`:

| Mode | Ports |
|------|-------|
| Dev | 7781 (PTY), 7782 (proxy), 7769 (static) |
| Prod | 7681 (PTY), 7682 (proxy), 6969 (static) |

`on_window_event(Destroyed)` kills all PTY sessions and the Node server.

## Related

- [Tauri IPC Commands](../api/tauri-ipc.md) detailed protocol
- [Frontend Layer](./frontend.md) consumes these commands
