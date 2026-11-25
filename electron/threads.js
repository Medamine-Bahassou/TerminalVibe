// Project threads: find agent CLIs on PATH, read their local transcripts
// (prompts, replies, tool calls) and write handoff files. No provider calls.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { readEdges } = require('./claude-sessions');

// shortcut: a transcript over 2 x 2 MB loses its middle, read it in chunks if long threads need it.
const EDGE = 2 * 1024 * 1024;
const MAX_ITEMS = 600;
const PREVIEW_ITEMS = 100;

// name -> absolute launcher path, or null. Windows npm shims are .cmd files.
function detectAgents(names, env = process.env, home = os.homedir()) {
  const win = process.platform === 'win32';
  const dirs = [...String(env.PATH ?? env.Path ?? '').split(path.delimiter),
    path.join(home, '.local', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.npm-global', 'bin'), '/usr/local/bin'];
  const exts = win ? ['.exe', '.cmd'] : [''];
  const out = {};
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== 'string' || !/^[\w.-]+$/.test(name)) continue;
    out[name] = null;
    search: for (const dir of dirs) {
      for (const ext of dir ? exts : []) {
        const file = path.join(dir.replace(/^"|"$/g, ''), name + ext);
        try { if (fs.statSync(file).isFile()) { if (!win) fs.accessSync(file, fs.constants.X_OK); out[name] = file; break search; } } catch {}
      }
    }
  }
  return out;
}

const rows = raw => raw.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(r => r && typeof r === 'object');
// TerminalVibe's handoff context rides on the user's first message (XML tag; older builds used brackets).
const stripNote = text => text.replace(/\s*<terminalvibe_context\b[\s\S]*?<\/terminalvibe_context>\s*$/, '')
  .replace(/\s*\[TerminalVibe (?:context|thread history): [^\]]*\]\s*$/, '').trim();
// Threads dropped into a message as context: their notes name the history file and the “title” the text shows.
const threadRefs = text => {
  const threads = [...text.matchAll(/<terminalvibe_context thread="([^"]*)">“([^”]*)”/g)].map(m => ({ path: m[1], title: m[2] }));
  return threads.length ? { threads } : {};
};
// The handoff message an older TerminalVibe typed in as its own prompt: not something the user said.
const isOldHandoff = text => text.startsWith('Continue this conversation. The full history with the previous agent is in ');
const clip = (s, n = 160) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// One line that says what a tool call did: its command, file, pattern or url.
function toolSummary(input) {
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return clip(input); } }
  if (!input || typeof input !== 'object') return '';
  const v = input.command ?? input.cmd ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.url ?? input.description ?? input.prompt
    ?? Object.values(input).find(x => typeof x === 'string');
  return clip(Array.isArray(v) ? shellArgv(v) : v);
}
// Codex runs commands as ["bash", "-lc", "cmd"]: show the command itself.
const shellArgv = v => (v.length === 3 && /(^|\/)(ba|z)?sh$/.test(v[0]) && /^-l?c$/.test(v[1]) ? v[2] : v.join(' '));

// The whole call, for a tool row's expanded view: the command as written, else the arguments as JSON.
function toolDetail(input) {
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return input.slice(0, 4000); } }
  if (!input || typeof input !== 'object') return '';
  const cmd = input.command ?? input.cmd;
  const text = typeof cmd === 'string' ? cmd : Array.isArray(cmd) ? shellArgv(cmd) : JSON.stringify(input, null, 2);
  return text.length > 4000 ? text.slice(0, 3999) + '…' : text;
}

// ── File changes a tool call made, for the chat's "changed files" card and its diff ──
// [{ path, add, del, patch }]: patch is unified-diff-like lines (capped, it is saved with the history).
const PATCH_MAX_LINES = 400;
function fileChange(file, lines) {
  let add = 0, del = 0;
  for (const l of lines) { if (l[0] === '+') add++; else if (l[0] === '-') del++; }
  const patch = lines.length > PATCH_MAX_LINES ? [...lines.slice(0, PATCH_MAX_LINES), `… ${lines.length - PATCH_MAX_LINES} more lines`] : lines;
  return { path: String(file), add, del, patch: patch.join('\n') };
}
// Claude Code's Edit / MultiEdit / Write result: a structured patch, or a new file's content.
function claudeChanges(r) {
  if (!r || typeof r !== 'object' || typeof r.filePath !== 'string') return null;
  if (Array.isArray(r.structuredPatch) && r.structuredPatch.length) {
    const lines = [];
    for (const h of r.structuredPatch) {
      lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
      for (const l of h.lines || []) lines.push(String(l));
    }
    return [fileChange(r.filePath, lines)];
  }
  if (r.type === 'create' && typeof r.content === 'string') return [fileChange(r.filePath, r.content.split('\n').map(l => '+' + l))];
  return null;
}
// Codex's apply_patch input: "*** Update File: path" / "*** Add File: path" sections.
function patchChanges(text) {
  if (typeof text !== 'string' || !text.includes('*** ')) return null;
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (m) { cur = { path: m[2].trim(), lines: m[1] === 'Delete' ? ['-(file deleted)'] : [] }; out.push(cur); continue; }
    if (!cur || line.startsWith('*** ')) continue;
    cur.lines.push(line);
  }
  return out.length ? out.map(f => fileChange(f.path, f.lines)) : null;
}

// Parsed transcripts, keyed by file and reused until the file changes.
const parsed = new Map(); // file -> { size, mtimeMs, result }
const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
// A user message's pasted images ride on its text item, or on an image-only item.
function addImages(items, start, ts, images) {
  if (!images.length) return;
  let it = items.slice(start).find(x => x.role === 'user');
  if (!it) items.push(it = { role: 'user', text: '', ts });
  it.images = images;
}

async function parseFile(file, parse) {
  const st = await fs.promises.stat(file);
  const hit = parsed.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.result;
  const result = parse(rows(await readEdges(file, EDGE)));
  if (parsed.size > 50) parsed.delete(parsed.keys().next().value);
  parsed.set(file, { size: st.size, mtimeMs: st.mtimeMs, result });
  return result;
}

function toolOutput(value) {
  let text = '';
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return toolOutput(parsed); } catch {}
    text = value;
  } else if (Array.isArray(value)) text = value.map(toolOutput).filter(Boolean).join('\n');
  else if (value && typeof value === 'object') {
    if (value.output !== undefined) return toolOutput(value.output);
    if (value.stdout !== undefined || value.stderr !== undefined) text = [value.stdout, value.stderr].filter(v => v != null && v !== '').map(toolOutput).join('\n');
    else if (value.text !== undefined) return toolOutput(value.text);
    else if (value.content !== undefined) return toolOutput(value.content);
  }
  return text.length > 64000 ? text.slice(0, 64000) + '\n… output truncated' : text;
}

// Claude Code's note that a background command (or background subagent) ended:
// <task-notification><task-id>…<tool-use-id>…<status>completed|failed|killed…<summary>…</summary>.
function taskNotification(text) {
  if (!/^\s*<task-notification>/.test(text || '')) return null;
  const tag = name => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() || null;
  const status = tag('status') || 'completed';
  return { taskId: tag('task-id'), toolUseId: tag('tool-use-id'), summary: tag('summary') || '',
    status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'stopped' };
}
// side: a subagent's own transcript (subagents/agent-<id>.jsonl), whose rows are all sidechain rows.
function parseClaude(list, side = false) {
  const items = [], tools = new Map(), queued = [], ended = new Set();
  // A background task ended: the line where it happened (role "event", a turn of its own) and its call's status.
  const onNotification = (n, ts) => {
    if (!n || ended.has(n.taskId || n.toolUseId)) return; // Claude can log one twice (queued, then as a turn)
    ended.add(n.taskId || n.toolUseId);
    const call = n.toolUseId && tools.get(n.toolUseId);
    if (call?.bg) Object.assign(call.bg, { status: n.status, summary: n.summary, endedAt: ts });
    if (call?.agent && call.agent.status === 'running') call.agent.status = n.status === 'stopped' ? 'stopped' : n.status;
    if (!call && !n.summary) return; // a task this transcript says nothing else about: no line to show
    // Arriving between tool steps, it was queued while the agent worked: part of that turn, not a turn of its own.
    const prev = items[items.length - 1];
    const inTurn = !!prev && (prev.role === 'tool' || prev.role === 'thinking' || (prev.role === 'event' && prev.inTurn));
    items.push({ role: 'event', ...(inTurn ? { inTurn } : {}), kind: call?.agent ? 'agent' : 'bg', status: n.status, text: n.summary || 'Background task ended',
      title: call?.bg?.description || call?.agent?.description || '', command: call?.bg?.command || '', ts });
  };
  for (const row of list) {
    // A message sent while Claude was working (a steer) is recorded only as a queued_command attachment, never as
    // a user row: show it as the user's message. Claude Code's own queued notices (<task-notification>…) stay out.
    const qc = row.type === 'attachment' && row.attachment?.type === 'queued_command' ? row.attachment : null;
    if (qc && !row.isSidechain && typeof qc.prompt === 'string' && taskNotification(qc.prompt)) { onNotification(taskNotification(qc.prompt), qc.timestamp || row.timestamp || null); continue; }
    if (qc && (qc.commandMode || 'prompt') === 'prompt' && typeof qc.prompt === 'string' && qc.prompt.trim() && !qc.prompt.trim().startsWith('<') && !row.isSidechain) {
      const text = stripNote(qc.prompt.trim());
      items.push({ role: 'user', text, ...threadRefs(qc.prompt), ts: qc.timestamp || row.timestamp || null, steered: true });
      queued.push(text);
      continue;
    }
    // Claude Code's own running totals for the session (cumulative; the latest row wins).
    if (row.type === 'cost-state' && row.modelUsage && typeof row.modelUsage === 'object') {
      const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      for (const m of Object.values(row.modelUsage)) {
        t.input += m?.inputTokens || 0; t.cacheRead += m?.cacheReadInputTokens || 0;
        t.cacheWrite += m?.cacheCreationInputTokens || 0; t.output += m?.outputTokens || 0;
      }
      items.session = { ...t, cost: Number.isFinite(row.totalCostUSD) ? row.totalCostUSD : null };
      continue;
    }
    if (!['user', 'assistant'].includes(row.type) || row.isMeta || (row.isSidechain && !side)) continue;
    // The context in use: the latest reply's prompt (fresh + cached input) plus what it wrote, which the next prompt carries.
    const u = row.type === 'assistant' && row.message?.model !== '<synthetic>' && row.message?.usage;
    if (u) items.last = { model: row.message.model || '', input: u.input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0, output: u.output_tokens || 0 };
    const content = row.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const start = items.length;
    for (const b of blocks) {
      if (b?.type === 'text') {
        let text = String(b.text || '').trim();
        // A typed /command or /skill is saved as <command-name>/x</command-name><command-args>…</command-args>: show it as typed
        // (the "<" filter below dropped it, so the prompt vanished and its sent copy never matched the transcript).
        const cmd = row.type === 'user' && text.match(/^<command-message>[\s\S]*?<command-name>([^<]+)<\/command-name>/);
        if (cmd) {
          const name = cmd[1].trim(), args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1].trim() || '';
          // A typed $skill is sent as "/skill <whole message>" (chat-sdk expandSlashSkill): show what was typed.
          const typed = name[0] === '/' && args.split(/[\s,;!?()[\]{}]+/).includes('$' + name.slice(1));
          text = typed ? args : [name, args].filter(Boolean).join(' ');
        }
        // Claude Code's own "[Request interrupted by user]" / "… for tool use]" markers are not prompts:
        // they flag the step the user stopped (the chat shows an "Interrupted" line after that turn).
        // Claude Code's own filler reply (model "<synthetic>", not the model's): never shown as an answer.
        if (row.type === 'assistant' && row.message?.model === '<synthetic>' && /^No response requested\.?$/.test(text)) continue;
        if (row.type === 'user' && /^\[Request interrupted by user/.test(text)) {
          if (items.length) Object.assign(items[items.length - 1], { interrupted: /tool use/.test(text) ? 'tool' : 'reply', interruptedAt: row.timestamp || null });
          continue;
        }
        // A steer Claude Code also wrote as a user row (when it hosts its own turn): shown once, as the steer.
        if (row.type === 'user' && queued.length && queued[0] === stripNote(text)) { queued.shift(); continue; }
        if (row.type === 'user' && taskNotification(text)) { onNotification(taskNotification(text), row.timestamp || null); continue; }
        if (text && !text.startsWith('<') && !(row.type === 'user' && isOldHandoff(text))) items.push({ role: row.type, text: row.type === 'user' ? stripNote(text) : text, ...(row.type === 'user' ? threadRefs(text) : {}), ts: row.timestamp || null });
      } else if (b?.type === 'thinking' && row.type === 'assistant') {
        const text = String(b.thinking || '').trim();
        if (text) items.push({ role: 'thinking', text, ts: row.timestamp || null });
      } else if (b?.type === 'tool_use') {
        const item = { role: 'tool', name: String(b.name || 'tool'), summary: toolSummary(b.input), detail: toolDetail(b.input), ts: row.timestamp || null };
        // Claude's questions to the user: the chat shows each question and the answer given, not the tool's JSON.
        if (b.name === 'AskUserQuestion' && Array.isArray(b.input?.questions)) item.qa = b.input.questions.map(q => ({ question: String(q?.question || q?.header || ''), answer: null }));
        if (isDelegate(b.name)) item.input = b.input;
        // A command left running in the background: it runs on after this call (backgroundTails reads its output).
        if (b.name === 'Bash' && b.input?.run_in_background) {
          item.bg = { command: String(b.input.command || ''), description: String(b.input.description || ''), status: 'running', taskId: null, file: null, startedAt: row.timestamp || null };
        }
        // A subagent: its own steps are read from its transcript (claudeSubagents).
        if ((b.name === 'Agent' || b.name === 'Task') && b.input && typeof b.input === 'object') {
          item.agent = { toolUseId: b.id, type: String(b.input.subagent_type || 'general-purpose'), description: String(b.input.description || ''),
            prompt: String(b.input.prompt || ''), status: 'running', last: null };
        }
        tools.set(b.id, item); items.push(item);
      } else if (b?.type === 'tool_result' && tools.has(b.tool_use_id)) {
        const item = tools.get(b.tool_use_id);
        item.output = toolOutput(b.content);
        if (b.is_error) item.error = true;
        if (item.bg) {
          if (b.is_error) item.bg.status = 'failed';
          item.bg.taskId = row.toolUseResult?.backgroundTaskId || /with ID: ([\w-]+)/.exec(item.output)?.[1] || null;
          item.bg.file = /Output is being written to: (\S+\.output)\b/.exec(item.output)?.[1] || null;
        }
        if (item.agent) {
          const r = row.toolUseResult && typeof row.toolUseResult === 'object' ? row.toolUseResult : {};
          // The report without Claude Code's own wrapper tags; a background agent's launch notice says it still runs.
          if (Array.isArray(r.content)) item.output = r.content.map(c => String(c?.text || '')).filter(t => t && !t.trimStart().startsWith('<')).join('\n').trim();
          Object.assign(item.agent, { id: r.agentId || null, model: r.resolvedModel || null, ms: r.totalDurationMs || null,
            status: b.is_error ? 'failed' : r.status === 'completed' || !r.status ? 'completed' : r.status === 'async_launched' ? 'running' : r.status });
        }
        if (item.qa) {
          const answers = row.toolUseResult?.answers;
          for (const x of item.qa) {
            const v = answers && typeof answers === 'object' ? answers[x.question] : undefined;
            if (v != null) x.answer = Array.isArray(v) ? v.join(', ') : String(v);
          }
        }
        // The edit's diff rides on the row that carries its result.
        const files = !b.is_error && claudeChanges(row.toolUseResult);
        if (files) item.files = files;
      }
    }
    if (row.type === 'user') addImages(items, start, row.timestamp || null, blocks
      .filter(b => b?.type === 'image' && b.source?.type === 'base64' && IMG_EXT[b.source.media_type] && typeof b.source.data === 'string')
      .map(b => ({ mediaType: b.source.media_type, data: b.source.data })));
  }
  return items;
}

function parseCodex(list) {
  const items = [], tools = new Map();
  let id = null, cwd = null, turnState = null, ctx = null, model = null;
  for (const r of list) {
    const p = r.payload;
    if (r.type === 'event_msg' && p?.type === 'token_count' && p.info?.last_token_usage) {
      // Codex's input_tokens include the cached ones: split them so the tooltip reads like Claude's.
      const split = t => t && { input: Math.max(0, (t.input_tokens || 0) - (t.cached_input_tokens || 0)), cacheRead: t.cached_input_tokens || 0, cacheWrite: 0, output: t.output_tokens || 0 };
      ctx = { used: p.info.last_token_usage.input_tokens || 0, max: p.info.model_context_window || 0,
        last: split(p.info.last_token_usage), ...(p.info.total_token_usage ? { session: { ...split(p.info.total_token_usage), cost: null } } : {}) };
    }
    if (r.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(p?.type)) {
      turnState = { status: p.type === 'task_started' ? 'working' : p.type === 'task_complete' ? 'completed' : 'aborted', at: Date.parse(r.timestamp) || 0 };
    }
    if (r.type === 'session_meta') { id = p?.id || null; cwd = p?.cwd || null; continue; }
    if (r.type === 'turn_context' && p?.model) model = p.model; // the model the latest turn used
    if (r.type === 'event_msg' && p?.type === 'item_completed' && p.item) {
      const it = p.item, ts = r.timestamp || null;
      if (it.type === 'CommandExecution') {
        const cmd = Array.isArray(it.command) ? shellArgv(it.command) : String(it.command || '');
        items.push({ role: 'tool', name: 'shell', summary: clip(cmd), detail: cmd.length > 4000 ? cmd.slice(0, 3999) + '…' : cmd, output: toolOutput(it.aggregated_output ?? it.output ?? { stdout: it.stdout, stderr: it.stderr }), ts,
          ...(typeof it.exit_code === 'number' && it.exit_code !== 0 ? { error: true } : {}) });
      } else if (it.type === 'FileChange' && it.changes && typeof it.changes === 'object') {
        const files = Object.entries(it.changes).map(([file, ch]) => fileChange(file, ch?.type === 'add' ? String(ch.content || '').split('\n').map(l => '+' + l)
          : ch?.type === 'delete' ? ['-(file deleted)'] : String(ch?.unified_diff || '').split('\n').filter(Boolean)));
        items.push({ role: 'tool', name: 'apply_patch', summary: clip(files.map(f => f.path).join(', ')), detail: files.map(f => f.path).join('\n'), ts, files });
      } else if (it.type === 'McpToolCall') {
        const name = `${it.server || 'mcp'}.${it.tool || 'tool'}`;
        items.push({ role: 'tool', name, summary: toolSummary(it.arguments), detail: toolDetail(it.arguments), ts,
          ...(it.status === 'failed' || it.error ? { error: true } : {}),
          ...(isDelegate(name) ? { input: jsonInput(it.arguments), ...(it.result ? { output: toolOutput(it.result.content ?? it.result) } : {}) } : {}) });
      } else if (it.type === 'ImageView' && it.path) {
        const file = String(it.path).replace(/^file:\/\//, '');
        items.push({ role: 'tool', name: 'view_image', summary: clip(file), detail: file, ts });
      }
      continue;
    }
    if (r.type !== 'response_item' || !p) continue;
    if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
      const text = (p.content || []).map(c => typeof c?.text === 'string' ? c.text : '').filter(t => t && !t.startsWith('<')).join('\n').trim();
      const start = items.length;
      if (text && !(p.role === 'user' && isOldHandoff(text))) items.push({ role: p.role, text: p.role === 'user' ? stripNote(text) : text, ...(p.role === 'user' ? threadRefs(text) : {}), ts: r.timestamp || null });
      if (p.role === 'user') addImages(items, start, r.timestamp || null, (p.content || [])
        .map(c => c?.type === 'input_image' && typeof c.image_url === 'string' && /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(c.image_url))
        .filter(Boolean).map(m => ({ mediaType: m[1], data: m[2] })));
    } else if (p.type === 'reasoning') {
      // Only the readable summary (the reasoning itself is encrypted).
      const text = (Array.isArray(p.summary) ? p.summary : []).map(x => typeof x?.text === 'string' ? x.text : '').filter(Boolean).join('\n\n').trim();
      if (text) items.push({ role: 'thinking', text, ts: r.timestamp || null });
    } else if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(p.type)) {
      const item = { role: 'tool', name: String(p.name || (p.type === 'local_shell_call' ? 'shell' : 'tool')),
        summary: toolSummary(p.arguments ?? p.input ?? p.action), detail: toolDetail(p.arguments ?? p.input ?? p.action), ts: r.timestamp || null };
      if (item.name === 'apply_patch') {
        let input = p.input ?? p.arguments; try { input = JSON.parse(input); } catch {}
        const files = patchChanges(typeof input === 'string' ? input : input?.input ?? input?.patch);
        if (files) item.files = files;
      }
      if (isDelegate(item.name)) item.input = jsonInput(p.arguments ?? p.input);
      if (p.call_id) tools.set(p.call_id, item);
      // Newer Codex wraps its tools in an "exec" script; the steps it ran come as item_completed events below.
      if (item.name !== 'exec') items.push(item);
    } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type) && tools.has(p.call_id)) {
      let out = p.output; try { out = JSON.parse(out); } catch {}
      tools.get(p.call_id).output = toolOutput(out);
      const code = out?.metadata?.exit_code;
      if ((typeof code === 'number' && code !== 0) || out?.success === false) tools.get(p.call_id).error = true;
    }
  }
  return { id, cwd, items, ...(turnState ? { turnState } : {}), ...(ctx ? { ctx } : {}), ...(model ? { model } : {}) };
}

const claudeFiles = new Map(); // sessionId -> transcript path
async function claudeFile(sessionId, home) {
  let file = claudeFiles.get(sessionId);
  if (file && fs.existsSync(file)) return file;
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects');
  let folders = []; try { folders = await fs.promises.readdir(projects); } catch {}
  file = folders.map(f => path.join(projects, f, sessionId + '.jsonl')).find(f => fs.existsSync(f));
  if (file) claudeFiles.set(sessionId, file);
  return file || null;
}
async function claudeSegment({ sessionId, cwd, since, exclude = [], subagent }, home) {
  if (!sessionId && cwd) sessionId = await findClaudeSession(cwd, since, exclude, home);
  if (!/^[\w-]{8,64}$/.test(sessionId || '')) return { items: [] };
  const file = await claudeFile(sessionId, home);
  if (!file) return { sessionId, items: [] };
  const dir = path.join(path.dirname(file), sessionId, 'subagents');
  // A subagent's thread (seg.subagent = the Agent call's id): its own transcript, read only.
  if (subagent) {
    const meta = (await subagentMetas(dir)).find(x => x.toolUseId === subagent);
    const items = meta ? await parseFile(meta.file, parseSidechain).catch(() => []) : [];
    await claudeSubagents(items, dir);
    return { sessionId, items };
  }
  const items = await parseFile(file, parseClaude);
  await claudeSubagents(items, dir);
  await backgroundTails(items);
  return { sessionId, items, ...(items.last ? { ctx: claudeContext(items.last, items.session) } : {}) };
}
const parseSidechain = list => parseClaude(list, true);
// A running background command's latest output (Claude Code writes it to <session>/tasks/<id>.output): the last
// lines, re-read on each history read while it runs (the transcript itself doesn't change meanwhile).
async function backgroundTails(items) {
  await Promise.all(items.filter(x => x.bg?.status === 'running' && x.bg.file && /[\\/]tasks[\\/][\w-]+\.output$/.test(x.bg.file)).map(async ({ bg }) => {
    try {
      const st = await fs.promises.stat(bg.file);
      bg.size = st.size;
      if (bg.tailSize === st.size) return;
      const fh = await fs.promises.open(bg.file, 'r');
      try {
        const n = Math.min(st.size, 6000), buf = Buffer.alloc(n);
        await fh.read(buf, 0, n, st.size - n);
        bg.tail = buf.toString('utf8').replace(/^[^\n]*\n(?=[\s\S])/, n < st.size ? '' : '$&').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').slice(-40).join('\n');
        bg.tailSize = st.size;
      } finally { await fh.close(); }
    } catch {}
  }));
}
// Each subagent keeps its own transcript and a meta file naming the Agent call that started it (toolUseId).
async function subagentMetas(dir) {
  let names = []; try { names = await fs.promises.readdir(dir); } catch { return []; }
  return (await Promise.all(names.filter(n => n.endsWith('.meta.json')).map(async n => {
    try { return { ...JSON.parse(await fs.promises.readFile(path.join(dir, n), 'utf8')), file: path.join(dir, n.replace(/\.meta\.json$/, '.jsonl')) }; } catch { return null; }
  }))).filter(x => x?.toolUseId);
}
async function claudeSubagents(items, dir) {
  if (!items.some(x => x.agent)) return;
  const metas = new Map((await subagentMetas(dir)).map(m => [m.toolUseId, m]));
  await Promise.all(items.filter(x => x.agent).map(async ({ agent }) => {
    const meta = metas.get(agent.toolUseId);
    if (!meta) return;
    agent.model ||= meta.model || null;
    if (agent.status === 'running' && meta.finished) agent.status = 'completed';
    // The row shows the latest step; the steps themselves open in the subagent's own thread.
    try {
      const all = await parseFile(meta.file, parseSidechain), x = all.length > 1 ? all.at(-1) : null; // [0] is the prompt
      agent.last = x && { role: x.role, name: x.name, summary: x.summary, text: x.text?.slice(0, 300), ts: x.ts, steps: all.length };
    } catch {}
  }));
}
// Claude's window isn't in the transcript: it follows the model. Every current model has 1M; Haiku 4.5 and
// models before the 4.6 generation have 200k ("[1m]" ids opt into 1M).
function claudeWindow(model) {
  const m = String(model).toLowerCase();
  if (/\[1m\]/.test(m)) return 1000000;
  // claude-3*, haiku-4-5, and opus/sonnet 4, 4.0, 4.1, 4.5 (optionally dated: claude-sonnet-4-5-20250929)
  return /claude-3|haiku-4-5|(?:opus|sonnet)-4(?:-[015])?(?:-\d{8})?$/.test(m) ? 200000 : 1000000;
}
function claudeContext(last, session) {
  const used = last.input + last.cacheRead + last.cacheWrite + last.output;
  // A prompt can only outgrow a 200k guess if the window is really 1M.
  const max = Math.max(claudeWindow(last.model), used > 200000 ? 1000000 : 0);
  return { used, max, model: last.model, last, ...(session ? { session } : {}) };
}

// Claude keeps a folder per project (its path with every other character as "-"):
// the newest transcript there since the session started, that no other session claimed.
async function findClaudeSession(cwd, since, exclude, home) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
  let names = []; try { names = await fs.promises.readdir(dir); } catch { return null; }
  const found = (await Promise.all(names.filter(n => n.endsWith('.jsonl') && !exclude.includes(n.slice(0, -6)))
    .map(n => fs.promises.stat(path.join(dir, n)).then(s => ({ n, t: s.mtimeMs }), () => null))))
    .filter(x => x && x.t >= (Number(since) || 0)).sort((a, b) => b.t - a.t)[0];
  if (!found) return null;
  claudeFiles.set(found.n.slice(0, -6), path.join(dir, found.n));
  return found.n.slice(0, -6);
}

// Codex has no --session-id flag: without a known id, take the newest rollout
// in this cwd that started after the segment launched.
// shortcut: two Codex sessions started in the same folder at once can swap, read the id from the Codex app-server if that becomes scriptable.
const codexFiles = new Map();
async function codexSegment({ sessionId, cwd, since, exclude = [] }, home) {
  const root = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions');
  const cacheKey = sessionId && path.join(root, sessionId);
  const cachedFile = cacheKey && codexFiles.get(cacheKey);
  if (cachedFile) {
    const result = await parseFile(cachedFile, parseCodex).catch(() => null);
    if (result) {
      const { id, cwd, ...history } = result;
      return { sessionId: id || sessionId, ...history };
    }
    codexFiles.delete(cacheKey);
  }
  const start = new Date(Math.max(0, (Number(since) || Date.now()) - 86400000));
  const files = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let names = []; try { names = await fs.promises.readdir(dir); } catch { continue; }
    for (const name of names) if (name.endsWith('.jsonl') && (!sessionId || name.includes(sessionId))) files.push(path.join(dir, name));
  }
  const stats = await Promise.all(files.map(f => fs.promises.stat(f).then(s => ({ f, t: s.mtimeMs }), () => null)));
  for (const { f } of stats.filter(s => s && (sessionId || s.t >= (Number(since) || 0))).sort((a, b) => b.t - a.t)) {
    const res = await parseFile(f, parseCodex).catch(() => null);
    if (!res || (!sessionId && (path.resolve(res.cwd || '') !== path.resolve(cwd || '') || exclude.includes(res.id)))) continue;
    if (res.id || cacheKey) {
      if (codexFiles.size >= 128) codexFiles.delete(codexFiles.keys().next().value);
      codexFiles.set(path.join(root, res.id || sessionId), f);
    }
    return { sessionId: res.id || sessionId, items: res.items, ...(res.turnState ? { turnState: res.turnState } : {}), ...(res.ctx ? { ctx: res.ctx } : {}), ...(res.model ? { model: res.model } : {}) };
  }
  return { sessionId, items: [] };
}

// Agents whose own history isn't readable (Antigravity CLI's ACP, OpenCode's server): the chat records each
// session's messages and tool calls from the protocol (electron/chat-sdk.js) in
// ~/.terminalvibe/acp/<session id>.jsonl, one chat item per line.
const acpFile = (sessionId, home) => path.join(home, '.terminalvibe', 'acp', sessionId + '.jsonl');
function parseAcp(list) {
  // An "interrupt" record (the agent exited mid-turn) flags the step before it, like Claude Code's interrupt marker.
  const items = [], calls = new Map();
  for (const r of list) {
    if (r.role === 'interrupt') { if (items.length) Object.assign(items[items.length - 1], { interrupted: r.reason || 'reply', interruptedAt: r.ts || null }); continue; }
    // A subagent's call is recorded when it starts and again when it ends: the end replaces the start in place.
    if (r.callId && calls.has(r.callId)) { items[calls.get(r.callId)] = { ...r, ts: items[calls.get(r.callId)].ts }; continue; }
    if (r.callId) calls.set(r.callId, items.length);
    items.push(r);
  }
  return items.filter(r => ['user', 'assistant', 'thinking', 'tool'].includes(r.role)).map(r => ({ ...(r.role === 'user'
    ? { role: 'user', text: stripNote(String(r.text || '')), ...threadRefs(String(r.text || '')), ts: r.ts || null }
    : r.role === 'tool' ? { role: 'tool', name: String(r.name || 'tool'), summary: String(r.summary || ''), detail: String(r.detail || ''), ...(r.output !== undefined ? { output: toolOutput(r.output) } : {}), ts: r.ts || null, ...(r.error ? { error: true } : {}),
      ...(r.agent && typeof r.agent === 'object' ? { agent: { ...r.agent, last: null } } : {}), ...(r.input ? { input: r.input } : {}) }
    : { role: r.role, text: String(r.text || ''), ts: r.ts || null }), ...(r.interrupted ? { interrupted: r.interrupted, interruptedAt: r.interruptedAt } : {}) }))
    .filter(r => r.role === 'tool' || r.text || r.interrupted);
}
async function acpSegment({ sessionId }, home) {
  // A session run in the terminal (no id recorded) has no history TerminalVibe can read.
  if (!/^[\w-]{8,64}$/.test(sessionId || '')) return { items: [], unsupported: true };
  const file = acpFile(sessionId, home);
  if (!fs.existsSync(file)) return { sessionId, items: [] };
  const items = await parseFile(file, parseAcp);
  // A subagent (OpenCode's task tool) has its own session transcript: the row shows its latest step.
  await Promise.all(items.filter(x => x.agent?.sessionId && /^[\w-]{8,64}$/.test(x.agent.sessionId)).map(async ({ agent }) => {
    try {
      const all = await parseFile(acpFile(agent.sessionId, home), parseAcp), x = all.length > 1 ? all.at(-1) : null;
      agent.last = x && { role: x.role, name: x.name, summary: x.summary, text: x.text?.slice(0, 300), ts: x.ts, steps: all.length };
    } catch {}
  }));
  return { sessionId, items };
}

async function readSegment(seg = {}, home = os.homedir()) {
  const r = seg.harness === 'claude' ? await claudeSegment(seg, home)
    : seg.harness === 'codex' ? await codexSegment(seg, home)
    : seg.harness === 'antigravity' || seg.harness === 'opencode' ? await acpSegment(seg, home)
    : { items: [], unsupported: true };
  await delegatedSubagents(r.items, home);
  return r;
}

// TerminalVibe's delegate_task (delegate-mcp.js): a subagent on another harness. Its run file
// (~/.terminalvibe/subagents/<key>.json) names the session it runs in; that session's transcript is its thread.
const isDelegate = name => /terminalvibe[._]+delegate_task$/.test(name || '');
const jsonInput = v => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } } return v && typeof v === 'object' ? v : null; };
const DELEGATE_NAMES = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' };
// A run still marked running whose process is gone (TerminalVibe or the agent was killed) was stopped.
const alive = pid => { if (!Number.isInteger(pid) || pid <= 1) return false; try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
async function delegatedSubagents(items, home) {
  const calls = items.filter(x => x.role === 'tool' && isDelegate(x.name) && x.input && typeof x.input.prompt === 'string' && DELEGATE_NAMES[x.input.harness]);
  if (!calls.length) return;
  const { delegateKey } = require('./delegate-mcp');
  // Every run of a call's harness + prompt (one file each: <key>.<startedAt>.<pid>.<request>.json; <key>.json before that).
  const dir = path.join(home, '.terminalvibe', 'subagents');
  let names = []; try { names = await fs.promises.readdir(dir); } catch {}
  const runsOf = new Map();
  for (const key of new Set(calls.map(x => delegateKey(x.input.harness, x.input.prompt.trim())))) {
    const files = names.filter(n => n.startsWith(key + '.') && n.endsWith('.json'));
    const runs = (await Promise.all(files.map(n => fs.promises.readFile(path.join(dir, n), 'utf8').then(JSON.parse).catch(() => null))))
      .filter(r => r && typeof r === 'object').sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    runsOf.set(key, runs);
  }
  // A finished call names its session in its result: that run. A call still running: the earliest run started
  // after it that no other call has, in the order the calls were made.
  const claimed = new Set();
  const sessionOf = x => typeof x.output === 'string' ? /^\[[^\]\n]+ session ([^\]\n]+)\]\n/.exec(x.output)?.[1] || null : null;
  const pick = new Map();
  for (const x of calls) {
    const sid = sessionOf(x), run = sid && runsOf.get(delegateKey(x.input.harness, x.input.prompt.trim())).find(r => r.sessionId === sid);
    if (run) { pick.set(x, run); claimed.add(run); }
  }
  for (const x of calls) {
    if (pick.has(x) || sessionOf(x)) continue;
    const at = Date.parse(x.ts) || 0;
    const run = runsOf.get(delegateKey(x.input.harness, x.input.prompt.trim())).find(r => !claimed.has(r) && (r.startedAt || 0) >= at - 5000);
    if (run) { pick.set(x, run); claimed.add(run); }
  }
  await Promise.all(calls.map(async (x, n) => {
    const { harness, prompt, description, model } = x.input;
    const run = pick.get(x) || null;
    const sid = sessionOf(x);
    if (typeof x.output === 'string') x.output = x.output.replace(/^\[[^\]\n]+ session [^\]\n]+\]\n/, ''); // the report, without its session line
    const runStatus = run?.status === 'running' && !alive(run.pid) ? 'stopped' : run?.status;
    // One id per call (a thread opened for it is found again by this id).
    const agent = x.agent = { toolUseId: `tv-${delegateKey(harness, prompt.trim())}-${Date.parse(x.ts) || n}`, harness, sessionId: run?.sessionId || sid || null, type: DELEGATE_NAMES[harness],
      description: String(description || ''), prompt, model: model || run?.model || null, since: run?.startedAt || Date.parse(x.ts) || null,
      status: runStatus === 'stopped' && x.output === undefined ? 'stopped'
        : x.error || runStatus === 'failed' || runStatus === 'stopped' ? 'failed' : x.output !== undefined || runStatus === 'completed' ? 'completed' : 'running',
      ms: run?.endedAt && run.startedAt ? run.endedAt - run.startedAt : null, last: null };
    if (!agent.sessionId) return;
    try {
      const child = await readSegment({ harness, sessionId: agent.sessionId, since: agent.since }, home), all = child.items, l = all.length > 1 ? all.at(-1) : null;
      agent.last = l && { role: l.role, name: l.name, summary: l.summary, text: l.text?.slice(0, 300), ts: l.ts, steps: all.length };
      agent.model ||= child.model || child.ctx?.model || null; // the model it ran on
    } catch {}
  }));
}

// ── Thread folders: ~/.terminalvibe/threads/<id>/ ──
// thread.json  : title, project, folder and the thread's agent sessions
// history.json : the combined chat of every session, TerminalVibe's own copy
// handoff.md   : the full history given to the next agent on a switch
const threadsRoot = home => path.join(home, '.terminalvibe', 'threads');
function threadDir(id, root) {
  if (!/^[\w-]{1,64}$/.test(id || '')) throw new Error('Invalid thread id');
  return path.join(root, id);
}
// Keep composer attachments with the thread so draft and transcript paths survive temp cleanup.
async function saveThreadAttachment(id, name, bytes, home = os.homedir()) {
  const root = path.join(threadDir(id, threadsRoot(home)), 'attachments');
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  return require('./dropped-files').saveDroppedFile(name, bytes, root);
}
const imageFiles = new WeakMap(); // parsed image -> files by thread (parse results are cached)
// Pasted images are saved in the thread folder: the panel and the handoff get file paths, not base64.
async function saveImages(dir, items) {
  if (!items.some(it => it.images?.some(image => typeof image !== 'string'))) return items;
  return Promise.all(items.map(async it => {
    if (!it.images) return it;
    const images = [];
    for (const im of it.images) {
      if (typeof im === 'string') { images.push(im); continue; }
      let saved = imageFiles.get(im);
      if (!saved) imageFiles.set(im, saved = new Map());
      let file = saved.get(dir);
      if (!file) {
        file = path.join(dir, 'images', crypto.createHash('sha1').update(im.data).digest('hex').slice(0, 16) + '.' + IMG_EXT[im.mediaType]);
        try {
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, Buffer.from(im.data, 'base64'), { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
          saved.set(dir, file);
        } catch { continue; } // a failed save drops the preview, never the history
      }
      images.push(file);
    }
    return { ...it, images };
  }));
}

const written = new Map(); // dir -> metadata and parsed item references from the last write
const savedHistories = new Map();
async function readSavedHistory(dir) {
  const file = path.join(dir, 'history.json');
  try {
    const stat = await fs.promises.stat(file);
    const stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const cached = savedHistories.get(dir);
    if (cached?.stamp === stamp) return cached.segments;
    const saved = JSON.parse(await fs.promises.readFile(file, 'utf8')).segments;
    const segments = Array.isArray(saved) ? saved : [];
    if (savedHistories.size >= 16) savedHistories.delete(savedHistories.keys().next().value);
    savedHistories.set(dir, { stamp, segments });
    return segments;
  } catch {
    savedHistories.delete(dir);
    return [];
  }
}

// Refresh a thread's folder from the agents' transcripts and return its full history.
// A session whose transcript is gone (deleted, cleaned up) keeps the copy saved earlier.
async function syncThread(meta = {}, home = os.homedir(), root = threadsRoot(home)) {
  const dir = threadDir(meta.id, root);
  const segs = (Array.isArray(meta.segments) ? meta.segments : []).slice(-20);
  const saved = await readSavedHistory(dir);
  const fresh = [];
  const claimed = segs.map(s => s.sessionId).filter(Boolean);
  for (const s of segs) {
    // A forked thread's copied sessions are frozen: their saved items end at the fork point,
    // and the agent's transcript (which goes on past it) is never read again.
    const f = s.frozen ? { items: [], ...(s.unsupported ? { unsupported: true } : {}) }
      : await readSegment({ ...s, exclude: claimed }, home).catch(() => ({ items: [] }));
    if (f.sessionId && !claimed.includes(f.sessionId)) claimed.push(f.sessionId);
    fresh.push({ ...f, items: await saveImages(dir, f.items) });
  }
  const merged = segs.map((s, i) => {
    const old = saved.find(x => x.since === s.since && x.harness === s.harness);
    const f = fresh[i];
    const items = f.items.length || !old ? f.items : old.items;
    return { harness: s.harness, sessionId: f.sessionId || s.sessionId || old?.sessionId || null, since: s.since,
      model: s.model || null, usedModel: f.model || f.ctx?.model || null, effort: s.effort || null, handoff: !!s.handoff, ...(s.frozen ? { frozen: true } : {}), ...(f.unsupported ? { unsupported: true } : {}), ...(f.turnState ? { turnState: f.turnState } : {}), ...(f.ctx ? { ctx: f.ctx } : {}), items };
  });
  const thread = { id: meta.id, title: String(meta.title || 'New thread'), projectId: meta.projectId || null, cwd: meta.cwd || null,
    createdAt: meta.createdAt || null, segments: merged.map(({ items, unsupported, ...s }) => s) };
  const items = merged.map(s => s.items);
  const metadata = JSON.stringify(thread);
  const prior = written.get(dir);
  if (prior?.metadata !== metadata || !items.every((list, i) => list === prior.items[i] || (!list.length && !prior.items[i].length))) {
    const history = JSON.stringify({ segments: merged.map(({ unsupported, ...s }) => s) });
    if (prior?.metadata !== metadata || prior.history !== history) {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, 'thread.json'), JSON.stringify(thread, null, 2));
      await fs.promises.writeFile(path.join(dir, 'history.json'), history);
    }
    if (written.size >= 16) written.delete(written.keys().next().value);
    written.set(dir, { metadata, items, history });
  }
  return merged;
}

function latestItems(segments, budget) {
  const out = segments.map(s => ({ ...s }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].items.length > budget) {
      out[i].trimmed = out[i].items.length - budget;
      out[i].items = budget ? out[i].items.slice(-budget) : [];
    }
    budget = Math.max(0, budget - out[i].items.length);
  }
  return out;
}
// Read the saved tail without waiting for the agents' transcripts or writing files.
async function threadHistoryPreview(meta, home = os.homedir(), root = threadsRoot(home)) {
  const saved = await readSavedHistory(threadDir(meta.id, root));
  const segments = (Array.isArray(meta.segments) ? meta.segments : []).slice(-20).map(s => {
    const old = saved.find(x => x.since === s.since && x.harness === s.harness);
    return old || { items: [] };
  });
  if (!segments.some(s => s.items.length)) return null;
  const full = latestItems(segments, MAX_ITEMS);
  return latestItems(segments, PREVIEW_ITEMS).map((segment, i) => ({
    ...segment, previewOffset: (segment.trimmed || 0) - (full[i].trimmed || 0),
  }));
}

const historyReads = new Map();
async function threadHistory(meta, home = os.homedir(), root = threadsRoot(home)) {
  const key = JSON.stringify([root, home, meta]);
  if (historyReads.has(key)) return historyReads.get(key);
  const result = syncThread(meta, home, root).then(segments => latestItems(segments, MAX_ITEMS))
    .finally(() => historyReads.delete(key));
  historyReads.set(key, result);
  return result;
}

// Live state of one subagent call, used by that subagent's own thread view to show its working row. Reuses the
// parent's history (which already carries the call's status and latest step), without sending all its items.
async function subagentStatus(meta, call, home = os.homedir()) {
  if (!call || !meta) return null;
  try {
    const segments = await threadHistory(meta, home);
    const a = segments.flatMap(s => s.items || []).find(x => x.role === 'tool' && x.agent?.toolUseId === call)?.agent;
    return a ? { status: a.status, since: a.since || null, last: a.last || null } : null;
  } catch { return null; }
}

// What the next agent is told about the history file. One list, so the wording is easy to tune.
const HANDOFF_INSTRUCTIONS = [
  'This is the conversation so far in this TerminalVibe thread, from earlier coding agents. Treat it as your own memory: the user is continuing the same work with you.',
  'Use it silently: never tell the user you read it, never recap or summarize it, and never comment on how much or how little it contains.',
  "Answer the user's latest message directly; bring in earlier details only when they matter for it.",
];
const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => xml(s).replace(/"/g, '&quot;');

// Full history as XML, so the next agent of the thread starts with the whole context.
async function writeHandoff(meta = {}, home = os.homedir(), root = threadsRoot(home)) {
  const names = meta.names || {};
  const merged = await syncThread(meta, home, root);
  let out = `<terminalvibe_handoff project="${attr(meta.cwd || 'unknown')}">\n<instructions>\n${HANDOFF_INSTRUCTIONS.map(l => '- ' + l).join('\n')}\n</instructions>\n<conversation>\n`;
  for (const s of merged) {
    out += `<session agent="${attr(names[s.harness] || s.harness)}"${s.model && s.model !== 'default' ? ` model="${attr(s.model)}"` : ''}${s.unsupported && !s.items.length ? ' transcript="unavailable"' : ''}>\n`;
    for (const it of s.items) {
      if (it.role === 'thinking') continue; // the previous agent's private reasoning stays out of the handoff
      // So does an agent reading an earlier handoff file (plumbing; the chat itself shows that step).
      if (it.role === 'tool' && /[\\/]\.terminalvibe[\\/](?:threads[\\/][^\\/]+[\\/]handoff\.(?:xml|md)|handoffs[\\/])/i.test(it.summary || '')) continue;
      out += it.role === 'tool'
        ? `<tool name="${attr(it.name)}"${it.error ? ' failed="true"' : ''}>${xml(it.summary)}</tool>\n`
        : `<message role="${it.role}">\n${xml(it.text)}\n${(it.images || []).map(p => `<image path="${attr(p)}"/>\n`).join('')}</message>\n`;
    }
    out += '</session>\n';
  }
  out += '</conversation>\n</terminalvibe_handoff>\n';
  const file = path.join(threadDir(meta.id, root), 'handoff.xml');
  await fs.promises.writeFile(file, out);
  return file;
}

// Fork: a new thread whose history is the parent's, up to and including one message.
// Its sessions are frozen copies (see syncThread); pasted images are copied into its own folder,
// so deleting the parent never breaks the fork. Returns the fork's segments for the renderer.
async function forkThread({ meta, seg, item, id, title } = {}, home = os.homedir(), root = threadsRoot(home)) {
  const dir = threadDir(id, root);
  if (id === meta?.id) throw new Error('Invalid thread id');
  const merged = await syncThread(meta, home, root);
  seg = Number(seg); item = Number(item);
  if (!Number.isInteger(seg) || !Number.isInteger(item) || !merged[seg] || item < 0 || item >= merged[seg].items.length) throw new Error('Invalid fork point');
  await fs.promises.mkdir(path.join(dir, 'images'), { recursive: true });
  // One copy per file: sessions share an image's file, and two copies at once to one target fail on Windows (EBUSY).
  const copies = new Map();
  const copyImages = async it => {
    if (!it.images?.length) return it;
    const images = [];
    for (const src of it.images) {
      const dst = path.join(dir, 'images', path.basename(src));
      if (!copies.has(dst)) copies.set(dst, fs.promises.copyFile(src, dst).then(() => true, () => false));
      if (await copies.get(dst)) images.push(dst); // a missing image drops its preview only
    }
    return { ...it, images };
  };
  const segments = await Promise.all(merged.slice(0, seg + 1).map(async (s, i) =>
    ({ ...s, frozen: true, items: await Promise.all((i === seg ? s.items.slice(0, item + 1) : s.items).map(copyImages)) })));
  const thread = { id, title: String(title || 'Fork'), projectId: meta.projectId || null, cwd: meta.cwd || null, createdAt: Date.now(),
    forkOf: { id: meta.id, seg, item }, segments: segments.map(({ items, unsupported, ...s }) => s) };
  await fs.promises.writeFile(path.join(dir, 'thread.json'), JSON.stringify(thread, null, 2));
  await fs.promises.writeFile(path.join(dir, 'history.json'), JSON.stringify({ segments: segments.map(({ unsupported, ...s }) => s) }));
  return segments.map(({ items, ...s }) => s);
}

// Deleting a thread deletes its folder; the agents' own transcripts stay.
async function deleteThread(id, home = os.homedir(), root = threadsRoot(home)) {
  const dir = threadDir(id, root);
  written.delete(dir);
  savedHistories.delete(dir);
  await fs.promises.rm(dir, { recursive: true, force: true });
  return true;
}

module.exports = { detectAgents, saveThreadAttachment, syncThread, threadHistory, threadHistoryPreview, subagentStatus, writeHandoff, forkThread, deleteThread, toolSummary, toolOutput, parseClaude, parseCodex, parseAcp, acpFile, fileChange };

if (require.main === module) {
  const assert = require('assert');
  // Context windows: 1M for current models, 200k for Haiku 4.5 and pre-4.6 models, and never below a prompt that outgrew 200k.
  for (const [m, w] of [['claude-opus-5-5', 1e6], ['claude-haiku-5-5', 1e6], ['claude-opus-4-6', 1e6], ['claude-haiku-4-5-20251001', 2e5],
    ['claude-sonnet-4-5-20250929', 2e5], ['claude-opus-4-1-20250805', 2e5], ['claude-sonnet-4-20250514', 2e5], ['claude-sonnet-4-5[1m]', 1e6]]) assert.strictEqual(claudeWindow(m), w, m);
  const ctx = claudeContext({ model: 'claude-haiku-4-5', input: 5, cacheRead: 210000, cacheWrite: 0, output: 10 });
  assert.deepStrictEqual([ctx.used, ctx.max], [210015, 1e6]);
  const items = parseClaude([
    { type: 'assistant', message: { model: 'claude-opus-5-5', content: [], usage: { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 30 } } },
    { type: 'cost-state', totalCostUSD: 1.5, modelUsage: { 'claude-opus-5-5': { inputTokens: 10, outputTokens: 30, cacheReadInputTokens: 1000, cacheCreationInputTokens: 50 } } },
  ]);
  assert.deepStrictEqual(items.session, { input: 10, cacheRead: 1000, cacheWrite: 50, output: 30, cost: 1.5 });
  assert.strictEqual(claudeContext(items.last, items.session).used, 1082);
  console.log('threads: ok');
}
