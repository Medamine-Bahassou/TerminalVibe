---
type: Reference
title: Plugin API Reference
description: Full reference for the api object passed to activate() in TerminalVibe plugins.
tags: [plugins, api, reference]
timestamp: 2026-08-20T00:00:00Z
---

# Plugin API Reference

Every plugin entry calls `TerminalVibe.register({ id, activate, deactivate })`.
The app then invokes `activate(api)` with a per-plugin `api` object. Everything
a plugin can do goes through this object.

## Identity & logging

| Member | Type | Description |
|--------|------|-------------|
| `api.id` | string | Plugin id (directory name) |
| `api.name` | string | Manifest `name` |
| `api.version` | string | Manifest `version` |
| `api.log(...args)` | fn | Logs to the console with a `[plugin:<id>]` prefix |

## Events

Register hooks for app lifecycle events.

| Member | Signature | Description |
|--------|-----------|-------------|
| `api.events.on` | `(event, callback) => void` | Subscribe to an event |
| `api.events.off` | `(event, callback) => void` | Unsubscribe a handler |

### Events

| Event | Payload | Fired when |
|-------|---------|------------|
| `terminal:add` | `{ wsId, termId, type, label?, url? }` | A terminal (`type: 'terminal'`) or browser tab (`type: 'browser'`) is created |
| `terminal:activate` | `{ wsId, termId }` | A tab becomes active |
| `terminal:remove` | `{ wsId, termId, type }` | A tab is removed |
| `terminal:exit` | `{ termId, code }` | A terminal's PTY process exits |
| `theme:changed` | `{ name }` | The active theme changes |

```js
api.events.on('terminal:add', ({ termId, type, label }) => {
  api.log('added', type, termId, label);
});
api.events.on('theme:changed', ({ name }) => {
  api.log('theme is now', name);
});
```

## Commands + keybindings

| Member | Signature | Description |
|--------|-----------|-------------|
| `api.commands.register` | `(def) => void` | Register a command, optionally with a keybinding |
| `api.commands.unregister` | `(id) => void` | Remove a command by id |
| `api.commands.run` | `(id) => void` | Invoke a command by id |

`def`:

```js
{
  id: 'my-plugin.greet',      // unique command id (string)
  label: 'Greet in terminal', // human label (optional)
  combo: { ctrl: true, shift: true, key: 'H' }, // optional keybinding
  handler() { ... }           // function — runs the command
}
```

`combo` modifiers are booleans: `ctrl`, `shift`, `alt`, `meta`. `key` is a
single character (case-insensitive) or a key/code string such as `'F5'` or
`'PageDown'`.

**Priority:** built-in app shortcuts win; plugin combos only fire when no
built-in action matched. Commands run from any window that loaded the plugin.

Writing to a terminal from a command:

```js
handler() {
  const term = api.state.getActiveTerminal();
  if (!term) return;
  const data = new TextEncoder().encode('\r\nhello from plugin!\r\n');
  window.electronAPI.terminalWrite({ id: term.id, data });
}
```

## Context-menu items

| Member | Signature | Description |
|--------|-----------|-------------|
| `api.menus.add` | `(type, item) => void` | Add an item to a context menu |
| `api.menus.remove` | `(type, label) => void` | Remove an item by label |

`type` is one of `'terminal'`, `'workspace'`, or `'folder'`.

`item`:

```js
{
  label: 'My item',                          // required
  icon: '<i class="ph ph-hand-wave"></i>',   // optional HTML (ph = phosphor icons)
  when: (data) => true,                      // optional guard — item hidden if falsy
  handler: (data) => { ... }                 // required
}
```

`data` is the context payload:

| Menu | `data` |
|------|--------|
| `terminal` | `{ wsId, termId }` (plus `_fromBody` when right-clicked on the terminal body) |
| `workspace` | `{ wsId }` |
| `folder` | `{ folderId }` |

Plugin items are appended after the built-in items, behind a separator.

## Themes

| Member | Signature | Description |
|--------|-----------|-------------|
| `api.themes.register` | `(name, theme) => void` | Add a theme to the picker |
| `api.themes.unregister` | `(name) => void` | Remove a theme added by this plugin |

Theme shape:

```js
api.themes.register('my-theme', {
  label: 'My Theme',                 // shown in the picker
  bg: '#1b1b2f', fg: '#e0e0ff',
  cursor: '#e0e0ff', selection: '#353570',
  swatches: ['#1b1b2f', '#e0e0ff'],  // for the theme dropdown
  palette: [                         // 16 colors: 0-7 normal, 8-15 bright
    '#1b1b2f', '#ff6b6b', '#51cf66', '#ffd43b',
    '#4dabf7', '#cc5de8', '#22b8cf', '#f8f9fa',
    '#495057', '#ff8787', '#8ce99a', '#ffe066',
    '#74c0fc', '#da77f2', '#66d9e8', '#f1f3f5'
  ],
  ui: { accent: '#4dabf7' }          // optional UI overrides
});
```

Registered themes appear in Settings → Appearance → Theme automatically.
Names already used by built-in or custom themes win and are ignored.

## Configurable settings

Plugins declare options in `plugin.json` (the `settings` array) and read/write
them through `api.config`. The values are edited by the user in **Settings →
Plugins → <plugin> → Options** and persisted in `state.json`. Edits apply live
to every loaded window.

| Member | Signature | Description |
|--------|-----------|-------------|
| `api.config.get` | `(key, fallback?) => any` | Read a value; falls back to the schema `default`, then to `fallback` |
| `api.config.set` | `(key, value) => void` | Write a value (persisted + delivered to all handlers) |
| `api.config.all` | `() => object` | All values merged over defaults |
| `api.config.onChange` | `(cb) => void` | Subscribe; `cb` fires with `{ id, config, changed }` whenever values change |

```js
const greeting = api.config.get('greeting', 'hello');
api.config.onChange(({ config }) => {
  api.log('config changed →', JSON.stringify(config));
});
```

Settings are declared in the manifest (see
[Manifest Reference](./manifest.md) → `settings`). The default schema supports
`text`, `number`, `boolean`, and `select` types.

## UI widgets

| Member | Signature | Description |
|--------|-----------|-------------|
| `api.ui.addWidget` | `(widget) => void` | Mount a DOM element into the UI |
| `api.ui.removeWidget` | `(id) => void` | Unmount a widget by id |

```js
const clock = document.createElement('span');
clock.textContent = '...';
api.ui.addWidget({ id: 'clock', position: 'statusbar', el: clock });
```

`position`:

| Value | Mounts to |
|-------|-----------|
| `'statusbar'` | A strip below the pane area; the strip is hidden until a plugin adds the first widget |
| `'sidebar'` | The bottom of the sidebar |

## Read-only state access

| Member | Returns |
|--------|---------|
| `api.state.getActiveTerminal()` | `{ id, label, type, url?, wsId } \| null` |
| `api.state.getActiveWorkspace()` | `{ id, label } \| null` |
| `api.state.getWorkspaces()` | `[{ id, label }]` |

```js
const term = api.state.getActiveTerminal();
if (term) api.log('active:', term.label, '(' + term.type + ')');
```

## Related

- [Overview](./index.md) — quick start
- [Manifest Reference](./manifest.md) — plugin.json
- [Tutorial](./tutorial.md) — using the API in a real plugin
- [Troubleshooting](./troubleshooting.md) — limitations and debugging