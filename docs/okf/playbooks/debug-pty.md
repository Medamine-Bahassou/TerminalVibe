---
type: Playbook
title: Debugging PTY Issues
description: Troubleshooting terminal session creation, output, and lifecycle problems.
tags: [debugging, pty, terminal, troubleshooting]
timestamp: 2026-06-19T00:00:00Z
---

# Debugging PTY Issues

## Symptom: Terminal Not Creating

### Check Rust-side (Tauri mode)

1. Verify `tauriPtyReady` flag is `true` in frontend
2. Check Rust console for `create_terminal` errors
3. Ensure `$SHELL` environment variable is set

### Check Node-side (WebSocket mode)

1. Verify WebSocket connection to port 7681/7781
2. Check for `create` frame errors in server logs
3. Ensure `node-pty` is installed: `ls node_modules/node-pty`

## Symptom: No Output

### Check PTY output path

**Tauri mode:**
```
PTY master read → background thread → app.emit('pty://output', {id, data})
```

**WebSocket mode:**
```
PTY master read → ws.send(binary frame [sessionId][output])
```

### Debug steps

1. Add console.log in `pty://output` listener
2. Check if data arrives but xterm doesn't render
3. Verify xterm.js terminal is attached to DOM

## Symptom: Terminal Hangs on Exit

### Check close sequence

1. `close_terminal` kills child process
2. Background thread should emit `pty://exit`
3. Frontend should dispose xterm and remove entry

### Debug steps

1. Check if `pty://exit` event fires
2. Verify child process is actually killed
3. Check for zombie processes: `ps aux | grep <shell>`

## Symptom: CWD Not Persisting

### OSC 7 Integration

CWD is reported via OSC 7 escape sequence:

- **Bash**: Hook in `.bashrc`
- **Zsh**: Hook in `.zshrc`

### Debug steps

1. Check if OSC 7 is enabled in shell config
2. Verify `cwd` field updates in TerminalEntry
3. Check localStorage for saved state

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Port in use | Previous server didn't clean up | Kill lingering node processes |
| Permission denied | PTY spawn failed | Check shell permissions |
| Blank terminal | xterm not attached | Verify DOM attachment |
| Slow output | Large scrollback | Reduce scrollback buffer |

## Related

- [Tauri IPC Commands](../api/tauri-ipc.md) command reference
- [WebSocket PTY Protocol](../api/websocket-pty.md) protocol details
- [Rust Shell Layer](../architecture/rust-shell.md) implementation
