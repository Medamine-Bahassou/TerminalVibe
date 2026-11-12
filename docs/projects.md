# Projects and threads

A **project** is a folder on disk. A **thread** is a workspace tied to one folder plus the chain of agent sessions that ran in it. Threads are listed in the **Threads** section of the left sidebar, not in the workspace list.

## Creating a thread

- **+** in the Threads header starts a thread with **No project** selected.
- The folder button adds a project folder (or asks for its path in browser mode) and starts a thread in it.
- Right-click a project for **New thread** or **Remove project**. Removing a project deletes its threads; files on disk are kept.

A new thread is a draft. It stays out of the sidebar and the saved state until you start an agent or open a terminal in it. Switching away from a draft discards it.

The thread page has a project chooser, one card for each agent CLI found on `PATH` (Claude Code, Codex, Gemini CLI, Antigravity, OpenCode, Cursor Agent, Copilot CLI, Amp, Qwen Code, Aider), and **Open a plain terminal**. The project is locked once the thread has started. Closing a thread's last tab brings the page back.

A thread with **No project** gets its own folder, `~/.terminalvibe/scratch/<uuid>`, when something first runs in it. Such threads sit at the top of the list, outside any project.

## History

The **Thread history** titlebar button opens the right panel. It reads the agents' own transcripts and shows your prompts, the replies, tool calls and pasted images. Only **Claude Code** and **Codex** transcripts can be read. Other agents run normally, but their sessions show no history.

- **Ctrl+F** in the panel finds text in the history.
- Hover a message to copy it or **fork** from it. A fork is a new thread with the history up to that message, and any agent can continue it.
- The thread is named after its first prompt. Right-click a thread to rename it.
- Sidebar rows show the last activity time, the git branch and a logo for each agent used.

## Switching agents

A new tab in a started thread (**+** or Ctrl+Shift+T) opens on the agent cards. Pick one to open that agent in a new tab next to the others, or choose **Use as a plain terminal** (or press Esc) to keep the tab's shell.

Every agent started in a thread is a new session of that thread. This includes agents started from the cards, and agents typed into one of its terminals, for example `codex`. Picking the same Claude Code or Codex session again resumes it.

When a new agent joins a thread that already has history, TerminalVibe writes the full history to `handoff.xml`. A short note pointing to that file is added to the first message you send to the new agent.

## Storage

Each thread has a folder, `~/.terminalvibe/threads/<id>/`, that contains:

- `thread.json`: title, project and sessions
- `history.json`: TerminalVibe's copy of the combined history, which is kept if an agent's transcript is deleted
- `images/`: pasted images
- `handoff.xml`: the last handoff

Thread names, projects and layouts are saved with the current profile. Restarting TerminalVibe restores shells and layouts, not running agents.

**Delete thread** removes the thread's folder and, for a scratch thread, its scratch folder. The agents' own transcripts (`~/.claude`, `~/.codex`) are kept.

Tests: `node scripts/test-threads.js`, which is part of `npm test`.
