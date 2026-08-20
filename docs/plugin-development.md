# TerminalVibe Plugin Development

TerminalVibe has a JavaScript plugin system. Plugins run in the renderer (like
zsh/VSCode plugins — same trust level as the app itself) and can register
commands, keybindings, terminal lifecycle hooks, context-menu items, themes,
configurable settings, and UI widgets.

A working example lives in [`examples/hello-terminalvibe/`](../examples/hello-terminalvibe).

## How plugins are loaded

Each plugin is a directory in `~/.terminalvibe/plugins/<id>/`:

```
~/.terminalvibe/plugins/
  hello-terminalvibe/
    plugin.json      # manifest (required)
    plugin.js        # JS entry — the value of "main" (required)
    style.css        # optional; not auto-injected yet
```

At startup the app scans that directory for `plugin.json` manifests. For each
enabled plugin it reads the entry file (`"main"`) and evaluates it in the
renderer against a small global `TerminalVibe` namespace. The entry calls
`TerminalVibe.register({ id, activate, deactivate })` and the app then invokes
`activate(api)` with a per-plugin API object.

Enable/disable state is persisted in `state.json` (`pluginStates`); config
values under `pluginConfigs`. Plugins are loaded in both the main window and
the Settings window, so config edits made in Settings apply live everywhere.

### `plugin.json` manifest

```json
{
  "name": "Hello TerminalVibe",
  "version": "1.0.0",
  "description": "What it does",
  "author": "You",
  "main": "plugin.js",
  "settings": [
    { "key": "greeting", "label": "Greeting", "type": "text", "default": "hello" },
    { "key": "style", "label": "Greeting color", "type": "select",
      "default": "green", "options": ["green", "yellow", "cyan"] }
  ]
}
```

The optional `settings` array declares editable options; see
[`docs/plugins/manifest.md`](./plugins/manifest.md) for the full schema.

### Entry file

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

`id` in `TerminalVibe.register` must match the directory name.

## The `api` object

Passed to `activate(api)`.

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

`position` is `'statusbar'` (a strip below the pane area, shown only when at
least one plugin adds a widget) or `'sidebar'` (appended to the sidebar).

### Read-only state access

- `api.state.getActiveTerminal()` → `{ id, label, type, url, wsId } | null`
- `api.state.getActiveWorkspace()` → `{ id, label } | null`
- `api.state.getWorkspaces()` → `[{ id, label }]`

## Limitations / notes

- Plugins only load in the Electron (desktop) app — the browser dev-mode
  backend has no plugin host.
- There is no network marketplace; install by copying a folder into
  `~/.terminalvibe/plugins/`.
- Plugins are trusted user code running with renderer privileges (no Node
  APIs). Don't install plugins from sources you don't trust.
- `style.css` in a plugin is not auto-injected yet; inject styles via a
  `document.createElement('style')` in `activate` if needed.