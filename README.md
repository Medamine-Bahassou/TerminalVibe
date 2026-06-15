<p align="center">
  <img src="logo.png" alt="TerminalVibe" width="200">
</p>

<h1 align="center">TerminalVibe</h1>

<p align="center">A terminal multiplexer and desktop workspace app with integrated browser, built on Tauri 2.x.</p>

<p align="center">
  <img src="screenshots/main.png" alt="TerminalVibe - Main Interface" width="800">
</p>

## Features

- **Multi-workspace** - switch between independent workspace contexts via sidebar, with drag-and-drop reordering and color customization
- **Split panes** - recursive horizontal and vertical splits with drag-and-drop terminal reordering between panes
- **Tabbed groups** - each pane holds a tab bar for terminals or browser sessions
- **Built-in browser** - embedded web browsing with URL bar, navigation (back/forward/reload), history, and local file support
- **PDF viewer** - open PDFs directly in a tab via EmbedPDF
- **Image viewer** - display images inline in a browser tab
- **Background images** - set terminal background images in global or per-tab mode, with adjustable opacity
- **Shell integration** - automatic current working directory (CWD) reporting via OSC 7 for bash and zsh, persisted across sessions
- **Custom themes** - create, edit, import, and export themes with full color control (terminal palette + UI colors), with live preview
- **8 built-in themes** - Catppuccin Mocha/Latte, Dracula, Gruvbox, Tokyo Night, Nord, Solarized Dark, Monochrome
- **Configurable keyboard shortcuts** - rebind every shortcut from the Settings panel with conflict resolution
- **Per-terminal font zoom** - Ctrl+Scroll to scale individual terminals
- **Terminal search** - Ctrl+Shift+F with incremental search, next/previous navigation
- **Multi-select terminals** - Ctrl+Alt+Click to select multiple terminals
- **Right-click copy/paste** - context menu on terminal body for copy and paste
- **Directional pane navigation** - Alt+H/J/K/L to focus adjacent split panes
- **Persistent state** - layout, themes, settings, and open browser URLs persist across sessions (auto-save every 30s)
- **Frameless window** - custom titlebar with logo, sidebar toggle, and window controls (minimize/maximize/close)
- **Status bar** - shows active workspace, terminal name, terminal dimensions + font size, connection status, multi-select count, and real-time clock

<p align="center">
  <img src="screenshots/settings.png" alt="TerminalVibe - Settings" width="800">
</p>

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri 2.x (Rust) - PTY management via `portable-pty`, IPC, window control |
| Frontend | Vanilla JS (single IIFE), xterm.js 5.3 with WebGL renderer, no framework |
| Backend | Node.js - WebSocket PTY server (fallback), HTTP browser proxy, static server |

## Project Structure

```
├── app.js                  # Frontend UI logic (single IIFE)
├── index.html              # HTML entry point
├── style.css               # Styles
├── server.js               # Node.js backend (PTY WebSocket server + HTTP browser proxy)
├── vendor/                 # Vendored xterm.js addons, Coloris, EmbedPDF assets
├── dist/                   # Build output
├── server-dist/            # Bundled server for Tauri
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs          # Setup, PTY spawn, IPC commands
│   │   └── pty.rs          # portable-pty integration with OSC 7 shell integration
│   ├── Cargo.toml
│   └── tauri.conf.json
└── ARCHITECTURE.md         # Detailed architecture docs
```

## Prerequisites

- Rust toolchain (rustup)
- Node.js 18+
- npm
- Linux: `GDK_BACKEND=x11` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` may be needed for dev

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Outputs the frontend bundle to `dist/` and produces a Linux AppImage via Tauri CLI.

