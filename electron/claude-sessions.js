// Read local Claude history only; no provider calls or transcript modifications.
const fs = require('fs');
const path = require('path');
const os = require('os');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function readEdges(file, size = 128 * 1024) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const stat = await handle.stat();
    const head = Buffer.alloc(Math.min(size, stat.size));
    await handle.read(head, 0, head.length, 0);
    if (stat.size <= size) return head.toString();
    const tail = Buffer.alloc(Math.min(size, stat.size - size));
    await handle.read(tail, 0, tail.length, stat.size - tail.length);
    // Discard partial edge records, not malformed/truncated in-progress lines.
    return head.toString().split('\n').slice(0, -1).join('\n') + '\n' + tail.toString().split('\n').slice(1).join('\n');
  } finally { await handle.close(); }
}
function textContent(content) {
  return typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(b => b?.type === 'text').map(b => b.text || '').join('\n') : '';
}
async function listClaudeSessions(cwd, home = os.homedir()) {
  // The terminal cwd is only the default for NEW conversations, not a filter.
  const directory = typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : home;
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const executable = findClaudeLauncher(home);
  const projects = path.join(config, 'projects');
  let folders;
  try { folders = await fs.promises.readdir(projects, { withFileTypes:true }); }
  catch (e) { if (e.code === 'ENOENT') return { cwd:directory, sessions:[], executable, scope:'all-projects' }; throw e; }
  const entries = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
    const project = path.join(projects, folder.name);
    let files;
    try { files = await fs.promises.readdir(project); }
    catch (e) { if (['ENOENT','EACCES'].includes(e.code)) continue; throw e; }
    for (const file of files) {
      if (!file.endsWith('.jsonl') || !UUID.test(file.slice(0,-6))) continue;
      const full = path.join(project,file);
      try {
        const stat = await fs.promises.lstat(full);
        if (stat.isFile() && !stat.isSymbolicLink()) entries.push({full,id:file.slice(0,-6),time:stat.mtimeMs});
      } catch (e) { if (!['ENOENT','EACCES'].includes(e.code)) throw e; }
    }
  }
  const sessions = [];
  for (const file of entries.filter(Boolean).sort((a,b) => b.time-a.time).slice(0,80)) {
    try {
      const raw = await readEdges(file.full);
      let title = '', first = '', sessionCwd = null;
      const preview = [];
      for (const line of raw.split('\n')) {
        let row; try { row = JSON.parse(line); } catch { continue; }
        if (!row || typeof row !== 'object') continue;
        if (!sessionCwd && typeof row.cwd === 'string' && path.isAbsolute(row.cwd)) sessionCwd = row.cwd;
        if (row.type === 'custom-title' && typeof row.customTitle === 'string') title = row.customTitle;
        if (row.type === 'summary' && typeof row.summary === 'string' && !title) title = row.summary;
        if (!['user','assistant'].includes(row.type) || row.isMeta || row.isSidechain) continue;
        const text = textContent(row.message?.content).trim();
        if (!text || text.startsWith('<')) continue;
        if (!first && row.type === 'user') first = text;
        preview.push({ role:row.type, text:text.slice(0,1800) });
        if (preview.length > 6) preview.shift();
      }
      if (sessions.some(s => s.id === file.id)) continue;
      sessions.push({ id:file.id, cwd:sessionCwd, title:(title || first || 'Untitled conversation').replace(/\s+/g,' ').slice(0,160),
        updatedAt:new Date(file.time).toISOString(), preview, previewPartial:true });
    } catch (e) { if (!['ENOENT','EACCES'].includes(e.code)) throw e; }
  }
  return { cwd:directory, sessions, limit:80, executable, scope:'all-projects' };
}
function findClaudeLauncher(home) {
  for (const directory of [...(process.env.PATH || '').split(path.delimiter), path.join(home,'.local','bin')]) {
    if (!directory) continue;
    const file=path.join(directory,process.platform==='win32'?'claude.exe':'claude');
    try { fs.accessSync(file,fs.constants.X_OK); if(fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}
// Pasted images live in the transcript as base64 blocks on user rows; Claude's
// "[Image #N]" ids come from row.imagePasteIds, else they count up per session.
// Per-transcript index of image messages, so a hover doesn't re-read and re-parse whole
// transcripts: the first lookup indexes a file once, later ones read only lines appended
// since (transcripts are append-only JSONL). Items keep the line's byte range, not the
// base64 data, so the index stays small; a shrunk or replaced file is re-indexed.
const imageIndexes = new Map(); // file -> { ino, done, mark, state, items }
const MARK = 64; // bytes just before `done`, to notice a rewritten (not appended) file
async function indexImages(file, needle, extract) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const st = await fh.stat();
    let ix = imageIndexes.get(file);
    if (ix && (st.ino !== ix.ino || st.size < ix.done)) ix = null;
    if (ix && ix.done) {
      const mark = Buffer.alloc(Math.min(MARK, ix.done));
      await fh.read(mark, 0, mark.length, ix.done - mark.length);
      if (!mark.equals(ix.mark)) ix = null;
    }
    if (!ix) imageIndexes.set(file, ix = { ino: st.ino, done: 0, mark: Buffer.alloc(0), state: {}, items: [] });
    if (st.size === ix.done) return ix.items;
    const buf = Buffer.alloc(st.size - ix.done);
    const { bytesRead } = await fh.read(buf, 0, buf.length, ix.done);
    const end = buf.subarray(0, bytesRead).lastIndexOf(10) + 1;
    const scan = (from, to, state, out) => {
      for (let off = from; off < to;) {
        let nl = buf.indexOf(10, off); if (nl < 0 || nl > to) nl = to;
        const line = buf.subarray(off, nl);
        if (line.includes(needle)) {
          let row = null; try { row = JSON.parse(line.toString('utf8')); } catch {}
          if (row) for (const item of extract(row, state)) out.push({ ...item, start: ix.done + off, end: ix.done + nl });
        }
        off = nl + 1;
      }
    };
    scan(0, end, ix.state, ix.items);
    // An unterminated last line is used now but re-read next time (it may still be written).
    const tail = [];
    if (end < bytesRead) scan(end, bytesRead, structuredClone(ix.state), tail);
    ix.done += end;
    ix.mark = Buffer.from(buf.subarray(Math.max(0, end - MARK), end));
    if (ix.mark.length < Math.min(MARK, ix.done)) { // short append: the mark spans older bytes too
      ix.mark = Buffer.alloc(Math.min(MARK, ix.done));
      await fh.read(ix.mark, 0, ix.mark.length, ix.done - ix.mark.length);
    }
    return tail.length ? ix.items.concat(tail) : ix.items;
  } finally { await fh.close(); }
}
// Re-read one indexed line and hand its parsed row to `pick`.
async function readIndexedRow(file, item, pick) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(item.end - item.start);
    await fh.read(buf, 0, buf.length, item.start);
    return pick(JSON.parse(buf.toString('utf8')));
  } catch { return null; } finally { await fh.close(); }
}
const normText = s => s.replace(/\s+/g, ' ').trim();
async function findClaudeImage({ sessionId, cwd, n, prompt } = {}, home = os.homedir()) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return null;
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects');
  const candidates = [];
  if (typeof sessionId === 'string' && UUID.test(sessionId)) {
    try {
      for (const folder of await fs.promises.readdir(projects)) candidates.push(path.join(projects, folder, sessionId + '.jsonl'));
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (typeof cwd === 'string' && path.isAbsolute(cwd)) {
    // shortcut: mirrors Claude's folder naming; very long cwds get a hash suffix and are missed.
    const dir = path.join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    try {
      const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.jsonl') && UUID.test(f.slice(0, -6)));
      const stats = await Promise.all(files.map(f => fs.promises.stat(path.join(dir, f)).then(s => [s.mtimeMs, f], () => [0, f])));
      stats.sort((a, b) => b[0] - a[0]).forEach(([, f]) => candidates.push(path.join(dir, f)));
    } catch (e) { if (!['ENOENT', 'EACCES'].includes(e.code)) throw e; }
  }
  // The pane cwd can be stale (PowerShell sends no OSC 7), so also scan the newest transcripts anywhere,
  // but trust those only when the prompt shown in the terminal matches the message holding the image.
  const trusted = new Set(candidates);
  const recent = [];
  try {
    for (const folder of await fs.promises.readdir(projects, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const dir = path.join(projects, folder.name);
      let files; try { files = await fs.promises.readdir(dir); } catch { continue; }
      await Promise.all(files.filter(f => f.endsWith('.jsonl') && UUID.test(f.slice(0, -6))).map(f =>
        fs.promises.stat(path.join(dir, f)).then(st => recent.push([st.mtimeMs, path.join(dir, f)]), () => {})));
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  recent.sort((a, b) => b[0] - a[0]).slice(0, 10).forEach(([, f]) => { if (!candidates.includes(f)) candidates.push(f); });
  const want = typeof prompt === 'string' ? normText(prompt).slice(0, 80) : '';
  const extract = (row, state) => {
    if (row?.type !== 'user' || !Array.isArray(row.message?.content)) return [];
    const images = row.message.content.filter(b => b?.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string');
    if (!images.length) return [];
    const ids = Array.isArray(row.imagePasteIds) && row.imagePasteIds.length === images.length ? row.imagePasteIds : null;
    const text = normText(textContent(row.message.content)).slice(0, 200);
    state.seq = state.seq || 0;
    return images.flatMap((b, i) => {
      const id = ids ? Number(ids[i]) : ++state.seq;
      if (ids) state.seq = Math.max(state.seq, id);
      return /^image\/(png|jpeg|gif|webp)$/.test(b.source.media_type) ? [{ id, text, part: i }] : [];
    });
  };
  const load = (file, item) => readIndexedRow(file, item, row => {
    const b = row.message.content.filter(b => b?.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string')[item.part];
    return b ? { mediaType: b.source.media_type, data: b.source.data } : null;
  });
  // Index candidates in parallel; results are still taken in candidate order.
  const indexed = await Promise.all(candidates.map(file => indexImages(file, '"image"', extract).catch(e => {
    if (['ENOENT', 'EACCES', 'EISDIR'].includes(e.code)) return null; throw e;
  })));
  let fallback = null;
  for (const [i, file] of candidates.entries()) {
    const items = indexed[i]?.filter(it => it.id === n);
    if (!items?.length) continue;
    // Latest wins: ids restart after /clear in the same file.
    const matched = want ? items.findLast(it => it.text.startsWith(want)) : null;
    if (matched) return load(file, matched);
    if (trusted.has(file) && !fallback) fallback = [file, items[items.length - 1]];
  }
  return fallback ? load(...fallback) : null;
}
// Sent "[Pasted text #N +M lines]" prompts are kept in history.jsonl: inline `content`, or a
// `contentHash` pointing into paste-cache/. Only a prompt that matches the visible one is trusted.
async function findClaudePaste({ n, lines: breaks, prompt } = {}, home = os.homedir()) {
  n = Number(n); breaks = Number(breaks) || 0;
  if (!Number.isInteger(n) || n < 1 || typeof prompt !== 'string' || !prompt.trim()) return null;
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  let raw;
  try { raw = await fs.promises.readFile(path.join(config, 'history.jsonl'), 'utf8'); }
  catch (e) { if (['ENOENT', 'EACCES'].includes(e.code)) return null; throw e; }
  // Recalling a prompt (↑) renumbers its pastes, so compare without the numbers.
  const norm = s => s.replace(/\s+/g, ' ').trim().replace(/\[Pasted text #\d+/g, '[Pasted text #');
  const want = norm(prompt).slice(0, 80);
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('pastedContents')) continue;
    let row; try { row = JSON.parse(lines[i]); } catch { continue; }
    if (typeof row?.display !== 'string' || !row.pastedContents || !norm(row.display).startsWith(want)) continue;
    const refs = [...row.display.matchAll(/\[Pasted text #(\d+)(?: \+(\d+) lines?)?\]/g)].filter(m => Number(m[2] || 0) === breaks);
    const id = (refs.find(m => Number(m[1]) === n) || refs[0])?.[1];
    const paste = id && row.pastedContents[id];
    if (paste?.type !== 'text') continue;
    if (typeof paste.content === 'string') return paste.content;
    if (typeof paste.contentHash === 'string' && /^[a-f0-9]{8,64}$/.test(paste.contentHash)) {
      try { return await fs.promises.readFile(path.join(config, 'paste-cache', paste.contentHash + '.txt'), 'utf8'); }
      catch (e) { if (!['ENOENT', 'EACCES'].includes(e.code)) throw e; }
    }
  }
  return null;
}
// Codex rollouts (~/.codex/sessions/YYYY/MM/DD/*.jsonl) keep a sent image as
// `<image name=[Image #N] …>` text followed by an input_image data URL.
// `later`: how many identical prompts were sent after this one (Codex numbers every message
// from #1, so "[Image #1]" can repeat within a session); 0 is the newest.
async function findCodexImage({ n, prompt, files: paneFiles, later = 0 } = {}, home = os.homedir()) {
  later = Math.max(0, Number(later) || 0);
  // A message whose image is a file this pane pasted is certain; a bare prompt match
  // ("[Image #1]" alone) can belong to any session, so it is only the fallback.
  const own = new Set(Array.isArray(paneFiles) ? paneFiles.filter(f => typeof f === 'string') : []);
  n = Number(n);
  if (!Number.isInteger(n) || n < 1 || typeof prompt !== 'string' || !prompt.trim()) return null;
  const files = [];
  // shortcut: only the 3 newest entries per year/month/day level; older sessions are not searched.
  const walk = async (dir, depth) => {
    let entries; try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (depth === 3) {
      for (const e of entries) if (e.isFile() && e.name.endsWith('.jsonl')) {
        try { files.push([(await fs.promises.stat(path.join(dir, e.name))).mtimeMs, path.join(dir, e.name)]); } catch {}
      }
      return;
    }
    for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 3)) await walk(path.join(dir, e.name), depth + 1);
  };
  await walk(path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions'), 0);
  const want = normText(prompt).slice(0, 80);
  const extract = row => {
    const p = row?.payload;
    if (p?.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) return [];
    const text = normText(p.content.filter(b => b?.type === 'input_text' && typeof b.text === 'string' && !/^<\/?image\b/.test(b.text)).map(b => b.text).join(' ')).slice(0, 200);
    return p.content.flatMap((b, i) => {
      const id = /^<image name=\[Image #(\d+)\]/.exec(b?.type === 'input_text' ? b.text : '')?.[1];
      const url = p.content[i + 1]?.type === 'input_image' ? p.content[i + 1].image_url : null;
      return id && typeof url === 'string' && /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(url)
        ? [{ id: Number(id), text, part: i + 1, path: / path="([^"]*)"/.exec(b.text)?.[1] }] : [];
    });
  };
  const load = (file, item, own) => readIndexedRow(file, item, row => {
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(row.payload.content[item.part]?.image_url || '');
    return m ? { mediaType: m[1], data: m[2], ...(own ? { own: true } : {}) } : null;
  });
  const newest = files.sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, f]) => f);
  const indexed = await Promise.all(newest.map(f => indexImages(f, '"input_image"', extract).catch(() => null)));
  let fallback = null;
  for (const [i, file] of newest.entries()) {
    const hits = indexed[i]?.filter(it => it.id === n && it.text.startsWith(want)) || []; // oldest first
    const pick = hits[hits.length - 1 - later];
    if (pick && own.has(pick.path)) return load(file, pick, true);
    if (pick && !fallback) fallback = [file, pick];
  }
  return fallback ? load(...fallback) : null;
}
module.exports = { listClaudeSessions, findClaudeImage, findClaudePaste, findCodexImage, textContent, readEdges };
