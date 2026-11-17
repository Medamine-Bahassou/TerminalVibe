const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../electron/usage-limits.js'), 'utf8');
let spawns = 0, used = 6;
const moduleStub = { exports: {} };
const fakeSpawn = (_bin, args) => {
  assert.deepEqual(Array.from(args), ['app-server'], 'usage requests must use account metadata without starting a model turn');
  spawns++;
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdin = new EventEmitter(); child.kill = () => {};
  child.stdin.write = line => {
    const request = JSON.parse(line);
    if (request.method === 'initialized') return;
    assert(['initialize', 'account/rateLimits/read'].includes(request.method));
    const result = request.id === 1 ? {} : { rateLimitsByLimitId: { codex: {
      primary: { usedPercent: used, windowDurationMins: 10080, resetsAt: 1893456000 },
    } } };
    queueMicrotask(() => child.stdout.emit('data', JSON.stringify({ id: request.id, result }) + '\n'));
  };
  return child;
};
vm.runInNewContext(source, {
  module: moduleStub, require: name => { assert.equal(name, 'child_process'); return { spawn: fakeSpawn }; },
  process: { platform: 'linux' }, setTimeout, clearTimeout, Date, console,
});
(async () => {
  const read = moduleStub.exports.usageLimits;
  const found = { codex: 'codex' }, env = { CODEX_HOME: '/first-account' };
  const [one, two] = await Promise.all([read(found, env, true), read(found, env, true)]);
  assert.equal(spawns, 1, 'simultaneous refreshes share a live read');
  assert.equal(one, two);
  assert.equal(one.codex.windows[0].used, 6);
  used = 9;
  assert.equal((await read(found, env)).codex.windows[0].used, 6, 'background reads may use the one-minute cache');
  assert.equal((await read(found, env, true)).codex.windows[0].used, 9, 'explicit refresh must bypass cached figures');
  used = 15;
  assert.equal((await read(found, { CODEX_HOME: '/second-account' })).codex.windows[0].used, 15, 'different CLI account directories must not share cached figures');
  assert.equal(spawns, 3);
  console.log('PASS: live quota reads, fresh refreshes, concurrent requests and account-scoped caching');
})().catch(error => { console.error(error); process.exitCode = 1; });
