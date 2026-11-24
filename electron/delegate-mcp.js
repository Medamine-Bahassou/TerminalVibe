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
// A2UI: the chat renders ```a2ui fences of A2UI 1.0 messages as live UI (a2ui.js). The brief rides in the server's
// instructions (Claude Code keeps up to 4096 chars) and Codex's developerInstructions (chat-sdk.js), so agents can
// answer with UI without calling a2ui_guide first; the guide is the full reference.
const A2UI_BRIEF = `The TerminalVibe chat renders A2UI 1.0 (Google's generative UI protocol) as live UI. Use it, without asking or calling a tool first, when the user asks for a form, UI, picker, buttons or A2UI, or when an interactive choice, form or confirmation clearly serves better than prose: put an \`\`\`a2ui fenced block in your reply holding a JSON array of A2UI messages. Keep prose outside the block; no HTML.
Message: {"version":"1.0","createSurface":{"surfaceId":"s1","sendDataModel":true,"dataModel":{...},"components":[...]}}. A later block may send {"version":"1.0","updateComponents":{surfaceId,components}}, {"version":"1.0","updateDataModel":{surfaceId,path,value}} or {"version":"1.0","deleteSurface":{surfaceId}}.
Components are a flat list of {"id","component",...props}; the root has id "root"; child/children hold ids.
Text{text (simple markdown), variant caption|body} Image{url} Icon{name} Row/Column{children,justify,align} List{children,direction} Card{child} Divider Tabs{tabs:[{title,child}]} Modal{trigger,content} Button{child (id of a Text), variant primary|default|borderless, action} TextField{label,value,placeholder,variant shortText|longText|number|obscured} CheckBox{label,value} ChoicePicker{label,options:[{label,value}],value (string array),variant mutuallyExclusive|multipleSelection,displayStyle checkbox|chips} Slider{label,min,max,value} DateTimeInput{label,value,enableDate,enableTime}.
TerminalVibe extras: Chart{type bar|line|area|pie|donut, stacked (bar/area), labels:[x labels or slice names], series:[{name,values:[numbers]}] (pie/donut: series[0] split across labels), unit, min, max, height} draws real charts (legend, tooltip, table view; up to 8 series) - use it for any chart, never text bars or hand-made images. Image.url may be https or a local file path (absolute or relative to the project; png, jpg, gif, webp, svg).
A value is a literal, {"@path":"/json/pointer"} (bind every input this way) or {"@call":"formatString","args":{"value":"Hi \${/name}"}}.
Validation: "checks":[{"condition":{"@call":"required","args":{"value":{"@path":"/name"}}},"message":"Name is required"}] (also email, regex, length, numeric); a Button's checks keep it disabled until they pass.
Button action: {"event":{"name":"create","userMessage":"Create it","context":{"name":{"@path":"/name"}}}}. When pressed, the user's next message is that userMessage plus an \`\`\`a2ui-action block with the event and the data model: act on it.
For list templates, functions and every property, call a2ui_guide.`;
const A2UI_TOOL = {
  name: 'a2ui_guide',
  description: 'How to show interactive UI (forms, pickers, buttons, cards, lists, tabs) in the TerminalVibe chat with A2UI 1.0. '
    + 'Call this before writing an ```a2ui block.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { title: 'A2UI guide', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
const A2UI_GUIDE = `# A2UI 1.0 in the TerminalVibe chat

Put a fenced code block with the language \`a2ui\` in your reply. It holds a JSON array of A2UI 1.0 messages (or JSON
lines). The chat renders it in place as UI. Keep prose outside the block. Every message has "version": "1.0".

## Messages
- {"version":"1.0","createSurface":{"surfaceId":"s1","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json","sendDataModel":true,"components":[...],"dataModel":{...}}}
- {"version":"1.0","updateComponents":{"surfaceId":"s1","components":[...]}}   (upsert by id)
- {"version":"1.0","updateDataModel":{"surfaceId":"s1","path":"/form/name","value":"Ada"}}   (path omitted = whole model)
- {"version":"1.0","deleteSurface":{"surfaceId":"s1"}}
A later \`a2ui\` block may update or delete a surface from an earlier reply of this chat. Use a new surfaceId for a new UI.

## Components (flat list, referenced by id; the root component has id "root")
Each: {"id":"x","component":"<Name>", ...props}. Optional on any: "weight" (flex-grow inside Row/Column),
"accessibility":{"label","description"}.
- Text: text, variant caption|body. Text supports simple markdown (# headings, **bold**, lists, \`code\`).
- Image: url (https), description, fit contain|cover|fill|none|scaleDown, variant icon|avatar|smallFeature|mediumFeature|largeFeature|header
- Icon: name (accountCircle add arrowBack arrowForward attachFile calendarToday call camera check close delete download edit
  event error fastForward favorite favoriteOff folder help home info locationOn lock lockOpen mail menu moreVert moreHoriz
  notificationsOff notifications pause payment person phone photo play print refresh rewind search send settings share
  shoppingCart skipNext skipPrevious star starHalf starOff stop upload visibility visibilityOff volumeDown volumeMute volumeOff volumeUp warning)
- Video: url, posterUrl. AudioPlayer: url, description
- Row / Column: children, justify start|center|end|spaceBetween|spaceAround|spaceEvenly|stretch, align start|center|end|stretch
- List: children, direction vertical|horizontal, align
- Card: child. Divider: axis horizontal|vertical
- Tabs: tabs [{"title":..., "child":"id"}]. Modal: trigger (id), content (id)
- Button: child (id, usually a Text), variant default|primary|borderless, action, checks
- TextField: label, value, placeholder, variant shortText|longText|number|obscured, checks
- CheckBox: label, value (boolean), checks
- ChoicePicker: label, options [{"label","value"}], value (string array), variant mutuallyExclusive|multipleSelection,
  displayStyle checkbox|chips, filterable, checks
- Slider: label, min, max, value (number), steps. DateTimeInput: value (ISO string), enableDate, enableTime, min, max, label
- Chart (TerminalVibe extension): type bar|line|area|pie|donut, stacked (true: stacked bars/areas), labels (string
  array: x labels, or a pie's slice names), series [{"name","values":[numbers]}] (up to 8; null = missing; a pie/donut
  uses series[0], one value per label, past 8 slices folded into "Other"), unit ("%", or "$" "€" "£" which lead the
  number), min, max (y range), height (px, default 220). Legend, hover tooltip and a table view are built in.
  labels/series/values may be {"@path"} bindings.
Image.url may be https, data:, or a local file path (absolute, ~/, or relative to the project folder; png jpg gif webp svg).
Strings must be valid JSON: write line breaks inside text as \\n.

children is ["id", ...] or a template {"path":"/items","componentId":"row"}: one copy per item, where paths without a
leading "/" are relative to the item ({"@path":"name"}).

## Values
A dynamic value is a literal, a data binding {"@path":"/json/pointer"}, or a function call {"@call":"name","args":{...}}.
Bind inputs to the data model with {"@path":...} so what the user enters is kept (two-way binding).
Functions: required(value) regex(value,pattern) length(value,min,max) numeric(value,min,max) email(value)
formatString(value:"Hi \${/user/name}") formatNumber(value,decimals,grouping) formatCurrency(value,currency,decimals)
formatDate(value,format:"MMM d, yyyy") pluralize(value,one,other) openUrl(url) and(values) or(values) not(value).
No operators: build text with formatString. Checks: "checks":[{"condition":{"@call":"required","args":{"value":{"@path":"/f/email"}}},"message":"Email is required"}];
a Button's checks disable it until they pass.

## Actions
Button "action": {"event":{"name":"submit","userMessage":"Submit the form","context":{"email":{"@path":"/f/email"}}}}
or {"functionCall":{"@call":"openUrl","args":{"url":"https://..."}}}.
When the user presses it, your next user message is userMessage (or "A2UI action: <name>") followed by an \`a2ui-action\`
block: {"version":"1.0","action":{"name","surfaceId","sourceComponentId","timestamp","context"}} and, when the surface
has "sendDataModel": true, {"version":"1.0","surfaces":{"<surfaceId>":<data model>}}. Act on it like any user request.

## Example
\`\`\`a2ui
[{"version":"1.0","createSurface":{"surfaceId":"deploy","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
 "dataModel":{"env":["staging"],"notes":""},
 "components":[
  {"id":"root","component":"Card","child":"col"},
  {"id":"col","component":"Column","children":["title","env","notes","go"]},
  {"id":"title","component":"Text","text":"### Deploy"},
  {"id":"env","component":"ChoicePicker","label":"Environment","displayStyle":"chips","value":{"@path":"/env"},
   "options":[{"label":"Staging","value":"staging"},{"label":"Production","value":"production"}]},
  {"id":"notes","component":"TextField","label":"Notes","variant":"longText","value":{"@path":"/notes"}},
  {"id":"go","component":"Button","variant":"primary","child":"goText",
   "action":{"event":{"name":"deploy","userMessage":"Deploy","context":{"env":{"@path":"/env"},"notes":{"@path":"/notes"}}}}},
  {"id":"goText","component":"Text","text":"Deploy"}]}}]
\`\`\`
`;
function guideText() {
  const dir = skillDir();
  if (!dir) return null;
  const body = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
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
    serverInfo: { name: 'terminalvibe', version: '1.0.0' }, instructions: (skillDir() ? INSTRUCTIONS + '\n\n' : '') + A2UI_BRIEF } });
  if (method === 'ping') return send({ id, result: {} });
  // In a read-only chat the subagent is read only too: say so, so agents needn't ask before each call.
  if (method === 'tools/list') {
    const readOnly = currentAccess() === 'read-only';
    return send({ id, result: { tools: [{ ...TOOL, annotations: { title: 'Run a subagent', readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } },
      ...(skillDir() ? [GUIDE] : []), A2UI_TOOL] } });
  }
  if (method === 'tools/call' && params?.name === A2UI_TOOL.name) return send({ id, result: { content: [{ type: 'text', text: A2UI_GUIDE }] } });
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

module.exports = { delegateKey, childArgs, A2UI_BRIEF };
