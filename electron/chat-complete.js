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
    if (e.isDirectory()) out.push(...mdCommands(full, `${prefix}${e.name}:`));
    else if (e.name.endsWith('.md')) out.push({ name: prefix + e.name.slice(0, -3), description: describe(full) });
  }
  return out;
}
function skills(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map(e => ({ name: e.name, description: describe(path.join(dir, e.name, 'SKILL.md')) }));
}

// Built-ins whose result shows up as a reply in the chat (the TUI-only ones, like /model or /cost, don't).
const BUILTIN = {
  claude: [['compact', 'Summarize the conversation to free up context'], ['review', 'Review a pull request'], ['init', 'Write a CLAUDE.md for this project'],
    ['security-review', 'Review the pending changes for security issues'], ['pr-comments', 'Get the comments of a GitHub pull request']],
  codex: [['review', 'Review the current changes'], ['init', 'Write an AGENTS.md for this project'], ['compact', 'Summarize the conversation to free up context']],
};
function listCommands(harness, cwd, home = os.homedir(), env = process.env) {
  const builtin = (BUILTIN[harness] || []).map(([name, description]) => ({ name, description }));
  let own = [];
  if (harness === 'claude') {
    const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    const project = typeof cwd === 'string' && path.isAbsolute(cwd) ? path.join(cwd, '.claude') : null;
    own = [...(project ? [...mdCommands(path.join(project, 'commands')), ...skills(path.join(project, 'skills'))] : []),
      ...mdCommands(path.join(config, 'commands')), ...skills(path.join(config, 'skills'))];
  } else if (harness === 'codex') {
    own = mdCommands(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'prompts')).map(c => ({ ...c, name: 'prompts:' + c.name }));
  }
  const seen = new Set();
  return [...own.map(c => ({ ...c, custom: true })), ...builtin].filter(c => !seen.has(c.name) && seen.add(c.name));
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
    assert.equal(listCommands('codex', project, home, {})[0].name, 'prompts:fix');
    fs.rmSync(home, { recursive: true, force: true });
    console.log('PASS: chat @ file lists and slash commands');
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
