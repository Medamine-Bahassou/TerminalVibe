---
type: Guide
title: Plugin System Overview
description: Overview, architecture, installation, and quick start for the TerminalVibe plugin system.
tags: [plugins, overview, getting-started]
timestamp: 2026-08-20T00:00:00Z
---

# TerminalVibe Plugin System

> Extend TerminalVibe with Obsidian-style plugins — JavaScript + CSS
> (TypeScript via build): commands, keybindings, terminal lifecycle hooks,
> context-menu items, themes, terminal output, configurable settings, and UI
> widgets.

## What are plugins?

A plugin is a small folder placed inside `~/.terminalvibe/plugins/`. Each
plugin ships a manifest (`manifest.json`, or legacy `plugin.json`), a
JavaScript entry (`main.js`, or legacy `plugin.js`), and an optional
stylesheet (`styles.css`, auto-injected). On startup the app finds every
enabled plugin, injects its stylesheet, evaluates its entry, and activates it
with a per-plugin API object that exposes the app's extension points. The
folder name is the plugin id (as in Obsidian).

```
~/.terminalvibe/
├── plugins/
│   └── my-plugin/
│       ├── manifest.json      # manifest (or plugin.json)
│       ├── main.js            # JS entry ("main" field, else main.js, else plugin.js)
│       └── styles.css         # optional — auto-injected
```

Two examples: `examples/hello-terminalvibe/` (legacy `register` style) and
`examples/clock-obsidian/` (Obsidian style: `Plugin` subclass + TS source).

## What can plugins do?

| Capability | API |
|---|---|
| Commands + keybindings | `api.commands.register({ id, combo, handler })` |
| Terminal lifecycle hooks | `api.events.on('terminal:add' \| ...)` |
| Context-menu items | `api.menus.add('terminal' \| 'workspace' \| 'folder', item)` |
| Custom themes | `api.themes.register(name, theme)` |
| Terminal output (display-only) | `api.terminal.write(id, text)` |
| Configurable settings | `api.config.get/set` + manifest `settings` |
| UI widgets (status bar / sidebar / banner) | `api.ui.addWidget({ id, position, el })` |
| Read-only state access | `api.state.getActiveTerminal()`, `getWorkspaces()`, ... |

## How loading works

1. The Electron **main process** scans `~/.terminalvibe/plugins/` for
   manifests (`manifest.json`, else `plugin.json`) and serves entry/stylesheet
   files over IPC (`config:listPlugins`, `config:readPluginFile`).
2. The **renderer** auto-injects the stylesheet (`"styles"`, else
   `styles.css`, else `style.css`), then evaluates each enabled entry with a
   CommonJS `module`/`exports` shim, so bundled (TS-compiled) output works —
   plugins only touch the DOM + API, no Node access.
3. The entry either calls `TerminalVibe.register({ id, activate, deactivate })`
   or exports a `TerminalVibe.Plugin` subclass (`onload`/`onunload`) — or a
   plain `{ activate }` / `{ onload }` object.
4. The app activates the plugin and it registers what it needs.
5. Enable/disable state is persisted in `state.json` under `pluginStates`;
   config values under `pluginConfigs`.

Plugins load in **both** the main window and the Settings window, so config
changes made in the Settings window apply live in the main window. Toggling a
plugin off/on reloads it without a restart.

## Install a plugin

```bash
# Copy the example plugin into the plugins directory
cp -r examples/hello-terminalvibe ~/.terminalvibe/plugins/

# Open Settings → Plugins (new folders activate on page open).
# Check the developer console for:
#   [plugin:hello-terminalvibe] activated
```

## Manage plugins

The **Settings → Plugins** page lists every installed plugin with its status
(Active/Disabled), an **activate/deactivate toggle**, and an **open-folder**
button that reveals the plugin directory in your file manager. Plugins that
declare `settings` get a **configure** button that opens that plugin's options
page — the same page has a back button that returns to the list of all
plugins. Changes apply immediately and persist to `state.json`.

## Quick start

Create `~/.terminalvibe/plugins/hello/plugin.json`:

```json
{
  "name": "Hello",
  "version": "1.0.0",
  "description": "My first plugin",
  "author": "You",
  "main": "plugin.js"
}
```

Create `~/.terminalvibe/plugins/hello/plugin.js`:

```js
TerminalVibe.register({
  id: 'hello',
  activate(api) {
    api.log('hello world');
    api.events.on('terminal:add', ({ termId, type }) => {
      api.log('new ' + type + ' terminal:', termId);
    });
  },
  deactivate() {}
});
```

Open Settings → Plugins — the plugin activates on page open and logs on boot
and whenever a terminal is added.

## Doc pages

- [Manifest Reference](./manifest.md) — every `plugin.json` field
- [API Reference](./api-reference.md) — the full `api` object
- [Tutorial](./tutorial.md) — build a real plugin step by step
- [Troubleshooting](./troubleshooting.md) — limitations, debugging, security

### HTML version

The same documentation is also available as standalone styled pages, openable
in any browser:

- [Overview](./html/index.html) · [Manifest](./html/manifest.html) ·
  [API Reference](./html/api-reference.html) · [Tutorial](./html/tutorial.html) ·
  [Troubleshooting](./html/troubleshooting.html)

## Related

- [Plugin Development](../plugin-development.md) — condensed single-page reference
- `examples/hello-terminalvibe/` — legacy-style example plugin
- `examples/clock-obsidian/` — Obsidian-style example (manifest + Plugin class + styles.css + TS)
- `examples/plugin-api.d.ts` — TypeScript definitions for plugin authors
- [Architecture](../okf/architecture/frontend.md) — how the frontend boots