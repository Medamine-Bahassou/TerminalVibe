---
okf_version: "0.1"
---

# TerminalVibe Knowledge Bundle

> Architecture, API protocols, and operational playbooks for TerminalVibe — a terminal multiplexer and desktop workspace app built on Tauri 2.x.

## Architecture

- [Frontend Layer](./architecture/frontend.md) — Vanilla JS + xterm.js UI with state management
- [Rust Shell Layer](./architecture/rust-shell.md) — Tauri 2.x PTY management and IPC
- [Node.js Backend](./architecture/node-backend.md) — WebSocket PTY server, HTTP proxy, static server

## API & Protocols

- [Tauri IPC Commands](./api/tauri-ipc.md) — Native PTY commands (create, write, resize, close)
- [WebSocket PTY Protocol](./api/websocket-pty.md) — Binary and JSON frames for PTY sessions
- [Browser Proxy Protocol](./api/browser-proxy.md) — HTTP proxy for embedded browser tabs
- [Frontend State Model](./api/frontend-state.md) — Workspaces, layouts, groups, terminals

## Playbooks

- [Development Setup](./playbooks/dev-setup.md) — Prerequisites and running in dev mode
- [Build & Release](./playbooks/build-release.md) — Building the AppImage and bundling
- [Debugging PTY Issues](./playbooks/debug-pty.md) — Troubleshooting terminal session problems
