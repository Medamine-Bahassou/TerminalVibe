const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
function releaseCandidates(procs, sessionId, own, host = process.pid) {
  if (!own || !/^[\w-]{8,}$/.test(String(sessionId || ''))) return [];
  const parents = new Map(procs.map(p => [p.pid, p.ppid]));
  const descends = (pid, root) => { const seen = new Set(); while (pid > 1 && !seen.has(pid)) { if (pid === root) return true; seen.add(pid); pid = parents.get(pid); } return false; };
  const holds = new RegExp(`(?:^|\\s)(?:resume|--resume|--session-id)\\s+["']?${sessionId}["']?(?=\\s|$)`);
  return procs.filter(p => p.pid > 1 && p.pid !== host && !descends(p.pid, own) && !descends(own, p.pid)
    && /(?:^|[\\/\s"'])codex(?:\.exe|\.cmd|\.js)?(?=[\s"']|$)/i.test(p.args) && holds.test(p.args));
}
function ownSessionId(procs, own) {
  const parents = new Map(procs.map(p => [p.pid, p.ppid]));
  const ownTree = pid => { const seen = new Set(); while (pid > 1 && !seen.has(pid)) { if (pid === own) return true; seen.add(pid); pid = parents.get(pid); } return false; };
  const ids = new Set();
  for (const p of procs) {
    if (!ownTree(p.pid) || !/(?:^|[\\/\s"'])codex(?:\.exe|\.cmd|\.js)?(?=[\s"']|$)/i.test(p.args)) continue;
    const match = /(?:^|\s)(?:resume|--resume|--session-id)(?:\s+|=)["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=["'\s]|$)/i.exec(p.args);
    if (match) ids.add(match[1]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}
async function releaseSession(sessionId, own) {
  if (!own) return 0;
  let procs;
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 10000, maxBuffer: 16 << 20 });
    const rows = JSON.parse(stdout || '[]');
    procs = (Array.isArray(rows) ? rows : [rows]).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, args: p.CommandLine || '' }));
  } else {
    const { stdout } = await exec('ps', ['-eo', 'pid=,ppid=,args='], { timeout: 4000 });
    procs = stdout.split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], args: m[3] }));
  }
  sessionId = sessionId || ownSessionId(procs, own);
  if (!sessionId) throw new Error('Could not resolve the locked conversation from this terminal. Open its terminal view and retry, or close its other window.');
  let count = 0;
  for (const p of releaseCandidates(procs, sessionId, own)) {
    try { process.kill(p.pid, 'SIGTERM'); count++; } catch {}
  }
  return count;
}
module.exports = { releaseCandidates, releaseSession, ownSessionId };
