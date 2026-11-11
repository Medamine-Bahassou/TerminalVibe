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
      for (const f of files) {
        if (!f.endsWith('.jsonl') || !UUID.test(f.slice(0, -6))) continue;
        try { recent.push([(await fs.promises.stat(path.join(dir, f))).mtimeMs, path.join(dir, f)]); } catch {}
      }
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  recent.sort((a, b) => b[0] - a[0]).slice(0, 10).forEach(([, f]) => { if (!candidates.includes(f)) candidates.push(f); });
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const want = typeof prompt === 'string' ? norm(prompt).slice(0, 80) : '';
  let fallback = null;
  for (const file of candidates) {
    let raw;
    try { raw = await fs.promises.readFile(file, 'utf8'); } catch (e) { if (['ENOENT', 'EACCES'].includes(e.code)) continue; throw e; }
    let seq = 0, found = null, matched = null;
    for (const line of raw.split('\n')) {
      if (!line.includes('"image"')) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row?.type !== 'user' || !Array.isArray(row.message?.content)) continue;
      const images = row.message.content.filter(b => b?.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string');
      if (!images.length) continue;
      const ids = Array.isArray(row.imagePasteIds) && row.imagePasteIds.length === images.length ? row.imagePasteIds : null;
      const isMatch = want && norm(textContent(row.message.content)).startsWith(want);
      images.forEach((b, i) => {
        const id = ids ? Number(ids[i]) : ++seq;
        if (ids) seq = Math.max(seq, id);
        if (id !== n || !/^image\/(png|jpeg|gif|webp)$/.test(b.source.media_type)) return;
        found = b.source; // latest wins: ids restart after /clear in the same file
        if (isMatch) matched = b.source;
      });
    }
    if (matched) return { mediaType: matched.media_type, data: matched.data };
    if (found && trusted.has(file) && !fallback) fallback = { mediaType: found.media_type, data: found.data };
  }
  return fallback;
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
module.exports = { listClaudeSessions, findClaudeImage, findClaudePaste, textContent, readEdges };
