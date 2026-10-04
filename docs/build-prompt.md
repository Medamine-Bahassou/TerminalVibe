# Build Prompt: TerminalVibe

Build **TerminalVibe**, a terminal multiplexer and desktop workspace app for Linux, built on Electron with a custom HTML/CSS/JS frontend (no framework). Single-window, frameless, VS Code-inspired UI.

## Stack

- Electron (main process owns everything native), node-pty in main over IPC
- Frontend: vanilla JS + xterm.js (fit, search, web-links, unicode11, image, WebGL renderer)
- split.js only for sidebar/main split; terminal splits use a custom `.sash` implementation
- State persisted as JSON under `~/.terminalvibe/` (auto-save every 30s): workspaces, layout, themes, settings, browser history, profiles
- Icons: Phosphor font via CDN (`<i class="ph ph-*">`), never inline SVG or unicode glyphs
- No CSS transitions/animations — snappy UI only

## Core features

### Terminals & layout
- Multi-workspace: independent workspace contexts in a left sidebar, drag-and-drop reordering, per-workspace colors; sidebar is VS Code-style auto-hide dock (8px sliver, hover reveals, pinnable from titlebar)
- Recursive horizontal/vertical splits with custom sashes; min pane width enforced; maximize/minimize pane arrangements
- Each pane has a tab bar holding terminals AND browser sessions (mixed); drag terminals between panes to reorder/reparent
- Directional pane navigation Alt+H/J/K/L; Ctrl+Alt+Click multi-select of terminals; per-terminal font zoom via Ctrl+Scroll
- Terminal search (Ctrl+Shift+F, incremental, next/prev), right-click copy/paste context menu
- Shell integration via OSC 7 CWD reporting (bash/zsh), persisted across sessions; tab titles show folder name only; new tabs inherit the previous tab's label
- Background images for terminals (global or per-tab mode) with opacity control
- Desktop notification when a long-running command finishes: detected in the Electron MAIN process by watching /proc busy→idle transitions, gated on app focus, toggleable in Settings → Advanced (default ON)
- Middle-click paste confined to terminals only (suppressed everywhere else in the UI)

### Built-in browser
- Embedded browsing using native WebContentsView (NOT `<webview>`, NOT iframe+proxy) attached per tab, with URL bar, back/forward/reload, history, local file support
- PDF viewer and image viewer tabs via the browser's native rendering

### Right sidebar & status bar
- Resizable right sidebar (custom drag handle, not Split.js) toggled from titlebar
- Status bar: active workspace, terminal name, dimensions + font size, connection status, multi-select count, live clock

### Themes & appearance
- Theme engine: 8 built-in themes (Catppuccin Mocha/Latte, Dracula, Gruvbox, Tokyo Night, Nord, Solarized Dark, Monochrome) plus create/edit/import/export with full color control (terminal palette + UI vars), live preview
- Desktop-overview theme switcher (Ctrl+Shift+K): mirrors real workspace tiling with mock windows at scaled actual positions; arrows cycle, Enter applies, Escape closes — never live-applies while previewing

### Profiles
- Per-profile isolated state (`~/.terminalvibe/profiles/<id>.json`); launch picker with kebab edit/delete; in-place switching without reload; default profile badge + set-default in context menu; arrows in profile page to switch between profiles

### Settings
- Settings is a full PAGE (never a modal), VS Code/Linear style. Sections include Appearance, Keyboard Shortcuts, Advanced
- Every keyboard shortcut rebindable with conflict resolution, per-shortcut reset, Escape-to-clear, shortcuts can be disabled entirely. All new shortcut features must plug into this system (DEFAULT_SHORTCUTS/customShortcuts/matchShortcut), never hardcoded
- Setting behavior must match its label exactly (e.g., transparency slider higher = more transparent)

### Plugin system
- Drop-in folder at `~/.terminalvibe/plugins/` with `plugin.json` manifest + entry file
- API surface: commands + keybindings, terminal lifecycle hooks, context-menu items, themes, configurable settings sections, UI widgets, read-only state access
- Static HTML documentation pages under `docs/plugins/html/` sharing nav/docs.css and a docs-search input

### CLI
- Subcommand grammar: `new | create | list | close | attach`; tab spec `name:type:cmd_or_url`; flags `-t/-s v|h/--split-back/--workspace`; YAML batch create via `-f`; headless subcommands skip window creation; documented in `docs/cli.md`

### Window chrome
- Frameless window, custom titlebar: logo, sidebar toggle, profile switcher, right-sidebar toggle, spacer sized to the NATIVE min/max/close overlay (never margin hacks), native window controls
- Version exposed as a single shared `APP_VERSION` constant, referenced app-wide
- Packaged as AppImage via electron-builder; releases published to GitHub with bare version tags

## Non-negotiable behaviors / known traps

- Run `node scripts/build-vendor.js` then rebuild `dist/` after source edits — stale dist is a recurring failure mode
- WebGL contexts are capped (~16) by Chromium: attach the WebGL addon only to VISIBLE terminals, dispose when hidden, never one per terminal at creation
- Terminal background must be seamless: sashes/gutters use var(--bg), transparent only over a bg image; viewport matches canvas color
- Browser tab slots use `display: flex`
- Scrollbars: tab bar always visible (x-small); xterm viewport scrollbar shown on hover when overflowing
- Never read sessionStorage on the boot path (cold-start stall)
- Centralized reusable CSS classes for design tokens (radius etc.) as single points of control

## Deliverables

Working Electron app: `npm run dev` for development, `npm run build:appimage` for packaging, CLI binary, plugin docs, and README with screenshots.
