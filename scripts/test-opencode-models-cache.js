// OpenCode's model catalog is cached per folder, restored on startup and refreshed when stale.
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
    setTimeout: fn => { fn(); return 0; },
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
  assert.ok(fresh.store['tv-opencode-models-v2'], 'the catalog must be persisted');
  const restored = context(fresh.store);
  assert.equal(vm.runInContext(`chatModels('opencode', { cwd: ${JSON.stringify(cwd)} }).length`, restored.ctx), 2, 'a restart must restore the cached models');
  await vm.runInContext(`loadOpenCodeModels('/bin/opencode', ${JSON.stringify(cwd)})`, restored.ctx);
  assert.deepEqual(restored.calls, [cwd], 'a restored catalog is refreshed');
  await vm.runInContext(`loadOpenCodeModels('/bin/opencode', ${JSON.stringify(cwd)})`, restored.ctx);
  assert.deepEqual(restored.calls, [cwd], 'a fresh catalog is not re-probed');
  const other = context();
  let attempts = 0;
  other.ctx.window.electronAPI.chatSdkModels = async () => { attempts++; throw Error('offline'); };
  assert.equal(await vm.runInContext(`loadOpenCodeModels('/bin/opencode', ${JSON.stringify(cwd)})`, other.ctx), null);
  assert.equal(attempts, 2, 'a failed probe is retried once');
  assert.equal(vm.runInContext(`openCodeCatalogs.has(${JSON.stringify(cwd)})`, other.ctx), false, 'a failed probe must not be cached');
  // A chat with no folder still probes: the main process falls back to the home directory.
  const noFolder = context();
  assert.ok(await vm.runInContext(`loadOpenCodeModels('/bin/opencode', '')`, noFolder.ctx), 'a chat without a cwd must still load models');
  assert.deepEqual(noFolder.calls, [''], 'the probe is sent even when the cwd is empty');
  console.log('PASS: OpenCode models are cached per folder, restored on startup, refreshed when stale, retried on failure and loaded without a cwd.');
})().catch(error => { console.error(error); process.exitCode = 1; });
