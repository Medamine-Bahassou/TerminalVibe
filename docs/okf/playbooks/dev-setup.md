---
type: Playbook
title: Development Setup
description: Prerequisites and instructions for running TerminalVibe in development mode.
tags: [development, setup, prerequisites]
timestamp: 2026-06-19T00:00:00Z
---

# Development Setup

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Rust toolchain | Latest | Install via [rustup](https://rustup.rs/) |
| Node.js | 18+ | LTS recommended |
| npm | Latest | Comes with Node.js |
| Linux only | — | `GDK_BACKEND=x11` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` may be needed |

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd terminal3
npm install

# Start dev mode
npm run dev
```

## What Happens

1. Tauri starts in dev mode
2. Rust shell spawns Node.js backend on dev ports:
   - PTY WebSocket: 7781
   - Browser Proxy: 7782
   - Static Server: 7769
3. Frontend hot-reload loop copies assets to `dist/`
4. WebView opens with the app

## Linux-Specific

If the app doesn't render properly:

```bash
export GDK_BACKEND=x11
export WEBKIT_DISABLE_COMPOSITING_MODE=1
npm run dev
```

## Dev vs Prod Ports

| Service | Dev Port | Prod Port |
|---------|----------|-----------|
| PTY WebSocket | 7781 | 7681 |
| Browser Proxy | 7782 | 7682 |
| Static Server | 7769 | 6969 |

## Troubleshooting

### Node server won't start

- Check if ports are in use: `lsof -i :7781`
- Ensure `npm install` completed successfully

### WebView blank

- Check Rust console for errors
- Verify Node server is running on expected ports

### PTY not connecting

- See [Debugging PTY Issues](./debug-pty.md)

## Related

- [Build & Release](./build-release.md) for production builds
- [Node Backend](../architecture/node-backend.md) port details
