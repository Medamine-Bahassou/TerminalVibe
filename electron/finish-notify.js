'use strict';
// One poll step of "a command / agent response finished" detection for a PTY.
// cur: per-terminal state { wasBusy, name, agentSince } (mutated)
// info: runningProcessInfo() result; io: { out, in } last output/input times.
// Codex stays in the foreground between turns, so a response is finished when
// its output (spinner, streamed text) stops. Claude Code is detected exactly
// from its terminal title instead (renderer, setupTerminalTitles).
// Returns { kind: 'command' | 'agent', name } or null.
const AGENT_RE = /^codex\b/i;
const AGENT_QUIET_MS = 2500; // silence that ends a response
const AGENT_MIN_MS = 1500;   // shorter output runs are typing echo / redraws

function finishStep(cur, info, io, now) {
  if (!info.running) {
    const event = cur.wasBusy ? { kind: 'command', name: cur.name } : null;
    cur.wasBusy = false; cur.name = null; cur.agentSince = 0;
    return event;
  }
  cur.wasBusy = true;
  if (info.name) cur.name = info.name;
  if (!AGENT_RE.test(cur.name || '')) return null;
  if (now - (io.out || 0) < AGENT_QUIET_MS) {
    if (!cur.agentSince) cur.agentSince = now;
    return null;
  }
  if (!cur.agentSince) return null;
  // Measure the output run from the last keystroke, so typing never counts.
  const finished = (io.out || 0) - Math.max(cur.agentSince, io.in || 0) >= AGENT_MIN_MS;
  cur.agentSince = 0;
  return finished ? { kind: 'agent', name: cur.name } : null;
}

module.exports = { finishStep };
