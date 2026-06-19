---
type: Architecture Layer
title: Frontend Layer
description: Vanilla JS + xterm.js UI with state management, workspace rendering, and dual PTY backend support.
tags: [frontend, xterm, vanilla-js, ui]
resource: app.js
timestamp: 2026-06-19T00:00:00Z
---

# Frontend Layer

All UI logic lives in a single IIFE in `app.js`. No framework — state is mutated in place and re-rendered by targeted DOM updates.

## Components

| File | Role |
|------|------|
| `index.html` | HTML entry point |
| `app.js` | Frontend UI logic (single IIFE) |
| `style.css` | Styles |

## Key Responsibilities

- **Workspace management** — Multiple workspaces with sidebar navigation, drag-and-drop reordering
- **Split pane rendering** — Recursive horizontal/vertical splits with sized children
- **Tabbed groups** — Each pane holds a tab bar for terminals or browser sessions
- **Terminal integration** — xterm.js 5.3 with WebGL renderer
- **Browser tabs** — Embedded web browsing via iframes with proxy support
- **Persistence** — Layout, themes, settings saved to localStorage

## State Model

```js
workspaces: [{
  id, label, color?, activeTermId, layout, _maximizedGroupId?
}]

layout = SplitNode | GroupNode

SplitNode = {
  type: 'split',
  id, direction: 'h' | 'v', sizes: [pct...], children: [layout...]
}

GroupNode = {
  type: 'group',
  id, activeTermId, _history: [termId...], terminals: [TerminalEntry...]
}
```

## Dual PTY Backend

The frontend branches on `isTauri() && tauriPtyReady`:

1. **Tauri Native PTY** — `invoke('write_terminal', ...)` / events
2. **Node.js WebSocket** — Binary frames on `ws://127.0.0.1:7681`

## Related

- [Rust Shell Layer](./rust-shell.md) provides Tauri native PTY
- [Node Backend](./node-backend.md) provides WebSocket PTY fallback
- [Frontend State Model](../api/frontend-state.md) detailed state reference
