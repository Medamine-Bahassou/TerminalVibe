# TerminalVibe Plugin Development

TerminalVibe has an **Obsidian-style** plugin system: each plugin is a folder
with a manifest, a JS entry, and an optional stylesheet. TypeScript sources
compile down to the JS entry (same workflow as Obsidian). Plugins run in the
renderer (like zsh/VSCode plugins — same trust level as the app itself) and
can register commands, keybindings, terminal lifecycle hooks, context-menu
items, themes, terminal output, configurable settings, and UI widgets.

Two working examples:

- [`examples/hello-terminalvibe/`](../examples/hello-terminalvibe) — legacy
  style (`plugin.json` + `TerminalVibe.register`).
- [`examples/clock-obsidian/`](../examples/clock-obsidian) — Obsidian style
  (`manifest.json` + `Plugin` subclass + `styles.css` + `src/main.ts`).
- Type definitions for TS authors: [`examples/plugin-api.d.ts`](../examples/plugin-api.d.ts).

## How plugins are loaded

Each plugin is a directory in `~/.terminalvibe/plugins/<id>/` — the folder
name is the canonical id (as in Obsidian):

```
~/.terminalvibe/plugins/
  clock-obsidian/
    manifest.json     # manifest (or legacy plugin.json)
    main.js           # JS entry ("main" field, else main.js, else plugin.js)
    styles.css        # optional — auto-injected (or manifest "styles"/"css", else style.css)
    src/main.ts       # optional TS source (dev only, compiled to main.js)
```

At startup the app scans that directory for manifests. For each enabled
plugin it auto-injects the stylesheet (if any), evaluates the entry in the
renderer against a small global `TerminalVibe` namespace (with a CommonJS
`module`/`exports` shim, so bundled output works), and activates it with a
per-plugin API object.

Enable/disable state is persisted in `state.json` (`pluginStates`); config
values under `pluginConfigs`. Plugins are loaded in both the main window and
the Settings window, so config edits made in Settings apply live everywhere.
Toggling a plugin off/on in Settings reloads it — no restart needed (also
picks up code edits while developing).

### Manifest (`manifest.json`, or legacy `plugin.json`)

```json
{
  "id": "clock-obsidian",
  "name": "Clock",
  "version": "1.0.0",
  "minAppVersion": "0.5.10",
  "description": "What it does",
  "author": "You",
  "settings": [
    { "key": "greeting", "label": "Greeting", "type": "text", "default": "hello" },
    { "key": "style", "label": "Greeting color", "type": "select",
      "default": "green", "options": ["green", "yellow", "cyan"] }
  ]
}
```

Notes:

- `manifest.json` is preferred; `plugin.json` still works. Unknown fields
  (e.g. Obsidian's `fundingUrl`, `isDesktopOnly`) are ignored.
- The folder name wins over a manifest-level `"id"`.
- `"main"` overrides the entry filename; otherwise the loader probes
  `main.js`, then `plugin.js`.
- `"styles"` (or legacy `"css"`) overrides the stylesheet filename;
  otherwise the loader probes `styles.css`, then `style.css`.
- The optional `settings` array declares editable options; see
  [`docs/plugins/manifest.md`](./plugins/manifest.md) for the full schema.

### Entry file — three supported shapes

**1. Obsidian-style `Plugin` class (recommended for new plugins):**

```js
// main.js (CommonJS — e.g. compiled from src/main.ts)
class ClockPlugin extends TerminalVibe.Plugin {
  async onload() {
    this.addCommand({ id: 'greet', name: 'Greet', callback: () => { ... } });
    this.addStatusBarItem().textContent = new Date().toLocaleTimeString();
  }
  onunload() { /* cleanup */ }
}
module.exports = ClockPlugin;
```

`export default class … extends TerminalVibe.Plugin` (tsc/esbuild) works
too — both `module.exports = Cls` and `exports.default = Cls` are detected,
as is a plain `{ onload, onunload }` object.

**2. Legacy `TerminalVibe.register`:**

```js
TerminalVibe.register({
  id: 'my-plugin',
  activate(api) {
    // set up commands, hooks, menus, themes, settings, widgets
  },
  deactivate() {
    // undo — called on unload/reload
  }
});
```

**3. `module.exports = { activate, deactivate }`** — same contract as (2).

For `register`, `id` should match the directory name; on mismatch the folder
name is used and a warning is logged.

## The `api` object

Passed to `activate(api)` — and available as `this.api` inside a
`TerminalVibe.Plugin` subclass. Everything below works in both styles; the
`Plugin` class just adds Obsidian-flavoured sugar on top:

| `Plugin` helper | Equivalent `api` call |
|---|---|
| `this.addCommand({ id, name, callback, hotkeys? })` | `api.commands.register({ id, label, combo, handler })` |
| `this.addStatusBarItem()` → element | `api.ui.addWidget({ position: 'statusbar', el })` |
| `this.addRibbonIcon(icon, title, cb)` → button | `api.ui.addWidget({ position: 'sidebar', el })` |
| `this.registerEvent(ev, cb)` | `api.events.on(ev, cb)` (auto-removed on unload either way) |
| `await this.loadData()` / `await this.saveData(obj)` | `api.config.all()` / `api.config.set(k, v)` |

`addCommand` accepts our `combo: { ctrl, shift, alt, meta, key }` or
Obsidian's `hotkeys: [{ modifiers: ['Ctrl','Shift'], key: 'H' }]` (first entry
wins). Command ids without a `:` are auto-prefixed with `<pluginId>:`.

### Identity & logging

- `api.id`, `api.name`, `api.version` — from the manifest.
- `api.log(...args)` — logs with a `[plugin:<id>]` prefix.

### Commands + keybindings

```js
api.commands.register({
  id: 'my-plugin.greet',           // unique command id
  label: 'Greet in active terminal',
  combo: { ctrl: true, shift: true, key: 'H' }, // optional keybinding
  handler() { ... }
});
api.commands.unregister('my-plugin.greet');   // remove
api.commands.run('my-plugin.greet');          // invoke by id
```

`combo` fields: `{ ctrl, shift, alt, meta, key }`. `key` is a single character
or a key/code string (e.g. `'F5'`, `'PageDown'`). Built-in app shortcuts take
priority; plugins only fire when nothing else matched.

To write a message that appears on the terminal **screen** (never fed to the
shell) use `api.terminal.write(termId, stringOrUint8Array)`. To send real
keystrokes/input into the PTY, use `window.electronAPI.terminalWrite({ id, data })`
with a `Uint8Array`.

### Terminal lifecycle hooks

```js
api.events.on('terminal:add',      ({ wsId, termId, type, label, url }) => {});
api.events.on('terminal:activate', ({ wsId, termId }) => {});
api.events.on('terminal:remove',   ({ wsId, termId, type }) => {});
api.events.on('terminal:exit',     ({ termId, code }) => {});
api.events.on('theme:changed',     ({ name }) => {});
```

`api.events.off(event, cb)` removes a handler. `type` is `'terminal'` or
`'browser'`.

### Context menu items

```js
api.menus.add('terminal', {
  label: 'My item',
  icon: '<i class="ph ph-hand-wave"></i>',  // optional
  when: (data) => true,                      // optional guard
  handler: (data) => {}
});
api.menus.remove('terminal', 'My item');
```

`type` is `'terminal'`, `'workspace'`, or `'folder'`. `data` is the context
payload (`{ wsId, termId }` for terminals, `{ wsId }` for workspaces,
`{ folderId }` for folders).

### Themes

```js
api.themes.register('my-theme', {
  label: 'My Theme',
  bg: '#111', fg: '#eee', cursor: '#eee', selection: '#333',
  swatches: ['#111', '#eee'],
  palette: [ /* 16 colors, 0-7 normal + 8-15 bright */ ],
  ui: { accent: '#4dabf7' }              // optional UI overrides
});
api.themes.unregister('my-theme');
```

Registered themes appear in Settings → Appearance → Theme automatically. Use a
name not already in use (built-in + custom theme names win).

### Configurable settings

```js
const greeting = api.config.get('greeting', 'hello'); // reads + falls back
api.config.set('greeting', 'hi');                     // persist + notify
api.config.all();                                     // { greeting: 'hi', ... }
api.config.onChange(({ config, changed }) => {        // fires on every edit
  api.log('config changed →', JSON.stringify(config));
});
```

Options are declared in `plugin.json` (`settings`) and edited by the user from
**Settings → Plugins → <plugin> → Options**. Changes apply live in every window
and persist in `state.json`.

### UI widgets

```js
const el = document.createElement('span');
el.textContent = '…';
api.ui.addWidget({ id: 'clock', position: 'statusbar', el });
api.ui.removeWidget('clock');
```

| `position` | Mounts to |
|---|---|
| `'statusbar'` | A strip below the pane area; the strip is hidden until a plugin adds the first widget |
| `'sidebar'` | The bottom of the sidebar |
| `'sidebar-top'` | **Above the WORKSPACES header** — e.g. a banner image (see `examples/workspace-banner/`) |

`sidebar-top` widgets keep their place across sidebar re-renders and are
only visible while the sidebar is expanded (hide them yourself otherwise —
the example does this in `styles.css` with
`#sidebar:not(.expanded) .workspace-banner`).

### Read-only state access

- `api.state.getActiveTerminal()` → `{ id, label, type, url, wsId } | null`
- `api.state.getActiveWorkspace()` → `{ id, label } | null`
- `api.state.getWorkspaces()` → `[{ id, label }]`

## Stylesheets (`styles.css`)

Like Obsidian, a `styles.css` in the plugin folder is **auto-injected** on
load — no import needed — and removed when the plugin is disabled or
uninstalled. Override the filename with `"styles"` (or legacy `"css"`) in
the manifest; otherwise `styles.css`, then `style.css`, is probed.

Scope your selectors with a plugin prefix (e.g. `.my-plugin-clock`) so they
can't leak into the app or other plugins:

```css
.my-plugin-clock { font-variant-numeric: tabular-nums; color: var(--muted-text); }
```

The app exposes its theme as CSS variables (`--bg`, `--fg`, `--accent`,
`--border`, `--muted-text`, …) — prefer them over hardcoded colors so the
plugin follows theme changes.

## TypeScript (`src/main.ts` → `main.js`)

Same workflow as Obsidian: author in `src/main.ts`, ship compiled `main.js`.
Only the manifest, the compiled entry, and the stylesheet go into
`~/.terminalvibe/plugins/<id>/`.

```bash
cd my-plugin
npm init -y
npm i -D typescript esbuild
npx esbuild src/main.ts --format=cjs --platform=browser --outfile=main.js
```

Reference the shipped types (no runtime import — `TerminalVibe` is global):

```ts
/// <reference path="<repo>/examples/plugin-api.d.ts" />

export default class MyPlugin extends TerminalVibe.Plugin {
  async onload() {
    this.addCommand({ id: 'hi', name: 'Say hi', callback: () => this.sayHi() });
  }
  private sayHi() {
    const term = this.api.state.getActiveTerminal();
    if (term) this.api.terminal.write(term.id, '\r\nhello!\r\n');
  }
}
```

Both `export default` (tsc/esbuild) and `module.exports =` (plain JS)
outputs are detected, including `{ onload, onunload }` objects. The loader
evaluates entries with a CommonJS `module`/`exports` shim, so bundled output
works — but `require('node:…')`/npm imports of Node builtins do not (plugins
run in the sandboxed renderer; use `window.electronAPI.*` instead).

## Limitations / notes

- Plugins only load in the Electron (desktop) app — the browser dev-mode
  backend has no plugin host.
- There is no network marketplace; install by copying a folder into
  `~/.terminalvibe/plugins/`.
- No restart needed while developing: newly added folders are picked up when
  you open Settings → Plugins, and toggling the plugin off/on re-reads the
  entry and stylesheet.
- On load failure the Plugins page shows an **Error** badge with the reason
  (console has the stack).
- Plugins are trusted user code running with renderer privileges (no Node
  APIs). Don't install plugins from sources you don't trust.