// PTY → renderer flow control (the scheme VS Code uses).
// The renderer acks every chunk once xterm has parsed it. A PTY that gets
// HIGH chars ahead is paused until the backlog drains below LOW, so a flood
// (`cat bigfile`, a noisy build) cannot bury the renderer and Ctrl+C stays
// responsive. LOW is half of HIGH so xterm never runs dry while the resume
// is in flight; measured throughput then matches an unthrottled PTY.
const HIGH = 100000, LOW = 50000, STALL_MS = 5000;

function createPtyFlow(pty, stallMs = STALL_MS) {
  let unacked = 0, timer = null; // timer set <=> paused
  const resume = () => {
    clearTimeout(timer); timer = null;
    try { pty.resume(); } catch {}
  };
  return {
    sent(n) {
      unacked += n;
      if (timer || unacked <= HIGH) return;
      try { pty.pause(); } catch { return; }
      // Acks get lost when a window closes or reloads mid-flood. Never stay
      // paused forever: no ack for stallMs means start over.
      // ponytail: a process that exits while paused loses the output still in
      // the kernel buffer once node-pty destroys the socket (200ms). Drain
      // before exit if that ever shows up.
      timer = setTimeout(() => { unacked = 0; resume(); }, stallMs);
    },
    ack(n) {
      unacked = Math.max(0, unacked - n);
      if (!timer) return;
      if (unacked < LOW) resume(); else timer.refresh();
    },
    stop() { clearTimeout(timer); timer = null; },
  };
}

module.exports = { createPtyFlow, HIGH, LOW };
