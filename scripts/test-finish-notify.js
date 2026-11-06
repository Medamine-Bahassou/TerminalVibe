const assert = require('node:assert/strict');
const { finishStep } = require('../electron/finish-notify');

// Drive one terminal through [now, info, io] ticks → the "kind:name" events.
const run = ticks => {
  const cur = { wasBusy: false, name: null, agentSince: 0 };
  return ticks.map(([now, info, io]) => finishStep(cur, info, io, now)).filter(Boolean).map(e => `${e.kind}:${e.name}`);
};
const S = 1000, idle = { running: false, name: null }, codex = { running: true, name: 'codex' }, npm = { running: true, name: 'npm' };

assert.deepEqual(run([[0, npm, {}], [S, idle, {}]]), ['command:npm'], 'busy → idle is a finished command');
assert.deepEqual(run([[0, idle, {}], [S, idle, {}]]), [], 'idle shell never notifies');
// A 2s Codex reply (Enter at 1s, output until 3s) still counts.
assert.deepEqual(run([1, 2, 3, 4, 5, 6].map(t => [t * S, codex, { in: S, out: Math.min(t, 3) * S }])), ['agent:codex'], 'short replies notify');
// Enter at 1s, Codex streams until 9s, then quiet → one agent event.
const streamed = [];
for (let t = 1; t <= 13; t++) streamed.push([t * S, codex, { in: S, out: Math.min(t, 9) * S }]);
assert.deepEqual(run(streamed), ['agent:codex'], 'a long response that goes quiet is a finished agent turn');
// Typing in the prompt: each keystroke echoes right away, then silence.
const typing = [];
for (let t = 1; t <= 12; t++) typing.push([t * S, codex, { in: Math.min(t, 6) * S, out: Math.min(t, 6) * S + 50 }]);
assert.deepEqual(run(typing), [], 'typing echo is not a response');
assert.deepEqual(run([...streamed, [14 * S, idle, {}]]), ['agent:codex', 'command:codex'], 'quitting the agent is a finished command');
console.log('Finish notifications: command end, agent turn end, typing ignored passed');
