const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const sdk = { id: 'chat', label: 'Chat', cwd: '/project', dead: true, _sdk: { alive: true, harness: 'codex' } };
const terminal = { id: 'term', label: 'Dev server', cwd: '/project' };
const terms = [sdk, terminal], cache = new Map(), reads = [], renders = [];
const button = { isConnected: true, querySelector: () => ({}) }, workspace = { id: 'ws' };
let resolveTerminal;
const ctx = vm.createContext({
  getWorkspaceTerminals: () => terms, isLiveTerminal: t => !t.dead,
  _wsProcsCache: cache, _WS_PROCS_TTL: 900,
  harnessOf: id => ({ bin: id === 'antigravity' ? 'agy' : id }),
  checkTerminalRunning: id => { reads.push(id); return resolveTerminal ? new Promise(resolve => { resolveTerminal.push(resolve); }) : Promise.resolve('node'); },
  _isHiddenWsProc: name => !name || name === 'powershell',
  renderWsProcs: (_el, processes) => renders.push(processes), Date,
});
vm.runInContext(source.slice(source.indexOf('  function updateWorkspaceProcs('), source.indexOf('  // Enter / Ctrl+C')), ctx);
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
(async () => {
  ctx.updateWorkspaceProcs(workspace, button); await flush();
  assert.deepEqual(Array.from(renders.at(-1), p => p.name), ['codex', 'node']);
  assert.deepEqual(reads, ['term'], 'SDK agents must not rely on PTY process lookup');
  ctx.updateWorkspaceProcs(workspace, button); await flush();
  assert.equal(reads.length, 1, 'unchanged sessions reuse cached processes');
  sdk._sdk.harness = 'antigravity';
  ctx.updateWorkspaceProcs(workspace, button); await flush();
  assert.equal(renders.at(-1)[0].name, 'agy', 'harness switches invalidate the cache');
  sdk._sdk.alive = false;
  ctx.updateWorkspaceProcs(workspace, button); await flush();
  assert.deepEqual(Array.from(renders.at(-1), p => p.name), ['node'], 'stopped agents leave immediately');
  sdk._sdk.alive = true;
  cache.clear(); resolveTerminal = [];
  ctx.updateWorkspaceProcs(workspace, button);
  sdk._sdk.alive = false;
  resolveTerminal.shift()('node'); await flush();
  resolveTerminal.shift()('node'); await flush();
  assert.deepEqual(Array.from(renders.at(-1), p => p.name), ['node'], 'stale in-flight detection must not resurrect stopped agents');
  console.log('Workspace chat agent presence checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
