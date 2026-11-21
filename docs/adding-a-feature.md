# Adding a Feature to TerminalVibe

Brief recipe for built-in features.

## Where things live

| Layer | Files | Owns |
|---|---|---|
| UI + state | `app.js` (one IIFE), `index.html`, `style.css` | Workspaces, splits, tabs, settings pages |
| Desktop shell | `electron/main.js`, `electron/preload.js` | PTY (`node-pty`), browser views, `~/.terminalvibe/` config IPC |
| Browser dev mode | `server.js` | WS PTY (7681) + static server (6969); **not** used by the packaged app |
| Build | `scripts/build-dist.js` | Copies `index.html`/`app.js`/`style.css` → `dist/` |

`app.js` is vanilla JS: module-level `let` state, `render*()` DOM updates,
`saveState()`/`restoreState()` persistence. No framework.

## Recipe

1. **State** — add a `let` near the related state in `app.js`, include it in
   `saveState()`/`restoreState()` (and `restoreSettingsOnly()` if the
   Settings window needs it).
2. **Render** — add a `render*()`/`apply*()` function; call it from boot and
   from every mutation site. Reuse existing CSS variables for theming.
3. **Wire UI** — Settings row in `index.html` + listener in `app.js`
   (search for `set-theme` for the canonical pattern). Keyboard action?
   Add to `DEFAULT_SHORTCUTS` + `SHORTCUT_LABELS` + the keydown handler.
4. **Cross-window** — if Settings edits it, the main window picks it up via
   `settings:changed` → `restoreSettingsOnly()` → `apply*()`.
5. **Native needs?** — PTY/filesystem/shell belongs in `electron/main.js`
   behind an IPC handler + a `preload.js` bridge method (never Node APIs in
   the renderer).

## Verify & ship

```bash
node --check app.js electron/main.js   # syntax
npm test                               # CLI tests
npm run electron:dev                   # manual check (native PTY)
npm run build                          # dist/ + packaged Linux builds
```
