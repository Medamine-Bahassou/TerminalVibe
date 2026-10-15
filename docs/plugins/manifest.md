---

type: Reference
title: Plugin Manifest
description: Reference for manifest.json / plugin.json, the manifest that describes a TerminalVibe plugin.
tags: [plugins, manifest, reference]
timestamp: 2026-08-20T00:00:00Z
---

# Plugin Manifest (`manifest.json`)

Every plugin lives in `~/.terminalvibe/plugins/<id>/` and must contain a
manifest: **`manifest.json`** (Obsidian-style, preferred) or legacy
`plugin.json`. The directory name is the plugin `id`.

## Location

```
~/.terminalvibe/plugins/<id>/
├── manifest.json      # this file (or plugin.json)
├── main.js            # the entry ("main" field, else main.js, else plugin.js)
└── styles.css         # optional stylesheet (auto-injected)
```
The `id` is the directory name. It is used to namespace commands, config
settings, widgets, and enable/disable state, so keep it stable and unique.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | no | Ignored when it disagrees — the folder name always wins (as in Obsidian) |
| `name` | string | yes | Human-readable display name |
| `version` | string | yes | Semver-ish version, e.g. `1.0.0` |
| `minAppVersion` | string | no | Minimum TerminalVibe version (informational, like Obsidian) |
| `description` | string | yes | Short summary of what the plugin does |
| `author` | string | no | Author name or handle |
| `main` | string | no | Entry JS file, relative to the plugin folder. When absent the loader probes `main.js`, then `plugin.js` |
| `styles` | string | no | Stylesheet file, relative to the folder. When absent the loader probes `styles.css`, then `style.css` (auto-injected) |
| `css` | string | no | Legacy alias of `styles` |
| `settings` | array | no | Declared options the user can configure (see below) |

## Settings (configurable options)

The optional `settings` array declares variables the user can customize from
**Settings → Plugins → <plugin> → Options**. Each entry:

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Unique key within this plugin; the `api.config.get/set` name |
| `label` | string | Human-readable label shown in the UI |
| `type` | string | `text`, `number`, `boolean`, or `select` |
| `default` | any | Fallback value (required for `number`/`boolean`; optional for `text`) |
| `options` | array | Only for `select` — the allowed values |
| `description` | string | Optional helper text under the label |

```json
"settings": [
  { "key": "greeting", "label": "Greeting", "type": "text", "default": "hello" },
  { "key": "style", "label": "Greeting color", "type": "select",
    "default": "green", "options": ["green", "yellow", "cyan"] },
  { "key": "showClock", "label": "Show clock", "type": "boolean", "default": true }
]
```

Values are persisted in `~/.terminalvibe/state.json` under `pluginConfigs`
keyed by plugin id, and exposed to the plugin through `api.config` (see
[API Reference](./api-reference.md)).

## Example

```json
{
  "name": "Hello TerminalVibe",
  "version": "1.0.0",
  "description": "Example plugin demonstrating the TerminalVibe plugin API.",
  "author": "TerminalVibe"
}
```

(`"main"`/`"styles"` omitted — the loader finds `main.js`/`plugin.js` and
`styles.css`/`style.css` on its own.)

## Validation rules

- The directory name (the `id`) is canonical: it namespaces commands, config,
  widgets, and enable/disable state. A manifest-level `"id"` that disagrees
  is ignored (warning in the console); `TerminalVibe.register` ids that
  disagree are re-keyed the same way.
- No readable entry (`"main"`, else `main.js`, else `plugin.js`) → the plugin
  is skipped with an **Error** badge in Settings → Plugins.
- A malformed manifest (invalid JSON, or not an object) is skipped silently.
- Unknown fields (e.g. Obsidian's `fundingUrl`) are ignored.
- Settings with a `type` other than `text`, `number`, `boolean`, or `select`
  render as a plain text field.

## Entry contract

The entry is evaluated with a CommonJS `module`/`exports` shim against the
global `TerminalVibe` namespace (`register` + `Plugin`). Any one of these
activates the plugin:

```js
// 1. Obsidian-style class (recommended)
class MyPlugin extends TerminalVibe.Plugin {
  async onload() { /* setup via this.addCommand / this.api… */ }
  onunload() { /* cleanup */ }
}
module.exports = MyPlugin;          // `export default` output works too

// 2. Legacy register
TerminalVibe.register({
  id: 'hello',               // should match the folder name
  activate(api) { ... },     // required — sets up the plugin
  deactivate() { ... }       // optional — cleanup on unload
});

// 3. Plain object export
module.exports = { activate(api) { ... }, deactivate() { ... } };
```

## Enable / disable

Plugins are enabled by default. State is stored in `~/.terminalvibe/state.json`
under `pluginStates`:

```json
{
  "pluginStates": {
    "hello": true,
    "disabled-plugin": false
  }
}
```

A plugin with `false` is discovered but never evaluated or activated.

## Related

- [Overview](./index.md) — what plugins can do
- [API Reference](./api-reference.md) — the `api` object
- [Tutorial](./tutorial.md) — build a plugin step by step