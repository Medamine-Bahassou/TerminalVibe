# Command Line Interface

TerminalVibe ships a small CLI for launching workspaces, building terminal
layouts, and driving sessions headlessly. Invoke it as `terminalvibe <command>`
(the app binary) — the same command runs the `--help` text below.

## Usage

```
terminalvibe <command> [options]
```

## Commands

```
new NAME [-t S] [-s v|h S] [--split-back] [--workspace NAME ...] [--profile ID] [--cwd DIR]
create -f FILE|- [-w NAME ...] [--profile ID] [--cwd DIR]
list [--profile ID]
close NAME [--profile ID]
attach NAME [--profile ID]
```

- `new NAME` — open the GUI with a new workspace pre-built from the tab specs.
- `create -f FILE` — build workspaces from a YAML file (or `-` for stdin), then open.
- `list` — print existing workspaces and exit (headless).
- `close NAME` — close a workspace by name and exit (headless).
- `attach NAME` — open the GUI focused on an existing workspace.

## Tab spec

`S = name:type:cmd_or_url`

- `type` is `terminal` (default) or `browser`.
- For terminals the trailing value is the command to run; for browsers it's the URL.

Examples:

```
"code:terminal:nvim ."
"web:browser:https://example.com"
"logs:terminal:tail -f /var/log/syslog"
```

## Options

| Option | Description |
|--------|-------------|
| `-t, --tab S` | Add a tab to the current workspace |
| `-s, --split v\|h S` | Split the current pane and add `S` in the new pane |
| `--split-back` | Move the cursor up one split level |
| `--workspace NAME` | Start a new workspace segment (in `new`) |
| `-f, --file FILE` | YAML file (or `-` for stdin) for `create` |
| `-w, --workspace NAME` | Filter to named workspace(s) from the YAML |
| `--profile ID` | Use an existing profile instead of a temporary one |
| `--cwd DIR` | Starting directory for all terminals |
| `--help` | Show this help and exit |

## Examples

```
terminalvibe new Fullstack -t "editor:terminal:nvim ." -s v "backend:terminal:python runserver"
terminalvibe new Dev -t "web:browser:https://localhost:3000" -t "logs:terminal:tail -f log.txt"
terminalvibe create -f workspaces.yaml
terminalvibe list
terminalvibe close "My Workspace"
terminalvibe attach "My Workspace"
```
