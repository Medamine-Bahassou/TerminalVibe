---
type: Playbook
title: Plugin Troubleshooting
description: Limitations, security model, and debugging tips for TerminalVibe plugins.
tags: [plugins, troubleshooting, security]
timestamp: 2026-08-20T00:00:00Z
---

# Plugin Troubleshooting

## Limitations

| Limitation | Details |
|------------|---------|
| Desktop only | Plugins load only in the Electron app. Browser dev mode (`npm run dev`) has no plugin host. |
| No marketplace | Install by copying a folder into `~/.terminalvibe/plugins/`. No network install. |
| No hot reload | Plugins load at startup. Restart the app after adding or editing a plugin. |
| No Node access | Plugins run in the sandboxed renderer — no `require`, no filesystem. Use `window.electronAPI.*` for app capabilities. |
| `style.css` not auto-loaded | A plugin stylesheet is not injected automatically. Inject styles via `document.createElement('style')` in `activate` if needed. |
| `deactivate` on app exit | `deactivate()` runs on unload/reload paths, not guaranteed on window close. |

## Debugging

### See plugin logs

Open the developer console (**F12** / Ctrl+Shift+I). All `api.log(...)` output
is prefixed with `[plugin:<id>]`.

### Plugin did not load

Check the console for these warnings:

| Message | Meaning |
|---------|---------|
| `missing "main" entry` | `plugin.json` has no `main` field |
| `entry not readable` | The file named by `main` is missing or unreadable |
| `failed to evaluate <id>` | The entry threw while executing. The error follows on the same line. |
| `activate failed for <id>` | `activate(api)` threw. The error follows on the same line. |

Also confirm:

- The folder name matches the `id` in `TerminalVibe.register`.
- The folder is directly inside `~/.terminalvibe/plugins/` (no nesting).
- `plugin.json` is valid JSON.
- The plugin is enabled in `pluginStates` inside `~/.terminalvibe/state.json`.

### Keybinding does nothing

- Built-in shortcuts win. Pick a combo the app does not already use.
- Verify the combo's modifiers: `{ ctrl: true, shift: true, key: 'H' }` means
  Ctrl+Shift+H.
- A single-character `key` matches case-insensitively; multi-char keys match
  `e.key` or `e.code`.

### Menu item missing

- Check `api.menus.add` — `when(data)` must return truthy for the current
  context.
- Confirm the type matches where you expect it: `'terminal'`, `'workspace'`,
  or `'folder'`.

### Status bar / widget not visible

- The status bar strip only shows once at least one plugin adds a widget with
  `position: 'statusbar'`.
- A widget removed with `api.ui.removeWidget` is gone permanently for the
  session.

## Security model

Plugins are **trusted user code** running with the same privileges as the app
itself:

- They execute in the renderer, so they can read/write the DOM and the app
  state, and use the `window.electronAPI` bridge (PTY writes, clipboard,
  browser tabs).
- They **cannot** access Node.js APIs or the filesystem directly.
- The `contextIsolation` + `sandbox` Electron settings are unchanged — plugins
  are evaluated in the same world as the app.

**Treat plugins like shell scripts**: only install plugins you wrote or that
you trust, and review the source of anything you copy into
`~/.terminalvibe/plugins/`.

## Error handling in your plugin

Wrap risky code in `try/catch`; the app catches errors in event handlers,
commands, `activate`, and menu handlers and logs them without crashing.

```js
handler() {
  try {
    // ...
  } catch (err) {
    api.log('command failed:', err);
  }
}
```

## Related

- [Overview](./index.md) — install and quick start
- [API Reference](./api-reference.md)
- [Tutorial](./tutorial.md)