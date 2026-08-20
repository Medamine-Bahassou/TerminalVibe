---
type: Tutorial
title: Building a Plugin
description: Step-by-step guide to building a real TerminalVibe plugin, mirroring examples/hello-terminalvibe.
tags: [plugins, tutorial]
timestamp: 2026-08-20T00:00:00Z
---

# Building a Plugin

This tutorial builds the plugin in `examples/hello-terminalvibe/`, which uses
every extension point in the API. The result is a "hello" plugin that greets
the active terminal, watches lifecycle events, adds a context-menu item, a
theme, configurable options, and a status-bar clock.

## 1. Scaffold the folder

```bash
mkdir -p ~/.terminalvibe/plugins/hello-terminalvibe
cd ~/.terminalvibe/plugins/hello-terminalvibe
```

Create `plugin.json`:

```json
{
  "name": "Hello TerminalVibe",
  "version": "1.0.0",
  "description": "Example plugin demonstrating the TerminalVibe plugin API.",
  "author": "TerminalVibe",
  "main": "plugin.js"
}
```

Create `plugin.js`:

```js
TerminalVibe.register({
  id: 'hello-terminalvibe',
  activate(api) { /* ... */ },
  deactivate() { /* ... */ }
});
```

The `id` must match the folder name.

## 2. Log and register a command

```js
activate(api) {
  api.log('activated');

  api.commands.register({
    id: 'hello-terminalvibe.greet',
    label: 'Greet in active terminal',
    combo: { ctrl: true, shift: true, key: 'H' },
    handler() {
      const term = api.state.getActiveTerminal();
      if (!term) { api.log('no active terminal'); return; }
      const text = '\r\n\x1b[32m[hello] Hi from ' + api.name + ' v' + api.version + '!\x1b[0m\r\n';
      api.terminal.write(term.id, text);
    }
  });
}
```

- `api.log` prefixes messages with `[plugin:hello-terminalvibe]`.
- The command is bound to **Ctrl+Shift+H** (unused by the app). Built-in
  shortcuts take priority over plugin combos.
- `api.terminal.write` renders the text on the terminal **screen**. It is never
  fed to the shell, so it can't be misinterpreted as a command or glob. (Use
  `window.electronAPI.terminalWrite` with a `Uint8Array` only for real input.)

## 3. Watch lifecycle events

```js
api.events.on('terminal:add', ({ termId, type }) => api.log('terminal added:', termId, type));
api.events.on('terminal:activate', ({ termId }) => api.log('terminal activated:', termId));
api.events.on('terminal:remove', ({ termId }) => api.log('terminal removed:', termId));
api.events.on('theme:changed', ({ name }) => api.log('theme changed:', name));
```

## 4. Add a context-menu item

```js
api.menus.add('terminal', {
  label: 'Hello from plugin',
  icon: '<i class="ph ph-hand-wave"></i>',
  handler(data) {
    const term = api.state.getActiveTerminal();
    if (!term) return;
    api.terminal.write(term.id, '\r\n\x1b[33m[hello] context menu clicked\x1b[0m\r\n');
  }
});
```

Right-clicking any terminal tab or body now shows the item in its own section.

## 5. Register a theme

```js
api.themes.register('hello-theme', {
  label: 'Hello Theme',
  bg: '#1b1b2f',
  fg: '#e0e0ff',
  cursor: '#e0e0ff',
  selection: '#353570',
  swatches: ['#1b1b2f', '#e0e0ff'],
  palette: [
    '#1b1b2f', '#ff6b6b', '#51cf66', '#ffd43b',
    '#4dabf7', '#cc5de8', '#22b8cf', '#f8f9fa',
    '#495057', '#ff8787', '#8ce99a', '#ffe066',
    '#74c0fc', '#da77f2', '#66d9e8', '#f1f3f5'
  ],
  ui: { accent: '#4dabf7' }
});
```

The theme appears in Settings → Appearance → Theme the next time the app boots.

## 6. Add configurable options

Declare options in `plugin.json` with a `settings` array:

```json
"settings": [
  { "key": "greeting", "label": "Greeting", "type": "text", "default": "hello" },
  { "key": "style", "label": "Greeting color", "type": "select",
    "default": "green", "options": ["green", "yellow", "cyan"] },
  { "key": "showClock", "label": "Show clock", "type": "boolean", "default": true }
]
```

Read them in the entry and react to edits:

```js
const greeting = api.config.get('greeting', 'hello');
const style = api.config.get('style', 'green');
const showClock = api.config.get('showClock', true);

api.config.onChange(({ config }) => {
  api.log('config changed →', JSON.stringify(config));
});
```

The user edits these values from **Settings → Plugins → Hello TerminalVibe →
Options**. Changes apply immediately (every loaded window is notified through
`onChange`) and persist in `state.json` under `pluginConfigs`.

## 7. Add a status-bar widget

```js
let interval = null;

const clock = document.createElement('span');
clock.style.fontVariantNumeric = 'tabular-nums';
const tick = () => { clock.textContent = new Date().toLocaleTimeString(); };
tick();
interval = setInterval(tick, 1000);
api.ui.addWidget({ id: 'clock', position: 'statusbar', el: clock });
```

The status bar strip is hidden until the first widget is added.

## 8. Clean up on deactivate

```js
deactivate() {
  if (interval) clearInterval(interval);
}
```

## 9. Restart and verify

```bash
# restart the app, then open the developer console (F12) and look for:
#   [plugin:hello-terminalvibe] activated
#   [plugin:hello-terminalvibe] ready — press Ctrl+Shift+H
```

Now:

- **Ctrl+Shift+H** writes a greeting into the active terminal.
- Creating/activating/closing tabs logs lifecycle events.
- Right-click a terminal → **Hello from plugin**.
- Settings → Appearance → Theme lists **Hello Theme**.
- Settings → Plugins → Hello TerminalVibe → **Options** edits the greeting,
  color, and clock settings — changes apply live.
- The status bar shows a live clock.

## Next steps

- Read the [API Reference](./api-reference.md) for every available method.
- See [Troubleshooting](./troubleshooting.md) for common gotchas.

## Related

- `examples/hello-terminalvibe/` — the finished plugin
- [Manifest Reference](./manifest.md)
- [API Reference](./api-reference.md)