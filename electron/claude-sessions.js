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
module.exports = { listClaudeSessions, textContent, readEdges };
