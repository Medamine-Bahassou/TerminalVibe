# TerminalVibe Architecture

## Overview

TerminalVibe is a terminal multiplexer / desktop app built with **Tauri 2** (Rust shell + WebView frontend). It supports multiple workspaces, split panes, tabbed terminal groups, and embedded browser tabs, all backed by PTY sessions.

The app has three distinct layers:

```
┌─────────────────────────────────────────────┐
│  Frontend (index.html + app.js + style.css) │
│  xterm.js + vanilla JS state management     │
└──────────────────┬──────────────────────────┘
                   │  Tauri invoke / events
┌──────────────────▼──────────────────────────┐
│  Rust Shell (src-tauri/src/)               │
│  - PtyManager (portable-pty)                │
│  - Spawns Node.js backend                   │
└──────────────────┬──────────────────────────┘
                   │  child process
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

1. **Tauri Native PTY** (preferred in desktop builds):
   - Commands: `create_terminal`, `write_terminal`, `resize_terminal`, `close_terminal`
   - Events: `pty://output`, `pty://exit`
   - Flag: `tauriPtyReady = true`

2. **Node.js WebSocket PTY** (fallback / browser mode):
   - WebSocket on `ws://127.0.0.1:7681`
   - Binary frames: `[36-byte termId][pty bytes...]`
   - JSON control frames: `{type:'create'|'resize'|'close', ...}`

`sendStdin()` and `sendControl()` branch on `isTauri() && tauriPryReady`.

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

---

## Layer 2 — Rust Shell (`src-tauri/src/`)

### `main.rs`

Minimal entry point: calls `terminalvibe::run()`.

### `lib.rs`

- Registers Tauri commands: `create_terminal`, `write_terminal`, `resize_terminal`, `close_terminal`.
- Manages two pieces of state:
  - `PtyManager` — native PTY sessions
  - `Mutex<Option<Child>>` — the Node.js server process
- `setup()` spawns `node server.js`:
  - In dev: ports 7781/7782/7769
  - In prod: ports 7681/7682/6969
- `on_window_event(Destroyed)` kills all PTY sessions and the Node server.

### `pty.rs` — `PtyManager`

- Uses `portable-pty` + `parking_lot::Mutex<HashMap<String, PtySession>>`
- `PtySession` holds `writer`, `master`, `child` (killable)
- `create_terminal()`:
  - Opens a PTY pair, spawns the user's `$SHELL -l` with `TERM=xterm-256color`
  - Spawns a background thread that reads master output and emits `pty://output` events
  - On EOF / error, emits `pty://exit` with the exit code
- `write()`, `resize()`, `close()`, `close_all()` are straightforward wrappers

### `tauri.conf.json`

- Custom frameless window (1200×684, min 600×400)
- `beforeDevCommand` copies static assets to `dist/` with a hot-reload loop
- `beforeBuildCommand` bundles `server.js` + `node_modules/ws` + `node-pty` into `server-dist/`
- Resources: `server-dist/*` is bundled into the AppImage

---

## Layer 3 — Node.js Backend (`server.js`)

The backend is spawned by the Rust shell and serves three roles:

### A. WebSocket PTY Server (port 7681 / 7781)

- Uses `node-pty` to create PTY sessions keyed by `sessionId` (UUID)
- WebSocket frames:
  - **Client → Server**: `{type:'create', id, cols, rows, cwd}` / `{type:'resize'|'close'}`
  - **Server → Client**: binary `[sessionId bytes][pty output bytes]`
- In Tauri mode the frontend prefers the native Rust PTY; the Node WS server exists for browser mode and as a fallback.

### B. HTTP Browser Proxy (port 7682 / 7782)

- Transparent HTTP proxy that:
  - Strips framing / CSP / X-Frame-Options headers
  - Rewrites HTML, CSS, and JS URLs to proxy paths
  - Injects a service worker (`SW_SCRIPT`) for fetch interception
  - Serves proxied content under `/p/<base64url>/`
- Upstream requests are cached on disk (`cache/` dir, 512 MB LRU by default)
- DNS results are cached for 30 s
- Handles WebSocket upgrades for proxied targets via `wsProxy`

### C. Static App Server (port 6969 / 7769)

- Serves the bundled frontend files from `dist/` (or `../dist` in dev)
- Used only when running outside Tauri (browser dev mode)

---

## Data Flow

### Terminal Input

```
User keystroke
  → xterm.onData
  → sendStdin(termId, bytes)
  → [Tauri] invoke('write_terminal', {id, data})
      → PtyManager.write() → PTY master writer
  → [WS] binary frame [termId][bytes] → server.js → node-pty writer
```

### Terminal Output

```
PTY master read
  → [Rust] background thread → app.emit('pty://output', {id, data})
      → frontend listener → xterm.write()
  → [Node] ws.send(binary frame)
      → frontend ws.onmessage → xterm.write()
```

### Browser Tab

```
addBrowserTab(url)
  → lazy iframe creation in getOrCreateSlot()
  → iframe.src = proxyPathUrl(url)  (e.g. /p/<b64>/)
  → HTTP proxy on 7682 rewrites + caches upstream content
  → syncBrowserSlots() positions container via transform3d
```

---

## Key Abstractions

| Concept | Location | Description |
|---|---|---|
| Workspace | `app.js` | Top-level container; one active at a time; sidebar buttons |
| Layout tree | `app.js` | Recursive `split` / `group` structure defining pane arrangement |
| Group | `app.js` | Tabbed container of terminals + optional browser tabs |
| TerminalEntry | `app.js` | Wrapper around xterm.js instance or browser iframe |
| PtyManager | `src-tauri/src/pty.rs` | Rust-side PTY session pool |
| PTYSession | `server.js` | Node-side PTY session wrapper |
| DiskCache | `server.js` | On-disk LRU cache for proxied HTTP responses |
| Proxy rewrite | `server.js` | HTML/CSS/JS/URL rewriter for transparent proxying |

---

## Build & Run

| Command | Effect |
|---|---|
| `npm run dev` | Starts Tauri in dev mode; Rust spawns Node on ports 7781/7782/7769 |
| `npm run build` | Bundles frontend + Node deps into `server-dist/`, builds AppImage |
| `npm start` | Runs Node backend standalone (browser mode, ports 7681/7682/6969) |

---

## Current Known Limitations (from TODO)

- PDF state (comments, scroll) via embedPDF is not persisted
- Multiple-select single command not implemented
- On startup PDF not loaded (browser tab restore issue)
- Split arrangement + maximize edge cases during minimize/restore
