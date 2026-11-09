const assert = require('node:assert/strict');
const { createPtyFlow, HIGH, LOW } = require('../electron/pty-flow');

const fakePty = () => {
  const p = { paused: false, pause() { p.paused = true; }, resume() { p.paused = false; } };
  return p;
};

(async () => {
  let pty = fakePty(), flow = createPtyFlow(pty);
  flow.sent(HIGH);
  assert.equal(pty.paused, false, 'at the high watermark the PTY keeps running');
  flow.sent(1);
  assert.equal(pty.paused, true, 'past the high watermark the PTY is paused');
  flow.ack(HIGH - LOW);
  assert.equal(pty.paused, true, 'stays paused until the backlog is below the low watermark');
  flow.ack(2);
  assert.equal(pty.paused, false, 'resumes once the renderer has caught up');
  flow.ack(10 * HIGH);
  flow.sent(HIGH);
  assert.equal(pty.paused, false, 'extra acks never drive the backlog negative');
  flow.stop();

  // Acks lost (window closed mid-flood): the PTY must not stay paused forever.
  pty = fakePty(); flow = createPtyFlow(pty, 20);
  flow.sent(HIGH + 1);
  assert.equal(pty.paused, true);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(pty.paused, false, 'a stalled PTY resumes on its own');
  flow.sent(HIGH);
  assert.equal(pty.paused, false, 'and its backlog starts over');
  flow.stop();

  console.log('pty flow control: ok');
})().catch(e => { console.error(e); process.exit(1); });
