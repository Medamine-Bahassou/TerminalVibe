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

/**
 * @param {number} pid PID of the PTY's direct child (node-pty's pid).
 * @returns {boolean} true when a real process (excluding the idle shell) is
 *   running inside the terminal.
 */
function hasRunningProcess(pid) {
  if (process.platform !== 'linux') return true;
  if (!pid || pid <= 1) return false;
  const commRaw = readProc(`/proc/${pid}/comm`);
  if (commRaw == null) return true; // cannot inspect — assume busy
  const comm = commRaw.trim();
  if (!SHELL_RE.test(comm)) {
    // The PTY's direct child is not a shell (e.g. `exec vim`, a direct
    // command or an app) — a process is definitely running.
    return true;
  }
  const fields = procStatFields(pid);
  if (!fields) return true;
  // Foreground process group of the terminal. At an idle prompt the shell's
  // own group owns it; when a job runs (foreground, incl. helpers like
  // `tmux`/`nano`), the job's group takes over.
  const pgrp = parseInt(fields[2], 10);
  const tpgid = parseInt(fields[5], 10);
  return tpgid !== 0 && tpgid !== pgrp;
}

module.exports = { hasRunningProcess };
