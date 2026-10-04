<p align="center">
  <img src="logo.png" alt="TerminalVibe" width="200">
</p>

<h1 align="center">TerminalVibe</h1>

<p align="center">A terminal multiplexer and desktop workspace app with integrated browser, built on Electron.</p>

<p align="center">
  <img src="screenshots/splits.png" alt="TerminalVibe - Split panes and workspaces" width="800">
</p>

## Features

- **Profiles** - isolated per-profile state with a launch picker, default profile badge, and in-place switching (`Ctrl+Shift+P`)
- **Right sidebar** - resizable panel with a clipboard history widget, toggled from the titlebar
- **Tab search & maximize** - `Ctrl+Shift+O` to jump to any tab, `Ctrl+Shift+M` to maximize/restore a tab
- **Multi-workspace** - switch between independent workspace contexts via sidebar, with drag-and-drop reordering and color customization
- **Split panes** - recursive horizontal and vertical splits with drag-and-drop terminal reordering between panes
- **Tabbed groups** - each pane holds a tab bar for terminals or browser sessions
- **Built-in browser** - embedded web browsing with URL bar, navigation (back/forward/reload), history, and local file support
- **PDF viewer** - open PDFs directly in a tab via the browser's native viewer
- **Image viewer** - display images inline in a browser tab via the browser's native viewer
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
- **Plugin system** - drop a plugin folder into `~/.terminalvibe/plugins/` to add commands, keybindings, terminal lifecycle hooks, context-menu items, themes, settings sections, and UI widgets (see [docs/plugin-development.md](docs/plugin-development.md))
- **Frameless window** - custom titlebar with logo, sidebar toggle, and window controls (minimize/maximize/close)
- **Status bar** - shows active workspace, terminal name, terminal dimensions + font size, connection status, multi-select count, and real-time clock
- **Command line** - launch workspaces and build terminal/browser layouts from the terminal: `new`, `create` (YAML), `list`, `close`, `attach` (see [docs/cli.md](docs/cli.md))

## Screenshots

### Workspaces, split panes and tabs
<p align="center">
  <img src="screenshots/splits.png" alt="TerminalVibe - Split panes and workspaces" width="800">
</p>

### Running AI coding agents
<p align="center">
  <img src="screenshots/claude.png" alt="TerminalVibe - Running Claude Code in the terminal" width="800">
</p>

### Built-in browser
Browser tabs live next to terminals in the same pane.

<p align="center">
  <img src="screenshots/browser.png" alt="TerminalVibe - Terminals and a browser tab in split panes" width="800">
</p>

<p align="center">
  <img src="screenshots/youtube.png" alt="TerminalVibe - Built-in browser playing YouTube" width="800">
</p>

### Right sidebar with clipboard history
<p align="center">
  <img src="screenshots/right-sidebar.png" alt="TerminalVibe - Right sidebar panel" width="800">
</p>

### Profiles
<p align="center">
  <img src="screenshots/profiles.png" alt="TerminalVibe - Profile picker" width="800">
</p>

### Settings
Sections: Appearance, Terminal, Shortcuts, Theme Editor, Plugins, Advanced.

<p align="center">
  <img src="screenshots/settings.png" alt="TerminalVibe - Settings" width="800">
</p>

### Rebindable keyboard shortcuts
<p align="center">
  <img src="screenshots/shortcuts.png" alt="TerminalVibe - Keyboard shortcuts settings" width="800">
</p>

### Theme editor
<p align="center">
  <img src="screenshots/theme-editor.png" alt="TerminalVibe - Theme editor" width="800">
</p>

### Background images
<p align="center">
  <img src="screenshots/background.png" alt="TerminalVibe - Terminal background image" width="800">
</p>

## Default Keyboard Shortcuts

All shortcuts are rebindable in Settings → Shortcuts.

| Action | Shortcut |
|--------|----------|
| New terminal / close terminal | `Ctrl+Shift+T` / `Ctrl+Shift+W` |
| Split horizontal / vertical | `Ctrl+Shift+D` / `Ctrl+Shift+E` |
| New browser tab | `Ctrl+Shift+B` |
| Search in terminal / search tabs | `Ctrl+Shift+F` / `Ctrl+Shift+O` |
| Copy / paste | `Ctrl+Shift+C` / `Ctrl+Shift+V` |
| Next / previous tab | `Ctrl+PageDown` / `Ctrl+PageUp` |
| Next / previous workspace | `Ctrl+Shift+PageDown` / `Ctrl+Shift+PageUp` |
| Jump to workspace N | `Alt+1` … `Alt+9` |
| Focus adjacent pane | `Alt+H/J/K/L` |
| Multi-select terminals | `Ctrl+Alt+Click` |
| Maximize / restore tab | `Ctrl+Shift+M` |
| Profiles | `Ctrl+Shift+P` |
| Toggle sidebar | `Ctrl+Shift+S` |
| Quit | `Ctrl+Shift+Q` |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron - PTY management via `node-pty` in the main process, IPC, window control |
| Frontend | Vanilla JS (single IIFE), xterm.js 5.3 with WebGL renderer, no framework |
| Backend | Node.js - WebSocket PTY server (browser dev mode), HTTP browser proxy, static server |

## Project Structure

```
├── app.js                  # Frontend UI logic (single IIFE)
├── index.html              # HTML entry point
├── style.css               # Styles
├── server.js               # Node.js backend (browser dev mode: PTY WS + HTTP proxy)
├── electron/
│   ├── main.js             # Main process: node-pty PTY, WebContentsView browser tabs
│   └── preload.js          # contextBridge IPC API
├── vendor/                 # Vendored xterm.js addons, Coloris assets
├── examples/               # Example plugins (see docs/plugin-development.md)
├── dist/                   # Build output
└── ARCHITECTURE.md         # Detailed architecture docs
```

## Prerequisites

- Node.js 18+
- npm

## Development

```bash
npm install
npm run dev            # browser dev mode (Node backend on ports 7681/7682/6969)
npm run electron:dev   # Electron dev mode (native PTY via node-pty)
```

## Build

```bash
npm run build
```

Outputs the frontend bundle to `dist/` and produces Linux packages (AppImage / dir) via electron-builder.
