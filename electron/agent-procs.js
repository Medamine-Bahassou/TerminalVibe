'use strict';
// Processes a chat's agent left running: everything an agent starts inherits TERMINALVIBE_PANE_ID (the chat's id),
// a detached one too (`nohup server &`, `setsid`, a dev server the agent launched and moved on from), so the chat
// can list them, show their URLs and stop them. The agent's own live tree (its tool calls, MCP servers) isn't
// "left running": anything under the agent's process is skipped while it runs.
// Linux reads /proc; macOS asks ps for environments (-E). Windows can't read another process's env cheaply: none.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Daemons tools start on their own (git signing, credential caches, a prompt's git status): not something the agent
// "ran". /proc names are cut at 15 characters.
const DAEMONS = /^(gpg-agent|ssh-agent|scdaemon|dirmngr|keyboxd|dbus-daemon|dbus-launch|git-credential-ca.*|at-spi-bus-laun.*|pulseaudio|pipewire|gitstatusd.*)$/;
// A bare shell (no command) left over is a prompt's helper (powerlevel10k forks one for gitstatusd), not a task.
const isHarnessServer = p => p.match && /^opencode(\.exe)?$/.test(path.basename(p.args?.[0] || p.comm))
  && (p.args || []).slice(1).join(' ') === 'serve --hostname=127.0.0.1 --port=0';
const isBareShell = p => /^-?(ba|z|da|fi|k)?sh$/.test(path.basename(p.args?.[0] || p.comm)) && (p.args?.length || 1) <= 1;

async function scanLinux(paneId) {
  const needle = Buffer.from(`\0TERMINALVIBE_PANE_ID=${paneId}\0`), first = Buffer.from(`TERMINALVIBE_PANE_ID=${paneId}\0`);
  const ticks = 100; // USER_HZ on every Linux build Node targets
  let boot = 0;
  try { boot = Number(/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8'))?.[1]) * 1000 || 0; } catch {}
  const all = new Map(); // pid -> { ppid, match, ... }
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name), dir = path.join('/proc', name);
    let stat;
    try { stat = fs.readFileSync(path.join(dir, 'stat'), 'utf8'); } catch { continue; }
    const close = stat.lastIndexOf(')'), comm = stat.slice(stat.indexOf('(') + 1, close), f = stat.slice(close + 2).split(' ');
    const p = { pid, ppid: Number(f[1]), comm, match: false };
    all.set(pid, p);
    let env;
    try { env = fs.readFileSync(path.join(dir, 'environ')); } catch { continue; } // another user's process
    if (!(env.indexOf(needle) >= 0 || env.subarray(0, first.length).equals(first))) continue;
    p.match = true;
    try { p.args = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean); } catch { p.args = [comm]; }
    try { p.cwd = fs.readlinkSync(path.join(dir, 'cwd')); } catch { p.cwd = null; }
    p.startedAt = boot ? boot + Number(f[19]) / ticks * 1000 : null; // field 22: start time, in ticks since boot
  }
  return all;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 8000 }, (err, out) => err ? reject(err) : resolve(out)));
}
async function scanMac(paneId) {
  // Two listings: one with environments (to match), one without (clean command lines).
  const [withEnv, plain] = await Promise.all([run('ps', ['-Aww', '-E', '-o', 'pid=,ppid=,command=']), run('ps', ['-Aww', '-o', 'pid=,ppid=,lstart=,comm=,command='])]);
  const matched = new Set();
  for (const line of withEnv.split('\n')) {
    const m = /^\s*(\d+)\s+\d+\s+(.*)$/.exec(line);
    if (m && new RegExp(`(?:^|\\s)TERMINALVIBE_PANE_ID=${paneId.replace(/[^\w-]/g, '')}(?:\\s|$)`).test(m[2])) matched.add(Number(m[1]));
  }
  const all = new Map();
  for (const line of plain.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    all.set(pid, { pid, ppid: Number(m[2]), comm: path.basename(m[4]), match: matched.has(pid), args: m[5].split(' '), cwd: null, startedAt: Date.parse(m[3]) || null });
  }
  return all;
}

// roots: the chat's live processes (its structured agent, its terminal) whose trees are skipped; listeners:
// [{ pid, url }] from servers.js.
async function agentProcesses(paneId, roots = [], listeners = []) {
  if (!/^[\w-]{1,128}$/.test(paneId || '')) return [];
  const all = process.platform === 'linux' ? await scanLinux(paneId) : process.platform === 'darwin' ? await scanMac(paneId) : null;
  if (!all) return [];
  const under = (pid, root) => { for (let p = pid, hops = 0; p && hops < 128; p = all.get(p)?.ppid, hops++) if (p === root) return true; return false; };
  const self = new Set(); for (let p = process.pid; p; p = all.get(p)?.ppid) { if (self.has(p)) break; self.add(p); }
  // OpenCode's harness server (chat-sdk.js launches exactly this) and its helpers are the agent, not something it
  // left running, even orphaned by an app instance that was killed before it could stop it.
  roots = [...roots, ...[...all.values()].filter(isHarnessServer).map(p => p.pid)];
  const kept = [...all.values()].filter(p => p.match && !self.has(p.pid) && !DAEMONS.test(p.comm) && !roots.some(r => r && under(p.pid, r)));
  const keptIds = new Set(kept.map(p => p.pid));
  // One row per tree: a process whose parent is also listed belongs to that row (npm -> node -> esbuild).
  const top = pid => { let t = pid; for (let p = all.get(pid)?.ppid, hops = 0; p && hops < 128; p = all.get(p)?.ppid, hops++) if (keptIds.has(p)) t = p; return t; };
  const rows = new Map(kept.filter(p => !keptIds.has(p.ppid) && !isBareShell(p)).map(p => [p.pid, { pid: p.pid, command: (p.args || [p.comm]).join(' '), cwd: p.cwd, startedAt: p.startedAt, urls: [], pids: [p.pid] }]));
  for (const p of kept) if (rows.has(top(p.pid)) && p.pid !== top(p.pid)) rows.get(top(p.pid)).pids.push(p.pid);
  for (const l of listeners) {
    if (!keptIds.has(l.pid)) continue;
    const row = rows.get(top(l.pid));
    if (row && !row.urls.includes(l.url)) row.urls.push(l.url);
  }
  return [...rows.values()].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

// Stop one row: its whole tree, after checking (again) that it is still this chat's, so a reused pid is never hit.
async function stopAgentProcess(paneId, pid, roots) {
  const row = (await agentProcesses(paneId, roots)).find(r => r.pid === Number(pid));
  if (!row) throw new Error('That process is no longer running.');
  for (const p of [...row.pids].reverse()) { try { process.kill(p, 'SIGTERM'); } catch {} }
  return true;
}

module.exports = { agentProcesses, stopAgentProcess };
