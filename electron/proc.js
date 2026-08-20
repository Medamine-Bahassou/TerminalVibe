'use strict';
/**
 * Detects whether a PTY session currently has a process running inside it —
 * i.e. something other than the idle shell. Used to decide whether closing a
 * tab should be confirmed before killing the session.
 *
 * Linux-only: inspects /proc. On unsupported platforms we conservatively
 * assume a process is running so we never kill a session silently.
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

const SHELL_RE = /^(bash|zsh|sh|fish|dash|ash|ksh|tcsh|csh|pwsh|nu)$/;
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

module.exports = { hasRunningProcess, runningProcessInfo };
