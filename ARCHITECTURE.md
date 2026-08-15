# TerminalVibe Architecture

## Overview

TerminalVibe is a terminal multiplexer / desktop app built with **Electron** (Chromium shell + Node.js main process). It supports multiple workspaces, split panes, tabbed terminal groups, and embedded browser tabs, all backed by PTY sessions.

The app has three distinct layers:

```
┌─────────────────────────────────────────────┐
│  Frontend (index.html + app.js + style.css) │
│  xterm.js + vanilla JS state management     │
└──────────────────┬──────────────────────────┘
                   │  Electron IPC (preload bridge)
┌──────────────────▼──────────────────────────┐
│  Electron Shell (electron/main.js)          │
│  - node-pty PTY sessions (main process)     │
│  - WebContentsView browser tabs             │
│  - Settings / detached windows, config dir  │
└──────────────────┬──────────────────────────┘
                   │  (browser dev mode only)
┌──────────────────▼──────────────────────────┐
│  Node.js Backend (server.js)                │
│  - WebSocket PTY server (port 7681)         │
│  - HTTP browser proxy (port 7682)           │
│  - Static app server (port 6969)            │
└─────────────────────────────────────────────┘
```

---

## Layer 1 — Frontend (`index.html`, `app.js`, `style.css`)

All UI logic lives in a single IIFE in `app.js`. There is no framework; state is mutated in place and re-rendered by targeted DOM updates.

### State Model

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

TerminalEntry = {
  id, label, type: 'terminal' | 'browser',
  // terminal:
  term: xterm.Terminal, fit, search, el, cwd?, pending?, color?
  // browser:
  iframe?, browserContainer?, el, url, opened?, _suspendTimer?
}
```

Key state variables:
- `workspaces[]` + `activeWsId`
- `focusedSlotId`
- `_multiSelected: Set<termId>`
- `_wsDomCache: wsId -> DOM container` (workspace DOM is cached and shown/hidden)
- `currentThemeName`, `currentFontSize`, etc.

### Dual PTY Backend

The frontend talks to PTY sessions through **one of two backends**, selected at runtime:

1. **Electron Native PTY** (desktop builds):
   - IPC commands: `terminal:create`, `terminal:write`, `terminal:resize`, `terminal:close`
   - Events: `terminal:data`, `terminal:exit`
   - Flag: `nativePtyReady = true`

2. **Node.js WebSocket PTY** (browser dev mode):
   - WebSocket on `ws://127.0.0.1:7681`
   - Binary frames: `[36-byte termId][pty bytes...]`
   - JSON control frames: `{type:'create'|'resize'|'close', ...}`

`sendStdin()` and `sendControl()` branch on `isDesktop() && nativePtyReady`.

### Workspace / Split / Group Rendering

- `buildNodeDom(node, wsp)` recursively renders the layout tree:
  - `split` → flex container with `direction: row|column`, children sized by `sizes[]`
  - `group` → tab bar + body; only the active tab's slot is visible
- `renderPaneArea()` rebuilds the active workspace's DOM from the layout tree.
- `switchWorkspacePane()` shows the cached container for `activeWsId` and hides others.
- Browser slots use `transform: translate3d(...)` for positioning to avoid iframe reloads.
- Inactive workspaces' browser containers are pushed offscreen (`x: -9999`).

### Terminal Lifecycle

- `addTerminal(wsId, targetGroupId)` creates an `xterm.Terminal`, wires `onData` → `sendStdin`, appends to group.
- `addBrowserTab(wsId, targetGroupId, url)` creates an entry with `type: 'browser'`; the iframe is created lazily in `getOrCreateSlot`.
- `activateTerminal(wsId, termId)` updates tab active state, slot visibility, focus, and history stack.
- `removeTerminal(wsId, termId)` disposes xterm / kills iframe, removes from group, re-activates next tab.
- `toggleMaximizeTerminal` / `unmaximize` toggles `ws._maximizedGroupId` and re-renders.

### Persistence

- `saveState()` / `restoreState()` serialize to `localStorage['ghostterm-state-v2']`.
- Layout is serialized as JSON (splits + groups + terminal metadata). Browser URLs are persisted; terminal PTY state is not.
- Settings and themes persist to `~/.terminalvibe/` via Electron IPC (`config:*` handlers).

---

## Layer 2 — Electron Shell (`electron/`)

### `main.js`

- Creates the frameless main window (1200×684, min 600×400) with `titleBarOverlay`.
- Runs **node-pty in the main process**: `terminal:create/write/resize/close` IPC handlers keep a `Map<termId, IPty>`.
- Owns native **WebContentsView** browser tabs (`browser:create/show/hide/resize/navigate/...`), placed by renderer-reported bounds. These paint above the window DOM, so the settings window is a separate always-on-top `BrowserWindow`.
- Detach-to-window: `terminal:detach` spawns a child window that reuses the same running PTY; output is buffered (`detachedPending`) until the renderer attaches.
- IPC for external links, clipboard, local file resolution, and the `~/.terminalvibe/` config directory.

### `preload.js`

Exposes a sandboxed `electronAPI` bridge via `contextBridge`: terminal, browser, clipboard, settings-window, and config methods.

---

## Layer 3 — Node.js Backend (`server.js`)

Used only in **browser dev mode** (`npm start`). The Electron app does not spawn it — node-pty runs in Electron's main process instead.

### A. WebSocket PTY Server (port 7681)

- Uses `node-pty` to create PTY sessions keyed by `sessionId` (UUID)
- WebSocket frames:
  - **Client → Server**: `{type:'create', id, cols, rows, cwd}` / `{type:'resize'|'close'}`
  - **Server → Client**: binary `[sessionId bytes][pty output bytes]`

### B. HTTP Browser Proxy (port 7682)

- Transparent HTTP proxy that:
  - Strips framing / CSP / X-Frame-Options headers
  - Rewrites HTML, CSS, and JS URLs to proxy paths
  - Injects a service worker (`SW_SCRIPT`) for fetch interception
  - Serves proxied content under `/p/<base64url>/`
- Upstream requests are cached on disk (`cache/` dir, 512 MB LRU by default)
- DNS results are cached for 30 s
- Handles WebSocket upgrades for proxied targets via `wsProxy`

### C. Static App Server (port 6969)

- Serves the frontend files from `dist/` for browser dev mode.

---

## Data Flow

### Terminal Input

```
User keystroke
  → xterm.onData
  → sendStdin(termId, bytes)
  → [Electron] electronAPI.terminalWrite({id, data})
      → main process node-pty writer
  → [WS] binary frame [termId][bytes] → server.js → node-pty writer
```

### Terminal Output

```
PTY master read
  → [Electron] main process → webContents.send('terminal:data', {id, data})
      → preload onTerminalData → xterm.write()
  → [Node] ws.send(binary frame)
      → frontend ws.onmessage → xterm.write()
```

### Browser Tab

```
addBrowserTab(url)
  → native WebContentsView in main process (electron/main.js)
  → renderer reports slot bounds via syncBrowserSlots()
  → browser:create / browser:resize / browser:show
```

---

## Key Abstractions

| Concept | Location | Description |
|---|---|---|
| Workspace | `app.js` | Top-level container; one active at a time; sidebar buttons |
| Layout tree | `app.js` | Recursive `split` / `group` structure defining pane arrangement |
| Group | `app.js` | Tabbed container of terminals + optional browser tabs |
| TerminalEntry | `app.js` | Wrapper around xterm.js instance or browser tab |
| PtyManager | `electron/main.js` | Main-process `node-pty` session pool |
| PTYSession | `server.js` | Node-side PTY session wrapper (browser dev mode) |
| WebContentsView | `electron/main.js` | Native browser tab views owned by the main process |
| DiskCache | `server.js` | On-disk LRU cache for proxied HTTP responses |
| Proxy rewrite | `server.js` | HTML/CSS/JS/URL rewriter for transparent proxying |

---

## Build & Run

| Command | Effect |
|---|---|
| `npm run dev` | Starts the dev static server + `server.js` (browser mode) |
| `npm run electron:dev` | Dev server + Electron with native PTY |
| `npm run build` | Bundles frontend to `dist/`, produces Linux packages via electron-builder |
| `npm start` | Runs Node backend standalone (browser mode, ports 7681/7682/6969) |

---

## Current Known Limitations (from TODO)

- PDF state (comments, scroll) via embedPDF is not persisted
- Multiple-select single command not implemented
- On startup PDF not loaded (browser tab restore issue)
- Split arrangement + maximize edge cases during minimize/restore
