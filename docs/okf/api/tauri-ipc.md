---
type: API Reference
title: Tauri IPC Commands
description: Native PTY commands for terminal lifecycle management via Tauri invoke/emit.
tags: [tauri, ipc, pty, commands]
timestamp: 2026-06-19T00:00:00Z
---

# Tauri IPC Commands

Commands are invoked from the frontend via `invoke()` and emit events via `app.emit()`.

## Commands

### `create_terminal`

Create a new PTY session.

```js
invoke('create_terminal', { cols: 80, rows: 24 })
// Returns: string (terminal ID)
```

**Behavior:**
- Opens a PTY pair
- Spawns `$SHELL -l` with `TERM=xterm-256color`
- Starts background reader thread for output
- Emits `pty://output` events as data arrives

### `write_terminal`

Write data to a terminal's stdin.

```js
invoke('write_terminal', { id: 'term-uuid', data: 'ls -la\n' })
```

### `resize_terminal`

Resize a terminal's PTY dimensions.

```js
invoke('resize_terminal', { id: 'term-uuid', cols: 120, rows: 40 })
```

### `close_terminal`

Kill a terminal's process and clean up.

```js
invoke('close_terminal', { id: 'term-uuid' })
```

## Events

### `pty://output`

Emitted when PTY has output data.

```js
listen('pty://output', (event) => {
  const { id, data } = event.payload
  // data is Uint8Array of terminal output
})
```

### `pty://exit`

Emitted when terminal process exits.

```js
listen('pty://exit', (event) => {
  const { id, code } = event.payload
  // code is the exit code (null if killed)
})
```

## Shell Integration

OSC 7 is supported for automatic CWD reporting:

- **Bash**: via `.bashrc` hook
- **Zsh**: via `.zshrc` hook

CWD is persisted across sessions for workspace restore.

## Related

- [Rust Shell Layer](../architecture/rust-shell.md) implementation
- [WebSocket PTY Protocol](./websocket-pty.md) fallback protocol
