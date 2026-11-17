const assert = require('node:assert/strict');
const { finishStep } = require('../electron/finish-notify');

// Drive one terminal through [now, info, io] ticks → the "kind:name" events.
const run = ticks => {
  const cur = { wasBusy: false, name: null, agentSince: 0 };
  return ticks.map(([now, info, io]) => finishStep(cur, info, io, now)).filter(Boolean).map(e => `${e.kind}:${e.name}`);
};
const S = 1000, idle = { running: false, name: null }, codex = { running: true, name: 'codex' }, npm = { running: true, name: 'npm' };
const runningCommand = { hasCommand: true };
const awk = { running: true, name: 'awk' };

assert.deepEqual(run([[0, npm, runningCommand], [S, idle, runningCommand]]), ['command:npm'], 'explicit commands notify even without input');
assert.deepEqual(run([[S, awk, { out: S }], [2 * S, idle, { in: 2 * S }]]), [], 'shell startup helpers and incidental input never notify');
assert.deepEqual(run([[S, awk, {}], [2 * S, idle, {}], [3 * S, npm, runningCommand], [4 * S, idle, runningCommand]]), ['command:npm'], 'the first submitted command still notifies');
assert.deepEqual(run([[0, idle, {}], [S, idle, {}]]), [], 'idle shell never notifies');
// A 2s Codex reply (Enter at 1s, output until 3s) still counts.
assert.deepEqual(run([1, 2, 3, 4, 5, 6].map(t => [t * S, codex, { ...runningCommand, in: S, out: Math.min(t, 3) * S }])), ['agent:codex'], 'short replies notify');
// Enter at 1s, Codex streams until 9s, then quiet → one agent event.
const streamed = [];
for (let t = 1; t <= 13; t++) streamed.push([t * S, codex, { ...runningCommand, in: S, out: Math.min(t, 9) * S }]);
assert.deepEqual(run(streamed), ['agent:codex'], 'a long response that goes quiet is a finished agent turn');
// Typing in the prompt: each keystroke echoes right away, then silence.
const typing = [];
for (let t = 1; t <= 12; t++) typing.push([t * S, codex, { ...runningCommand, in: Math.min(t, 6) * S, out: Math.min(t, 6) * S + 50 }]);
assert.deepEqual(run(typing), [], 'typing echo is not a response');
assert.deepEqual(run([...streamed, [14 * S, idle, runningCommand]]), ['agent:codex', 'command:codex'], 'quitting the agent is a finished command');
console.log('Finish notifications: command end, agent turn end, typing ignored passed');
