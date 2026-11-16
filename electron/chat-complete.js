'use strict';
// Suggestions for the chat input: files/folders of the chat's folder (@ mentions) and an agent's
// slash commands (built-ins plus the user's own commands, skills and prompts).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX = 8000;
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.cache', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'coverage']);

// Files of a folder, relative: git's list when it is a repo (respects .gitignore), else a bounded walk.
function gitFiles(cwd) {
  return new Promise(resolve => execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd, timeout: 4000, maxBuffer: 32 << 20 },
    (err, out) => resolve(err ? null : out.split('\0').filter(Boolean).slice(0, MAX))));
}
async function walkFiles(cwd) {
  const files = [], queue = [''];
  while (queue.length && files.length < MAX) {
    const rel = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(path.join(cwd, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) queue.push(p); }
      else if (e.isFile()) files.push(p);
    }
  }
  return files;
}
async function listFiles(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return { files: [], dirs: [] };
  const files = (await gitFiles(cwd)) || await walkFiles(cwd);
  const dirs = new Set();
  for (const f of files) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
  return { files, dirs: [...dirs] };
}

// A command file's description: frontmatter `description:`, else its first non-empty line.
function describe(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch { return ''; }
  const front = text.match(/^---\n([\s\S]*?)\n---/);
  const d = front?.[1].match(/^description:\s*["']?(.*?)["']?\s*$/m)?.[1];
  return (d || text.replace(/^---\n[\s\S]*?\n---/, '').split('\n').find(l => l.trim()) || '').replace(/^#+\s*/, '').trim().slice(0, 120);
}
// *.md under a folder as "a:b" names (sub-folders become namespaces).
function mdCommands(dir, prefix = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() || (e.isSymbolicLink() && fs.statSync(full, { throwIfNoEntry: false })?.isDirectory())) out.push(...mdCommands(full, `${prefix}${e.name}:`));
    else if (e.name.endsWith('.md')) out.push({ name: prefix + e.name.slice(0, -3), description: describe(full) });
  }
  return out;
}
function skills(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter(e => fs.existsSync(path.join(dir, e.name, 'SKILL.md'))) // follows symlinked skill folders
    .map(e => ({ name: e.name, description: describe(path.join(dir, e.name, 'SKILL.md')) }));
}

// Every built-in, as the TUI's own "/" menu lists it (Claude Code 2.1.325, Codex 0.169). The chat types
// into the agent's terminal, so TUI-only commands work too.
// ponytail: hand-copied tables, re-copy when a CLI release adds commands.
const table = t => t.split('\n').map(l => { const i = l.indexOf('|'); return { name: l.slice(0, i), description: l.slice(i + 1) }; });
const BUILTIN = {
  claude: table(`add-dir|Add a new working directory
advisor|Let Claude consult a stronger model at key moments
artifact-capabilities|Runtime capabilities for published Artifacts
artifact-diagramming|Diagramming guidance for Artifacts
artifacts|Browse your published and shared artifacts
auto-mode-setup|Teach auto mode about your environment, plus optional rule tweaks
autocompact|Set how full the context gets before auto-summarizing
autofix-pr|Monitor and autofix any issues with the current PR
background|Send this session to the background and free the terminal
batch|Plan a large change; background agents each open a PR
branch|Create a branch of the current conversation at this point
btw|Ask a quick side question without interrupting the main conversation
bug|Report a bug or share your conversation
cd|Move this session to a new working directory
chrome|Open Claude in Chrome settings
claude-api|Build and debug apps that use the Claude API
claude-in-chrome|Let Claude browse and interact with pages in your Chrome
clear|Start a new session with empty context
code-review|Review the current diff or a PR for bugs and cleanups
color|Set the prompt bar color for this session
compact|Free up context by summarizing the conversation so far
config|Open settings
context|Visualize current context usage as a colored grid
copy|Copy Claude's last response to clipboard
dataviz|Chart and dashboard design guidance
debug|Turn on debug logging and investigate problems
design|Make a new Design artifact from a brief
design-login|Authorize design-system access for /design-sync
design-sync|Push your design system components to claude.ai/design
diff|Toggle the diff panel showing uncommitted changes
doctor|Health-check your setup and fix issues
effort|Set effort level for model usage
exit|Exit the CLI
export|Export the current conversation to a file or clipboard
fast|Toggle fast mode
feedback|Send feedback to Anthropic or report a bug
fewer-permission-prompts|Pre-approve safe read-only commands based on your usage
focus|Toggle focus view: just your prompt, summary, and response
fork|Copy this conversation into a new background session
goal|Set a goal Claude checks before stopping
help|Show help and available commands
hooks|View hook configurations for tool events
ide|Manage IDE integrations and show status
import|Import config from another AI coding agent
init|Initialize a new CLAUDE.md file with codebase documentation
insights|Generate a report analyzing your Claude Code sessions
install-github-app|Set up Claude GitHub Actions for a repository
install-slack-app|Install the Claude Slack app
keybindings|Open your keyboard shortcuts file
list-agents|List subagents, teammates, and other Claude sessions
login|Sign in with your Anthropic account
logout|Sign out from your Anthropic account
loop|Repeat a prompt or command on an interval
mcp|Manage MCP servers
memory|Edit CLAUDE.md files and memory settings
mobile|Show QR code to download the Claude mobile app
model|Set the AI model for Claude Code
output-style|List output styles or switch to one
permissions|Manage allow and deny tool permission rules
plan|Enable plan mode or view the current session plan
plugin|Manage Claude Code plugins
plugin-authoring|Write a mod: a live pane, view or behaviour change in Claude Code
powerup|Discover Claude Code features through quick interactive lessons
privacy-settings|View and update your privacy settings
radio|Listen to Claude FM lo-fi radio
rate-limit-options|Manage usage limits and upgrade options
recap|Generate a one-line session recap now
release-notes|View release notes
reload-plugins|Activate pending plugin changes in the current session
reload-skills|Pick up skills added or changed on disk during this session
remote-control|Control this session from your phone or claude.ai/code
remote-env|Choose the default environment for cloud agents
rename|Rename the current conversation
restart|Restart Claude Code and keep this session
resume|Resume a previous conversation
rewind|Restore the code and/or conversation to a previous point
run|Launch this project's app to see your change working
run-skill-generator|Create a skill that knows how to run this project's app
sandbox|Configure sandboxing
schedule|Create and manage routines: cloud agents on a schedule
scroll-speed|Adjust mouse wheel scroll speed
security-review|Complete a security review of the pending changes on the current branch
send-to-project|Send this session's work to a Claude Project
simplify|Clean up the changed code without changing behavior
skill-doctor|Show which loaded skills are unused and costing context
skills|List available skills
slides|Make a new Slides deck artifact from a brief
status|Show Claude Code status: version, model, account, connectivity
statusline|Set up Claude Code's status line UI
stickers|Check Claude Code sticker availability
subtask|Send a subagent off with your full context
tasks|View and manage everything running in the background
team-onboarding|Help teammates ramp on Claude Code with a guide from your usage
teleport|Send this session to the cloud, or resume one from claude.ai
terminal-setup|Install Shift+Enter key binding for newlines
theme|Change the theme
tui|Set the terminal UI renderer (default | fullscreen)
ultrareview|Find and verify bugs in your branch using a cloud session
update-config|Change settings: hooks, permissions, environment variables
upgrade|Upgrade your plan for higher rate limits and more Opus
usage|Show session cost, plan usage, and activity stats
usage-credits|Configure usage credits or request them from your admin
verify|Try your change and report if it works
voice|Toggle voice mode
web-setup|Set up cloud sessions with your GitHub account
whiteboard|Make a new Whiteboard artifact from a brief`),
  codex: table(`agents|open the agent command center
approve|approve one retry of a recent auto-review denial
archive|archive this session
cd|change the current working directory
clear|clear the terminal and start a new chat
compact|summarize conversation to prevent hitting the context limit
config|configure Codex preferences
copy|copy the last response or part of it
daemon|manage the local background server
daybreak|learn about broader access for cybersecurity work
delete|permanently delete this session
diff|show git diff (including untracked files)
exit|exit Codex
experimental|toggle experimental features
export|export the conversation as markdown
fast|2x speed, increased usage
feedback|send logs to maintainers or save a ZIP
fork|fork the current chat
goal|set or view the goal for a long-running task
hooks|view and manage lifecycle hooks
ide|include current selection, open files, and other context from your IDE
import|import setup, this project, and recent chats from Claude Code
init|create an AGENTS.md file with instructions for Codex
keymap|remap TUI shortcuts
logout|log out of Codex
mcp|list MCP tools; use /mcp verbose or /mcp login <name>
memories|configure memory use and generation
mention|mention a file
model|choose what model and reasoning effort to use
new|start a new chat during a conversation
permissions|choose what Codex is allowed to do
pets|choose or hide the terminal pet
plan|switch to Plan mode
plugins|browse plugins
presets|run or save reusable prompts and slash commands
ps|list background terminals
pwd|show the current working directory
raw|toggle raw scrollback mode for copy-friendly terminal selection
recap|summarize the current conversation now
rename|rename the current thread
resume|resume a saved chat
review|review my current changes and find issues
side|start a side conversation
skills|use skills to improve how Codex performs specific tasks
status|show current session configuration and token usage
statusline|configure which items appear in the status line
stop|stop all background terminals
subagents|switch between this session's subagents
theme|choose a syntax highlighting theme
title|configure which items appear in the terminal title
tui|choose the TUI mode for the next launch
usage|view account usage or use a usage limit reset
vim|toggle Vim mode for the composer
voice|start or stop voice; use /voice settings to choose a voice
warnings|view retained warnings and diagnostic details
worktree|start or continue a conversation in a new worktree`),
};
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// Enabled plugins' commands and skills, named "plugin:name" like the TUI shows them.
function pluginCommands(config) {
  const installed = readJson(path.join(config, 'plugins', 'installed_plugins.json'))?.plugins || {};
  const enabled = readJson(path.join(config, 'settings.json'))?.enabledPlugins || {};
  const out = [];
  for (const [id, installs] of Object.entries(installed)) {
    if (enabled[id] === false) continue;
    const dir = installs?.[0]?.installPath;
    if (!dir) continue;
    const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json')) || {};
    const name = manifest.name || id.split('@')[0];
    // The manifest can point commands/skills at other folders (string or list), else the default ones.
    const paths = (v, def) => [def, ...[].concat(v || [])].map(p => path.resolve(dir, p));
    const found = [...paths(manifest.commands, 'commands').flatMap(d => mdCommands(d)), ...paths(manifest.skills, 'skills').flatMap(skills)];
    for (const c of found) out.push({ ...c, name: `${name}:${c.name}` });
  }
  return out;
}
// Skills synced from the claude.ai account: skills/synced/<bucket>/<skill>/SKILL.md.
function syncedSkills(config) {
  const root = path.join(config, 'skills', 'synced');
  let buckets = [];
  try { buckets = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return buckets.filter(b => b.isDirectory() && !b.name.startsWith('.')).flatMap(b => skills(path.join(root, b.name)));
}
// The cwd's .claude folders and its parents' (Claude Code loads nested project commands too).
function projectDirs(cwd, home) {
  const dirs = [];
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return dirs;
  for (let d = path.resolve(cwd); d !== home; d = path.dirname(d)) {
    dirs.push(path.join(d, '.claude'));
    if (path.dirname(d) === d) break;
  }
  return dirs;
}
function listCommands(harness, cwd, home = os.homedir(), env = process.env) {
  let own = [];
  if (harness === 'claude') {
    const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    own = [...projectDirs(cwd, home).flatMap(p => [...mdCommands(path.join(p, 'commands')), ...skills(path.join(p, 'skills'))]),
      ...mdCommands(path.join(config, 'commands')), ...skills(path.join(config, 'skills')), ...syncedSkills(config), ...pluginCommands(config)];
  } else if (harness === 'codex') {
    own = mdCommands(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'prompts')).map(c => ({ ...c, name: 'prompts:' + c.name }));
  }
  const seen = new Set(['model', 'effort']); // the chat's model picker sets these
  // The chat's own: a side question opens a side chat (forked from this one) instead of the TUI overlay.
  const chat = [{ name: 'side', description: 'Ask a side question in a new side chat' }, { name: 'btw', description: 'Ask a side question in a new side chat' }];
  return [...own.map(c => ({ ...c, custom: true })), ...chat, ...(BUILTIN[harness] || [])].filter(c => !seen.has(c.name) && seen.add(c.name));
}

module.exports = { listFiles, listCommands };

if (require.main === module) {
  const assert = require('assert');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-complete-'));
  const project = path.join(home, 'proj');
  fs.mkdirSync(path.join(project, 'src', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(project, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'lib', 'a.js'), '');
  fs.writeFileSync(path.join(project, 'node_modules', 'x', 'b.js'), '');
  fs.mkdirSync(path.join(home, '.claude', 'commands', 'git'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'commands', 'git', 'ship.md'), '---\ndescription: Ship it\n---\nDo the thing');
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'lint'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'lint', 'SKILL.md'), '# Lint the code\n');
  const plug = (id, dir) => {
    fs.mkdirSync(path.join(home, dir, 'skills', 'go'), { recursive: true });
    fs.writeFileSync(path.join(home, dir, 'skills', 'go', 'SKILL.md'), '---\ndescription: Go now\n---\n');
    return [id, [{ installPath: path.join(home, dir) }]];
  };
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: Object.fromEntries([plug('pl@m', 'p1'), plug('off@m', 'p2')]) }));
  fs.mkdirSync(path.join(home, 'p2', 'skills', 'x'), { recursive: true });
  fs.writeFileSync(path.join(home, 'p2', 'skills', 'x', 'SKILL.md'), 'x');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'pl@m': true, 'off@m': false } }));
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'synced', 'b1', 'pdf'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'synced', 'b1', 'pdf', 'SKILL.md'), '# Read PDFs\n');
  fs.mkdirSync(path.join(home, '.codex', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'prompts', 'fix.md'), 'Fix the bug');
  (async () => {
    const { files, dirs } = await listFiles(project);
    assert.deepEqual(files, ['src/lib/a.js'], 'Walk skips node_modules');
    assert.deepEqual(dirs.sort(), ['src', 'src/lib']);
    const claude = listCommands('claude', project, home, {});
    assert.deepEqual(claude.find(c => c.name === 'git:ship'), { name: 'git:ship', description: 'Ship it', custom: true });
    assert.equal(claude.find(c => c.name === 'lint').description, 'Lint the code');
    assert(claude.some(c => c.name === 'compact' && !c.custom));
    assert(['resume', 'permissions', 'help', 'rewind'].every(n => claude.some(c => c.name === n)), 'TUI-only built-ins listed');
    assert(!claude.some(c => c.name === 'model' || c.name === 'effort'), 'Model picker commands hidden');
    assert.equal(claude.find(c => c.name === 'btw').description, 'Ask a side question in a new side chat', 'btw opens a side chat');
    assert.equal(claude.find(c => c.name === 'pl:go').description, 'Go now', 'Enabled plugin skills');
    assert(!claude.some(c => c.name === 'off:x'), 'Disabled plugins skipped');
    assert.equal(claude.find(c => c.name === 'pdf').description, 'Read PDFs', 'Synced account skills');
    assert(!listCommands('codex', project, home, {}).some(c => c.name === 'model'));
    assert.equal(listCommands('codex', project, home, {})[0].name, 'prompts:fix');
    fs.rmSync(home, { recursive: true, force: true });
    console.log('PASS: chat @ file lists and slash commands');
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
