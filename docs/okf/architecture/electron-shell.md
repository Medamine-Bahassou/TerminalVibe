---
type: Architecture Layer
title: Electron Shell Layer
description: Electron main process managing PTY sessions via node-pty, native WebContentsView browser tabs, and window controls.
tags: [electron, pty, ipc, windows]
resource: electron/
timestamp: 2026-08-15T00:00:00Z
---

# Electron Shell Layer

The Electron main process handles PTY management (node-pty), native WebContentsView browser tabs, settings/detached windows, and the `~/.terminalvibe/` config directory.

## Source Files

| File | Role |
|------|------|
| `electron/main.js` | Main process — window creation, PTY pool, browser views, IPC handlers |
| `electron/preload.js` | Sandboxed `electronAPI` contextBridge for the renderer |
| `electron/dev-server.js` | Dev-mode static server for hot-reload |

## PTY Management

node-pty runs in the main process, keyed by terminal ID in a `Map`.

### IPC Handlers

| Handler | Description |
|---------|-------------|
| `terminal:create` | Spawns `$SHELL` with `TERM=xterm-256color`, wires `onData`/`onExit` |
| `terminal:write` | Writes bytes to PTY stdin |
| `terminal:resize` | Resizes the PTY |
| `terminal:close` | Kills child, cleans up session |
| `terminal:detach` | Detaches a terminal into its own window (reuses the PTY) |
| `terminal:kill-all` | Kills all PTYs on quit |

### Events

| Event | Payload | When |
|-------|---------|------|
| `terminal:data` | `{id, data}` | PTY master has output |
| `terminal:exit` | `{id, code}` | Process exited or EOF |

## Browser Tabs

Native WebContentsView instances are owned by the main process because they always paint above the window DOM:

- `browser:create` / `browser:destroy` — view lifecycle
- `browser:show` / `browser:hide` / `browser:resize` — placement from renderer-reported bounds
- `browser:navigate` / `browser:back` / `browser:forward` / `browser:reload` / `browser:zoom`
- `browser:event` — navigation/loading/title events relayed to the renderer

## Settings Window

The settings page lives in a separate always-on-top BrowserWindow (native views can never cover it in the same window).

## Related

- [Electron IPC Commands](../api/electron-ipc.md) detailed protocol
- [Frontend Layer](./frontend.md) consumes these commands
