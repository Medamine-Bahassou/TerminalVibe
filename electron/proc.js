'use strict';
/**
 * Detects whether a PTY session currently has a process running inside it —
 * i.e. something other than the idle shell. Used to decide whether closing a
 * tab should be confirmed before killing the session, and what the workspace
 * buttons in the sidebar show.
 *
 * Linux: inspects /proc. Windows: lists child processes via Get-CimInstance
 * (an idle powershell.exe / cmd.exe / wsl.exe with no busy children counts
 * as idle — never "unknown"). Other platforms: conservatively assume busy.
 */
const fs = require('fs');
const path = require('path');

function readProc(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// Field offsets inside /proc/<pid>/stat AFTER the closing paren of comm:
// [0]=state, [1]=ppid, [2]=pgrp, [3]=session, [4]=tty_nr, [5]=tpgid, ...
function procStatFields(pid) {
  const s = readProc(`/proc/${pid}/stat`);
  if (!s) return null;
  const idx = s.lastIndexOf(')');
  if (idx === -1) return null;
  return s.slice(idx + 2).split(' ');
}

const SHELL_RE = /^(bash|zsh|sh|fish|dash|ash|ksh|tcsh|csh|pwsh|powershell|cmd|wsl|nu)$/;
const INTERP_RE = /^(node|nodejs|python|python3|python2|ruby|perl|php|deno|bun|lua)$/;
const SCRIPT_EXT_RE = /\.(js|mjs|cjs|ts|py|rb|pl|lua|php|sh)$/i;

// Resolve a display-friendly process name from argv when /proc/<pid>/comm
// only reveals the interpreter ("node", "python" etc). Reads cmdline to
// find the script/module the user actually ran.
function processDisplayName(pid, comm) {
  if (!INTERP_RE.test(comm)) return comm;
  const cmdline = readProc(`/proc/${pid}/cmdline`);
  if (!cmdline) return comm;
  const argv = cmdline.split('\0').filter(Boolean);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-m' && argv[i + 1]) return argv[i + 1]; // python -m module
    if (a === '-e' || a === '-c' || a.startsWith('-')) continue;
    const name = path.basename(a).replace(SCRIPT_EXT_RE, '');
    if (name) return name;
  }
  return comm;
}

/**
 * @param {number} pid PID of the PTY's direct child (node-pty's pid).
 * @returns {boolean} true when a real process (excluding the idle shell) is
 *   running inside the terminal.
 */
function hasRunningProcess(pid) {
  return runningProcessInfo(pid).running;
}

/**
 * Like hasRunningProcess, but also returns the name (comm) of the running
 * process when one is detected — used for quit/close confirmation messages.
 * @returns {{running: boolean, name: string|null}}
 */
function runningProcessInfo(pid) {
  if (process.platform === 'win32') return windowsProcessInfo(pid);
  if (process.platform !== 'linux') return { running: true, name: null };
  if (!pid || pid <= 1) return { running: false, name: null };
  const commRaw = readProc(`/proc/${pid}/comm`);
  if (commRaw == null) return { running: true, name: null }; // cannot inspect — assume busy
  const comm = commRaw.trim();
  if (!SHELL_RE.test(comm)) {
    // The PTY's direct child is not a shell (e.g. `exec vim`, a direct
    // command or an app) — a process is definitely running.
    return { running: true, name: processDisplayName(pid, comm) };
  }
  const fields = procStatFields(pid);
  if (!fields) return { running: true, name: null };
  // Foreground process group of the terminal. At an idle prompt the shell's
  // own group owns it; when a job runs (foreground, incl. helpers like
  // `tmux`/`nano`), the job's group takes over.
  const pgrp = parseInt(fields[2], 10);
  const tpgid = parseInt(fields[5], 10);
  if (tpgid !== 0 && tpgid !== pgrp) {
    const jobComm = readProc(`/proc/${tpgid}/comm`);
    return { running: true, name: jobComm ? processDisplayName(tpgid, jobComm.trim()) : null };
  }
  return { running: false, name: null };
}

// ── Windows ─────────────────────────────────────────────────────────────
// An idle shell (powershell.exe / cmd.exe / wsl.exe / pwsh.exe) with nothing
// running inside it must report idle — never {running:true, name:null},
// which the UI would render as "- unknown" in the workspace button.
// A terminal is busy when the shell has a non-shell descendant (e.g. the
// user ran `node server.js` inside powershell → node.exe child).
// Console helpers (conhost / openconsole) and nested shells are ignored.

// Names that alone mean "idle at a prompt" — never reported as busy.
const WIN_IDLE_RE = /^(powershell|pwsh|cmd|wsl|bash|zsh|sh|fish|dash|ash|ksh|tcsh|csh|nu|conhost|openconsole|windowsterminal)$/i;

// Cached whole-system process table: parentPid -> [{pid, name}].
// ponytail: async background refresh avoids blocking main event loop with powershell/wmic
let _winTable = null; // { ts: number, byParent: Map<number, Array<{pid:number,name:string}>> | null }
let _winUpdating = false;
let _hasWmic = true;
const WIN_CACHE_TTL = 3000;

function refreshWindowsProcessTable() {
  if (_winUpdating) return;
  _winUpdating = true;
  const { execFile } = require('child_process');

  const onOutput = (out) => {
    _winUpdating = false;
    if (!out) return;
    const byParent = new Map();
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.includes(':')) {
        const m = /^(\d+):(\d+):(.+)$/.exec(trimmed);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        const ppid = parseInt(m[2], 10);
        const name = m[3].trim();
        if (!name || isNaN(pid) || isNaN(ppid)) continue;
        if (!byParent.has(ppid)) byParent.set(ppid, []);
        byParent.get(ppid).push({ pid, name });
      } else if (trimmed.includes(',')) {
        const parts = trimmed.split(',');
        if (parts.length >= 4) {
          const pid = parseInt(parts[parts.length - 1], 10);
          const ppid = parseInt(parts[parts.length - 2], 10);
          const name = parts.slice(1, parts.length - 2).join(',').trim();
          if (!name || isNaN(pid) || isNaN(ppid)) continue;
          if (!byParent.has(ppid)) byParent.set(ppid, []);
          byParent.get(ppid).push({ pid, name });
        }
      }
    }
    _winTable = { ts: Date.now(), byParent };
  };

  const tryPowershell = () => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | ForEach-Object { "$($_.ProcessId):$($_.ParentProcessId):$($_.Name)" }'],
        { timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          _winUpdating = false;
          if (err || !stdout) return;
          onOutput(stdout);
        }
      );
    } catch {
      _winUpdating = false;
    }
  };

  try {
    if (_hasWmic) {
      execFile(
        'wmic',
        ['process', 'get', 'ProcessId,ParentProcessId,Name', '/format:csv'],
        { timeout: 3000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout || !stdout.includes(',')) {
            _hasWmic = false;
            tryPowershell();
            return;
          }
          onOutput(stdout);
        }
      );
    } else {
      tryPowershell();
    }
  } catch {
    _winUpdating = false;
  }
}

function windowsProcessTable() {
  const now = Date.now();
  if (!_winTable || (now - _winTable.ts >= WIN_CACHE_TTL)) {
    refreshWindowsProcessTable();
  }
  return _winTable ? _winTable.byParent : null;
}

if (process.platform === 'win32') {
  refreshWindowsProcessTable();
}

function windowsProcessInfo(pid) {
  if (!pid || pid <= 1) return { running: false, name: null };
  let byParent = null;
  try {
    byParent = windowsProcessTable();
  } catch {
    byParent = null;
  }
  // Cannot inspect — assume an idle shell rather than reporting "unknown",
  // so idle powershell/cmd/wsl tabs stay clean in the sidebar.
  if (!byParent) return { running: false, name: null };
  // BFS through nested shells / console helpers (depth-capped) looking for
  // the first real workload process.
  const seen = new Set([pid]);
  let frontier = [pid];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next = [];
    for (const p of frontier) {
      const kids = byParent.get(p) || [];
      for (const k of kids) {
        if (seen.has(k.pid)) continue;
        seen.add(k.pid);
        const base = k.name.replace(/\.exe$/i, '');
        if (!base) continue;
        if (WIN_IDLE_RE.test(base.toLowerCase())) {
          next.push(k.pid); // nested shell / conhost — look inside it
          continue;
        }
        return { running: true, name: base };
      }
    }
    frontier = next;
  }
  return { running: false, name: null };
}

module.exports = { hasRunningProcess, runningProcessInfo, refreshWindowsProcessTable };
