---
type: Reference
title: Plugin Manifest
description: Reference for plugin.json, the manifest that describes a TerminalVibe plugin.
tags: [plugins, manifest, reference]
timestamp: 2026-08-20T00:00:00Z
---

# Plugin Manifest (`plugin.json`)

Every plugin lives in `~/.terminalvibe/plugins/<id>/` and must contain a
`plugin.json` manifest. The directory name is the plugin `id`.

## Location

```
~/.terminalvibe/plugins/<id>/
├── plugin.json      # this file
└── plugin.js        # the entry, named by "main"
```

The `id` is the directory name. It is used to namespace commands, config
settings, widgets, and enable/disable state, so keep it stable and unique.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable display name |
| `version` | string | yes | Semver-ish version, e.g. `1.0.0` |
| `description` | string | yes | Short summary of what the plugin does |
| `author` | string | no | Author name or handle |
| `main` | string | yes | Entry JS file, relative to the plugin folder |
| `settings` | array | no | Declared options the user can configure (see below) |
| `css` | string | no | Reserved — plugin stylesheet (not auto-injected yet) |

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
  "author": "TerminalVibe",
  "main": "plugin.js"
}
```

## Validation rules

- The directory name (the `id`) must match the `id` passed to
  `TerminalVibe.register` in the entry file.
- `main` must exist and be readable; otherwise the plugin is skipped with a
  warning in the console.
- Unknown fields are ignored — extra metadata is fine.
- A malformed `plugin.json` (invalid JSON, or not an object) is skipped
  silently.
- Settings with a `type` other than `text`, `number`, `boolean`, or `select`
  render as a plain text field.

## Entry contract

The file named by `main` is evaluated against the global `TerminalVibe`
namespace. It should register the plugin:

```js
TerminalVibe.register({
  id: 'hello',               // must match the folder name
  activate(api) { ... },     // required — sets up the plugin
  deactivate() { ... }       // optional — cleanup on unload
});
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