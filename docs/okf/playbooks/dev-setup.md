---
type: Playbook
title: Development Setup
description: Prerequisites and instructions for running TerminalVibe in development mode.
tags: [development, setup, prerequisites]
timestamp: 2026-08-15T00:00:00Z
---

# Development Setup

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | LTS recommended |
| npm | Latest | Comes with Node.js |

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd terminal3
npm install

# Start Electron dev mode (native PTY)
npm run electron:dev

# Or browser dev mode (Node backend)
npm run dev
```

## What Happens

**Electron dev mode (`npm run electron:dev`):**

1. `electron/dev-server.js` serves the frontend on port 7769
2. Electron opens the app, PTY runs natively via node-pty in the main process

**Browser dev mode (`npm run dev`):**

1. `server.js` starts on ports 7681/7682/6969
2. Frontend loads in the browser and connects over WebSocket

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

### App blank

- Check the Electron console for errors (F12 to toggle DevTools)
- Verify the dev server is running on port 7769

### PTY not connecting

- See [Debugging PTY Issues](./debug-pty.md)

## Related

- [Build & Release](./build-release.md) for production builds
- [Node Backend](../architecture/node-backend.md) port details
