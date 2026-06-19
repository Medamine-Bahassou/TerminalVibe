---
type: Architecture Layer
title: Node.js Backend
description: WebSocket PTY server, HTTP browser proxy with caching, and static file server for browser mode.
tags: [nodejs, websocket, proxy, backend]
resource: server.js
timestamp: 2026-06-19T00:00:00Z
---

# Node.js Backend

Spawned by the Rust shell, `server.js` serves three roles: WebSocket PTY server, HTTP browser proxy, and static app server.

## Roles

### A. WebSocket PTY Server (port 7681)

- Uses `node-pty` for PTY sessions keyed by `sessionId` (UUID)
- Client → Server: JSON control frames `{type:'create'|'resize'|'close', ...}`
- Server → Client: Binary frames `[36-byte termId][pty output bytes]`

### B. HTTP Browser Proxy (port 7682)

Transparent HTTP proxy for embedded browser tabs:

- Strips framing / CSP / X-Frame-Options headers
- Rewrites HTML, CSS, JS URLs to proxy paths
- Injects service worker for fetch interception
- Serves proxied content under `/p/<base64url>/`
- On-disk LRU cache (512 MB default)
- DNS cache (30s TTL)
- WebSocket upgrade support

### C. Static App Server (port 6969)

- Serves bundled frontend from `dist/`
- Used only in browser dev mode (outside Tauri)

## Key Abstractions

| Abstraction | Description |
|-------------|-------------|
| PTYSession | Node-side PTY session wrapper |
| DiskCache | On-disk LRU cache for proxied HTTP responses |
| Proxy rewrite | HTML/CSS/JS/URL rewriter for transparent proxying |

## Related

- [WebSocket PTY Protocol](../api/websocket-pty.md) detailed protocol
- [Browser Proxy Protocol](../api/browser-proxy.md) proxy details
- [Rust Shell Layer](./rust-shell.md) spawns this backend
