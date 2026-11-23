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
// A chat's structured agent, as chat-sdk.js launches it (claude -p stream-json, codex app-server, agy acp, opencode
// serve), is the agent itself, never something it left running: also while it exits after handing the session to the
// terminal view (its pid leaves the chat's roots at once, the process a beat later, which logged a started/stopped pair).
const HARNESS_LAUNCH = { claude: a => a.includes('-p') && a.includes('stream-json'), codex: a => a[0] === 'app-server', agy: a => a[0] === 'acp',
  opencode: a => a.join(' ') === 'serve --hostname=127.0.0.1 --port=0' };
const isHarnessServer = p => {
  if (!p.match) return false;
  const args = p.args || [p.comm], at = args.findIndex((a, i) => i < 2 && HARNESS_LAUNCH[path.basename(a).replace(/(\.exe|\.js)$/, '')]);
  return at >= 0 && HARNESS_LAUNCH[path.basename(args[at]).replace(/(\.exe|\.js)$/, '')](args.slice(at + 1));
};
const isBareShell = p => /^-?(ba|z|da|fi|k)?sh$/.test(path.basename(p.args?.[0] || p.comm)) && (p.args?.length || 1) <= 1;

async function scanLinux(paneId, ids = []) {
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
    const p = { pid, ppid: Number(f[1]), comm, match: false, ticks: Number(f[11]) + Number(f[12]) }; // CPU time used (utime + stime)
    all.set(pid, p);
    if (ids.length) { // a process with the session id as an argument (--resume <id>, --session-id=<id>) has the conversation open
      try { p.args = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean); } catch { p.args = []; }
      p.hasSession = p.args.some(x => ids.some(id => x === id || x.endsWith('=' + id)));
    }
    let env;
    try { env = fs.readFileSync(path.join(dir, 'environ')); } catch { continue; } // another user's process
    if (!(env.indexOf(needle) >= 0 || env.subarray(0, first.length).equals(first))) continue;
    p.match = true;
    if (!p.args?.length) try { p.args = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean); } catch { p.args = [comm]; }
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

// Another TerminalVibe (a packaged build next to this dev app) shares ~/.terminalvibe, so its chats carry the same
// pane ids and its agents match here. Anything running under a different app instance is that instance's, not ours.
const APP = /^(electron|terminalvibe)$/i;
const foreignOf = all => pid => { let other = false; for (let p = all.get(pid)?.ppid, hops = 0; p && hops < 128; p = all.get(p)?.ppid, hops++) { if (p === process.pid) return false; if (APP.test(all.get(p)?.comm || '')) other = true; } return other; };

const MIN_AGE_MS = 3000;
const isAppHelper = p => APP.test(path.basename(p.args?.[0] || p.comm)) && (p.args || []).slice(1)
  .some(a => /\.js$/.test(a) && path.basename(path.dirname(a)) === 'electron' && fs.existsSync(path.join(__dirname, path.basename(a))));

// Only a process the agent left listening on a port is a server it left running: a tool command (git, a build)
// inherits the pane id too, but isn't one. URLs are attached to the row owning the whole tree, so a listener's
// parent (npm -> node) is kept with its child.
const isServer = row => row.urls?.length > 0;
// Part of a live root's own tree (the agent, its MCP servers, the shell of one of its tool calls): not left running.
// What a tool call's shell (`sh -c …`, how every harness runs a command) started is, though: Claude Code keeps a
// run_in_background server under its own process for as long as the session lives, so skipping the whole tree hid
// every server the agent was still running. Only once the turn is over, though: mid-turn a foreground command (a test
// server, an app boot check) looks the same, and listing it logged a "Server started/stopped" pair.
// Returns 'agent' (its own tree), 'tool' (started by one of its commands) or null (outside every root).
const isToolShell = p => /^(ba|z|da|fi|k)?sh$/.test(path.basename(p?.args?.[0] || p?.comm || '')) && (p.args || []).slice(1).some(a => /^-\w*c\w*$/.test(a));
function insideAgent(all, roots, pid) {
  let tool = false;
  for (let p = pid, hops = 0; p && hops < 128; p = all.get(p)?.ppid, hops++) {
    if (roots.includes(p)) return tool ? 'tool' : 'agent';
    if (p !== pid && isToolShell(all.get(p))) tool = true;
  }
  return null;
}
// paneId -> pids a tool call left running, seen while the agent was idle: they stay listed through its next turn.
const leftByTools = new Map();
// roots: the chat's live processes (its structured agent, its terminal) whose trees are skipped; listeners:
// [{ pid, url }] from servers.js. serversOnly is relaxed for the stop re-check, which must find any listed tree.
// idle: the chat's agent isn't in a turn, so whatever its commands started and is still alive was left running.
async function agentProcesses(paneId, roots = [], listeners = [], serversOnly = true, idle = true) {
  if (!/^[\w-]{1,128}$/.test(paneId || '')) return [];
  const all = process.platform === 'linux' ? await scanLinux(paneId) : process.platform === 'darwin' ? await scanMac(paneId) : null;
  if (!all) return [];
  const self = new Set(); for (let p = process.pid; p; p = all.get(p)?.ppid) { if (self.has(p)) break; self.add(p); }
  // OpenCode's harness server (chat-sdk.js launches exactly this) and its helpers are the agent, not something it
  // left running, even orphaned by an app instance that was killed before it could stop it.
  // TerminalVibe's own helpers too: the delegate MCP server every agent is given is the app's binary running one of its
  // electron/*.js scripts. It dies with its agent, a beat later, which logged it as "started"/"stopped" in the history.
  roots = [...roots, ...[...all.values()].filter(p => isHarnessServer(p) || (p.match && isAppHelper(p))).map(p => p.pid)];
  const foreign = foreignOf(all);
  const known = leftByTools.get(paneId) || new Set(), byTools = new Set();
  const kept = [...all.values()].filter(p => {
    if (!p.match || self.has(p.pid) || DAEMONS.test(p.comm) || foreign(p.pid)) return false;
    const where = insideAgent(all, roots, p.pid);
    if (where === 'tool' && (idle || known.has(p.pid))) byTools.add(p.pid);
    return !where || byTools.has(p.pid);
  });
  if (serversOnly && idle) { if (byTools.size) leftByTools.set(paneId, byTools); else leftByTools.delete(paneId); }
  const keptIds = new Set(kept.map(p => p.pid));
  // One row per tree: a process whose parent is also listed belongs to that row (npm -> node -> esbuild).
  const top = pid => { let t = pid; for (let p = all.get(pid)?.ppid, hops = 0; p && hops < 128; p = all.get(p)?.ppid, hops++) if (keptIds.has(p)) t = p; return t; };
  // Something that has run for under MIN_AGE_MS isn't "left running" yet: a tool call finishing, a helper exiting with its
  // agent. Listing it only adds a started/stopped pair to the history a poll later.
  const settled = p => !p.startedAt || Date.now() - p.startedAt >= MIN_AGE_MS;
  const rows = new Map(kept.filter(p => !keptIds.has(p.ppid) && !isBareShell(p) && settled(p)).map(p => [p.pid, { pid: p.pid, command: (p.args || [p.comm]).join(' '), cwd: p.cwd, startedAt: p.startedAt, urls: [], pids: [p.pid] }]));
  for (const p of kept) if (rows.has(top(p.pid)) && p.pid !== top(p.pid)) rows.get(top(p.pid)).pids.push(p.pid);
  for (const l of listeners) {
    if (!keptIds.has(l.pid)) continue;
    const row = rows.get(top(l.pid));
    if (row && !row.urls.includes(l.url)) row.urls.push(l.url);
  }
  return [...rows.values()].filter(serversOnly ? isServer : () => true).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

// The conversation open somewhere else: an agent of another TerminalVibe instance for this chat, or any process outside
// this app with the chat's session id in its arguments (a terminal's `claude --resume <id>`). Sending from here would
// collide with it. Linux only (it needs /proc); anything else answers "not found". Rows: [{ pid, command }].
const cpuSeen = new Map(); // pid -> { ticks, active }: the last poll's CPU time of an agent's tree, and when it last moved
const BUSY_MS = 4000, BUSY_TICKS = 3; // 3 ticks = 30ms of CPU between two polls (about a second apart)
async function sessionElsewhere(paneId, sessionIds = []) {
  if (process.platform !== 'linux' || !/^[\w-]{1,128}$/.test(paneId || '')) return [];
  const ids = sessionIds.filter(id => /^[\w-]{8,128}$/.test(id || ''));
  const all = await scanLinux(paneId, ids);
  const foreign = foreignOf(all);
  const ours = pid => { for (let p = pid, hops = 0; p && hops < 128; p = all.get(p)?.ppid, hops++) if (p === process.pid) return true; return false; };
  // Another instance's shell or dev server for the same tab isn't the conversation: only an agent binary counts.
  const AGENT = /^(claude|codex|opencode|gemini|agy|amp|cursor-agent|kimi|copilot|qwen|droid)(\.exe)?$/;
  const isAgent = p => [p.args?.[0] || p.comm, p.args?.[1] || ''].some(x => AGENT.test(path.basename(x)));
  const flagged = new Map([...all].filter(([pid, p]) => !ours(pid) && !DAEMONS.test(p.comm) && (p.hasSession || (p.match && foreign(pid) && isAgent(p)))));
  // Open elsewhere isn't a conflict, working elsewhere is: an agent's tree (it and its tool processes) that used CPU since the
  // last poll is working, and stays "busy" for BUSY_MS after it last did (the gaps between streamed chunks, an API wait).
  const kids = new Map();
  for (const p of all.values()) (kids.get(p.ppid) || kids.set(p.ppid, []).get(p.ppid)).push(p.pid);
  const treeTicks = root => { let n = 0; const stack = [root]; for (let seen = 0; stack.length && seen < 500; seen++) { const x = stack.pop(); n += all.get(x)?.ticks || 0; stack.push(...(kids.get(x) || [])); } return n; };
  const now = Date.now(), rows = [...flagged.values()].filter(p => !flagged.has(p.ppid)).map(p => {
    const ticks = treeTicks(p.pid), prev = cpuSeen.get(p.pid);
    let active = prev?.active || 0;
    if (prev && ticks - prev.ticks >= BUSY_TICKS) active = now;
    cpuSeen.set(p.pid, { ticks, active });
    return { pid: p.pid, command: (p.args?.length ? p.args : [p.comm]).join(' ').slice(0, 200), busy: now - active < BUSY_MS };
  });
  for (const pid of cpuSeen.keys()) if (!rows.some(r => r.pid === pid)) cpuSeen.delete(pid);
  return rows;
}

// Stop one row: its whole tree, after checking (again) that it is still this chat's, so a reused pid is never hit.
async function stopAgentProcess(paneId, pid, roots) {
  const row = (await agentProcesses(paneId, roots, [], false)).find(r => r.pid === Number(pid));
  if (!row) throw new Error('That process is no longer running.');
  for (const p of [...row.pids].reverse()) { try { process.kill(p, 'SIGTERM'); } catch {} }
  return true;
}

module.exports = { agentProcesses, stopAgentProcess, sessionElsewhere };

if (require.main === module) {
  const assert = require('assert');
  const h = args => isHarnessServer({ match: true, args });
  assert.ok(h(['/home/u/.local/bin/claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json']), 'structured claude');
  assert.ok(h(['codex', 'app-server', '--listen', 'stdio://']) && h(['node', '/npm/codex.js', 'app-server']), 'codex app-server (also via node)');
  assert.ok(h(['agy', 'acp']) && h(['opencode', 'serve', '--hostname=127.0.0.1', '--port=0']), 'agy acp, opencode serve');
  assert.ok(!h(['claude', '--resume', 'abc']) && !h(['claude']) && !h(['codex', 'exec', 'x']) && !h(['opencode', 'serve']) && !h(['node', 'server.js']), 'terminal agents and user processes still count');
  assert.ok(!isHarnessServer({ match: false, args: ['codex', 'app-server'] }), 'other panes');
  // agent 10 -> tool shell 11 -> server 12; agent 10 -> MCP server 13
  const tree = new Map([[10, { ppid: 1, comm: 'claude', args: ['claude', '-p'] }], [11, { ppid: 10, comm: 'zsh', args: ['/usr/bin/zsh', '-c', 'node dev.js'] }],
    [12, { ppid: 11, comm: 'node', args: ['node', 'dev.js'] }], [13, { ppid: 10, comm: 'node', args: ['node', 'mcp.js'] }]]);
  assert.deepStrictEqual([10, 11, 12, 13].map(pid => insideAgent(tree, [10], pid)), ['agent', 'agent', 'tool', 'agent'], 'a server a tool call started is the tool\'s; the agent, its shell and MCP servers are the agent\'s');
  assert.strictEqual(insideAgent(tree, [99], 12), null, 'outside every root');
  assert.ok(isServer({ urls: ['http://localhost:3000'] }) && !isServer({ urls: [] }) && !isServer({}), 'only listeners are servers');
  console.log('agent-procs: ok');
}
