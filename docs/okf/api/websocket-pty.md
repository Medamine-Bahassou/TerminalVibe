---
type: API Reference
title: WebSocket PTY Protocol
description: Binary and JSON frames for PTY sessions over WebSocket, used as fallback or browser mode.
tags: [websocket, pty, protocol, fallback]
timestamp: 2026-06-19T00:00:00Z
---

# WebSocket PTY Protocol

WebSocket connection to `ws://127.0.0.1:7681` (prod) or `ws://127.0.0.1:7781` (dev).

## Connection

```js
const ws = new WebSocket('ws://127.0.0.1:7681')
ws.binaryType = 'arraybuffer'
```

## Client → Server (JSON Control Frames)

### Create Terminal

```json
{
  "type": "create",
  "id": "session-uuid",
  "cols": 80,
  "rows": 24,
  "cwd": "/home/user"
}
```

### Resize Terminal

```json
{
  "type": "resize",
  "id": "session-uuid",
  "cols": 120,
  "rows": 40
}
```

### Close Terminal

```json
{
  "type": "close",
  "id": "session-uuid"
}
```

### Write to Terminal

```json
{
  "type": "data",
  "id": "session-uuid",
  "data": "base64-encoded-bytes"
}
```

## Server → Client (Binary Frames)

Terminal output is sent as binary frames:

```
[0:35]  Session ID (36 bytes, UUID string)
[36:]   PTY output bytes
```

```js
ws.onmessage = (event) => {
  const buf = new Uint8Array(event.data)
  const sessionId = new TextDecoder().decode(buf.slice(0, 36))
  const output = buf.slice(36)
  // Write output to xterm.js
}
```

## Server → Client (JSON Events)

### Terminal Exit

```json
{
  "type": "exit",
  "id": "session-uuid",
  "code": 0
}
```

## Frame Size

- Session ID: fixed 36 bytes (UUID string)
- Output: variable length (remaining bytes)

## Related

- [Node Backend](../architecture/node-backend.md) implementation
- [Tauri IPC Commands](./tauri-ipc.md) preferred native protocol
