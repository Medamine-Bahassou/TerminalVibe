---
type: Playbook
title: Build & Release
description: Building the production AppImage and bundling the frontend assets.
tags: [build, release, appimage, bundling]
timestamp: 2026-08-15T00:00:00Z
---

# Build & Release

## Build Command

```bash
npm run build
```

## What Happens

1. **Frontend bundle** — `scripts/build-dist.js` outputs to `dist/`
2. **Package** — `electron-builder` produces a Linux AppImage and `dir` build

## Output Structure

```
dist/                    # Frontend bundle (HTML, JS, CSS, assets)
release/                 # electron-builder output
```

## Bundle Resources

`package.json` `build.files` includes `electron/**/*`, `dist/**/*`, and `node_modules/node-pty/**/*`. Extra resources (`logo.png`, `logo-app.svg`) are copied in.

## Production Ports

| Service | Port |
|---------|------|
| PTY WebSocket | 7681 |
| Browser Proxy | 7682 |
| Static Server | 6969 |

## Related

- [Development Setup](./dev-setup.md) for dev mode
- [Node Backend](../architecture/node-backend.md) server roles
