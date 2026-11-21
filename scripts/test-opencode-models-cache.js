// OpenCode's model catalog is cached per folder, restored on startup and fetched only once.
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const cache = source.slice(source.indexOf("  // OpenCode's catalog comes from"), source.indexOf('  const chatAgentIds ='));
function context(store = {}) {
  const calls = [];
  const api = {
    chatSdkModels: async (_harness, _bin, cwd) => { calls.push(cwd); return [{ id: 'opencode/model-' + cwd, name: 'Model', efforts: ['default'] }]; },
  };
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => store[k] ?? null,
      setItem: (k, v) => { store[k] = v; },
    },
    window: { electronAPI: api },
    curChat: () => null, chatCwd: tab => tab?.cwd || '', syncThreadComposer: () => {},
  });
  vm.runInContext(cache, ctx);
  return { ctx, calls, store };
}
(async () => {
  const cwd = '/tmp/project';
  const fresh = context();
  assert.equal(vm.runInContext(`chatModels('opencode', { cwd: ${JSON.stringify(cwd)} }).length`, fresh.ctx), 1, 'default model only before the probe');
  await Promise.all([
    vm.runInContext(`loadOpenCodeModels('/bin/opencode', ${JSON.stringify(cwd)})`, fresh.ctx),
    vm.runInContext(`loadOpenCodeModels('/bin/opencode', ${JSON.stringify(cwd)})`, fresh.ctx),
  ]);
  assert.deepEqual(fresh.calls, [cwd], 'concurrent loads must share one probe');
  assert.equal(vm.runInContext(`chatModels('opencode', { cwd: ${JSON.stringify(cwd)} }).length`, fresh.ctx), 2);
  assert.ok(fresh.store['tv-opencode-models'], 'the catalog must be persisted');
  const restored = context(fresh.store);
  assert.equal(vm.runInContext(`chatModels('opencode', { cwd: ${JSON.stringify(cwd)} }).length`, restored.ctx), 2, 'a restart must restore the cached models');
  await vm.runInContext(`loadOpenCodeModels('/bin/opencode', ${JSON.stringify(cwd)})`, restored.ctx);
  assert.deepEqual(restored.calls, [], 'a cached folder must never re-probe');
  const other = context();
  other.ctx.window.electronAPI.chatSdkModels = async () => { throw Error('offline'); };
  assert.equal(await vm.runInContext(`loadOpenCodeModels('/bin/opencode', ${JSON.stringify(cwd)})`, other.ctx), null);
  assert.equal(vm.runInContext(`openCodeCatalogs.has(${JSON.stringify(cwd)})`, other.ctx), false, 'a failed probe must not be cached');
  console.log('PASS: OpenCode models are cached per folder, restored on startup and probed once.');
})().catch(error => { console.error(error); process.exitCode = 1; });
