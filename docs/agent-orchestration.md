# Agent orchestration

TerminalVibe's Electron app exposes an authenticated local control channel for
agents. Each agent gets a real PTY in a visible, named split. Launchers are
provider agnostic: supply an executable and arguments, a working directory,
and a recursive layout. No API keys are managed by TerminalVibe; each installed
agent uses its own login and approval settings.

## Give the skill to an agent

Copy the complete `skills/terminalvibe-orchestration` directory (including
`scripts/tv.js`) into your agent's skill directory. For Claude Code, for example,
use `.claude/skills/terminalvibe-orchestration/` in the project. For Codex use
`.agents/skills/terminalvibe-orchestration/`. Agents without skill discovery can
read `SKILL.md` directly and invoke the included client with Node.js 18+.

Start the updated Electron desktop app. Launch your orchestrator agent in a
TerminalVibe terminal so it inherits the correct control descriptor. Then ask:

> Use the TerminalVibe orchestration skill. Launch Claude Code, my Codex terminal
> agent, and my configured Antigravity terminal adapter in separate visible
> panes. Put Claude on the left at 50%, with the other two stacked on the right.
> Give each a separate task, inspect their output, and summarize their findings.

The agent must discover the installed commands and their prompt flags first.
An Antigravity desktop/editor command alone does not provide an interactive
terminal subagent. If there is no suitable launcher, the agent reports that
limitation instead of pretending a terminal session is available.

## Launch format

The following demonstrates a three-pane layout with harmless shell commands.
Replace `/absolute/project` and the argument arrays with verified agent commands.
`row` means left/right; `column` means top/bottom.

```json
{
  "name": "Agent team",
  "layout": {
    "split": "row", "sizes": [50, 50],
    "children": [
      { "name": "Lead", "cwd": "/absolute/project", "argv": ["/bin/bash"] },
      {
        "split": "column", "sizes": [50, 50],
        "children": [
          { "name": "Worker A", "cwd": "/absolute/project", "argv": ["/bin/bash"] },
          { "name": "Worker B", "cwd": "/absolute/project", "argv": ["/bin/bash"] }
        ]
      }
    ]
  }
}
```

```sh
node skills/terminalvibe-orchestration/scripts/tv.js launch --file team.json
node skills/terminalvibe-orchestration/scripts/tv.js list
```

Outside TerminalVibe, run `tv.js instances`, then supply `--instance FILE`.
Run the client on the same OS as Electron (Windows and WSL have different
home directories and executable paths). For multiple instances, select one
explicitly. Stale descriptors from crashes are labeled by PID liveness; a reused
PID is not proof of a live app, and connection errors remain authoritative.

## Protocol

POST JSON `{ "method": "list", "params": {} }` to the descriptor's loopback
`url`, with `Authorization: Bearer TOKEN`. Success is `{ "result": ... }`;
failure is `{ "error": "..." }` with a non-200 status. The client handles this
and exits nonzero on failure. The descriptor is stored with mode 0600 under
`~/.terminalvibe/control/instance-PID.json` and removed on normal exit. Windows
uses the user's filesystem ACLs. The token grants terminal control; keep the
file private. Browser Origin requests are rejected. There is no remote binding.

| Method | Parameters | Result |
| --- | --- | --- |
| `list` | none | Workspaces, layouts, pane IDs and dead state |
| `launch` | `name`, `layout` | Workspace and individual spawn results |
| `read` | `paneId`, optional `lines` (1–2000) | Rendered terminal text and dead state |
| `send` | `paneId`, `text`, optional `enter` | Input delivery acknowledgment |
| `focus` | `paneId` | Selected pane ID |
| `arrange` | `workspaceId`, `layout` | Updated workspace |

For `arrange`, use `{ "paneId": "ID" }` leaves, including every pane in the
workspace exactly once. Processes stay alive. Invalid launch plans and invalid
arrangements are rejected before changing the workspace. Spawn failure is
reported per pane; already-started agents are retained. Exited agent panes stay
visible for inspection, and launch commands are never replayed on app restart.
This does not provide automatic worktrees, provider APIs, structured task
completion, or a cross-agent message bus: the orchestrator coordinates tasks
through launch arguments, terminal input, and output inspection.

The control channel is desktop-only; `npm run dev` browser mode has no endpoint.
The CLI client and skill work independently of npm dependencies and can be
distributed together from this repository. The desktop build includes the
control server through `electron/**/*`.
