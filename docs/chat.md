# Chat tabs

Any workspace can open a **Chat** tab: the conversation of the coding agents run in that workspace, with a message box to talk to the one still running.

## Opening it

- Right-click a tab bar's **+** → **Chat ›** and pick an agent (only the agent CLIs found on your PATH are listed), or the tab group's **⋯** menu → **Chat**.

Each Chat tab is its own thread (its history, agent, picks and title), and a workspace can hold as many as you like: **Chat ›** in the tab bar menu, **New chat** in the **⋯** menu and the threads sidebar's pen button always open a new one. A Chat tab is named after its first prompt, keeps its own unsent draft and attachments, and can be split, moved and closed like any tab; it comes back after a restart. Two chats side by side show the focused one live and the other as a still picture until you click it.

## Threads sidebar

The titlebar's threads button (at the right) opens the threads sidebar: every workspace chat as a card, newest activity first, split into **Working** (its agent is busy: a spinner and the elapsed time) and **Settled**. A card shows the folder, the time since the last activity, the status, the title (the chat's first prompt), the git branch and the agent's logo; hover it for the full folder, workspace, branch and model. Click a card to open that chat, search to filter, and use the pen button for a new thread (a new workspace with its Chat tab open). The sidebar remembers whether it was open.

## What it shows

Every agent CLI started in one of the workspace's terminal tabs (for example typing `claude` or `codex` in its shell) becomes a session of the workspace's chat. The Chat tab reads the agents' own transcripts and shows your prompts, the replies, tool calls (expand one for the full command) and pasted images. Only **Claude Code** and **Codex** transcripts can be read. Other agents are detected, but their sessions show no history.

Each prompt is a turn. A finished turn folds its steps under **Worked for 16s ›** (click to open): the agent's thinking (**Thought**, open it for the full text), interim replies and tool calls (each opens to its full command). Its final reply stays visible, followed by the files it changed: **2 changed files +12 −3**, one row per file; click a file, or **Open diff** for all of them, to see the diff. The turn in progress shows its steps as they come. Thinking comes from Claude Code's transcript and from Codex's reasoning summaries (when Codex writes one); file changes come from the agents' edit tools (Claude Code's Edit / Write, Codex's apply_patch), not from files changed through shell commands.

- **Ctrl+F** in the Chat tab finds text in the history.
- Hover a message to copy it.

## Thread details

The panel button at the chat's top right (tooltip "Thread details") opens the thread details card inside the chat, like T3 Code's thread panel. It gathers the current chat's folder, git branch and quick action, listening servers and quota windows in one card:

- **Workspace**: the folder (its icon reveals it in Files), **Open in VS Code** (the chevron picks another installed editor), and project scripts from `t3.json` or `package.json` — **Add project script** writes a new one, and a script's chevron lists them all. Clicking a script runs it in a new terminal of the workspace.
- **Version control**: the branch (click to switch), the quick action — **Commit**, **Commit & push**, or **Commit, push & PR** when the branch is ahead of `origin/main` — with a chevron for Push, Pull and Create PR, and **Changes vs origin/main** with `+additions −deletions`. Click Changes for the full diff; clicking the quick action opens a commit message dialog.
- **Servers**: every listening port started from the app, labelled `localhost:<port>` and `Terminal · <process>`. Click to open it in a browser tab (Ctrl/Cmd-click for your own browser); the stop button appears on hover.
- **Usage limits**: **Session** and **Weekly** quota bars for the chat's agent, showing percent left; hovering explains when each resets.

Right-click the card to choose which sections it shows; the choice is remembered. The card stays open while you work and closes on Escape or an outside click. Server and git data refresh whenever you reopen it; quota data is the same cached reading as the sidebar's Usage page.

## Sending messages

**Enter** sends, **Shift+Enter** adds a new line. Your message shows and the box clears at once, even while an agent starts. A row at the end of the chat shows what is happening ("Starting Claude Haiku", then "Thinking · 4s") until the agent's turn ends; each finished prompt then shows how long it took ("Worked for 12s"). If the agent cannot start, your text goes back into the box.

Under the box:

- **Model chip** (agent logo, model, effort) opens the model picker: agents at left, a searchable model list in the middle, reasoning effort at right. Claude Code offers Opus, Sonnet, Haiku and Fable (the CLI's aliases for each family's latest model). Codex lists the models from its own cache (`~/.codex/models_cache.json`) with each model's effort levels; the desktop app reads it.
- **Footer**: the folder, the agent (click it to see its terminal), the git branch and the permissions (Ask first, Auto, Accept edits, Plan only, Full access; for Codex: Read only, Workspace write, Full access). The permissions are also at the foot of the picker's reasoning column.

### How the chat talks to the agent

In the desktop app, **Claude Code**, **Codex** and **OpenCode** chats run through the agents' own structured protocols, not a terminal (`electron/chat-sdk.js`). All use your installed CLI and its login:

- Claude Code runs headless: `claude -p --input-format stream-json --output-format stream-json`, with permission prompts answered over stdio (`--permission-prompt-tool stdio`).
- Codex runs `codex app-server` (JSON-RPC over stdio), the interface its IDE extension uses.
- **Antigravity CLI** runs `agy acp`, its [Agent Client Protocol](https://agentclientprotocol.com) server (JSON-RPC over stdio, the protocol editors such as Zed use). Its models (each with Low/Medium/High thinking) and permission modes (Ask first, Auto, Accept edits, Plan only) come from the agent itself; the model list is read once per run from a session opened and closed in the background, and cached. Full access is its `--dangerously-skip-permissions` start flag, so turning it on or off resumes the conversation in a new process.
- **OpenCode** runs a local `opencode serve` and drives it with the official `@opencode-ai/sdk`. Models come from the project's connected providers; the selected one is passed on every turn. Its access modes are Ask first (answer each permission card), Auto and Full access (approve every request), Accept edits (approve file edits only) and Plan only (its read-only plan agent); each takes effect on the next turn. Question prompts arrive as events and show in the answer tray.

Nothing is typed into or read from a screen. Permission prompts ("Allow Bash?", Codex's "Run this command?", Antigravity's "Allow this command?", OpenCode's "Allow bash?") and the agent's questions (Claude's `AskUserQuestion`, Codex's `requestUserInput`, OpenCode's `question`) arrive as events and show as a card above the message box; your pick goes back over the protocol. **Stop** interrupts the turn. A permission change applies right away: Claude Code switches mode live, Codex, Antigravity and OpenCode take model, effort and permissions on their next turn. There is no trust screen. Claude Code and Codex history is read from their own transcripts; Antigravity's and OpenCode's own history isn't readable, so TerminalVibe records each session's messages, thoughts and tool calls from the protocol in `~/.terminalvibe/acp/<session id>.jsonl`. Antigravity and OpenCode have no mid-turn steering: a message sent while they work runs right after the turn.

Other agents and browser mode still use the terminal under the chat.

Clicking the agent in the footer shows the terminal and resumes the same session in the real CLI (`claude --resume`, `codex resume`, `opencode --session`), to type to it directly. The structured session hands the conversation over first; while it is mid-turn the terminal view waits (stop it or let it finish). The next message from the chat takes the session back. One agent runs in a Chat tab at a time.

What a message does:

- **The running agent matches the picks**: it goes to that agent. An agent you started by hand in the terminal matches by its kind (Claude Code, Codex); a Claude Code or Codex chat takes such a session over as a structured one.
- **Same agent, other picks**: Codex and OpenCode take model, effort and permissions per turn. Claude Code switches permissions live; for another model, effort, Fast or Ultracode its session is resumed with the new flags, so the conversation keeps its context.
- **Nothing running** (the agent exited, or the app restarted): if the chat's latest conversation was with the picked agent, that session is resumed in its own folder, so it remembers everything. Otherwise a new session starts.
- **Another agent**: the current one quits and a new session starts.

A new session in a chat that already has history gets all of it: TerminalVibe writes the conversation so far to `handoff.xml` and adds a short note pointing to it to your first message (the chat hides the note again). An agent never starts from nothing when the chat has history.

For an agent that runs in the terminal, the first run in a folder may ask whether you trust it: the question shows as a card in the chat when it can be read, otherwise the chat shows the agent's terminal. A message is never typed into a tab whose agent has exited.

## Subagents

A subagent shows as a row in the turn: its harness's logo with a status icon (spinning while it works, a check when done, a warning when it failed), its task, its latest step or its report, and how long it took. Several started together share one "Ran 3 subagents" row. Click a row to open the subagent's own thread with every step it took; send a message there to continue with it. A "Subagent of" chip above the message box leads back.

- **Built-in subagents**: Claude Code's Agent tool and OpenCode's task tool.
- **Any harness**: Claude Code, Codex, OpenCode and Antigravity chats get TerminalVibe's `delegate_task` tool (a small MCP server, `electron/delegate-mcp.js`), so you can ask any of them for a subagent on Codex, Claude Code or OpenCode, with a model ("a codex subagent", "an opencode hy4 subagent"). It runs headless in the chat's folder (`codex exec`, `claude -p`, `opencode run`) and returns its report. Each harness uses its own settings from Settings > Providers. Stop stops it too, and the same task can be delegated any number of times.
- **Permissions**: a subagent can't ask, so it gets what the chat allows without asking, at the moment it starts (a change in the chat applies to the next subagent). Full access gives it full access; Plan or Read only makes it read only; Claude Code's other modes ask before the tool runs, then let it edit the workspace; Codex Workspace write and OpenCode or Antigravity Auto / Accept edits let it edit; Ask first in Codex, OpenCode or Antigravity makes it read only.

## Interactive UI (A2UI)

Agents can answer with live UI (forms, pickers, buttons, cards, lists, tabs) using Google's [A2UI 1.0](https://a2ui.org/specification/v1.0-a2ui/) protocol. A fenced block tagged `a2ui` holding A2UI messages (a JSON array, one object, or JSON lines) renders in place as part of the reply with the basic catalog (`a2ui.js`), not as a code block (until the block is complete, it streams in as code). Inputs bound with `{"@path": …}` keep what you enter in the surface's data model, and a later `a2ui` block in the same chat can update or delete an earlier surface: an update shows the updated surface in that later reply (what you entered carries over, and it becomes the live one), while the earlier reply keeps the surface as it was. Pressing a button with an `event` action sends the agent a message: its `userMessage` (or "A2UI action: <name>") followed by an `a2ui-action` block with the A2UI `action` event, plus the surface's data model when it was created with `sendDataModel`. While the agent works, that message is queued.

Agents know the format from the start, so a plain request ("give me a form to create a project") is enough: a compact A2UI brief (`A2UI_BRIEF` in `electron/delegate-mcp.js`) is in the instructions of TerminalVibe's MCP server, which every structured chat agent gets, and Codex also receives it as its thread's developer instructions. The server's `a2ui_guide` tool holds the full reference for the rest. Beyond the basic catalog, TerminalVibe adds a **Chart** component (`type` bar, line, area, pie or donut; `stacked` for bars and areas; `labels`, `series` of `{name, values}`, `unit`, `min`/`max`, `height`): grouped or stacked bars, lines, areas, and pies/donuts (the first series split across the labels, past 8 slices folded into "Other"), in a fixed, colorblind-checked palette (light and dark sets, up to 8 series), with a legend (a pie's shows each slice's share), a hover/arrow-key tooltip and a table view (the rows button). An **Image** may also show a local file (an absolute path, `~/`, or one relative to the chat's folder; PNG, JPEG, GIF, WebP or SVG), for example a chart the agent generated. A block with raw line breaks inside its strings or trailing commas still renders.

Not supported: renderer/agent function calls (`callRendererFunction`, `callAgentFunction`) and catalogs other than the basic one.

Tests: `node scripts/test-a2ui.js`.

## Forking

Hover a reply and click the fork button beside **Copy** to fork the thread from there: a new Chat tab opens beside it ("Fork: <title>", noted "Forked from …" at the top) with the history up to that reply, in the same folder and with the same agent picks. TerminalVibe copies that history into the fork's own thread folder, so deleting the original never breaks it. The fork's first message starts a new session (any agent) that gets the copied history as a handoff; the original thread's sessions are never resumed or changed by it.

## Storage

TerminalVibe keeps a copy of each workspace's chat in `~/.terminalvibe/threads/<workspace id>/` (`history.json`, pasted `images/`), so the history survives deleted transcripts. Closing the workspace removes that folder. The agents' own transcripts (`~/.claude`, `~/.codex`) are kept.

Workspaces saved as threads by older versions load as plain workspaces with their chat.

Tests: `node scripts/test-threads.js`, which is part of `npm test`.
