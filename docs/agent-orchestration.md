# Agent orchestration

TerminalVibe's desktop app and browser dev server expose an authenticated local control channel for
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

Start the updated Electron desktop app, or run `npm run dev` and open one
TerminalVibe browser tab. Restart the dev server and refresh the tab after an
update. Launch your orchestrator agent in a TerminalVibe terminal so it inherits
the correct control descriptor. Then ask:

> Use the TerminalVibe orchestration skill. Launch Claude Code, my Codex terminal
> agent, and my configured Antigravity terminal adapter in separate visible
> panes. Put Claude on the left at 50%, with the other two stacked on the right.
> Give each a separate task, inspect their output, and summarize their findings.

For a quick two-agent test in the current workspace, the installed skill now
uses a single client call:

```sh
node skills/terminalvibe-orchestration/scripts/tv.js pair --provider claude
```

Add `--prompt "TASK"` to give both agents work, or `--cwd DIR` to override the
calling directory. The command selects the owning/sole live instance, checks
the requested executable, pins the current workspace, creates two side-by-side
compact panes below the parent and returns both output snapshots after a bounded 750 ms
wait. Snapshots do not certify authentication or readiness. Do not relaunch to
wait for output; use `read` on the returned pane IDs. Providers are never
substituted, and approval settings remain enabled.
On updated apps the bottom worker row defaults to 200 px high and fills the
workspace width, with equal-width workers. Side docks minimize width instead
and fill the available height. Older apps retain the percentage layout.

For distinct tasks or custom layouts, `context --provider claude` returns the
instance, workspace list, selected workspace, cwd and verified launcher in one
call. Follow it with `launch --inspect --file plan.json`. No backend restart is
needed to use these client shortcuts with an app supporting workspace launches.
From PowerShell in a WSL UNC cwd, the client routes itself through `wsl.exe`
without shell path conversion, translates client/file paths and can verify the
calling user's Windows native launcher from WSL. It does not scan other users.
UTF-8 JSON files/stdin may include a PowerShell BOM.

For custom agents, discover the installed command and its prompt syntax first.
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

## Launch into the current workspace

No manual pane creation is needed. Pass `workspaceId` instead of `name` to add
the agents to an existing workspace. Use an ID returned by `list`, or `current`
to resolve the active workspace when the request starts. Existing terminals and
their processes are retained, and only the new panes are spawned.

For example, keep existing panes across the top 35% and add two reviewers side
by side below them:

```json
{
  "workspaceId": "current",
  "placement": { "split": "column", "sizes": [35, 65] },
  "layout": {
    "split": "row",
    "children": [
      { "name": "Reviewer A", "cwd": "/absolute/project", "argv": ["/bin/bash"] },
      { "name": "Reviewer B", "cwd": "/absolute/project", "argv": ["/bin/bash"] }
    ]
  }
}
```

Run this plan with the same `tv.js launch --file plan.json` command. Replace the
shells with verified agent launch commands and task arguments. Optionally pass
`anchorPaneId` to split beside a specific pane's group instead of the full
workspace layout; when no `workspaceId` is supplied, the anchor's workspace is
used. When both are supplied, they must refer to the same workspace.

`placement.split` defaults to `row` (existing left, new right); `column` means
existing top, new bottom. `placement.before: true` reverses child order. The two
`placement.sizes` percentages follow that order and default to `[50,50]`.
The added agents' internal arrangement comes from `layout`. The parent pane and
existing tabs remain intact; existing processes are not restarted or respawned.

`list` includes `activeWorkspaceId`, `activePaneId`, and capability flags
`launchIntoWorkspace` and `launchBesidePane`. Match the parent terminal's
`TERMINALVIBE_PANE_ID` to a workspace where possible, and then use its concrete
ID to avoid a focus change selecting another workspace. A missing capability
flag means the running app/page needs updating; it is not a reason to create
panes manually. Restarting dev mode or refreshing a browser tab closes its dev
terminals, so save work before loading an update.

Outside TerminalVibe, a sole live instance is selected automatically. If several
exist, run `tv.js instances`, then supply `--instance FILE`.
Run the client on the backend OS, or use automatic WSL routing from a Windows
WSL UNC cwd (Windows and WSL have different homes). For multiple instances, select one
explicitly. Stale descriptors from crashes are labeled by PID liveness; a reused
PID is not proof of a live app, and connection errors remain authoritative.

## Protocol

### Resize or move live panes

Use `resize` to size an already-open terminal group without restarting it:

```sh
node skills/terminalvibe-orchestration/scripts/tv.js resize '{"paneId":"BOTTOM_WORKER","width":"auto","height":"min"}'
node skills/terminalvibe-orchestration/scripts/tv.js resize '{"paneId":"WORKER","width":420,"height":280}'
node skills/terminalvibe-orchestration/scripts/tv.js place '{"paneId":"WORKER","anchorPaneId":"PARENT","side":"right"}'
```

`resize` accepts `min`, positive pixels, or `auto` per axis. Tabs in one group
share its dimensions. `place` moves only the selected tab within its workspace,
preserving sibling tabs and processes. Its sides are `left`, `right`, `top` and
`bottom`. Moving defaults to compact sizing along the docking axis only:
top/bottom minimize height and fill width, left/right minimize width and fill
height. `compact:false` fills the split proportionally,
and explicit `width`/`height` override the compact dimensions. Requests below
200 px are clamped; a layout still needs sufficient viewport space to fit its
minimums. Pixel dimensions include the tab header.

Compact subtrees retain normal split filling in the other dimension, so a
bottom worker row does not leave a blank strip beside narrow workers.
`placement.compact:true` uses this for new workers; it is the default when
placement percentages are omitted. Previously saved compact layouts requesting
both minima also follow the docking axis when rendered. Explicit
percentages are respected unless compact is explicitly enabled. `arrange`
leaves/subtrees may include `size:{height:"min"}` for a bottom row,
`size:{width:"min"}` for a side column, or explicit pixel values.
Sizes persist with the workspace. Manual sash dragging releases size requests
in the adjacent subtrees and their ancestors, including nested agent panes,
while preserving their current proportions so the divider does not jump.
After dragging, panes scale proportionally with the window.

`list` advertises `paneSizing`, `panePlacement` and `compactPanes`, the minimum
pane dimensions, each pane's group ID, requested group size, `agentManaged` flag
and measured bounds. Hidden groups can have zero/null bounds. These capabilities
require the updated backend/app page; restarting dev mode or refreshing the
page closes its dev terminals, so load the update after saving active work.

POST JSON `{ "method": "list", "params": {} }` to the descriptor's loopback
`url`, with `Authorization: Bearer TOKEN`. Success is `{ "result": ... }`;
failure is `{ "error": "..." }` with a non-200 status. The client handles this
and exits nonzero on failure. The descriptor is stored with mode 0600 under
`~/.terminalvibe/control/instance-PID.json` and removed on normal exit. Windows
uses the user's filesystem ACLs. The token grants terminal control; keep the
file private. Browser Origin requests are rejected. There is no remote binding.

| Method | Parameters | Result |
| --- | --- | --- |
| `list` | none | Active workspace/pane IDs, capabilities, workspaces, layouts, pane IDs and dead state |
| `launch` | `layout`; `name` for new, or `workspaceId`/`anchorPaneId` for existing; optional `placement` | Workspace and new panes' individual spawn results |
| `read` | `paneId`, optional `lines` (1–2000) | Rendered terminal text and dead state |
| `send` | `paneId`, `text`, optional `enter` | Input delivery acknowledgment |
| `focus` | `paneId` | Selected pane ID |
| `arrange` | `workspaceId`, `layout` | Updated workspace |
| `resize` | `paneId`, `width` and/or `height` (`min`, `auto`, or pixels) | Updated workspace with measured bounds |
| `place` | `paneId`, `anchorPaneId`, `side`; optional `compact`, `width`, `height` | Updated workspace; live processes preserved |

For `arrange`, use `{ "paneId": "ID" }` leaves, including every pane in the
workspace exactly once. Processes stay alive. Invalid launch plans and invalid
arrangements are rejected before changing the workspace. Spawn failure is
reported per pane; already-started agents are retained. Exited agent panes stay
visible for inspection, and launch commands are never replayed on app restart.
This does not provide automatic worktrees, provider APIs, structured task
completion, or a cross-agent message bus: the orchestrator coordinates tasks
through launch arguments, terminal input, and output inspection.

In browser mode, control requests pass through the PTY WebSocket to the ready
page, which owns the visible layout. The dev server starts the same authenticated
loopback control endpoint as the desktop app. With no ready tab, requests return
an explicit error; with multiple ready tabs, requests are rejected to avoid
changing an arbitrary workspace. Keep one TerminalVibe browser tab open.
The CLI client and skill work independently of npm dependencies and can be
distributed together from this repository. The desktop build includes the
control server through `electron/**/*`.
