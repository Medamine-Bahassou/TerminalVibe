---
type: Playbook
title: Build & Release
description: Building the production AppImage and bundling frontend + backend assets.
tags: [build, release, appimage, bundling]
timestamp: 2026-06-19T00:00:00Z
---

# Build & Release

## Build Command

```bash
npm run build
```

## What Happens

1. **Frontend bundle** — Outputs to `dist/`
2. **Server bundle** — Bundles `server.js` + `node_modules/ws` + `node-pty` into `server-dist/`
3. **AppImage** — Tauri CLI produces a Linux AppImage

## Output Structure

```
dist/                    # Frontend bundle (HTML, JS, CSS, assets)
server-dist/             # Bundled Node.js backend
  server.js
  node_modules/
src-tauri/target/release/
  bundle/appimage/       # AppImage output
```

## Bundle Resources

`tauri.conf.json` includes `server-dist/*` as resources, so the Node.js backend is bundled into the AppImage.

## Production Ports

| Service | Port |
|---------|------|
| PTY WebSocket | 7681 |
| Browser Proxy | 7682 |
| Static Server | 6969 |

## Related

- [Development Setup](./dev-setup.md) for dev mode
- [Node Backend](../architecture/node-backend.md) server roles
