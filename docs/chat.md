# Chat tabs

Any workspace can open a **Chat** tab: the conversation of the coding agents run in that workspace, with a message box to talk to the one still running.

## Opening it

- The chat button in the titlebar.
- Right-click a tab bar's **+** → **Chat ›** and pick an agent (only the agent CLIs found on your PATH are listed), or the tab group's **⋯** menu → **Chat**.

Each Chat tab is its own thread (its history, agent, picks and title), and a workspace can hold as many as you like: **Chat ›** in the tab bar menu, **New chat** in the **⋯** menu and the threads sidebar's pen button always open a new one; the titlebar button opens the workspace's most recent one. A Chat tab is named after its first prompt, keeps its own unsent draft and attachments, and can be split, moved and closed like any tab; it comes back after a restart. Two chats side by side show the focused one live and the other as a still picture until you click it.

## Threads sidebar

The titlebar's threads button (at the right) opens the threads sidebar: every workspace chat as a card, newest activity first, split into **Working** (its agent is busy: a spinner and the elapsed time) and **Settled**. A card shows the folder, the time since the last activity, the status, the title (the chat's first prompt), the git branch and the agent's logo; hover it for the full folder, workspace, branch and model. Click a card to open that chat, search to filter, and use the pen button for a new thread (a new workspace with its Chat tab open). The sidebar remembers whether it was open.

## What it shows

Every agent CLI started in one of the workspace's terminal tabs (for example typing `claude` or `codex` in its shell) becomes a session of the workspace's chat. The Chat tab reads the agents' own transcripts and shows your prompts, the replies, tool calls (expand one for the full command) and pasted images. Only **Claude Code** and **Codex** transcripts can be read. Other agents are detected, but their sessions show no history.

Each prompt is a turn. A finished turn folds its steps under **Worked for 16s ›** (click to open): the agent's thinking (**Thought**, open it for the full text), interim replies and tool calls (each opens to its full command). Its final reply stays visible, followed by the files it changed: **2 changed files +12 −3**, one row per file; click a file, or **Open diff** for all of them, to see the diff. The turn in progress shows its steps as they come. Thinking comes from Claude Code's transcript and from Codex's reasoning summaries (when Codex writes one); file changes come from the agents' edit tools (Claude Code's Edit / Write, Codex's apply_patch), not from files changed through shell commands.

- **Ctrl+F** in the Chat tab finds text in the history.
- Hover a message to copy it.

## Sending messages

**Enter** sends, **Shift+Enter** adds a new line. Your message shows and the box clears at once, even while an agent starts. A row at the end of the chat shows what is happening ("Starting Claude Haiku", then "Thinking · 4s") until the agent's turn ends; each finished prompt then shows how long it took ("Worked for 12s"). If the agent cannot start, your text goes back into the box.

Under the box:

- **Model chip** (agent logo, model, effort) opens the model picker: agents at left, a searchable model list in the middle, reasoning effort at right. Claude Code offers Opus, Sonnet, Haiku and Fable (the CLI's aliases for each family's latest model). Codex lists the models from its own cache (`~/.codex/models_cache.json`) with each model's effort levels; the desktop app reads it.
- **Footer**: the folder, the agent (click it to see its terminal), the git branch and the permissions for the next start (Ask first, Accept edits, Plan only, Full access; for Codex: Read only, Workspace write, Full access). The permissions are also at the foot of the picker's reasoning column.

The agent the chat starts runs inside the Chat tab itself, in the terminal under the chat. Clicking the agent in the footer shows that terminal (for its permission prompts and questions, or to type to it directly); the chat button that appears at the right of the tab bar brings the chat back. One agent runs in a Chat tab at a time: starting another one quits the current one first (its session stays resumable).

What a message does:

- **The running agent matches the picks**: it goes to that agent, through the same input path as typing in its tab. An agent you started by hand matches by its kind (Claude Code, Codex).
- **Same agent, other model, effort or permissions** (one the chat started): it quits and its session is resumed with the new flags, so the conversation keeps its context.
- **Nothing running** (the agent exited, or the app restarted): if the chat's latest conversation was with the picked agent, that session is resumed (`claude --resume`, `codex resume`) in its own folder, so it remembers everything. Otherwise a new session starts.
- **Another agent**: the current one quits and a new session starts.

A new session in a chat that already has history gets all of it: TerminalVibe writes the conversation so far to `handoff.xml` and adds a short note pointing to it to your first message (the chat hides the note again). An agent never starts from nothing when the chat has history.

The first run in a folder asks whether you trust it. The chat switches to the agent's terminal, waits for your answer, then switches back and sends. A message is never typed into a tab whose agent has exited.

## Storage

TerminalVibe keeps a copy of each workspace's chat in `~/.terminalvibe/threads/<workspace id>/` (`history.json`, pasted `images/`), so the history survives deleted transcripts. Closing the workspace removes that folder. The agents' own transcripts (`~/.claude`, `~/.codex`) are kept.

Workspaces saved as threads by older versions load as plain workspaces with their chat.

Tests: `node scripts/test-threads.js`, which is part of `npm test`.
