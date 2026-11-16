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

const ASK_INPUT = 'Type something';

// A Windows npm shim (.cmd) can't be spawned directly. It wraps `node <script>`: run that instead, so
// arguments (JSON settings, paths) are passed as-is, never re-parsed by cmd.exe.
function resolveLaunch(bin, args, platform = process.platform, readFile = f => fs.readFileSync(f, 'utf8')) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(bin)) return { file: bin, args };
  try {
    const m = /"%dp0%\\([^"]+\.(?:js|cjs|mjs))"/i.exec(readFile(bin));
    if (m) return { file: 'node', args: [path.win32.join(path.win32.dirname(bin), m[1]), ...args] };
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
    question: q.question || q.header || 'Claude has a question', detail: q.header && q.question ? [q.header] : [], multi: !!q.multiSelect,
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
  return {}; // "Ask first": Codex's own configured defaults
}
// Per-turn settings for Codex (it takes them on every turn/start, no restart).
function codexTurnParams(o = {}) {
  const a = codexAccess(o.access);
  return { ...(o.model && o.model !== 'default' ? { model: o.model } : {}), ...(o.effort && o.effort !== 'default' ? { effort: o.effort } : {}),
    ...(a.approvalPolicy ? { approvalPolicy: a.approvalPolicy, sandboxPolicy: a.sandboxPolicy } : {}), ...(o.serviceTier ? { serviceTier: o.serviceTier } : {}) };
}
const CLAUDE_MODE = access => access === 'default' || !access ? 'manual' : access;

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
    const gone = (code, error) => {
      if (!this.alive) return;
      this.alive = false; this.busy = false; this.asks.clear();
      this.rejectPending?.(Error(error || 'The agent exited'));
      this.emit('exit', { code, error: code ? (error || this.stderr.trim().split('\n').slice(-3).join('\n') || `exited with code ${code}`) : null });
    };
    this.proc.on('exit', code => gone(code));
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
  start({ bin, cwd, env, argv, access }) {
    // The chat's own flags (model, effort, session, settings) plus headless mode; permission prompts come back over
    // stdio. Full access can be switched on later in the session (a pick in the chat is the user's consent).
    this.launch(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--permission-prompt-tool', 'stdio', '--allow-dangerously-skip-permissions', ...argv.filter((x, i, a) => x !== '--permission-mode' && a[i - 1] !== '--permission-mode'),
      '--permission-mode', CLAUDE_MODE(access)], cwd, env);
    this.access = access;
    this.control({ subtype: 'initialize' });
    return Promise.resolve({ ok: true });
  }
  control(request) { this.write({ type: 'control_request', request_id: `tv-${++this.askSeq}`, request }); }
  onMessage(m) {
    if (m.type === 'system' && m.subtype === 'init' && m.session_id && m.session_id !== this.sessionId) { this.sessionId = m.session_id; this.emit('session', { sessionId: m.session_id }); }
    if (m.type === 'system' && m.subtype === 'status' && m.status === 'requesting') this.setBusy(true);
    if (m.type === 'assistant') this.setBusy(true);
    if (m.type === 'result') this.setBusy(false, m.is_error ? { error: short(m.result || (m.errors || []).join('\n') || m.subtype, 400) } : {});
    if (m.type === 'control_request') this.onControl(m);
  }
  onControl(m) {
    const reply = response => this.write({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } });
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
        this.addAsk(ask, a => {
          const labels = (a.indices || []).map(k => ask.options[k]?.label).filter(Boolean);
          answers[q.question] = a.text != null ? a.text : q.multiSelect ? labels.join(', ') : ask.options[a.index]?.label ?? '';
          next(i + 1);
        });
      };
      next(0);
      return;
    }
    const ask = claudePermissionAsk(req);
    this.addAsk(ask, a => {
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
  }
  send(text) {
    this.setBusy(true);
    this.write({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: this.sessionId || '' });
    return Promise.resolve(true);
  }
  interrupt() { this.control({ subtype: 'interrupt' }); }
  setAccess(access) {
    if (access === this.access) return;
    this.access = access;
    this.control({ subtype: 'set_permission_mode', mode: CLAUDE_MODE(access) });
  }
}

class CodexSession extends Session {
  start({ bin, cwd, env, options = {}, resume, fork, clientVersion }) {
    this.launch(bin, ['app-server'], cwd, env);
    this.rpcId = 0; this.pending = new Map(); this.turnId = null; this.options = options; this.cwd = cwd;
    this.rejectPending = err => { for (const p of this.pending.values()) p.reject(err); this.pending.clear(); };
    const a = codexAccess(options.access);
    const params = { cwd, ...(options.model && options.model !== 'default' ? { model: options.model } : {}), ...(a.approvalPolicy ? { approvalPolicy: a.approvalPolicy, sandbox: a.sandbox } : {}),
      ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}) };
    return (async () => {
      await this.rpc('initialize', { clientInfo: { name: 'terminalvibe', title: 'TerminalVibe', version: clientVersion || '0' } });
      this.write({ method: 'initialized', params: {} });
      const r = resume ? await this.rpc('thread/resume', { ...params, threadId: resume, excludeTurns: true })
        : fork ? await this.rpc('thread/fork', { ...params, threadId: fork, excludeTurns: true })
        : await this.rpc('thread/start', params);
      this.sessionId = r.thread.id;
      this.emit('session', { sessionId: r.thread.id });
      return { ok: true, sessionId: r.thread.id };
    })();
  }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.alive) return reject(Error('Codex is not running'));
      const id = ++this.rpcId;
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
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
      const err = p.turn?.status === 'failed' ? short(p.turn.error?.message || 'The turn failed', 400) : null;
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
        const ask = { question: q.question || q.header || 'Codex has a question', detail: q.header && q.question ? [q.header] : [],
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
  async send(text, { steer, options } = {}) {
    if (options) this.options = options;
    const input = [{ type: 'text', text, text_elements: [] }];
    this.setBusy(true);
    try {
      if (steer && this.turnId) {
        try { await this.rpc('turn/steer', { threadId: this.sessionId, expectedTurnId: this.turnId, input }); return true; }
        catch { /* the turn ended meanwhile: start a new one */ }
      }
      const r = await this.rpc('turn/start', { threadId: this.sessionId, input, ...codexTurnParams(this.options) });
      this.turnId = r.turn?.id || this.turnId;
      return true;
    } catch (err) { this.setBusy(false, { error: err.message }); throw err; }
  }
  interrupt() { if (this.turnId) this.rpc('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId }).catch(() => {}); }
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
class AcpSession extends Session {
  start({ bin, cwd, env, options = {}, resume, clientVersion, transcriptDir }) {
    this.options = options; this.dir = transcriptDir; this.tools = new Map(); this.buf = null; this.waiting = 0;
    // Full access is a start flag (it auto-approves every request); the other permissions are the session's modes.
    this.full = options.access === 'full';
    this.launch(bin, ['acp', ...(this.full ? ['--dangerously-skip-permissions'] : [])], cwd, env);
    this.rpcId = 0; this.pending = new Map(); this.queue = Promise.resolve();
    this.rejectPending = err => { for (const p of this.pending.values()) p.reject(err); this.pending.clear(); };
    return (async () => {
      await this.rpc('initialize', { ...ACP_CLIENT, clientInfo: { name: 'terminalvibe', title: 'TerminalVibe', version: clientVersion || '0' } });
      let r;
      if (resume) {
        // Resume without replay; an agent that only loads replays the history, which is already recorded.
        try { r = await this.rpc('session/resume', { sessionId: resume, cwd, mcpServers: [] }); }
        catch { this.replaying = true; try { r = await this.rpc('session/load', { sessionId: resume, cwd, mcpServers: [] }); } finally { this.replaying = false; } }
        this.sessionId = resume;
      } else { r = await this.rpc('session/new', { cwd, mcpServers: [] }); this.sessionId = r.sessionId; }
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
  recordTool(t, error) {
    const input = t.input ?? {};
    this.record({ role: 'tool', name: t.name, summary: short(t.title || toolSummaryOf(input), 200),
      detail: short(typeof input === 'string' ? input : JSON.stringify(input, null, 2), ACP_TOOL_DETAIL), ...(error ? { error: true } : {}) });
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
    if (this.replaying) return;
    const kind = u.sessionUpdate;
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const role = kind === 'agent_message_chunk' ? 'assistant' : 'thinking';
      if (this.buf?.role !== role) this.flush();
      this.buf ||= { role, text: '' };
      if (u.content?.type === 'text') this.buf.text += u.content.text || '';
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      if (kind === 'tool_call') this.flush();
      const t = this.tools.get(u.toolCallId) || { name: 'tool' };
      if (u.name || u.kind) t.name = String(u.name || u.kind);
      if (u.title) t.title = String(u.title);
      if (u.rawInput !== undefined || u.args !== undefined) t.input = u.rawInput ?? u.args;
      this.tools.set(u.toolCallId, t);
      if (u.status === 'completed' || u.status === 'failed') { this.recordTool(t, u.status === 'failed'); this.tools.delete(u.toolCallId); }
    }
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
        const r = await this.rpc('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] });
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
async function acpProbeModels(bin, env, cwd) {
  const s = new AcpSession('models-probe', 'antigravity', () => {});
  try {
    const r = await s.start({ bin, cwd, env, options: {} });
    s.rpc('session/close', { sessionId: r.sessionId }).catch(() => {});
    return r.models || [];
  } finally { setTimeout(() => s.stop(), 300); }
}
const toolSummaryOf = input => { try { return require('./threads').toolSummary(input); } catch { return ''; } };

const SESSIONS = { claude: ClaudeSession, codex: CodexSession, antigravity: AcpSession };
const sessions = new Map();

function register(ipcMain, { send, env: makeEnv, version, dataDir }) {
  // The model list of an agent whose models come from a live session (Antigravity), once per app run.
  const modelCache = new Map();
  ipcMain.handle('chat-sdk:models', async (_e, harness, bin) => {
    if (harness !== 'antigravity' || typeof bin !== 'string') return [];
    if (!modelCache.has(bin)) modelCache.set(bin, acpProbeModels(bin, makeEnv('models-probe'), require('os').tmpdir()).catch(() => { modelCache.delete(bin); return []; }));
    return modelCache.get(bin);
  });
  const emit = (key, ev) => send('chat-sdk:event', { key, ...ev });
  const get = key => { const s = sessions.get(key); return s?.alive ? s : null; };
  ipcMain.handle('chat-sdk:start', async (_e, key, opts = {}) => {
    const S = SESSIONS[opts.harness];
    if (!S || typeof key !== 'string' || typeof opts.bin !== 'string') return { ok: false, error: 'Unsupported agent' };
    sessions.get(key)?.stop();
    if (opts.cwd && !fs.existsSync(opts.cwd)) return { ok: false, error: `The project folder no longer exists: ${opts.cwd}` };
    const s = new S(key, opts.harness, emit);
    sessions.set(key, s);
    try {
      return await s.start({ ...opts, env: makeEnv(key), clientVersion: version, transcriptDir: dataDir && path.join(dataDir, 'acp') });
    } catch (err) {
      s.stop();
      return { ok: false, error: err.message || 'Could not start the agent' };
    }
  });
  ipcMain.handle('chat-sdk:send', async (_e, key, text, opts) => {
    const s = get(key);
    if (!s) return { ok: false, error: 'The agent is not running' };
    try { await s.send(String(text), opts || {}); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('chat-sdk:interrupt', (_e, key) => { get(key)?.interrupt(); return true; });
  ipcMain.handle('chat-sdk:respond', (_e, key, id, answer) => !!get(key)?.respond(String(id), answer));
  ipcMain.handle('chat-sdk:set-access', (_e, key, access) => { get(key)?.setAccess(access); return true; });
  ipcMain.handle('chat-sdk:stop', (_e, key) => { sessions.get(key)?.stop(); sessions.delete(key); return true; });
  ipcMain.handle('chat-sdk:status', (_e, key) => { const s = get(key); return s ? { alive: true, busy: s.busy, sessionId: s.sessionId, harness: s.harness } : { alive: false }; });
}
function stopAll() { for (const s of sessions.values()) s.stop(); sessions.clear(); }
function stop(key) { sessions.get(key)?.stop(); sessions.delete(key); }

module.exports = { register, stopAll, stop, resolveLaunch, claudePermissionAsk, claudeQuestionAsk, codexAsk, codexAccess, codexTurnParams, acpModels, acpPermissionAsk, AcpSession };

if (require.main === module) {
  const assert = require('assert');
  // npm shims run their script with node; native binaries and other platforms run as-is.
  const shim = '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
  assert.deepStrictEqual(resolveLaunch('C:\\npm\\codex.cmd', ['app-server'], 'win32', () => shim),
    { file: 'node', args: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', 'app-server'] });
  assert.deepStrictEqual(resolveLaunch('C:\\bin\\claude.exe', ['-p'], 'win32'), { file: 'C:\\bin\\claude.exe', args: ['-p'] });
  assert.deepStrictEqual(resolveLaunch('/usr/bin/codex', ['app-server'], 'linux'), { file: '/usr/bin/codex', args: ['app-server'] });
  assert.strictEqual(resolveLaunch('C:\\npm\\odd.cmd', [], 'win32', () => 'no script here'), null);
  // Claude permission asks: a suggestion adds "don't ask again"; a plan approval has its own question.
  const w = claudePermissionAsk({ tool_name: 'Write', display_name: 'Write', input: { file_path: 'a.txt' }, permission_suggestions: [{}], decision_reason: 'why' });
  assert.strictEqual(w.question, 'Allow Write?');
  assert.deepStrictEqual(w.options.map(o => o.label), ['Yes', "Yes, and don't ask again", 'No']);
  assert.deepStrictEqual(w.detail, ['a.txt', 'why']);
  assert.strictEqual(claudePermissionAsk({ tool_name: 'ExitPlanMode', input: { plan: 'step 1\nstep 2' } }).detail.length, 2);
  const q = claudeQuestionAsk({ question: 'Pick?', header: 'H', multiSelect: true, options: [{ label: 'A', description: 'a' }, { label: 'B' }] });
  assert.deepStrictEqual(q.options.map(o => o.label), ['A', 'B', ASK_INPUT, 'Submit']);
  // Codex: the offered decisions, and full access as never-ask + no sandbox, per thread and per turn.
  const c = codexAsk('item/commandExecution/requestApproval', { command: 'ls', reason: 'List?', availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['ls'] } }, 'cancel'] });
  assert.deepStrictEqual(c.ask.options.map(o => o.label), ['Yes', "Yes, and don't ask again for this command", 'No, and stop']);
  assert.deepStrictEqual(c.answer(1), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['ls'] } } });
  assert.deepStrictEqual(c.answer(-1), { decision: 'decline' });
  assert.deepStrictEqual(codexAccess('full'), { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } });
  assert.deepStrictEqual(codexTurnParams({ model: 'default', effort: 'low', access: 'default' }), { effort: 'low' });
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
  console.log('chat-sdk: ok');
}
