---
okf_version: "0.1"
---

# TerminalVibe Knowledge Bundle

> Architecture, API protocols, and operational playbooks for TerminalVibe — a terminal multiplexer and desktop workspace app built on Electron.

## Architecture

- [Frontend Layer](./architecture/frontend.md) — Vanilla JS + xterm.js UI with state management
- [Electron Shell Layer](./architecture/electron-shell.md) — PTY management and IPC in the main process
- [Node.js Backend](./architecture/node-backend.md) — WebSocket PTY server, HTTP proxy, static server

## API & Protocols

- [Electron IPC Commands](./api/electron-ipc.md) — Native PTY commands (create, write, resize, close)
- [WebSocket PTY Protocol](./api/websocket-pty.md) — Binary and JSON frames for PTY sessions
- [Browser Proxy Protocol](./api/browser-proxy.md) — HTTP proxy for embedded browser tabs
- [Frontend State Model](./api/frontend-state.md) — Workspaces, layouts, groups, terminals

## Plugins

- [Plugin Overview](../plugins/index.md) — what plugins can do and how to install them
- [Plugin Manifest](../plugins/manifest.md) — `plugin.json` reference
- [Plugin API Reference](../plugins/api-reference.md) — the full `api` object
- [Plugin Tutorial](../plugins/tutorial.md) — build a plugin step by step
- [Plugin Troubleshooting](../plugins/troubleshooting.md) — limitations and debugging

## Playbooks

- [Development Setup](./playbooks/dev-setup.md) — Prerequisites and running in dev mode
- [Build & Release](./playbooks/build-release.md) — Building the AppImage and bundling
- [Debugging PTY Issues](./playbooks/debug-pty.md) — Troubleshooting terminal session problems
