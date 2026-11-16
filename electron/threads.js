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

function parseClaude(list) {
  const items = [], tools = new Map();
  for (const row of list) {
    if (!['user', 'assistant'].includes(row.type) || row.isMeta || row.isSidechain) continue;
    const content = row.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const start = items.length;
    for (const b of blocks) {
      if (b?.type === 'text') {
        const text = String(b.text || '').trim();
        // Claude Code's own "[Request interrupted by user]" / "… for tool use]" markers are not prompts:
        // they flag the step the user stopped (the chat shows an "Interrupted" line after that turn).
        // Claude Code's own filler reply (model "<synthetic>", not the model's): never shown as an answer.
        if (row.type === 'assistant' && row.message?.model === '<synthetic>' && /^No response requested\.?$/.test(text)) continue;
        if (row.type === 'user' && /^\[Request interrupted by user/.test(text)) {
          if (items.length) Object.assign(items[items.length - 1], { interrupted: /tool use/.test(text) ? 'tool' : 'reply', interruptedAt: row.timestamp || null });
          continue;
        }
        if (text && !text.startsWith('<') && !(row.type === 'user' && isOldHandoff(text))) items.push({ role: row.type, text: row.type === 'user' ? stripNote(text) : text, ...(row.type === 'user' ? threadRefs(text) : {}), ts: row.timestamp || null });
      } else if (b?.type === 'thinking' && row.type === 'assistant') {
        const text = String(b.thinking || '').trim();
        if (text) items.push({ role: 'thinking', text, ts: row.timestamp || null });
      } else if (b?.type === 'tool_use') {
        const item = { role: 'tool', name: String(b.name || 'tool'), summary: toolSummary(b.input), detail: toolDetail(b.input), ts: row.timestamp || null };
        // Claude's questions to the user: the chat shows each question and the answer given, not the tool's JSON.
        if (b.name === 'AskUserQuestion' && Array.isArray(b.input?.questions)) item.qa = b.input.questions.map(q => ({ question: String(q?.question || q?.header || ''), answer: null }));
        tools.set(b.id, item); items.push(item);
      } else if (b?.type === 'tool_result' && tools.has(b.tool_use_id)) {
        const item = tools.get(b.tool_use_id);
        if (b.is_error) item.error = true;
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
  let id = null, cwd = null, turnState = null;
  for (const r of list) {
    const p = r.payload;
    if (r.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(p?.type)) {
      turnState = { status: p.type === 'task_started' ? 'working' : p.type === 'task_complete' ? 'completed' : 'aborted', at: Date.parse(r.timestamp) || 0 };
    }
    if (r.type === 'session_meta') { id = p?.id || null; cwd = p?.cwd || null; continue; }
    if (r.type === 'event_msg' && p?.type === 'item_completed' && p.item) {
      const it = p.item, ts = r.timestamp || null;
      if (it.type === 'CommandExecution') {
        const cmd = Array.isArray(it.command) ? shellArgv(it.command) : String(it.command || '');
        items.push({ role: 'tool', name: 'shell', summary: clip(cmd), detail: cmd.length > 4000 ? cmd.slice(0, 3999) + '…' : cmd, ts,
          ...(typeof it.exit_code === 'number' && it.exit_code !== 0 ? { error: true } : {}) });
      } else if (it.type === 'FileChange' && it.changes && typeof it.changes === 'object') {
        const files = Object.entries(it.changes).map(([file, ch]) => fileChange(file, ch?.type === 'add' ? String(ch.content || '').split('\n').map(l => '+' + l)
          : ch?.type === 'delete' ? ['-(file deleted)'] : String(ch?.unified_diff || '').split('\n').filter(Boolean)));
        items.push({ role: 'tool', name: 'apply_patch', summary: clip(files.map(f => f.path).join(', ')), detail: files.map(f => f.path).join('\n'), ts, files });
      } else if (it.type === 'McpToolCall') {
        items.push({ role: 'tool', name: `${it.server || 'mcp'}.${it.tool || 'tool'}`, summary: toolSummary(it.arguments), detail: toolDetail(it.arguments), ts,
          ...(it.status === 'failed' || it.error ? { error: true } : {}) });
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
      if (p.call_id) tools.set(p.call_id, item);
      // Newer Codex wraps its tools in an "exec" script; the steps it ran come as item_completed events below.
      if (item.name !== 'exec') items.push(item);
    } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type) && tools.has(p.call_id)) {
      let out = p.output; try { out = JSON.parse(out); } catch {}
      const code = out?.metadata?.exit_code;
      if ((typeof code === 'number' && code !== 0) || out?.success === false) tools.get(p.call_id).error = true;
    }
  }
  return { id, cwd, items, ...(turnState ? { turnState } : {}) };
}

const claudeFiles = new Map(); // sessionId -> transcript path
async function claudeSegment({ sessionId, cwd, since, exclude = [] }, home) {
  if (!sessionId && cwd) sessionId = await findClaudeSession(cwd, since, exclude, home);
  if (!/^[\w-]{8,64}$/.test(sessionId || '')) return { items: [] };
  let file = claudeFiles.get(sessionId);
  if (!file || !fs.existsSync(file)) {
    const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects');
    let folders = []; try { folders = await fs.promises.readdir(projects); } catch {}
    file = folders.map(f => path.join(projects, f, sessionId + '.jsonl')).find(f => fs.existsSync(f));
    if (!file) return { sessionId, items: [] };
    claudeFiles.set(sessionId, file);
  }
  return { sessionId, items: await parseFile(file, parseClaude) };
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
async function codexSegment({ sessionId, cwd, since, exclude = [] }, home) {
  const root = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions');
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
    return { sessionId: res.id || sessionId, items: res.items, ...(res.turnState ? { turnState: res.turnState } : {}) };
  }
  return { sessionId, items: [] };
}

// Agents driven over the Agent Client Protocol (Antigravity CLI): their own history isn't readable, so the chat
// records each session's messages and tool calls from the protocol (electron/chat-sdk.js) in
// ~/.terminalvibe/acp/<session id>.jsonl, one chat item per line.
const acpFile = (sessionId, home) => path.join(home, '.terminalvibe', 'acp', sessionId + '.jsonl');
function parseAcp(list) {
  return list.filter(r => ['user', 'assistant', 'thinking', 'tool'].includes(r.role)).map(r => r.role === 'user'
    ? { role: 'user', text: stripNote(String(r.text || '')), ...threadRefs(String(r.text || '')), ts: r.ts || null }
    : r.role === 'tool' ? { role: 'tool', name: String(r.name || 'tool'), summary: String(r.summary || ''), detail: String(r.detail || ''), ts: r.ts || null, ...(r.error ? { error: true } : {}) }
    : { role: r.role, text: String(r.text || ''), ts: r.ts || null }).filter(r => r.role === 'tool' || r.text);
}
async function acpSegment({ sessionId }, home) {
  // A session run in the terminal (no id recorded) has no history TerminalVibe can read.
  if (!/^[\w-]{8,64}$/.test(sessionId || '')) return { items: [], unsupported: true };
  const file = acpFile(sessionId, home);
  if (!fs.existsSync(file)) return { sessionId, items: [] };
  return { sessionId, items: await parseFile(file, parseAcp) };
}

function readSegment(seg = {}, home = os.homedir()) {
  if (seg.harness === 'claude') return claudeSegment(seg, home);
  if (seg.harness === 'codex') return codexSegment(seg, home);
  if (seg.harness === 'antigravity') return acpSegment(seg, home);
  return Promise.resolve({ items: [], unsupported: true });
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
const imageFiles = new WeakMap(); // parsed image -> saved file (parse results are cached, so this skips re-hashing)
// Pasted images are saved in the thread folder: the panel and the handoff get file paths, not base64.
async function saveImages(dir, items) {
  return Promise.all(items.map(async it => {
    if (!it.images) return it;
    const images = [];
    for (const im of it.images) {
      if (typeof im === 'string') { images.push(im); continue; }
      let file = imageFiles.get(im);
      if (!file) {
        file = path.join(dir, 'images', crypto.createHash('sha1').update(im.data).digest('hex').slice(0, 16) + '.' + IMG_EXT[im.mediaType]);
        try {
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, Buffer.from(im.data, 'base64'), { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
          imageFiles.set(im, file);
        } catch { continue; } // a failed save drops the preview, never the history
      }
      images.push(file);
    }
    return { ...it, images };
  }));
}

const written = new Map(); // dir -> last JSON written, so an unchanged poll writes nothing

// Refresh a thread's folder from the agents' transcripts and return its full history.
// A session whose transcript is gone (deleted, cleaned up) keeps the copy saved earlier.
async function syncThread(meta = {}, home = os.homedir(), root = threadsRoot(home)) {
  const dir = threadDir(meta.id, root);
  const segs = (Array.isArray(meta.segments) ? meta.segments : []).slice(-20);
  let saved = [];
  try { saved = JSON.parse(await fs.promises.readFile(path.join(dir, 'history.json'), 'utf8')).segments || []; } catch {}
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
      model: s.model || null, effort: s.effort || null, handoff: !!s.handoff, ...(s.frozen ? { frozen: true } : {}), ...(f.unsupported ? { unsupported: true } : {}), ...(f.turnState ? { turnState: f.turnState } : {}), items };
  });
  const thread = { id: meta.id, title: String(meta.title || 'New thread'), projectId: meta.projectId || null, cwd: meta.cwd || null,
    createdAt: meta.createdAt || null, segments: merged.map(({ items, unsupported, ...s }) => s) };
  const history = { segments: merged.map(({ unsupported, ...s }) => s) };
  const json = JSON.stringify([thread, history]);
  if (written.get(dir) !== json) {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'thread.json'), JSON.stringify(thread, null, 2));
    await fs.promises.writeFile(path.join(dir, 'history.json'), JSON.stringify(history));
    written.set(dir, json);
  }
  return merged;
}

// What the side panel shows: the newest MAX_ITEMS items across all sessions.
async function threadHistory(meta, home = os.homedir(), root = threadsRoot(home)) {
  const out = (await syncThread(meta, home, root)).map(s => ({ ...s }));
  let budget = MAX_ITEMS;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].items.length > budget) { out[i].trimmed = out[i].items.length - budget; out[i].items = out[i].items.slice(-budget); }
    budget = Math.max(0, budget - out[i].items.length);
  }
  return out;
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
  await fs.promises.rm(dir, { recursive: true, force: true });
  return true;
}

module.exports = { detectAgents, syncThread, threadHistory, writeHandoff, forkThread, deleteThread, toolSummary, parseClaude, parseCodex, parseAcp, acpFile, fileChange };
