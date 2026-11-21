#!/usr/bin/env node
/**
 * TerminalVibe's MCP server for chat agents: delegate_task, that runs a subagent on a harness
 * (Codex, Claude Code or OpenCode) headless in the chat's folder, waits for it and returns its final report; and
 * orchestration_guide, the terminalvibe-orchestration skill (panes, splits, browser tabs) for every chat agent, so it
 * needn't be installed per agent in Settings > Skills. The server's instructions point agents at it.
 *
 * Chat sessions get it from chat-sdk.js (delegateMcp), launched as `electron` in Node mode. Built-ins only.
 * Env (inherited from the parent agent's env; none of it secret):
 *      TERMINALVIBE_DELEGATE_LAUNCH  {"codex":{file,args},…} (resolved executables of the enabled harnesses)
 *      TERMINALVIBE_DELEGATE_ACCESS  full | read-only | edits (the parent chat's permissions)
 *      TERMINALVIBE_DELEGATE_CWD     the chat's folder
 *      TERMINALVIBE_DATA_DIR         ~/.terminalvibe: subagents/<key>.json tells the chat which session runs it
 * Each harness's own env (API keys) comes from ~/.terminalvibe/providers.json, read here.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HARNESSES = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' };
const dataDir = () => process.env.TERMINALVIBE_DATA_DIR || path.join(require('os').homedir(), '.terminalvibe');
const PROVIDERS = path.join(require('os').homedir(), '.terminalvibe', 'providers.json'); // as providers.js
// The chat finds a call's subagent by this key (threads.js delegatedSubagents computes the same one).
// ponytail: two calls with the same harness + prompt share a key, the latest run wins; add a call id if that matters.
const delegateKey = (harness, prompt) => crypto.createHash('sha1').update(`${harness}\0${prompt}`).digest('hex').slice(0, 20);

function childArgs(harness, { prompt, model }, access) {
  if (harness === 'codex') {
    // exec never asks: the parent's permissions pick the sandbox.
    const sandbox = access === 'full' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-s', access === 'read-only' ? 'read-only' : 'workspace-write'];
    // prompt null: read from stdin ("-")
    return ['exec', '--json', '--skip-git-repo-check', ...sandbox, ...(model ? ['-m', model] : []), ...(prompt == null ? ['-'] : ['--', prompt])];
  }
  if (harness === 'opencode') {
    // model: provider/model (opencode models). Read only runs its plan agent; full access approves every ask.
    // A leading space keeps a prompt that starts with "-" from being read as a flag.
    return ['run', '--format', 'json', ...(model ? ['-m', model] : []), ...(access === 'full' ? ['--auto'] : access === 'read-only' ? ['--agent', 'plan'] : []),
      /^-/.test(prompt) ? ' ' + prompt : prompt];
  }
  const mode = access === 'full' ? 'bypassPermissions' : access === 'read-only' ? 'plan' : 'acceptEdits';
  return ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode, ...(model ? ['--model', model] : []), ...(prompt == null ? [] : ['--', prompt])];
}

// One JSON event from the child: the session id as soon as it is known, then the reply and the outcome.
function onChildEvent(harness, ev, run) {
  if (harness === 'codex') {
    if (ev.type === 'thread.started' && ev.thread_id) run.session(ev.thread_id);
    else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) run.report = ev.item.text;
    else if (ev.type === 'turn.failed' || ev.type === 'error') run.error = ev.error?.message || ev.message || 'Codex failed';
  } else if (harness === 'opencode') {
    // OpenCode keeps no transcript TerminalVibe can read: record the run the way chat-sdk.js records an OpenCode
    // chat (~/.terminalvibe/acp/<session>.jsonl), so its thread shows every step and can be resumed.
    if (ev.sessionID && !run.sessionId) { run.session(ev.sessionID); run.record({ role: 'user', text: run.prompt }); }
    const part = ev.part || {};
    if (ev.type === 'text' && part.text?.trim()) { run.report = part.text.trim(); run.record({ role: 'assistant', text: run.report }); }
    else if (ev.type === 'reasoning' && part.text?.trim()) run.record({ role: 'thinking', text: part.text.trim() });
    else if (ev.type === 'tool_use' && part.state) {
      const s = part.state, input = s.input || {};
      run.record({ role: 'tool', name: String(part.tool || 'tool'), summary: clip(s.title || input.command || input.filePath || input.path || input.pattern || input.url || input.description || ''),
        detail: clip(typeof input === 'string' ? input : JSON.stringify(input, null, 2), 4000),
        ...(s.status === 'error' ? { error: true, output: String(s.error || '') } : { output: clip(String(s.output ?? ''), 64000) }) });
    } else if (ev.type === 'error') run.error = ev.error?.data?.message || ev.error?.message || ev.error?.name || 'OpenCode failed';
  } else {
    if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) run.session(ev.session_id);
    else if (ev.type === 'result') { run.report = String(ev.result || ''); if (ev.is_error) run.error = run.report || ev.subtype || 'Claude Code failed'; }
  }
}
const clip = (s, n = 200) => (s = String(s ?? ''), s.length > n ? s.slice(0, n - 1) + '…' : s);

const json = (v, fallback) => { try { return JSON.parse(v) ?? fallback; } catch { return fallback; } };
// The chat's permission pick right now (TerminalVibe rewrites the file when it changes), else the one at start.
function currentAccess() {
  try {
    const a = fs.readFileSync(process.env.TERMINALVIBE_DELEGATE_ACCESS_FILE || '', 'utf8').trim();
    if (['full', 'read-only', 'edits'].includes(a)) return a;
  } catch {}
  return ['full', 'read-only', 'edits'].includes(process.env.TERMINALVIBE_DELEGATE_ACCESS) ? process.env.TERMINALVIBE_DELEGATE_ACCESS : 'read-only';
}
const running = new Map(); // request id -> child process
// The whole tree: npm shims and agents start their own children (Windows has no process groups to signal).
function killTree(child) {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} } }
}
function delegate(input, requestId) {
  const harness = input?.harness, prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  const model = typeof input?.model === 'string' && input.model.trim() ? input.model.trim() : null;
  if (!HARNESSES[harness]) return Promise.resolve({ error: `harness must be one of: ${Object.keys(HARNESSES).join(', ')}` });
  if (!prompt) return Promise.resolve({ error: 'prompt is required' });
  const launch = json(process.env.TERMINALVIBE_DELEGATE_LAUNCH || '{}', {})[harness];
  if (!launch?.file) return Promise.resolve({ error: `${HARNESSES[harness]} is not installed or is disabled in TerminalVibe (Settings > Providers)` });
  const cwd = process.env.TERMINALVIBE_DELEGATE_CWD || process.cwd();
  if (!fs.existsSync(cwd)) return Promise.resolve({ error: `The project folder no longer exists: ${cwd}` });
  const dir = path.join(dataDir(), 'subagents');
  // One file per run: the same prompt delegated twice (or at once) keeps two runs, matched to their calls by time.
  const startedAt = Date.now();
  const file = path.join(dir, `${delegateKey(harness, prompt)}.${startedAt}.${process.pid}.${requestId ?? 0}.json`);
  const state = { harness, sessionId: null, status: 'running', model, pid: null, startedAt, endedAt: null };
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } catch {} };
  // The harness's own settings from Settings > Providers (its env, config folder) over the parent agent's env,
  // read from the file here so no API key passes through another agent's env or command line.
  const provider = json(fs.existsSync(PROVIDERS) ? fs.readFileSync(PROVIDERS, 'utf8') : '{}', {})?.[harness] || {};
  const env = { ...process.env };
  for (const k of ['ELECTRON_RUN_AS_NODE', 'TERMINALVIBE_DELEGATE_LAUNCH', 'TERMINALVIBE_DELEGATE_ACCESS', 'TERMINALVIBE_DELEGATE_ACCESS_FILE', 'TERMINALVIBE_DELEGATE_CWD']) delete env[k];
  if (provider.env && typeof provider.env === 'object') for (const [k, v] of Object.entries(provider.env)) if (/^[A-Za-z_]\w{0,127}$/.test(k) && typeof v === 'string') env[k] = v;
  const configEnv = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }[harness];
  if (configEnv && typeof provider.configDir === 'string' && provider.configDir.trim()) env[configEnv] = provider.configDir.trim().replace(/^~(?=$|[\\/])/, require('os').homedir());
  // Codex and Claude Code read the prompt from stdin: no command-line length limit, no prompt taken for a flag.
  const viaStdin = harness !== 'opencode';
  const args = childArgs(harness, { prompt: viaStdin ? null : prompt, model }, currentAccess());
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(launch.file, [...(launch.args || []), ...args], { cwd, env, stdio: [viaStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    } catch (err) { resolve({ error: err.message }); return; }
    if (requestId !== undefined) running.set(requestId, child);
    state.pid = child.pid || null;
    save();
    if (viaStdin) { child.stdin.on('error', () => {}); child.stdin.end(prompt); }
    const acp = path.join(dataDir(), 'acp');
    const run = {
      prompt, report: '', error: null, sessionId: null,
      session: id => { run.sessionId = state.sessionId = id; save(); },
      record: item => { if (!/^[\w-]{8,64}$/.test(run.sessionId || '')) return; try { fs.mkdirSync(acp, { recursive: true }); fs.appendFileSync(path.join(acp, run.sessionId + '.jsonl'), JSON.stringify({ ...item, ts: new Date().toISOString() }) + '\n'); } catch {} },
    };
    let buf = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (line) try { onChildEvent(harness, JSON.parse(line), run); } catch {}
      }
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    let done = false;
    const finish = (error, status = error ? 'failed' : 'completed') => {
      if (done) return; done = true;
      if (requestId !== undefined) running.delete(requestId);
      Object.assign(state, { status, endedAt: Date.now() });
      save();
      resolve(error ? { error, sessionId: state.sessionId } : { report: run.report || '(no reply)', sessionId: state.sessionId });
    };
    child.cancel = () => { killTree(child); finish('Stopped', 'stopped'); };
    child.on('error', err => finish(err.code === 'ENOENT' ? `${HARNESSES[harness]} was not found: ${launch.file}` : err.message));
    child.on('close', code => finish(run.error || (code ? stderr.trim().split('\n').filter(Boolean).pop() || `${HARNESSES[harness]} exited with code ${code}` : null)));
  });
}

const TOOL = {
  name: 'delegate_task',
  description: 'Run a subagent on a coding agent harness (Codex, Claude Code or OpenCode) in the current project folder, '
    + 'wait for it, and get its final report back. The TerminalVibe chat shows it as a subagent the user can open and continue. '
    + 'Use this whenever the user asks for a subagent, including one on a specific harness or model (for example "a codex subagent", '
    + '"an opencode hy4 subagent"); prefer it over opening terminal tabs or panes. The subagent sees none of this conversation: put everything it needs in the prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      harness: { type: 'string', enum: Object.keys(HARNESSES), description: 'The coding agent to run: codex, claude or opencode.' },
      description: { type: 'string', description: 'A short (3-6 word) title for the task, shown in the chat.' },
      prompt: { type: 'string', description: 'The complete task for the subagent.' },
      model: { type: 'string', description: 'Optional model; leave out for the harness default. Codex: a model id (gpt-…). Claude Code: an alias (opus, sonnet, haiku) or id. OpenCode: provider/model as listed by `opencode models` (for example opencode/hy4-flash-free).' },
    },
    required: ['harness', 'description', 'prompt'],
  },
};

// The orchestration skill, shipped with the app: next to electron/ in dev, in resources/skills when packaged
// (this script runs from resources/app.asar.unpacked/electron).
const SKILL = 'terminalvibe-orchestration';
const skillDir = () => [process.env.TERMINALVIBE_SKILL_DIR, path.join(__dirname, '..', 'skills', SKILL), path.join(__dirname, '..', '..', 'skills', SKILL)]
  .find(dir => dir && fs.existsSync(path.join(dir, 'SKILL.md')));
const INSTRUCTIONS = 'You are running inside TerminalVibe, a terminal workspace app. When the user asks to open, arrange or inspect '
  + 'TerminalVibe panes, splits, terminal tabs, agents in tabs or embedded browser tabs (or to read their output or send them input), '
  + 'call the orchestration_guide tool first: it returns how to do it with TerminalVibe\'s CLI. For a subagent, use delegate_task instead.';
const GUIDE = {
  name: 'orchestration_guide',
  description: 'How to control TerminalVibe: open agents, terminals or browser tabs in existing or new splits, navigate browser panes, '
    + 'arrange panes, read terminal output and browser content, and send follow-up input. Call this before doing any of that; '
    + 'it returns the full instructions and the path of the CLI to run.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { title: 'TerminalVibe orchestration guide', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
function guideText() {
  const dir = skillDir();
  if (!dir) return null;
  const body = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  return `Skill directory: ${dir}\nRun its client as: node ${JSON.stringify(path.join(dir, 'scripts', 'tv.js'))} <command> `
    + `(paths like scripts/tv.js below are relative to the skill directory).\n\n${body}`;
}

const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  // The agent stopped the call (the user pressed Stop): stop its subagent.
  if (method === 'notifications/cancelled') { running.get(params?.requestId)?.cancel(); return; }
  if (id === undefined) return; // other notifications
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
    serverInfo: { name: 'terminalvibe', version: '1.0.0' }, ...(skillDir() ? { instructions: INSTRUCTIONS } : {}) } });
  if (method === 'ping') return send({ id, result: {} });
  // In a read-only chat the subagent is read only too: say so, so agents needn't ask before each call.
  if (method === 'tools/list') {
    const readOnly = currentAccess() === 'read-only';
    return send({ id, result: { tools: [{ ...TOOL, annotations: { title: 'Run a subagent', readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } },
      ...(skillDir() ? [GUIDE] : [])] } });
  }
  if (method === 'tools/call' && params?.name === GUIDE.name) {
    const text = guideText();
    return send({ id, result: { content: [{ type: 'text', text: text || 'The TerminalVibe orchestration skill is not available in this build.' }], isError: !text } });
  }
  if (method === 'tools/call') {
    if (params?.name !== TOOL.name) return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
    const r = await delegate(params.arguments || {}, id);
    const head = r.sessionId ? `[${HARNESSES[params.arguments?.harness]} session ${r.sessionId}]\n` : '';
    return send({ id, result: { content: [{ type: 'text', text: head + (r.error ? `The subagent failed: ${r.error}` : r.report) }], isError: !!r.error } });
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

if (require.main === module) {
  // Run files are only needed to show a subagent's row: drop the ones older than 30 days.
  const runs = path.join(dataDir(), 'subagents');
  fs.promises.readdir(runs).then(names => names.forEach(n => {
    const f = path.join(runs, n);
    fs.promises.stat(f).then(s => { if (s.isFile() && Date.now() - s.mtimeMs > 30 * 86400000) return fs.promises.unlink(f); }).catch(() => {});
  })).catch(() => {});
  let buf = '';
  process.stdin.setEncoding('utf8').on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (line) { let msg; try { msg = JSON.parse(line); } catch { continue; } handle(msg).catch(err => msg.id !== undefined && send({ id: msg.id, error: { code: -32603, message: err.message } })); }
    }
  });
  // The agent went away: its subagents go too.
  const quit = () => { for (const c of running.values()) c.cancel(); setTimeout(() => process.exit(0), 200); };
  process.stdin.on('end', quit);
  process.on('SIGTERM', quit);
  process.on('SIGINT', quit);
}

module.exports = { delegateKey, childArgs };
