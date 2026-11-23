// Chat agents driven through their structured protocols instead of a terminal:
//  - Claude Code in headless stream-json mode (`claude -p --input-format stream-json --output-format stream-json`,
//    permission prompts answered over stdio: the protocol the Claude Agent SDK speaks);
//  - Codex through `codex app-server` (JSON-RPC over stdio, the interface its IDE extension uses).
// One process per Chat tab (key = the tab id). Both run on the user's own installed CLI and login.
// The renderer still reads the conversation from the agents' transcripts; this module only starts
// sessions, sends messages, and turns each protocol into the same few events:
//   session {sessionId} · busy · idle {error?} · ask {ask} · ask-done {id} · mode {mode} · exit {error?}
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { A2UI_BRIEF } = require('./delegate-mcp'); // Codex gets the A2UI brief as developer instructions

const ASK_INPUT = 'Type something';
const skillReferences = text => text.matchAll(/(?:^|[\s([{])\$([\w:.-]+?)(?=$|[\s,!?;)\]}]|\.(?=$|\s))/g);
function expandSlashSkill(text, references, skills) {
  const first = references.find(match => skills.some(skill => skill.name === match[1]));
  if (!first) return text;
  const [, name] = first;
  const rest = first.index === 0 && first[0] === '$' + name ? text.slice(first[0].length).trimStart() : text;
  return '/' + name + (rest ? ' ' + rest : '');
}

// A Windows npm shim (.cmd) can't be spawned directly. It wraps `node <script>`: run that instead, so
// arguments (JSON settings, paths) are passed as-is, never re-parsed by cmd.exe.
function resolveLaunch(bin, args, platform = process.platform, readFile = f => fs.readFileSync(f, 'utf8')) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(bin)) return { file: bin, args };
  try {
    const m = /"%dp0%\\([^"]+\.(js|cjs|mjs|exe))"/i.exec(readFile(bin));
    const target = m && path.win32.join(path.win32.dirname(bin), m[1]);
    // Newer packages (opencode-ai) ship a native binary behind the shim: run it directly.
    if (m) return m[2].toLowerCase() === 'exe' ? { file: target, args } : { file: 'node', args: [target, ...args] };
  } catch {}
  return null;
}

// ── Asks: a question with choices the chat shows in its answer tray ──
// options: [{ label, desc, input? (free text), submit? }], multi: checkboxes + Submit.
const short = (s, n = 400) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function toolSummary(name, input = {}) {
  if (input.command) return [short(input.command)];
  if (input.file_path || input.notebook_path || input.path) return [input.file_path || input.notebook_path || input.path];
  if (input.url) return [input.url];
  if (input.pattern) return [input.pattern];
  const json = JSON.stringify(input);
  return json && json !== '{}' ? [short(json, 300)] : [];
}
// Claude Code's AskUserQuestion: one tray per question, answered in turn.
function claudeQuestionAsk(q) {
  return {
    question: q.question || q.header || 'Claude has a question', header: q.question ? q.header || '' : '', detail: [], multi: !!q.multiSelect,
    options: [...(q.options || []).map(o => ({ label: String(o.label), desc: o.description || '' })), { label: ASK_INPUT, desc: '', input: true },
      ...(q.multiSelect ? [{ label: 'Submit', submit: true }] : [])],
  };
}
// A tool waiting for permission.
function claudePermissionAsk(req) {
  const name = req.display_name || req.tool_name;
  if (req.tool_name === 'ExitPlanMode') {
    return { question: 'Start with this plan?', detail: String(req.input?.plan || '').split('\n').filter(Boolean).slice(0, 6).map(l => short(l, 200)),
      options: [{ label: 'Yes, start' }, { label: 'No, keep planning' }] };
  }
  return {
    question: `Allow ${name}?`, detail: [...(req.description && req.description !== name ? [short(req.description, 200)] : []), ...toolSummary(name, req.input),
      ...(req.decision_reason ? [short(req.decision_reason, 300)] : [])],
    options: [{ label: 'Yes' }, ...(req.permission_suggestions?.length ? [{ label: "Yes, and don't ask again" }] : []), { label: 'No' }],
  };
}
// Codex approvals: the choices it offers (availableDecisions), in its words.
const CODEX_DECISIONS = { accept: 'Yes', acceptForSession: 'Yes, for this session', decline: 'No', cancel: 'No, and stop' };
function codexDecisions(params) {
  const list = params.availableDecisions?.length ? params.availableDecisions : ['accept', 'acceptForSession', 'decline', 'cancel'];
  return list.map(d => typeof d === 'string' ? { label: CODEX_DECISIONS[d] || d, decision: d }
    : d.acceptWithExecpolicyAmendment ? { label: "Yes, and don't ask again for this command", decision: d } : null).filter(Boolean);
}
function codexAsk(method, params) {
  if (method === 'item/commandExecution/requestApproval') {
    const d = codexDecisions(params);
    return { ask: { question: short(params.reason || 'Run this command?', 300), detail: [short(params.command || ''), ...(params.cwd ? [params.cwd] : [])].filter(Boolean), options: d.map(x => ({ label: x.label })) },
      answer: i => ({ decision: d[i]?.decision ?? 'decline' }) };
  }
  if (method === 'item/fileChange/requestApproval') {
    const d = ['accept', 'acceptForSession', 'decline', 'cancel'].map(x => ({ label: CODEX_DECISIONS[x], decision: x }));
    return { ask: { question: short(params.reason || 'Allow these file changes?', 300), detail: params.grantRoot ? [params.grantRoot] : [], options: d.map(x => ({ label: x.label })) },
      answer: i => ({ decision: d[i]?.decision ?? 'decline' }) };
  }
  if (method === 'item/permissions/requestApproval') {
    return { ask: { question: short(params.reason || 'Grant Codex extra permissions?', 300), detail: [short(JSON.stringify(params.permissions || {}), 300)], options: [{ label: 'Yes, for this turn' }, { label: 'No' }] },
      answer: i => ({ permissions: i === 0 ? params.permissions || {} : {}, scope: 'turn' }) };
  }
  if (method === 'mcpServer/elicitation/request') {
    return { ask: { question: short(params.message || params.request?.message || 'An MCP server asks for confirmation', 300), detail: [], options: [{ label: 'Accept' }, { label: 'Decline' }] },
      answer: i => i === 0 ? { action: 'accept', content: {} } : { action: 'decline' } };
  }
  return null;
}

// Codex: the chat's permission pick as a thread sandbox mode / approval policy, and as a turn's sandbox policy.
function codexAccess(access) {
  if (access === 'full') return { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } };
  if (access === 'read-only') return { approvalPolicy: 'on-request', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
  if (access === 'workspace-write') return { approvalPolicy: 'on-request', sandbox: 'workspace-write',
    sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeSlashTmp: false, excludeTmpdirEnvVar: false } };
  // Ask first must override inherited config and previous full-access turns.
  // Reads stay available; writes require explicit escalation/approval.
  return { approvalPolicy: 'on-request', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } };
}
// Per-turn settings for Codex (it takes them on every turn/start, no restart).
function codexTurnParams(o = {}) {
  const a = codexAccess(o.access);
  return { ...(o.model && o.model !== 'default' ? { model: o.model } : {}), ...(o.effort && o.effort !== 'default' ? { effort: o.effort } : {}),
    ...(a.approvalPolicy ? { approvalPolicy: a.approvalPolicy, sandboxPolicy: a.sandboxPolicy } : {}), ...(o.serviceTier ? { serviceTier: o.serviceTier } : {}) };
}
const CLAUDE_MODE = access => access === 'default' || !access ? 'manual' : access;
const DELEGATE_TOOL = /terminalvibe[._]+delegate_task$/; // delegate-mcp.js as each agent names it

class Session {
  constructor(key, harness, emit) {
    // A stopped session says nothing more: its exit must not reach the session replacing it in the same tab.
    this.key = key; this.harness = harness; this.emit = (type, data = {}) => { if (!this.silent) emit(key, { type, ...data }); };
    this.proc = null; this.alive = false; this.busy = false; this.sessionId = null;
    this.asks = new Map(); this.askSeq = 0; this.stderr = '';
  }
  launch(file, args, cwd, env) {
    const launch = resolveLaunch(file, args);
    if (!launch) throw Error(`Cannot run ${file}`);
    this.proc = spawn(launch.file, launch.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.alive = true;
    let buf = '';
    this.proc.stdout.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        try { this.onMessage(msg); } catch (err) { console.error('[chat-sdk]', err); }
      }
    });
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    this.proc.stdin.on('error', () => {});
    // An exit is an error when it failed (code), was killed (signal: a crash) or cut a turn short; a clean idle exit isn't.
    const gone = (code, error, signal) => {
      if (!this.alive) return;
      const midTurn = this.busy;
      this.alive = false; this.busy = false; this.asks.clear();
      const why = error || (code ? this.stderr.trim().split('\n').slice(-3).join('\n') || `exited with code ${code}`
        : signal ? `crashed (${signal})` : midTurn ? 'exited in the middle of a turn' : null);
      if (midTurn) this.onCrash?.(why);
      this.rejectPending?.(Error(why || 'The agent exited'));
      this.emit('exit', { code, error: why, midTurn });
    };
    this.proc.on('exit', (code, signal) => gone(code, null, signal));
    this.proc.on('error', err => gone(1, err.message));
  }
  write(obj) { if (this.alive) this.proc.stdin.write(JSON.stringify(obj) + '\n'); }
  setBusy(busy, extra) { if (this.busy === busy && !extra) return; this.busy = busy; this.emit(busy ? 'busy' : 'idle', extra); }
  addAsk(ask, resolve) {
    const id = String(++this.askSeq);
    this.asks.set(id, { ...ask, resolve });
    this.emit('ask', { ask: { id, question: ask.question, detail: ask.detail || [], multi: !!ask.multi, options: ask.options } });
    return id;
  }
  // answer: { index } (a choice), { indices } (multi-select Submit), { text } (typed answer).
  respond(id, answer) {
    const a = this.asks.get(id);
    if (!a) return false;
    this.asks.delete(id);
    this.emit('ask-done', { id });
    a.resolve(answer || {});
    return true;
  }
  stop() {
    this.silent = true;
    if (!this.proc) return;
    try { this.proc.stdin.end(); } catch {}
    const p = this.proc;
    setTimeout(() => { try { if (p.exitCode === null) p.kill(); } catch {} }, 1500);
  }
}

class ClaudeSession extends Session {
  steers = new Set(); // uuids of messages sent mid-turn that Claude has not taken in yet
  start({ bin, cwd, env, argv, access, extraArgs = [] }) {
    // The chat's own flags (model, effort, session, settings) plus headless mode; permission prompts come back over
    // stdio. Full access can be switched on later in the session (a pick in the chat is the user's consent).
    this.launch(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages',
      '--permission-prompt-tool', 'stdio', '--allow-dangerously-skip-permissions', ...argv.filter((x, i, a) => x !== '--permission-mode' && a[i - 1] !== '--permission-mode'),
      '--permission-mode', CLAUDE_MODE(access), ...extraArgs], cwd, env);
    this.access = access;
    this.cwd = cwd;
    this.env = env;
    this.control({ subtype: 'initialize' });
    return Promise.resolve({ ok: true });
  }
  control(request) { this.write({ type: 'control_request', request_id: `tv-${++this.askSeq}`, request }); }
  onMessage(m) {
    if (m.type === 'system' && m.subtype === 'init' && m.session_id && m.session_id !== this.sessionId) { this.sessionId = m.session_id; this.emit('session', { sessionId: m.session_id }); }
    if (m.type === 'system' && m.subtype === 'status' && m.status === 'requesting') this.setBusy(true);
    if (m.type === 'assistant') this.setBusy(true);
    // Claude echoes each input once it takes it in. A steer that came too late for the running turn becomes its own
    // turn after this result, so the session stays busy until every steer is taken (else the queue sends early).
    if (m.type === 'user' && m.isReplay) this.steers.delete(m.uuid);
    if (m.type === 'result' && m.is_error) this.steers.clear();
    // A turn the user stopped ends with an error result (Claude Code's "[ede_diagnostic] … stop_reason=null"): that's
    // the stop, already shown as "Interrupted", not a failure to report.
    const stopped = m.type === 'result' && this.stopping;
    if (m.type === 'result') this.stopping = false;
    if (m.type === 'result' && !this.steers.size) this.setBusy(false, m.is_error && !stopped ? { error: String(m.result || (m.errors || []).join('\n') || m.subtype) } : {});
    if (m.type === 'control_request') this.onControl(m);
  }
  onControl(m) {
    const reply = response => this.write({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
    // Stop pressed while this request is open: refuse it and end the turn, so Claude Code stops waiting on it.
    const stopped = () => reply({ behavior: 'deny', message: 'The user stopped this turn.', interrupt: true });
    const req = m.request || {};
    if (req.subtype !== 'can_use_tool') {
      this.write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: `Unsupported request: ${req.subtype}` } });
      return;
    }
    if (req.tool_name === 'AskUserQuestion') {
      const questions = req.input?.questions || [], answers = {};
      const next = i => {
        if (i >= questions.length) { reply({ behavior: 'allow', updatedInput: { ...req.input, questions, answers } }); return; }
        const q = questions[i], ask = claudeQuestionAsk(q);
        const id = this.addAsk(ask, a => {
          const labels = (a.indices || []).map(k => ask.options[k]?.label).filter(Boolean);
          answers[q.question] = a.text != null ? a.text : q.multiSelect ? labels.join(', ') : ask.options[a.index]?.label ?? '';
          next(i + 1);
        });
        this.asks.get(id).cancel = stopped;
      };
      next(0);
      return;
    }
    const ask = claudePermissionAsk(req);
    const id = this.addAsk(ask, a => {
      const label = ask.options[a.index]?.label;
      if (req.tool_name === 'ExitPlanMode') {
        if (label === 'Yes, start') {
          reply({ behavior: 'allow', updatedInput: req.input });
          // Leaving plan mode: back to asking first, as Claude Code does after a plan is approved.
          this.setAccess('default'); this.emit('mode', { mode: 'default' });
        } else reply({ behavior: 'deny', message: a.text || 'The user wants to keep planning. Refine the plan.' });
        return;
      }
      if (label === 'Yes') reply({ behavior: 'allow', updatedInput: req.input });
      else if (label === "Yes, and don't ask again") reply({ behavior: 'allow', updatedInput: req.input, updatedPermissions: req.permission_suggestions });
      else reply({ behavior: 'deny', message: a.text || 'The user denied this.' });
    });
    this.asks.get(id).cancel = stopped;
  }
  send(text, { images = [] } = {}) {
    if (!/^\s*\//.test(text) && text.includes('$')) {
      const references = [...skillReferences(text)];
      if (references.length) {
        const skills = require('./chat-complete').listClaudeSkills(this.cwd, undefined, this.env);
        text = expandSlashSkill(text, references, skills);
      }
    }
    const content = images.length ? [{ type: 'text', text }, ...images.map(({ mediaType, data }) => ({
      type: 'image', source: { type: 'base64', media_type: mediaType, data },
    }))] : text;
    const uuid = crypto.randomUUID();
    if (this.busy) this.steers.add(uuid);
    this.setBusy(true);
    this.write({ type: 'user', message: { role: 'user', content }, uuid, parent_tool_use_id: null, session_id: this.sessionId || '' });
    return Promise.resolve(true);
  }
  interrupt() {
    // An open permission / question request would keep the turn waiting on its answer: deny it (and interrupt) first.
    for (const [id, a] of this.asks) { a.cancel?.(); this.asks.delete(id); this.emit('ask-done', { id }); }
    this.steers.clear(); // Stop always ends the turn, even if Claude never takes a steer in
    if (this.busy) this.stopping = true; // its closing result is the stop, not an error
    this.control({ subtype: 'interrupt' });
  }
  setAccess(access) {
    if (access === this.access) return;
    this.access = access;
    this.control({ subtype: 'set_permission_mode', mode: CLAUDE_MODE(access) });
  }
}

class CodexSession extends Session {
  async initialize({ bin, cwd, env, clientVersion, extraArgs = [] }) {
    this.launch(bin, ['app-server', ...extraArgs], cwd, env);
    this.rpcId = 0; this.pending = new Map(); this.turnId = null; this.cwd = cwd;
    this.rejectPending = err => { for (const p of this.pending.values()) p.reject(err); this.pending.clear(); };
    await this.rpc('initialize', { clientInfo: { name: 'terminalvibe', title: 'TerminalVibe', version: clientVersion || '0' } });
    this.write({ method: 'initialized', params: {} });
  }
  async start({ bin, cwd, env, options = {}, resume, fork, clientVersion, extraArgs }) {
    this.options = options;
    const a = codexAccess(options.access);
    const params = { cwd, ...(options.model && options.model !== 'default' ? { model: options.model } : {}), ...(a.approvalPolicy ? { approvalPolicy: a.approvalPolicy, sandbox: a.sandbox } : {}),
      ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}), developerInstructions: A2UI_BRIEF };
    await this.initialize({ bin, cwd, env, clientVersion, extraArgs });
    const r = resume ? await this.rpc('thread/resume', { ...params, threadId: resume, excludeTurns: true })
      : fork ? await this.rpc('thread/fork', { ...params, threadId: fork, excludeTurns: true })
      : await this.rpc('thread/start', params);
    this.sessionId = r.thread.id;
    this.cwd = r.thread.cwd || cwd;
    this.emit('session', { sessionId: r.thread.id });
    return { ok: true, sessionId: r.thread.id };
  }
  rpc(method, params, timeout = 0) {
    return new Promise((resolve, reject) => {
      if (!this.alive) return reject(Error('Codex is not running'));
      const id = ++this.rpcId;
      const timer = timeout && setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Codex did not respond to ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.write({ id, method, params });
    });
  }
  async listSkills() {
    const result = await this.rpc('skills/list', { cwds: this.cwd ? [this.cwd] : [] }, 5000);
    const seen = new Set();
    return (result.data?.[0]?.skills || [])
      .filter(skill => skill.enabled && /^[\w:.-]+$/.test(skill.name) && skill.path && !seen.has(skill.name) && seen.add(skill.name))
      .map(({ name, description, path, scope }) => {
        const location = path.replace(/\\/g, '/');
        const source = /\/plugins\/cache\//i.test(location) ? 'app'
          : /\/skills\/\.system\//i.test(location) ? 'system'
          : ({ user: 'personal', repo: 'project', system: 'system', admin: 'system' })[scope];
        return { name, description, path, source };
      });
  }
  onMessage(m) {
    if (m.id !== undefined && !m.method) { // a response to our request
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (p) m.error ? p.reject(Object.assign(Error(m.error.message || 'Codex error'), { data: m.error })) : p.resolve(m.result);
      return;
    }
    if (m.id !== undefined) { this.onServerRequest(m); return; }
    const p = m.params || {};
    if (m.method === 'turn/started') { this.turnId = p.turn?.id || this.turnId; this.setBusy(true); }
    else if (m.method === 'turn/completed') {
      if (!p.turn?.id || p.turn.id === this.turnId) this.turnId = null;
      const err = p.turn?.status === 'failed' ? String(p.turn.error?.message || 'The turn failed') : null;
      this.setBusy(false, err ? { error: err } : {});
    }
    else if (m.method === 'error' && p.willRetry === false) this.lastError = short(p.error?.message || 'Codex error', 400);
    else if (m.method === 'serverRequest/resolved') {
      for (const [id, a] of this.asks) if (a.requestId === p.requestId) { this.asks.delete(id); this.emit('ask-done', { id }); }
    }
  }
  onServerRequest(m) {
    const reply = result => this.write({ id: m.id, result });
    if (m.method === 'item/tool/requestUserInput') {
      const questions = m.params?.questions || [], answers = {};
      const next = i => {
        if (i >= questions.length) { reply({ answers }); return; }
        const q = questions[i];
        const ask = { question: q.question || q.header || 'Codex has a question', header: q.question ? q.header || '' : '', detail: [],
          options: [...(q.options || []).map(o => ({ label: String(o.label), desc: o.description || '' })), ...(q.isOther || !q.options?.length ? [{ label: ASK_INPUT, input: true }] : [])] };
        const id = this.addAsk(ask, a => { answers[q.id] = { answers: [a.text != null ? a.text : ask.options[a.index]?.label ?? ''] }; next(i + 1); });
        this.asks.get(id).requestId = m.id;
      };
      next(0);
      return;
    }
    const c = codexAsk(m.method, m.params || {});
    if (!c) { this.write({ id: m.id, error: { code: -32601, message: `TerminalVibe does not handle ${m.method}` } }); return; }
    const id = this.addAsk(c.ask, a => reply(c.answer(a.index ?? -1)));
    this.asks.get(id).requestId = m.id;
  }
  async send(text, { steer, options, images = [] } = {}) {
    if (options) this.options = options;
    const input = [{ type: 'text', text, text_elements: [] }, ...images.map(path => ({ type: 'localImage', path }))];
    const revision = this.interruptRevision || 0;
    this.setBusy(true);
    try {
      const names = new Set([...skillReferences(text)].map(match => match[1]));
      if (names.size) {
        const skills = new Map((await this.listSkills().catch(() => [])).map(skill => [skill.name, skill.path]));
        for (const name of names) {
          const path = skills.get(name);
          if (path) input.push({ type: 'skill', name, path });
        }
      }
      if (revision !== (this.interruptRevision || 0)) { if (!this.turnId) this.setBusy(false); return false; }
      if (steer && this.turnId) {
        try { await this.rpc('turn/steer', { threadId: this.sessionId, expectedTurnId: this.turnId, input }); return true; }
        catch { /* the turn ended meanwhile: start a new one */ }
      }
      if (revision !== (this.interruptRevision || 0)) return false;
      const r = await this.rpc('turn/start', { threadId: this.sessionId, input, ...codexTurnParams(this.options) });
      this.turnId = r.turn?.id || this.turnId;
      if (revision !== (this.interruptRevision || 0)) { this.interruptTurn(); return false; }
      return true;
    } catch (err) { this.setBusy(false, { error: err.message }); throw err; }
  }
  interrupt() {
    this.interruptRevision = (this.interruptRevision || 0) + 1;
    this.interruptTurn();
  }
  interruptTurn() { if (this.turnId) this.rpc('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId }).catch(() => {}); }
  setAccess(access) { this.options = { ...this.options, access }; } // applies from the next turn
}

// ── Agent Client Protocol (Antigravity CLI: `agy acp`) ──
// JSON-RPC 2.0 over stdio. The agent's own history isn't readable, so this session records the conversation
// (your messages, its replies and thoughts, its tool calls) in ~/.terminalvibe/acp/<session id>.jsonl for the chat.
// Models, thinking level and permission mode are the session's config options, set before each turn.
const ACP_CLIENT = { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } };
// The picker's models from a session's config options: each model with the thinking levels it offers.
function acpModels(r) {
  const opts = r?.configOptions || [], model = opts.find(c => c.id === 'model'), level = opts.find(c => c.id === 'thought_level');
  if (!model?.options?.length) return null;
  const efforts = level?.options?.map(o => String(o.value)) || [];
  return model.options.map(o => ({ id: String(o.value), name: String(o.name || o.value),
    efforts: efforts.length ? efforts : ['default'], defaultEffort: String(level?.currentValue || 'default') }));
}
// A permission request in the answer tray's shape: its own choices (Allow / Deny…) in order.
function acpPermissionAsk(params = {}) {
  const tc = params.toolCall || {}, opts = params.options || [];
  const what = tc.kind === 'execute' ? 'this command' : tc.kind === 'edit' ? 'this edit' : tc.kind === 'delete' ? 'this deletion' : (tc.name || 'this action');
  const detail = [...new Set([tc.title, ...(tc.locations || []).map(l => l.path)].filter(Boolean).map(s => short(s, 300)))];
  return { ask: { question: `Allow ${what}?`, detail, options: opts.map(o => ({ label: String(o.name || o.optionId) })) },
    answer: i => opts[i] ? { outcome: { outcome: 'selected', optionId: opts[i].optionId } } : { outcome: { outcome: 'cancelled' } } };
}
const ACP_TOOL_DETAIL = 4000;
// ACP advertises custom slash actions and skills together with these built-in controls.
const AGY_CONTROLS = new Set(['goal', 'compact', 'schedule', 'browser', 'plan', 'swarm']);
class AcpSession extends Session {
  start({ bin, cwd, env, options = {}, resume, clientVersion, transcriptDir, extraArgs = [], mcpServers = [] }) {
    this.options = options; this.dir = transcriptDir; this.tools = new Map(); this.buf = null; this.waiting = 0;
    // TerminalVibe's subagent tool (delegateMcp); an agent that refuses it still opens the session without it.
    const open = (method, params) => this.rpc(method, { ...params, mcpServers }).catch(err => mcpServers.length ? this.rpc(method, { ...params, mcpServers: [] }) : Promise.reject(err));
    this.cwd = cwd;
    this.commandsReady = new Promise(resolve => { this.resolveCommands = resolve; });
    // Full access is a start flag (it auto-approves every request); the other permissions are the session's modes.
    this.full = options.access === 'full';
    this.launch(bin, ['acp', ...(this.full ? ['--dangerously-skip-permissions'] : []), ...extraArgs], cwd, env);
    this.rpcId = 0; this.pending = new Map(); this.queue = Promise.resolve();
    this.rejectPending = err => { for (const p of this.pending.values()) p.reject(err); this.pending.clear(); };
    return (async () => {
      await this.rpc('initialize', { ...ACP_CLIENT, clientInfo: { name: 'terminalvibe', title: 'TerminalVibe', version: clientVersion || '0' } });
      let r;
      if (resume) {
        // Resume without replay; an agent that only loads replays the history, which is already recorded.
        try { r = await open('session/resume', { sessionId: resume, cwd }); }
        catch { this.replaying = true; try { r = await open('session/load', { sessionId: resume, cwd }); } finally { this.replaying = false; } }
        this.sessionId = resume;
      } else { r = await open('session/new', { cwd }); this.sessionId = r.sessionId; }
      this.config = r?.configOptions || [];
      this.applied = Object.fromEntries(this.config.map(c => [c.id, c.currentValue]));
      if (r?.modes?.currentModeId) this.applied.mode = r.modes.currentModeId;
      this.emit('session', { sessionId: this.sessionId });
      const models = acpModels(r);
      if (models) this.emit('models', { models });
      await this.apply(options);
      return { ok: true, sessionId: this.sessionId, models };
    })();
  }
  write(obj) { super.write({ jsonrpc: '2.0', ...obj }); }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.alive) return reject(Error('The agent is not running'));
      const id = ++this.rpcId;
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }
  // The picks (model, thinking level, permission mode) the next turn runs with; only changes are sent.
  async apply(o = {}) {
    const set = async (configId, value) => {
      if (!value || value === 'default' || this.applied[configId] === value) return;
      if (!this.config.some(c => c.id === configId && c.options?.some(x => x.value === value))) return;
      const r = await this.rpc('session/set_config_option', { sessionId: this.sessionId, configId, value }).catch(() => null);
      if (r) { this.applied[configId] = value; if (r.configOptions) this.config = r.configOptions; }
    };
    await set('model', o.model);
    await set('thought_level', o.effort);
    const mode = o.access && o.access !== 'full' ? o.access : null;
    if (mode && !this.full && this.applied.mode !== mode && await this.rpc('session/set_mode', { sessionId: this.sessionId, modeId: mode }).then(() => true, () => false)) this.applied.mode = mode;
  }
  record(item) {
    if (this.replaying || !this.dir || !this.sessionId) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, this.sessionId + '.jsonl'), JSON.stringify({ ...item, ts: new Date().toISOString() }) + '\n');
    } catch (err) { console.error('[chat-sdk] acp transcript', err.message); }
  }
  flush() { if (this.buf?.text.trim()) this.record({ role: this.buf.role, text: this.buf.text.trim() }); this.buf = null; }
  // The process died mid-turn: keep what it said and did, then mark the turn as cut short (the chat shows the line).
  onCrash(why) {
    this.flush();
    for (const t of this.tools.values()) this.recordTool(t, true);
    this.tools.clear();
    this.record({ role: 'interrupt', reason: 'crash', text: why || '' });
  }
  // started: a delegate_task call recorded when it starts (shown running); its end is recorded under the same callId.
  recordTool(t, error, started = false) {
    const input = t.input ?? {}, delegated = DELEGATE_TOOL.test(t.name || '');
    this.record({ role: 'tool', name: t.name, summary: short(t.title || toolSummaryOf(input), 200),
      detail: short(typeof input === 'string' ? input : JSON.stringify(input, null, 2), ACP_TOOL_DETAIL),
      ...(delegated ? { input: typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { return {}; } })() : input, callId: t.id } : {}),
      ...(!started && t.output !== undefined ? { output: require('./threads').toolOutput(t.output) } : {}), ...(error ? { error: true } : {}) });
  }
  onMessage(m) {
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (p) m.error ? p.reject(Object.assign(Error(m.error.message || 'Agent error'), { data: m.error })) : p.resolve(m.result);
      return;
    }
    if (m.method === 'session/update') { this.onUpdate(m.params?.update || {}); return; }
    if (m.id === undefined) return;
    if (m.method === 'session/request_permission') {
      const c = acpPermissionAsk(m.params);
      const id = this.addAsk(c.ask, a => this.write({ id: m.id, result: c.answer(a.index ?? -1) }));
      this.asks.get(id).cancel = () => this.write({ id: m.id, result: { outcome: { outcome: 'cancelled' } } });
      return;
    }
    // No file system or terminal capability was offered: the agent uses its own tools.
    this.write({ id: m.id, error: { code: -32601, message: `TerminalVibe does not handle ${m.method}` } });
  }
  onUpdate(u) {
    if (u.sessionUpdate === 'available_commands_update') {
      this.skills = (u.availableCommands || []).filter(c => /^[\w:.-]+$/.test(c.name) && !AGY_CONTROLS.has(c.name))
        .map(({ name, description }) => ({ name, description }));
      this.resolveCommands?.();
      return;
    }
    if (this.replaying) return;
    const kind = u.sessionUpdate;
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const role = kind === 'agent_message_chunk' ? 'assistant' : 'thinking';
      if (this.buf?.role !== role) this.flush();
      this.buf ||= { role, text: '' };
      if (u.content?.type === 'text') this.buf.text += u.content.text || '';
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      if (kind === 'tool_call') this.flush();
      const t = this.tools.get(u.toolCallId) || { name: 'tool', id: u.toolCallId };
      if (u.name || u.kind) t.name = String(u.name || u.kind);
      if (u.title) t.title = String(u.title);
      if (u.rawInput !== undefined || u.args !== undefined) t.input = u.rawInput ?? u.args;
      if (u.rawOutput !== undefined) t.output = u.rawOutput;
      else if (u.content !== undefined) t.output = u.content;
      this.tools.set(u.toolCallId, t);
      if (u.status === 'completed' || u.status === 'failed') { this.recordTool(t, u.status === 'failed'); this.tools.delete(u.toolCallId); }
      else if (!t.started && t.input !== undefined && DELEGATE_TOOL.test(t.name)) { t.started = true; this.recordTool(t, false, true); } // a subagent: shown running
    }
  }
  async listSkills() {
    if (!this.skills && this.commandsReady) {
      let timer;
      try {
        await Promise.race([this.commandsReady, new Promise(resolve => { timer = setTimeout(resolve, 1500); })]);
      } finally { clearTimeout(timer); }
    }
    return this.skills || [];
  }
  send(text, { options } = {}) {
    if (options) this.options = options;
    this.waiting++;
    this.setBusy(true);
    // One turn at a time: a message sent mid-turn runs right after it (ACP has no steering).
    const run = async () => {
      this.record({ role: 'user', text });
      try {
        await this.apply(this.options);
        const references = /^\s*\//.test(text) ? [] : [...skillReferences(text)];
        const prompt = references.length ? expandSlashSkill(text, references, await this.listSkills()) : text;
        const r = await this.rpc('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: prompt }] });
        this.endTurn(r?.stopReason && !['end_turn', 'cancelled'].includes(r.stopReason) ? `stopped (${r.stopReason})` : null);
      } catch (err) { this.endTurn(err.message || 'The turn failed'); }
    };
    this.queue = this.queue.then(run);
    return Promise.resolve(true);
  }
  endTurn(error) {
    this.flush();
    for (const t of this.tools.values()) this.recordTool(t, false);
    this.tools.clear();
    if (--this.waiting <= 0) { this.waiting = 0; this.setBusy(false, error ? { error } : {}); }
    else if (error) this.emit('idle', { error }); // a queued message still runs: report the error, stay busy
  }
  interrupt() {
    // A cancelled turn's open permission requests are answered "cancelled", as the protocol asks.
    for (const [id, a] of this.asks) { a.cancel?.(); this.asks.delete(id); this.emit('ask-done', { id }); }
    if (this.sessionId) this.write({ method: 'session/cancel', params: { sessionId: this.sessionId } });
  }
  setAccess(access) {
    // Full access needs a restart (a start flag); the chat restarts on the next message when it changes.
    if ((access === 'full') !== this.full) return;
    this.options = { ...this.options, access };
    if (!this.busy) this.apply(this.options).catch(() => {});
  }
}
// The Antigravity models, read from a session opened and closed at once (an unused session isn't kept).
async function acpProbe(bin, env, cwd, read) {
  const s = new AcpSession('acp-probe', 'antigravity', () => {});
  const timer = setTimeout(() => s.stop(), 8000);
  try {
    const r = await s.start({ bin, cwd, env, options: {} });
    return await read(s, r);
  } finally {
    clearTimeout(timer);
    if (s.sessionId) s.rpc('session/close', { sessionId: s.sessionId }).catch(() => {});
    setTimeout(() => s.stop(), 300);
  }
}
const acpProbeModels = (bin, env, cwd) => acpProbe(bin, env, cwd, (_session, result) => result.models || []);
// A boot alone takes ~5s on an idle machine; with a live chat and other probes queued it can take much longer.
// Keep the startup budget separate from each request's budget: a slow boot must not eat the reader's deadline.
const OPENCODE_START_MS = 30000, OPENCODE_READ_MS = 30000;
// Use the detected executable and TerminalVibe's agent environment for the SDK's local server.
async function startOpenCodeServer(bin, env, cwd) {
  const launch = resolveLaunch(bin, ['serve', '--hostname=127.0.0.1', '--port=0']);
  if (!launch) throw Error('Could not launch OpenCode');
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2/client');
  const password = require('crypto').randomBytes(32).toString('hex');
  const startup = new AbortController();
  const timer = setTimeout(() => startup.abort(Error('OpenCode server did not start in time')), OPENCODE_START_MS);
  const child = spawn(launch.file, launch.args, {
    cwd,
    env: { ...env, OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  try {
    const baseUrl = await new Promise((resolve, reject) => {
      const abort = () => reject(startup.signal.reason);
      startup.signal.addEventListener('abort', abort, { once: true });
      child.once('error', reject);
      child.once('exit', () => reject(Error('OpenCode server exited')));
      let output = '';
      child.stdout.setEncoding('utf8').on('data', chunk => {
        output = (output + chunk).slice(-8192);
        const address = /^opencode server listening on (http:\/\/127\.0\.0\.1:\d+)\s*$/m.exec(output);
        if (address) {
          startup.signal.removeEventListener('abort', abort);
          resolve(address[1]);
        }
      });
    });
    const client = createOpencodeClient({
      baseUrl, throwOnError: true,
      headers: { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') },
    });
    return { client, child };
  } catch (err) {
    child.kill();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
// One throwaway server at a time: concurrent `opencode serve` boots (a model probe per open chat folder, skill
// probes) contend with each other and all blow the startup timeout. Each one alone takes ~5s.
let openCodeProbes = Promise.resolve();
function withOpenCodeServer(bin, env, cwd, read) {
  const run = openCodeProbes.then(async () => {
    const server = await startOpenCodeServer(bin, env, cwd);
    const request = new AbortController();
    const timer = setTimeout(() => request.abort(Error('OpenCode request timed out')), OPENCODE_READ_MS);
    try {
      return await read(server.client, request.signal);
    } finally {
      clearTimeout(timer);
      server.child.kill();
    }
  });
  openCodeProbes = run.catch(() => {});
  return run;
}
// "provider/model": the provider ends at the first slash, the model may keep its own.
const openCodeModel = id => typeof id === 'string' && id !== 'default' && id.includes('/')
  ? { providerID: id.slice(0, id.indexOf('/')), modelID: id.slice(id.indexOf('/') + 1) } : null;
const openCodeError = err => short(err?.data?.message || err?.message || (typeof err === 'string' ? err : ''), 400);
// Node's fetch reports a dropped HTTP connection as a bare "fetch failed" (or an UND_ERR_* code). It says nothing
// about the turn, so never surface it as the reason the agent stopped.
const openCodeTransportError = err => /^(fetch failed|terminated|socket hang up)$|UND_ERR_/i.test(openCodeError(err));
// A permission request in the answer tray's shape, and the SDK reply each choice sends back.
function openCodePermissionAsk(p = {}) {
  const detail = [...new Set([...(p.patterns || []).map(String), ...(typeof p.metadata?.description === 'string' ? [short(p.metadata.description, 300)] : [])])].slice(0, 4);
  const options = [{ label: 'Yes' }], replies = ['once'];
  if (p.always?.length) { options.push({ label: "Yes, and don't ask again" }); replies.push('always'); }
  options.push({ label: 'No' }); replies.push('reject');
  return { ask: { question: `Allow ${String(p.permission || 'this action')}?`, detail, options }, replies };
}
// Auto replies use "once", never "always": approving a permission must not write a rule into the user's config.
const openCodeEditPermission = /^(edit|write|patch|multiedit|apply_patch|applypatch)$/i;
const openCodeAccessReply = (access, permission) => {
  if (access === 'auto' || access === 'full') return 'once';
  if (access === 'plan') return 'reject';
  if (access === 'accept-edits' && openCodeEditPermission.test(String(permission || ''))) return 'once';
  return null;
};
// OpenCode (`opencode serve` + its SDK): the server's events carry messages, tools and questions; the
// agent's own history is only in its database, so this session records what the chat shows instead.
class OpenCodeSession extends Session {
  async start({ bin, cwd, env, options = {}, resume, fork, transcriptDir }) {
    this.options = options; this.dir = transcriptDir; this.cwd = cwd;
    this.tools = new Map(); this.parts = new Map(); this.waiting = 0; this.userMsgs = new Set();
    this.recordedTools = new Set(); this.recordedParts = new Set(); this.queue = Promise.resolve(); this.lastError = null;
    this.pendingIdle = false;
    this.children = new Set(); // subagent (task tool) sessions: their steps are recorded to their own transcript
    this.startedCalls = new Set(); // delegate_task calls recorded as running
    const server = await startOpenCodeServer(bin, env, cwd);
    this.client = server.client; this.server = server.child;
    this.alive = true;
    this.server.once('exit', code => {
      if (!this.alive) return;
      const midTurn = this.busy;
      this.alive = this.busy = false; this.asks.clear();
      this.abortEvents?.abort();
      this.emit('exit', { code, error: code ? `OpenCode exited with code ${code}` : null, midTurn });
    });
    this.abortEvents = new AbortController();
    this.consume(this.abortEvents.signal);
    let r;
    try {
      if (resume) r = await this.client.session.get({ sessionID: resume, directory: cwd });
      else if (fork) r = await this.client.session.fork({ sessionID: fork, directory: cwd });
      else r = await this.client.session.create({ directory: cwd });
    } catch (err) {
      this.stop();
      throw Error(err.message || 'Could not open the OpenCode session');
    }
    const info = r?.data;
    if (!info?.id) { this.stop(); throw Error('OpenCode did not open a session'); }
    this.sessionId = info.id;
    this.emit('session', { sessionId: this.sessionId });
    return { ok: true, sessionId: this.sessionId };
  }
  async consume(signal) {
    // The SDK's SSE client retries failed fetches itself, but a *clean* stream end (the server closing an idle
    // connection) just ends our for-await. Keep resubscribing: the agent's turn lives on the server, and this
    // stream is how we learn that it ended. A drop is never an agent error.
    while (this.alive && !signal.aborted) {
      try {
        const { stream } = await this.client.event.subscribe({ directory: this.cwd }, { signal });
        for await (const event of stream) {
          if (!this.alive || signal.aborted) break;
          this.onEvent(event);
        }
      } catch (err) {
        if (!this.alive || signal.aborted) return;
      }
      if (!this.alive || signal.aborted) return;
      await new Promise(resolve => setTimeout(resolve, this.sseRetryMs ?? 500));
    }
  }
  onEvent(event) {
    const p = event?.properties || {};
    // A subagent's session only adds its messages and steps (never ends the turn or asks).
    if (p.sessionID && p.sessionID !== this.sessionId && !(this.children.has(p.sessionID) && /^message\.(updated|part\.updated)$/.test(event.type))) return;
    if (event.type === 'message.updated') {
      if (p.info?.role === 'user') this.userMsgs.add(p.info.id);
      // The assistant message is complete after its last text delta — flush before the UI reads the transcript.
      else if (p.info?.role === 'assistant' && (p.info.time?.completed || p.info.finish)) this.flushParts();
    } else if (event.type === 'message.part.updated') {
      this.onPart(p.part || {});
    } else if (event.type === 'permission.asked') {
      this.onPermission(p);
    } else if (event.type === 'permission.replied' || event.type === 'question.replied' || event.type === 'question.rejected') {
      for (const [id, a] of this.asks) if (a.requestId === p.requestID) { this.asks.delete(id); this.emit('ask-done', { id }); }
    } else if (event.type === 'question.asked') {
      this.onQuestion(p);
    } else if (event.type === 'session.error') {
      this.lastError = openCodeError(p.error) || this.lastError;
    } else if (event.type === 'session.status') {
      const st = p.status || {};
      if (st.type === 'idle') {
        // The async prompt returns before the turn does: an idle is what ends it. One racing the POST is held
        // until the POST settles, so it still closes the turn instead of being lost.
        if (this.inPrompt) this.pendingIdle = true;
        else if (this.waiting) this.endTurn(this.aborted ? null : this.lastError || null);
      } else if (st.type === 'retry') {
        const msg = short(st.message || st.action?.message || 'OpenCode could not continue', 400);
        // A retry with an action (quota, auth) never recovers: say why instead of spinning forever.
        if (st.action && this.waiting) this.endTurn(msg);
        else this.lastError ||= msg;
      }
    } else if (event.type === 'session.idle') {
      if (this.inPrompt) this.pendingIdle = true;
      else if (this.waiting) this.endTurn(this.aborted ? null : this.lastError || null);
    }
  }
  onPart(part) {
    if (part.messageID && this.userMsgs.has(part.messageID)) return; // the prompt's own echo
    if (part.type === 'text' || part.type === 'reasoning') {
      if (part.type === 'text' && (part.synthetic || part.ignored)) return;
      const role = part.type === 'text' ? 'assistant' : 'thinking';
      this.parts.set(part.id, { role, text: String(part.text || ''), sid: part.sessionID });
      // A streamed part's last delta carries time.end. The prompt can resolve before it arrives,
      // so never rely on the turn end alone to record the answer.
      if (part.time?.end) this.recordPart(part.id);
    } else if (part.type === 'tool') {
      this.tools.set(part.id, part);
      const status = part.state?.status;
      // A subagent starting: follow its session, and record the call now so the chat shows it running.
      const child = part.tool === 'task' && part.state?.metadata?.sessionId;
      if (child && !this.children.has(child)) {
        this.children.add(child);
        if (status === 'running') this.recordTool(part, true);
        const prompt = part.state?.input?.prompt;
        if (prompt) this.record({ role: 'user', text: String(prompt) }, child);
      }
      // A delegated subagent (TerminalVibe's delegate_task): shown running too.
      if (DELEGATE_TOOL.test(part.tool || '') && status === 'running' && !this.startedCalls.has(part.id)) {
        this.startedCalls.add(part.id);
        this.recordTool(part, true);
      }
      if (status === 'completed' || status === 'error') {
        this.flushParts();
        this.tools.delete(part.id);
        this.recordTool(part);
      }
    }
  }
  recordPart(id) {
    const p = this.parts.get(id);
    if (!p || this.recordedParts.has(id)) return;
    this.parts.delete(id);
    if (!p.text.trim()) return;
    this.recordedParts.add(id);
    this.record({ role: p.role, text: p.text.trim() }, p.sid);
  }
  flushParts() {
    for (const id of [...this.parts.keys()]) this.recordPart(id);
  }
  // sid: the session the item belongs to (a subagent's steps go to its own transcript).
  record(item, sid) {
    sid = sid && this.children.has(sid) ? sid : this.sessionId;
    if (!this.dir || !sid) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, sid + '.jsonl'), JSON.stringify({ ...item, ts: new Date().toISOString() }) + '\n');
    } catch (err) { console.error('[chat-sdk] opencode transcript', err.message); }
  }
  // started: a subagent's call recorded when it starts; its result is recorded again under the same callId.
  recordTool(part, started = false) {
    if (this.recordedTools.has(part.id)) return;
    if (!started) this.recordedTools.add(part.id);
    const state = part.state || {}, input = state.input ?? {};
    const detail = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const meta = state.metadata || {}, threads = require('./threads');
    const agent = part.tool === 'task' && meta.sessionId ? { agent: { toolUseId: part.id, sessionId: meta.sessionId, type: String(input.subagent_type || 'general'),
      description: String(input.description || state.title || ''), prompt: String(input.prompt || ''), model: meta.model?.modelID || null,
      status: started ? 'running' : state.status === 'error' ? 'failed' : 'completed',
      ms: state.time?.end && state.time?.start ? state.time.end - state.time.start : null }, callId: part.id } : {};
    // A task's output wraps its report in <task …><task_result>: the report itself.
    const output = state.status === 'completed' && state.output !== undefined ? threads.toolOutput(state.output) : undefined;
    const report = agent.agent && output ? (/<task_result>\n?([\s\S]*?)\n?<\/task_result>/.exec(output)?.[1] ?? output).trim() : output;
    this.record({ role: 'tool', name: String(part.tool || 'tool'),
      summary: short(state.title || toolSummaryOf(input), 200), detail: short(detail, ACP_TOOL_DETAIL), ...agent,
      ...(DELEGATE_TOOL.test(part.tool || '') ? { input, callId: part.id } : {}), // a delegated subagent (threads.js delegatedSubagents)
      ...(!started && report !== undefined ? { output: report } : {}),
      ...(state.status === 'error' ? { error: true, ...(state.error ? { output: threads.toolOutput(state.error) } : {}) } : {}) }, part.sessionID);
  }
  onCrash(why) {
    this.flushParts();
    for (const part of this.tools.values()) this.recordTool(part);
    this.tools.clear();
    this.record({ role: 'interrupt', reason: 'crash', text: why || '' });
  }
  onPermission(p) {
    const reply = openCodeAccessReply(this.options.access, p.permission);
    if (reply) { this.client.permission.reply({ requestID: p.id, reply }).catch(() => {}); return; }
    const c = openCodePermissionAsk(p);
    const id = this.addAsk(c.ask, a => {
      this.client.permission.reply({ requestID: p.id, reply: c.replies[a.index] || 'reject', ...(a.text ? { message: a.text } : {}) }).catch(() => {});
    });
    this.asks.get(id).requestId = p.id;
    this.asks.get(id).cancel = () => this.client.permission.reply({ requestID: p.id, reply: 'reject' }).catch(() => {});
  }
  onQuestion(p) {
    const questions = p.questions || [], answers = [];
    const next = i => {
      if (i >= questions.length) { this.client.question.reply({ requestID: p.id, answers }).catch(() => {}); return; }
      const q = questions[i], ask = claudeQuestionAsk({ ...q, multiSelect: q.multiple });
      const id = this.addAsk(ask, a => {
        const labels = (a.indices || []).map(k => ask.options[k]?.label).filter(Boolean);
        answers[i] = a.text != null ? [a.text] : q.multiple ? labels : [ask.options[a.index]?.label ?? ''];
        next(i + 1);
      });
      this.asks.get(id).requestId = p.id;
      this.asks.get(id).cancel = () => this.client.question.reject({ requestID: p.id }).catch(() => {});
    };
    next(0);
  }
  async listSkills() {
    const { data } = await this.client.app.skills({ directory: this.cwd });
    return (data || []).filter(skill => /^[\w:.-]+$/.test(skill.id || skill.name))
      .map(skill => ({ name: skill.id || skill.name, description: skill.description }));
  }
  send(text, { options, images = [] } = {}) {
    if (options) this.options = options;
    this.waiting++;
    this.setBusy(true);
    // One turn at a time: a message sent mid-turn runs right after it.
    const run = async () => {
      this.aborted = false;
      this.lastError = null; // an error between turns (a dropped event stream) must not fail this one
      this.pendingIdle = false;
      this.record({ role: 'user', text });
      try {
        const parts = [{ type: 'text', text }];
        for (const image of images) parts.push({ type: 'file', mime: image.mediaType, url: `data:${image.mediaType};base64,${image.data}` });
        const model = openCodeModel(this.options.model);
        this.inPrompt = true;
        // A synchronous `session.prompt` holds its HTTP response open for the whole turn. Node's fetch gives up
        // after 5 minutes of waiting for response headers, so a long turn dies with a bare "fetch failed" while
        // OpenCode is still working. The async endpoint returns at once; the SSE stream carries the result and
        // the turn's idle event, so a turn can run for hours.
        const r = await this.client.session.promptAsync({ sessionID: this.sessionId, directory: this.cwd,
          ...(model ? { model } : {}), ...(this.options.access === 'plan' ? { agent: 'plan' } : {}), parts });
        const error = openCodeError(r?.data?.info?.error) || this.lastError;
        if (error) this.endTurn(this.aborted ? null : error);
        else if (this.pendingIdle) { this.pendingIdle = false; this.endTurn(this.aborted ? null : this.lastError || null); }
      } catch (err) {
        this.endTurn(this.aborted ? null : openCodeTransportError(err) ? 'connection lost' : openCodeError(err) || 'OpenCode could not take the message');
      } finally {
        this.inPrompt = false; this.aborted = false;
      }
    };
    this.queue = this.queue.then(run);
    return Promise.resolve(true);
  }
  endTurn(error) {
    if (!this.waiting) return; // a fatal status already ended this turn; the prompt settles later
    this.flushParts();
    clearTimeout(this.lateFlush);
    this.lateFlush = setTimeout(() => this.flushParts(), 800); // a final delta can follow the prompt's resolution
    for (const part of this.tools.values()) this.recordTool(part);
    this.tools.clear();
    if (--this.waiting <= 0) { this.waiting = 0; this.setBusy(false, error ? { error } : {}); }
    else if (error) this.emit('idle', { error });
  }
  interrupt() {
    this.aborted = true;
    for (const [id, a] of this.asks) { a.cancel?.(); this.asks.delete(id); this.emit('ask-done', { id }); }
    if (this.sessionId) this.client?.session.abort({ sessionID: this.sessionId }).catch(() => {});
  }
  setAccess(access) { this.options = { ...this.options, access }; }
  stop() {
    this.silent = true;
    this.alive = this.busy = false;
    clearTimeout(this.lateFlush);
    this.abortEvents?.abort();
    try { this.server?.kill(); } catch {}
  }
}
function openCodeModels(bin, env, cwd) {
  return withOpenCodeServer(bin, env, cwd, async (client, signal) => {
    try {
      const { data } = await client.provider.list({ directory: cwd }, { signal });
      const connected = new Set(data.connected);
      return data.all.filter(provider => connected.has(provider.id)).flatMap(provider =>
        Object.values(provider.models).map(model => ({
          id: `${provider.id}/${model.id}`, name: `${model.name} · ${provider.name}`,
          efforts: ['default'], defaultEffort: 'default',
        }))).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.error('[chat-sdk] OpenCode models probe failed:', err?.message || err);
      throw err;
    }
  });
}
const toolSummaryOf = input => { try { return require('./threads').toolSummary(input); } catch { return ''; } };

const SESSIONS = { claude: ClaudeSession, codex: CodexSession, antigravity: AcpSession, opencode: OpenCodeSession };
const sessions = new Map();

// env(key, harness) / args(harness): the provider's env vars and extra launch arguments (Settings > Providers).
// TerminalVibe's delegate_task MCP server (delegate-mcp.js) for a chat agent: subagents on Codex, Claude Code or
// OpenCode. Returns the flags (Claude, Codex) and env that add it to the agent's own MCP servers. Its settings ride in
// the agent's env (none secret; each harness's API keys are read by the server from providers.json). Only
// ELECTRON_RUN_AS_NODE goes in the server's own config: in the agent's env it would turn any Electron app the agent
// runs into Node.
// ponytail: Antigravity (ACP mcpServers) isn't wired; the server keeps the access picked when the agent started.
const DELEGATE_ENV = ['TERMINALVIBE_DELEGATE_LAUNCH', 'TERMINALVIBE_DELEGATE_ACCESS', 'TERMINALVIBE_DELEGATE_ACCESS_FILE', 'TERMINALVIBE_DELEGATE_CWD', 'TERMINALVIBE_DATA_DIR'];
// The chat's permission pick as the subagent's access. A headless subagent can't ask, so it never gets more than
// the chat allows without asking: Ask first in Codex, OpenCode or Antigravity (which run the tool without a card)
// is read only; Claude Code asks before the tool runs, so its Ask first may edit.
function delegateAccess(harness, a) {
  if (a === 'full' || a === 'bypassPermissions') return 'full';
  if (a === 'plan' || a === 'read-only') return 'read-only';
  if (harness === 'claude' || a === 'workspace-write' || a === 'auto' || a === 'accept-edits' || a === 'acceptEdits') return 'edits';
  return 'read-only';
}
// The current pick, read by the server on every call: a permission change in the chat applies to the next subagent.
const writeDelegateAccess = (file, harness, access) => {
  if (!file || access === undefined) return;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, delegateAccess(harness, access)); } catch {}
};
function delegateMcp(opts, env, dataDir, platform = process.platform) {
  if (!['claude', 'codex', 'opencode', 'antigravity'].includes(opts.harness)) return { args: [], env: {} };
  const found = require('./providers').detect(['codex', 'claude', 'opencode'], env);
  // A Windows .cmd that isn't an npm shim can't be started without a shell (which would reparse the prompt): left out.
  const launch = Object.fromEntries(Object.entries(found).filter(([, bin]) => bin).map(([name, bin]) => [name, resolveLaunch(bin, [], platform)])
    .filter(([, l]) => l?.file && (platform !== 'win32' || !/\.(cmd|bat)$/i.test(l.file))));
  const accessFile = dataDir && opts.key ? path.join(dataDir, 'delegate', crypto.createHash('sha1').update(String(opts.key)).digest('hex').slice(0, 16) + '.access') : '';
  writeDelegateAccess(accessFile, opts.harness, opts.access ?? 'default');
  const serverEnv = {
    TERMINALVIBE_DELEGATE_LAUNCH: JSON.stringify(launch),
    TERMINALVIBE_DELEGATE_ACCESS: delegateAccess(opts.harness, opts.access),
    ...(accessFile ? { TERMINALVIBE_DELEGATE_ACCESS_FILE: accessFile } : {}),
    TERMINALVIBE_DELEGATE_CWD: opts.cwd || '',
    ...(dataDir ? { TERMINALVIBE_DATA_DIR: dataDir } : {}),
  };
  // Packaged: the script is unpacked from app.asar (asarUnpack) so the agent can run it.
  const script = path.join(__dirname, 'delegate-mcp.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const command = process.execPath;
  if (opts.harness === 'claude') {
    return { accessFile, env: { ...serverEnv, MCP_TOOL_TIMEOUT: '3600000' },
      args: ['--mcp-config', JSON.stringify({ mcpServers: { terminalvibe: { type: 'stdio', command, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } } } })] };
  }
  if (opts.harness === 'codex') {
    const toml = JSON.stringify; // a JSON string is a valid TOML basic string
    // Codex passes only a few env vars to MCP servers: env_vars forwards these by name (values never in the args).
    // approve: Codex would refuse the call under Full access (no approvals) otherwise; the subagent never gets more
    // than the chat's current pick (delegateAccess), which is how Codex itself treats Ask first.
    return { accessFile, env: serverEnv, args: ['-c', `mcp_servers.terminalvibe.command=${toml(command)}`, '-c', `mcp_servers.terminalvibe.args=[${toml(script)}]`,
      '-c', 'mcp_servers.terminalvibe.env={ELECTRON_RUN_AS_NODE="1"}', '-c', `mcp_servers.terminalvibe.env_vars=[${DELEGATE_ENV.map(toml).join(',')}]`,
      '-c', 'mcp_servers.terminalvibe.tool_timeout_sec=3600', '-c', 'mcp_servers.terminalvibe.default_tools_approval_mode="approve"'] };
  }
  if (opts.harness === 'antigravity') {
    // ACP takes MCP servers on session/new|load|resume, env as name/value pairs (over stdio, never a command line).
    return { accessFile, env: {}, args: [], mcpServers: [{ name: 'terminalvibe', command, args: [script],
      env: Object.entries({ ELECTRON_RUN_AS_NODE: '1', ...serverEnv }).map(([name, value]) => ({ name, value })) }] };
  }
  let config = {}; try { config = JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}') || {}; } catch {}
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  config.mcp = { ...config.mcp, terminalvibe: { type: 'local', command: [command, script], environment: { ELECTRON_RUN_AS_NODE: '1' }, enabled: true, timeout: 3600000 } };
  return { accessFile, env: { ...serverEnv, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }, args: [] };
}

function register(ipcMain, { send, env: makeEnv, args: launchArgs = () => [], version, dataDir }) {
  // Cache Antigravity's catalog and coalesce concurrent OpenCode probes for the same project.
  const modelCache = new Map();
  ipcMain.handle('chat-sdk:models', async (_e, harness, bin, cwd) => {
    if (harness === 'opencode' && typeof bin === 'string') {
      const home = require('os').homedir();
      const directory = typeof cwd === 'string' && path.isAbsolute(cwd) && fs.existsSync(cwd) ? cwd : home;
      const key = JSON.stringify([bin, directory]);
      if (!modelCache.has(key)) modelCache.set(key, openCodeModels(bin, makeEnv('models-probe', harness), directory)
        .then(models => { if (Array.isArray(models) && models.length) modelCache.set(key, Promise.resolve(models)); return models; })
        .catch(() => { modelCache.delete(key); return null; })); // only failures re-probe; a good catalog is kept
      return modelCache.get(key);
    }
    if (harness !== 'antigravity' || typeof bin !== 'string') return [];
    if (!modelCache.has(bin)) modelCache.set(bin, acpProbeModels(bin, makeEnv('models-probe', harness), require('os').tmpdir()).catch(() => { modelCache.delete(bin); return []; }));
    return modelCache.get(bin);
  });
  const emit = (key, ev) => send('chat-sdk:event', { key, ...ev });
  const get = key => { const s = sessions.get(key); return s?.alive ? s : null; };
  ipcMain.handle('chat-sdk:skills', async (_e, harness, key, bin, cwd) => {
    const live = get(key);
    if (harness === 'claude') {
      return require('./chat-complete').listClaudeSkills(cwd || live?.cwd, undefined, makeEnv(key, harness));
    }
    if (live?.harness === harness && live.sessionId && (!cwd || cwd === live.cwd)
      && (live instanceof CodexSession || live instanceof AcpSession)) return live.listSkills();
    if (typeof bin !== 'string') throw Error('Agent executable was not found on PATH');
    const directory = typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : require('os').homedir();
    if (harness === 'opencode') {
      return withOpenCodeServer(bin, makeEnv(key, harness), directory, async (client, signal) => {
        const { data } = await client.app.skills({ directory }, { signal });
        return data.filter(skill => /^[\w:.-]+$/.test(skill.id || skill.name))
          .map(skill => ({ name: skill.id || skill.name, description: skill.description }));
      });
    }
    if (harness === 'antigravity') return acpProbe(bin, makeEnv(key, harness), directory, session => session.listSkills());
    if (harness !== 'codex') return [];
    const probe = new CodexSession(key, 'codex', () => {});
    const timer = setTimeout(() => probe.stop(), 10000);
    try {
      await probe.initialize({ bin, cwd: directory, env: makeEnv(key, harness), clientVersion: version });
      return await probe.listSkills();
    } finally {
      clearTimeout(timer);
      probe.stop();
    }
  });
  ipcMain.handle('chat-sdk:start', async (_e, key, opts = {}) => {
    const S = SESSIONS[opts.harness];
    if (!S || typeof key !== 'string' || typeof opts.bin !== 'string') return { ok: false, error: 'Unsupported agent' };
    sessions.get(key)?.stop();
    if (opts.cwd && !fs.existsSync(opts.cwd)) return { ok: false, error: `The project folder no longer exists: ${opts.cwd}` };
    const s = new S(key, opts.harness, emit);
    sessions.set(key, s);
    try {
      const env = makeEnv(key, opts.harness);
      let mcp = { args: [], env: {} };
      try { mcp = delegateMcp({ ...opts, key }, env, dataDir); } catch (err) { console.error('[chat-sdk] subagent tool', err.message); } // the agent starts without it
      s.delegateAccessFile = mcp.accessFile;
      return await s.start({ ...opts, env: { ...env, ...mcp.env }, extraArgs: [...launchArgs(opts.harness), ...mcp.args], mcpServers: mcp.mcpServers || [],
        clientVersion: version, transcriptDir: dataDir && path.join(dataDir, 'acp') });
    } catch (err) {
      s.stop();
      return { ok: false, error: err.message || 'Could not start the agent' };
    }
  });
  ipcMain.handle('chat-sdk:send', async (_e, key, text, opts) => {
    const s = get(key);
    if (!s) return { ok: false, error: 'The agent is not running' };
    writeDelegateAccess(s.delegateAccessFile, s.harness, opts?.options?.access); // the turn's permission pick
    try { await s.send(String(text), opts || {}); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('chat-sdk:interrupt', (_e, key) => { get(key)?.interrupt(); return true; });
  ipcMain.handle('chat-sdk:respond', (_e, key, id, answer) => !!get(key)?.respond(String(id), answer));
  ipcMain.handle('chat-sdk:set-access', (_e, key, access) => { const s = get(key); s?.setAccess(access); writeDelegateAccess(s?.delegateAccessFile, s?.harness, access); return true; });
  ipcMain.handle('chat-sdk:stop', (_e, key) => { sessions.get(key)?.stop(); sessions.delete(key); return true; });
  ipcMain.handle('chat-sdk:status', (_e, key) => { const s = get(key); return s ? { alive: true, busy: s.busy, sessionId: s.sessionId, harness: s.harness } : { alive: false }; });
}
function stopAll() { for (const s of sessions.values()) s.stop(); sessions.clear(); }
function stop(key) { sessions.get(key)?.stop(); sessions.delete(key); }
// The live agent process of a chat (agent-procs.js skips its tree).
// The agent's own process, skipped by the leftover-process scan: OpenCode's is its `opencode serve` (this.server).
function sessionPid(key) { const s = sessions.get(key); return s?.alive ? s.proc?.pid || s.server?.pid || null : null; }

module.exports = { register, stopAll, stop, sessionPid, resolveLaunch, claudePermissionAsk, claudeQuestionAsk, codexAsk, codexAccess, codexTurnParams, acpModels, acpPermissionAsk, AcpSession, OpenCodeSession, openCodeModels, openCodeModel, openCodePermissionAsk, openCodeAccessReply };

if (require.main === module) {
  const assert = require('assert');
  // npm shims run their script with node; native binaries and other platforms run as-is.
  const shim = '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
  assert.deepStrictEqual(resolveLaunch('C:\\npm\\codex.cmd', ['app-server'], 'win32', () => shim),
    { file: 'node', args: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', 'app-server'] });
  assert.deepStrictEqual(resolveLaunch('C:\\bin\\claude.exe', ['-p'], 'win32'), { file: 'C:\\bin\\claude.exe', args: ['-p'] });
  assert.deepStrictEqual(resolveLaunch('/usr/bin/codex', ['app-server'], 'linux'), { file: '/usr/bin/codex', args: ['app-server'] });
  assert.deepStrictEqual(resolveLaunch('C:\\npm\\opencode.cmd', ['serve'], 'win32', () => '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*'),
    { file: 'C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe', args: ['serve'] });
  assert.strictEqual(resolveLaunch('C:\\npm\\odd.cmd', [], 'win32', () => 'no script here'), null);
  // Claude permission asks: a suggestion adds "don't ask again"; a plan approval has its own question.
  const w = claudePermissionAsk({ tool_name: 'Write', display_name: 'Write', input: { file_path: 'a.txt' }, permission_suggestions: [{}], decision_reason: 'why' });
  assert.strictEqual(w.question, 'Allow Write?');
  assert.deepStrictEqual(w.options.map(o => o.label), ['Yes', "Yes, and don't ask again", 'No']);
  assert.deepStrictEqual(w.detail, ['a.txt', 'why']);
  assert.strictEqual(claudePermissionAsk({ tool_name: 'ExitPlanMode', input: { plan: 'step 1\nstep 2' } }).detail.length, 2);
  const q = claudeQuestionAsk({ question: 'Pick?', header: 'H', multiSelect: true, options: [{ label: 'A', description: 'a' }, { label: 'B' }] });
  assert.deepStrictEqual(q.options.map(o => o.label), ['A', 'B', ASK_INPUT, 'Submit']);
  assert.strictEqual(q.header, 'H');
  // Codex: the offered decisions, and full access as never-ask + no sandbox, per thread and per turn.
  const c = codexAsk('item/commandExecution/requestApproval', { command: 'ls', reason: 'List?', availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['ls'] } }, 'cancel'] });
  assert.deepStrictEqual(c.ask.options.map(o => o.label), ['Yes', "Yes, and don't ask again for this command", 'No, and stop']);
  assert.deepStrictEqual(c.answer(1), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['ls'] } } });
  assert.deepStrictEqual(c.answer(-1), { decision: 'decline' });
  assert.deepStrictEqual(codexAccess('full'), { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } });
  assert.deepStrictEqual(codexTurnParams({ model: 'default', effort: 'low', access: 'default' }), { effort: 'low', approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } });
  for (const access of ['default', undefined, 'unexpected']) assert.deepStrictEqual(codexAccess(access), codexAccess('read-only'));
  assert.strictEqual(codexTurnParams({ access: 'default' }).sandboxPolicy.type, 'readOnly', 'Returning from full access must explicitly restore the read-only sandbox');
  assert.deepStrictEqual(codexTurnParams({ model: 'm', access: 'full' }), { model: 'm', approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } });
  assert.strictEqual(codexAsk('item/tool/call', {}), null);
  // ACP (Antigravity): models with their thinking levels from config options; permission choices in the agent's order.
  const m = acpModels({ configOptions: [{ id: 'model', options: [{ value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }, { value: 'claude-opus' }] },
    { id: 'thought_level', currentValue: 'high', options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] }] });
  assert.deepStrictEqual(m[0], { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' });
  assert.strictEqual(m[1].name, 'claude-opus');
  assert.strictEqual(acpModels({ configOptions: [] }), null);
  const p = acpPermissionAsk({ toolCall: { kind: 'execute', title: 'echo hi > hi.txt' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny' }] });
  assert.strictEqual(p.ask.question, 'Allow this command?');
  assert.deepStrictEqual(p.ask.detail, ['echo hi > hi.txt']);
  assert.deepStrictEqual(p.answer(1), { outcome: { outcome: 'selected', optionId: 'deny' } });
  assert.deepStrictEqual(p.answer(-1), { outcome: { outcome: 'cancelled' } });
  // OpenCode: a model id keeps the model's own slashes; permissions reply through the SDK's choices.
  assert.deepStrictEqual(openCodeModel('nvidia/nvidia/active-speaker-detection'), { providerID: 'nvidia', modelID: 'nvidia/active-speaker-detection' });
  assert.strictEqual(openCodeModel('default'), null);
  const op = openCodePermissionAsk({ permission: 'bash', patterns: ['npm test'], always: ['bash'], metadata: { description: 'Run the tests' } });
  assert.strictEqual(op.ask.question, 'Allow bash?');
  assert.deepStrictEqual(op.ask.detail, ['npm test', 'Run the tests']);
  assert.deepStrictEqual(op.ask.options.map(o => o.label), ['Yes', "Yes, and don't ask again", 'No']);
  assert.deepStrictEqual(op.replies, ['once', 'always', 'reject']);
  assert.strictEqual(openCodeAccessReply('default', 'bash'), null, 'Ask first shows the permission card');
  assert.strictEqual(openCodeAccessReply('full', 'bash'), 'once');
  assert.strictEqual(openCodeAccessReply('auto', 'webfetch'), 'once');
  assert.strictEqual(openCodeAccessReply('plan', 'bash'), 'reject');
  assert.strictEqual(openCodeAccessReply('accept-edits', 'edit'), 'once');
  assert.strictEqual(openCodeAccessReply('accept-edits', 'write'), 'once');
  assert.strictEqual(openCodeAccessReply('accept-edits', 'bash'), null);
  // A retry with an action (quota, auth) ends the turn with its message instead of spinning forever.
  const oce = [], ocs = new OpenCodeSession('test', 'opencode', (_k, e) => oce.push(e));
  ocs.waiting = 1; ocs.busy = true; ocs.sessionId = 'ses_test'; ocs.tools = new Map(); ocs.parts = new Map();
  ocs.onEvent({ type: 'session.status', properties: { sessionID: 'ses_test', status: { type: 'retry', message: 'Free usage exceeded', action: { reason: 'free_tier_limit' } } } });
  assert.ok(!ocs.busy && oce.at(-1)?.type === 'idle' && /Free usage/.test(oce.at(-1).error), 'a fatal retry must end the turn with the error');
  ocs.onEvent({ type: 'session.status', properties: { sessionID: 'ses_test', status: { type: 'idle' } } });
  assert.strictEqual(oce.filter(e => e.type === 'idle').length, 1, 'a late idle must not end the turn twice');
  // The final text delta can arrive after the prompt resolves: the answer must still be recorded.
  const late = [], lateSession = new OpenCodeSession('test', 'opencode', () => {});
  Object.assign(lateSession, { parts: new Map(), recordedParts: new Set(), tools: new Map(), recordedTools: new Set(), waiting: 1, sessionId: 'ses_late' });
  lateSession.record = item => late.push(item);
  lateSession.onPart({ id: 'r1', type: 'reasoning', text: 'thinking' });
  lateSession.onPart({ id: 't1', type: 'text', text: '' });
  lateSession.endTurn(null);
  lateSession.onPart({ id: 't1', type: 'text', text: 'the answer', time: { end: 1 } });
  assert.deepStrictEqual(late, [{ role: 'thinking', text: 'thinking' }, { role: 'assistant', text: 'the answer' }]);
  const imagePath = '/tmp/terminalvibe-drop/image.png';
  const claude = new ClaudeSession('test', 'claude', () => {});
  claude.write = message => assert.deepStrictEqual(message.message.content, [
    { type: 'text', text: 'Check this image' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
  ]);
  claude.send('Check this image', { images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] });
  // A steer too late for the running turn runs as its own turn: busy until Claude takes it in and that turn ends.
  const events = [], steerer = new ClaudeSession('test', 'claude', (_k, e) => events.push(e.type)), inputs = [];
  steerer.write = message => inputs.push(message.uuid);
  steerer.send('first'); steerer.send('steer'); steerer.send('second steer');
  steerer.onMessage({ type: 'user', isReplay: true, uuid: inputs[0] });
  steerer.onMessage({ type: 'result' });
  assert.ok(steerer.busy && !events.includes('idle'), 'a result before the steer is taken must not end the turn');
  steerer.onMessage({ type: 'user', isReplay: true, uuid: inputs[1] });
  steerer.onMessage({ type: 'result' });
  assert.ok(steerer.busy && !events.includes('idle'), 'a second pending steer must also keep the queue waiting');
  steerer.onMessage({ type: 'user', isReplay: true, uuid: inputs[2] });
  steerer.onMessage({ type: 'result' });
  assert.ok(!steerer.busy && events.at(-1) === 'idle');
  // Stop: the turn's closing error result is the stop, not an error to show; the next turn's real error still is.
  const idles = [], stopper = new ClaudeSession('test', 'claude', (_k, e) => { if (e.type === 'idle') idles.push(e.error); });
  stopper.write = () => {};
  stopper.send('go'); stopper.setBusy(true); stopper.interrupt();
  stopper.onMessage({ type: 'result', is_error: true, result: '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null' });
  stopper.send('again'); stopper.setBusy(true);
  stopper.onMessage({ type: 'result', is_error: true, result: 'API Error: overloaded' });
  assert.deepStrictEqual(idles, [undefined, 'API Error: overloaded']);
  const claudeConfig = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tv-claude-skills-'));
  try {
    const skillDir = path.join(claudeConfig, 'skills', 'lint');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Lint');
    claude.env = { CLAUDE_CONFIG_DIR: claudeConfig };
    const sent = [];
    claude.write = message => sent.push(message.message.content);
    claude.send('$lint src');
    claude.send('Use $lint on src');
    claude.send('$unknown and $5');
    assert.deepStrictEqual(sent, ['/lint src', '/lint Use $lint on src', '$unknown and $5']);
  } finally {
    fs.rmSync(claudeConfig, { recursive: true, force: true });
  }
  const codex = new CodexSession('test', 'codex', () => {});
  codex.options = {};
  codex.turnId = 'turn';
  const methods = [];
  codex.rpc = async (method, { input }) => {
    methods.push(method);
    assert.deepStrictEqual(input, [
      { type: 'text', text: 'Check this image', text_elements: [] },
      { type: 'localImage', path: imagePath },
    ]);
    return { turn: { id: 'turn' } };
  };
  (async () => {
    await codex.send('Check this image', { images: [imagePath] });
    await codex.send('Check this image', { images: [imagePath], steer: true });
    assert.deepStrictEqual(methods, ['turn/start', 'turn/steer']);
    // A dropped event stream between turns must not surface as the next turn's error ("OpenCode: fetch failed").
    const turnErrors = [], stale = new OpenCodeSession('test', 'opencode', (_k, e) => { if (e.type === 'idle') turnErrors.push(e.error); });
    Object.assign(stale, { sessionId: 'ses_stale', waiting: 0, lastError: 'fetch failed', tools: new Map(), parts: new Map(),
      recordedTools: new Set(), recordedParts: new Set(), queue: Promise.resolve() });
    stale.record = () => {};
    stale.client = { session: { promptAsync: async () => {
      stale.onEvent({ type: 'session.status', properties: { sessionID: 'ses_stale', status: { type: 'idle' } } });
      return { data: { info: {} } };
    } } };
    await stale.send('go', { options: {} });
    await stale.queue;
    assert.deepStrictEqual(turnErrors, [undefined], 'a stale transport error must not fail a successful turn');
    // A long turn must not hold an HTTP response open: promptAsync returns at once and the stream's idle ends
    // the turn, including one that races ahead of the POST (Node's fetch times out a sync prompt after 5 minutes).
    const asyncCalls = [], asyncEvents = [], asyncSession = new OpenCodeSession('test', 'opencode', (_k, e) => asyncEvents.push(e));
    Object.assign(asyncSession, { parts: new Map(), recordedParts: new Set(), tools: new Map(), recordedTools: new Set(),
      waiting: 0, sessionId: 'ses_async', options: {}, alive: true, queue: Promise.resolve() });
    asyncSession.record = () => {};
    asyncSession.client = { session: { promptAsync: async args => {
      asyncCalls.push(args);
      asyncSession.onEvent({ type: 'session.status', properties: { sessionID: 'ses_async', status: { type: 'idle' } } });
      return {};
    } } };
    asyncSession.send('hello');
    await asyncSession.queue;
    assert.strictEqual(asyncCalls.length, 1, 'the turn uses the async prompt endpoint');
    assert.ok(asyncEvents.some(e => e.type === 'idle'), 'an idle racing the POST still settles the turn');
    const dropEvents = [], dropSession = new OpenCodeSession('test', 'opencode', (_k, e) => dropEvents.push(e));
    Object.assign(dropSession, { parts: new Map(), recordedParts: new Set(), tools: new Map(), recordedTools: new Set(),
      waiting: 0, sessionId: 'ses_drop', options: {}, alive: true, queue: Promise.resolve() });
    dropSession.record = () => {};
    dropSession.client = { session: { promptAsync: async () => { throw TypeError('fetch failed'); } } };
    dropSession.send('hello');
    await dropSession.queue;
    assert.strictEqual(dropEvents.at(-1)?.error, 'connection lost', 'a dropped fetch must not surface as a bare "fetch failed"');
    // A clean SSE end (server closing an idle connection) must resubscribe, not fail the turn.
    const subs = [], sse = new OpenCodeSession('test', 'opencode', () => {});
    Object.assign(sse, { alive: true, cwd: '/tmp', sseRetryMs: 5, lastError: null });
    sse.client = { event: { subscribe: async () => { subs.push(1); return { stream: (async function* () {})() }; } } };
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    await sse.consume(ctrl.signal);
    assert.ok(subs.length >= 2, 'an ended event stream is resubscribed');
    assert.strictEqual(sse.lastError, null, 'a transport drop must not fail the turn');
    const text = 'Use $project-skill with $project-skill and $disabled.';
    codex.cwd = '/project';
    codex.rpc = async (method, params) => {
      if (method === 'skills/list') {
        assert.deepStrictEqual(params, { cwds: ['/project'] });
        return { data: [{ skills: [
          { name: 'project-skill', enabled: true, scope: 'repo', path: '/project/.agents/skills/project-skill/SKILL.md' },
          { name: 'project-skill', enabled: true, path: '/other/SKILL.md' },
          { name: 'disabled', enabled: false, path: '/disabled/SKILL.md' },
        ] }] };
      }
      assert.equal(method, 'turn/start');
      assert.deepStrictEqual(params.input, [
        { type: 'text', text, text_elements: [] },
        { type: 'skill', name: 'project-skill', path: '/project/.agents/skills/project-skill/SKILL.md' },
      ]);
      return { turn: { id: 'turn' } };
    };
    assert.equal((await codex.listSkills())[0].source, 'project');
    await codex.send(text);
    const starting = new CodexSession('stop-first', 'codex', () => {});
    starting.sessionId = 'thread';
    let finishStart;
    const interrupted = [];
    starting.rpc = (method, params) => {
      if (method === 'turn/start') return new Promise(resolve => { finishStart = resolve; });
      assert.equal(method, 'turn/interrupt');
      interrupted.push(params.turnId);
      return Promise.resolve();
    };
    const sending = starting.send('First message');
    starting.interrupt();
    assert.deepEqual(interrupted, []);
    finishStart({ turn: { id: 'first' } });
    assert.equal(await sending, false);
    assert.deepEqual(interrupted, ['first'], 'Stop must interrupt a first turn whose ID arrives late');
    const agy = new AcpSession('test', 'antigravity', () => {});
    agy.queue = Promise.resolve();
    agy.waiting = 0;
    agy.tools = new Map();
    agy.apply = async () => {};
    agy.onUpdate({ sessionUpdate: 'available_commands_update', availableCommands: [
      { name: 'compact', description: 'Compact the session' },
      { name: 'project-skill', description: 'A project skill' },
    ] });
    assert.deepStrictEqual(await agy.listSkills(), [{ name: 'project-skill', description: 'A project skill' }]);
    let agyCall;
    agy.rpc = async (method, { prompt }) => {
      agyCall = { method, prompt };
      return { stopReason: 'end_turn' };
    };
    await agy.send('$project-skill src');
    await agy.queue;
    assert.deepStrictEqual(agyCall, { method: 'session/prompt', prompt: [{ type: 'text', text: '/project-skill src' }] });

    // delegate_task MCP wiring: settings ride in the agent's env (never the command line), ELECTRON_RUN_AS_NODE only
    // in the server's own config, a user's OpenCode config is kept, a Windows .cmd that isn't a shim is left out.
    const providers = require('./providers'), detect = providers.detect;
    providers.detect = () => ({ codex: '/bin/codex', claude: 'C:\\x\\claude.cmd', opencode: null });
    try {
      const cx = delegateMcp({ harness: 'codex', access: 'full', cwd: '/p' }, {}, '/d', 'linux');
      assert.equal(cx.env.TERMINALVIBE_DELEGATE_ACCESS, 'full');
      assert.equal(cx.env.TERMINALVIBE_DELEGATE_CWD, '/p');
      assert(!cx.env.ELECTRON_RUN_AS_NODE, 'never in the agent env');
      assert(cx.args.includes('mcp_servers.terminalvibe.env={ELECTRON_RUN_AS_NODE="1"}'));
      assert(!cx.args.join(' ').includes('TERMINALVIBE_DELEGATE_LAUNCH='), 'values are forwarded by name, not passed as args');
      const cl = delegateMcp({ harness: 'claude', access: 'plan' }, {}, '/d', 'linux');
      assert.equal(cl.env.TERMINALVIBE_DELEGATE_ACCESS, 'read-only');
      assert.deepStrictEqual(JSON.parse(cl.args[1]).mcpServers.terminalvibe.env, { ELECTRON_RUN_AS_NODE: '1' });
      const oc = delegateMcp({ harness: 'opencode', access: 'default' }, { OPENCODE_CONFIG_CONTENT: '{"mcp":{"mine":{"type":"local","command":["x"]}},"theme":"t"}' }, '/d', 'linux');
      const occ = JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT);
      assert(occ.mcp.mine && occ.mcp.terminalvibe && occ.theme === 't', "the user's OpenCode config is kept");
      assert.equal(oc.env.TERMINALVIBE_DELEGATE_ACCESS, 'read-only', 'OpenCode runs the tool without a card: Ask first stays read only');
      assert(cx.args.includes('mcp_servers.terminalvibe.default_tools_approval_mode="approve"'), 'Full access Codex can run it');
      const win = JSON.parse(delegateMcp({ harness: 'codex' }, {}, '/d', 'win32').env.TERMINALVIBE_DELEGATE_LAUNCH);
      assert(win.codex && !win.claude, 'an unresolvable .cmd is left out on Windows');
      const agy = delegateMcp({ harness: 'antigravity', access: 'auto' }, {}, '/d', 'linux');
      assert.equal(agy.mcpServers[0].name, 'terminalvibe');
      assert(agy.mcpServers[0].env.some(e => e.name === 'ELECTRON_RUN_AS_NODE') && agy.mcpServers[0].env.some(e => e.name === 'TERMINALVIBE_DELEGATE_ACCESS' && e.value === 'edits'));
      assert.deepStrictEqual(delegateMcp({ harness: 'amp' }, {}, '/d'), { args: [], env: {} });
      // Each harness's permission picks as the subagent's access.
      for (const [h, a, want] of [['claude', 'default', 'edits'], ['claude', 'plan', 'read-only'], ['claude', 'bypassPermissions', 'full'], ['codex', 'default', 'read-only'],
        ['codex', 'workspace-write', 'edits'], ['codex', 'full', 'full'], ['opencode', 'accept-edits', 'edits'], ['antigravity', 'default', 'read-only'], ['opencode', undefined, 'read-only']]) {
        assert.equal(delegateAccess(h, a), want, `${h} ${a}`);
      }
      // A permission change in the chat reaches the next subagent through the access file.
      const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tv-delegate-'));
      const live = delegateMcp({ harness: 'codex', access: 'default', key: 'pane-1' }, {}, tmp, 'linux');
      assert.equal(fs.readFileSync(live.env.TERMINALVIBE_DELEGATE_ACCESS_FILE, 'utf8'), 'read-only');
      writeDelegateAccess(live.accessFile, 'codex', 'full');
      assert.equal(fs.readFileSync(live.accessFile, 'utf8'), 'full');
      fs.rmSync(tmp, { recursive: true, force: true });
    } finally { providers.detect = detect; }
    const { childArgs, delegateKey } = require('./delegate-mcp');
    assert.deepStrictEqual(childArgs('codex', { prompt: null }, 'read-only').slice(-3), ['-s', 'read-only', '-']);
    assert(childArgs('codex', { prompt: null }, 'full').includes('--dangerously-bypass-approvals-and-sandbox'));
    assert.equal(childArgs('opencode', { prompt: '-x go' }, 'edits').at(-1), ' -x go', 'a prompt never reads as a flag');
    assert(childArgs('opencode', { prompt: 'go' }, 'read-only').includes('plan'));
    assert(!childArgs('claude', { prompt: null }, 'edits').includes('--'), 'the prompt comes on stdin');
    assert.equal(delegateKey('codex', 'a'), delegateKey('codex', 'a'));
    assert.notEqual(delegateKey('codex', 'a'), delegateKey('claude', 'a'));
    console.log('chat-sdk: ok');
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
