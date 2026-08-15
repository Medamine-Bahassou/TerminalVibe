---
type: API Reference
title: Electron IPC Commands
description: Native PTY commands and window controls exposed via the Electron preload bridge.
tags: [electron, ipc, pty, commands]
timestamp: 2026-08-15T00:00:00Z
---

# Electron IPC Commands

The frontend talks to the Electron main process through the sandboxed `electronAPI` bridge exposed by `electron/preload.js` via `contextBridge`. All PTY sessions run in the main process (node-pty).

## Commands

### `terminal:create`

Create a new PTY session.

```js
electronAPI.terminalCreate({ id, cols: 80, rows: 24, cwd: null })
```

**Behavior:**
- Spawns `$SHELL` with `TERM=xterm-256color`
- Registers `onData` → emits `terminal:data` events
- Registers `onExit` → emits `terminal:exit` events

### `terminal:write`

Write data to a terminal's stdin.

```js
electronAPI.terminalWrite({ id, data })
```

### `terminal:resize`

Resize a terminal's PTY dimensions.

```js
electronAPI.terminalResize({ id, cols: 120, rows: 40 })
```

### `terminal:close`

Kill a terminal's process and clean up.

```js
electronAPI.terminalClose(id)
```

### `terminal:detach`

Detach a terminal into its own window (reuses the same running PTY).

```js
electronAPI.terminalDetach({ id, cols, rows, cwd })
```

## Events

### `terminal:data`

Emitted when PTY has output data.

```js
electronAPI.onTerminalData(({ id, data }) => { ... })
```

### `terminal:exit`

Emitted when terminal process exits.

```js
electronAPI.onTerminalExit(({ id, code }) => { ... })
```

## Shell Integration

OSC 7 is supported for automatic CWD reporting:

- **Bash**: via `.bashrc` hook
- **Zsh**: via `.zshrc` hook

CWD is persisted across sessions for workspace restore.

## Other Bridges

- `clipboard:*` — clipboard read/write
- `shell:open-external` — external link handling
- `file:resolve` — local file path resolution
- `browser:*` — native WebContentsView browser tabs
- `config:*` — `~/.terminalvibe/` config directory
- `settings:*` — settings window lifecycle

## Related

- [Electron Shell Layer](../architecture/electron-shell.md) implementation
- [WebSocket PTY Protocol](./websocket-pty.md) browser dev mode fallback
