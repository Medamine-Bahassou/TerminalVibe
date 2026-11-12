# Projects and threads

The **Projects** section sits above Settings in the left sidebar. Use **+** to choose a project folder (or enter its absolute path in the browser version). Expand a project and use **+** to create a named thread.

The pencil button in the Projects header starts a thread with **No project** selected. Starting an agent or a terminal from it creates a TerminalVibe-managed folder `~/.terminalvibe/scratch/<uuid>`, and the thread is listed under **Scratch**.

Selecting a thread opens a dedicated view: a thread header, a project folder selector and four agent cards in the center, with **History of thread** on the right. The cards start Claude Code, Codex, Gemini CLI or OpenCode in a terminal. The chosen CLI must be installed locally. Selecting a card again opens its existing terminal for the current app session. **Agents** and **Terminals** switch the center view; the history stays visible.

The history stores session launch details and the most recent 300 terminal lines (up to 24,000 characters) per launch. It updates while the thread is open and persists with the workspace state. These are terminal output excerpts, not parsed chat transcripts. Restoring the app preserves these excerpts without treating restored shells as running agents. Missing CLI and authentication errors remain visible in the terminal.

Changing the folder selector moves the thread to that project and uses its folder for future launches. Existing terminal directories remain unchanged. On narrow windows the history sits below the center view.

Each thread has its own terminal tabs and splits. Its first terminal opens in the project folder; additional terminals inherit the current terminal directory. Run any installed CLI harness in those terminals. Switching threads keeps their running processes alive.

Projects, thread names, layouts and terminal directories save automatically in the current profile. Restarting TerminalVibe restores shells and layouts, not running processes or arbitrary harness conversations.

To continue a harness conversation after restarting:

1. Open the thread's **…** actions.
2. Choose **Save resume command** and enter the harness's command with the specific conversation/session ID.
3. Choose **Run resume command** to execute it in a new terminal in the project folder.

Saving a command or restoring the application never executes it. Conversation history remains owned by the harness; TerminalVibe stores the command you supply. You can update that command when changing harnesses or sessions.

Thread actions also allow renaming and deletion. Removing a project keeps its threads as regular workspaces. Deleting a thread uses the existing workspace close confirmation.

Validation: `npm run test:projects` runs isolated UI and real state serialization/restore tests without launching harnesses or touching user configuration.
