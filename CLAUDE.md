# TerminalVibe

Electron terminal multiplexer with workspaces, split panes, tab groups and embedded browser tabs. Vanilla JS, no framework, no bundler. Deeper architecture notes are in `ARCHITECTURE.md`. Feature recipes are in `docs/adding-a-feature.md`.

## Commands

```bash
npm run electron:dev     # desktop app + dev server (main-process changes need a full restart)
npm start                # browser mode: node server.js → http://localhost:6969
node scripts/build-dist.js   # copy frontend into dist/ — run after every frontend edit
npm test                 # CLI, agent control, servers, shell startup, sessions
npm run test:browser     # browser-pane resize + snapshot
node --check app.js      # quick syntax check (no linter/type checker in this repo)
```

## Layout

| File | Role |
|---|---|
| `index.html` | Static markup: titlebar, sidebar, modals, settings (Tailwind CDN utility classes) |
| `app.js` | All renderer logic in one IIFE: state, layout, terminals, browser tabs, settings, menus |
| `session-drawer.js` | Claude sessions history drawer |
| `proc-icons.js` | Generated brand logo paths (from `simple-icons`) for running processes |
| `style.css` | Original base styles (layout, behavior). Edit it rarely. |
| `workspace.css` | **Design system + redesign overrides. All visual work goes here.** Loaded after `style.css`. |
| `electron/main.js` / `preload.js` | Main process: PTYs, IPC, native menus, windows. `preload.js` is the `window.electronAPI` bridge |
| `electron/proc.js` | Detects the foreground process in a PTY (`/proc` on Linux) |
| `server.js` | Browser-mode backend (WebSocket PTY server, proxy) |
| `fonts/` | Geist Sans / Geist Mono woff2 (copied to `dist/fonts`) |

When you add a new frontend file, add it to `index.html` **and** to the `assets` list in `scripts/build-dist.js`. Otherwise the packaged app won't ship it.

Desktop-only features check `window.electronAPI?.x` and fall back to browser mode. For example, `showCtxMenu` builds DOM `.ctx-item`s. Electron shows them as a native `Menu` through `context-menu:popup`, and browser mode shows the HTML menu.

## Design system

The look is a quiet, premium dark UI in the spirit of Linear, Warp and Cursor. Keep every new surface consistent with it.

### Tokens (`workspace.css` `:root`). Never hard-code colors.

| Token | Use |
|---|---|
| `--bg` `--fg` | App background / primary text (theme-driven, can change at runtime) |
| `--ui-sidebar` | Sidebar, drawers, cards |
| `--ui-surface` | Elevated surfaces: modals, tiles |
| `--ui-hover` | Hover background, and the selected row in menus/dropdowns |
| `--ui-active` | Active/selected nav item (accent-tinted) |
| `--border` | Control borders (inputs, buttons, popovers) |
| `--ui-line` | Hairline dividers between rows/sections |
| `--muted-text` / `--dim-text` | Secondary / tertiary text, icons |
| `--accent` / `--accent-dim` | Focus, primary action, active indicators. Use sparingly. |
| `--ui-success` `--ui-error` | Status (running, destructive) |
| `--ui-font` / `--mono-font` | Geist Sans for UI, Geist Mono for paths, keys, ports, code |
| `--ui-radius` | 6px control radius |

Themes override `--bg/--fg/--accent/--border/...`, so derive new colors with `color-mix(in srgb, …)` from tokens.

### Corners: important

`body.roundless` is always on. `style.css` sets `border-radius: 0 !important` on everything. The "Corner style" setting was removed. Components that should be rounded opt back in with `!important`:

```css
body #sidebar.expanded .ws-btn { border-radius:6px !important; }
```

- Popovers / menus / dropdowns: `var(--ui-radius)` (cards 10px, modals 12px)
- Items inside them, buttons, inputs: 6px. Keycaps/badges: 4px. Switches, avatars, status icons: `50%` / `9999px`
- The **collapsed** sidebar stays square on purpose. Scope rounding to `#sidebar.expanded`.

### Typography

- UI text 13px / weight 400. Labels and row titles weight 500. Headings 600 (dialog title 15px, settings section 14px).
- Secondary text 12px, metadata 11–11.5px. Weights only 400/500/600.
- **No uppercase + letter-spacing labels.** Override Tailwind `uppercase tracking-*` headings back to sentence case.
- Never apply UI font, letter-spacing or line-height rules to `.xterm`. Terminal font settings are separate (user settings).

### Spacing and sizes (4px grid)

- Controls: inputs 32–36px, buttons 32px, menu rows 32px, sidebar rows ≥ 40px, icon buttons 28–30px.
- Popover padding 4px, items `6–8px` × `8–10px`. Card rows `14px 16px`. Dialog padding 20px.

### Component patterns (copy these)

- **Popover / menu / dropdown**: `background:var(--bg); border:1px solid var(--border); border-radius:var(--ui-radius) !important; padding:4px; box-shadow:0 8px 24px #0005;` Items are rounded 6px. Hover/selected use `var(--ui-hover)`, with no accent tint and no checkmark. Open it detached, 6–8px below the trigger and left-aligned.
- **Input**: `height:34px; background:var(--bg); border:1px solid var(--border);` hover `border-color:var(--muted-text)`. Focus: `outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)`. Never stack an outline on top of a border.
- **Search field**: wrapper with a 14px `ph-magnifying-glass` icon at left 10–12px, a padded input, and an optional `kbd` hint in mono 10.5px.
- **Buttons**: secondary is transparent + `--border` with `--ui-hover` on hover. Primary is `--accent` fill, text `#0d1017`, hover `color-mix(in srgb,var(--accent) 85%,#fff)`. Destructive uses `--ui-error`.
- **Focus ring (buttons/checkboxes)**: `box-shadow:0 0 0 2px <surface>, 0 0 0 4px color-mix(in srgb,var(--accent) 60%,transparent)`.
- **Lists**: solid `--ui-line` hairlines (never dashed). Rows highlight on hover with a rounded background.
- **Badges / counts**: quiet. Use transparent or `--ui-hover` with `--dim-text`, and tabular numbers.
- **Icons**: Phosphor (`<i class="ph ph-…">`, CDN) at 14–16px in `--muted-text`, brightening to `--fg` on hover. Process/server logos come from `procIconHtml(name, fallback)` in `app.js`.
- **Status**: show state with a real icon (`ph-check-circle`, `ph-warning-circle`, a spinning `ph-circle-notch`) tinted `--ui-success` or `--ui-error`. **Never** use colored dots or glow rings, and avoid labelled pills as state badges. A maximized pane is shown with an accent frame around the pane.
- **Checkbox**: custom `appearance:none` 16px box with 4px radius (see `.cc-dont-again input`).
- **Motion**: transitions 120–180ms on `background-color, color, border-color, box-shadow` only. Respect `prefers-reduced-motion`. No animations on terminal paths.

### Where to put styles

1. Add a commented block **at the end of `workspace.css`** that is scoped to the component (`#settings-modal …`, `body #sidebar …`, `.session-drawer …`).
2. Use `body`/ID prefixes or `!important` only to beat `style.css`, the `roundless` reset, or Tailwind classes in `index.html`. Don't refactor `style.css`.
3. Prefer CSS over JS. When JS builds markup, give it semantic class names (not Tailwind strings) so `workspace.css` can style it.
4. Rebuild with `node scripts/build-dist.js`, then check it in the app at narrow and wide window sizes.

## Gotchas

- Browser tabs are `<webview>` overlays positioned by `syncBrowserSlots()`. Keep resize syncing in the same frame (ResizeObserver callback, not rAF). `settleBrowserSurfaces()` fixes stale guest widths after a resize.
- Workspace running-process list: `refreshAllWorkspaceProcs()` polls every 1s, and `refreshWorkspaceProcsSoon()` runs on Enter/Ctrl+C/Ctrl+D.
- Settings dropdowns are custom (`initCustomDropdown`) over a hidden native `<select class="native-select-hidden">`.
