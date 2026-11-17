const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const agent = { id: 'agent', label: 'Codex chat', dead: true, _sdk: { alive: true, harness: 'codex' } };
const terms = [agent, { id: 'other' }], ws = { id: 'ws', layout: {} };
let confirm, closures = 0, checked = [];
const starting = new Map();
const agents = new Map();
const ctx = vm.createContext({
  _multiSelected: new Set(), _processCheckPending: new Set(), _closeLockConfirmed: new Set(), _chatStarting: starting, _tabAgent: agents,
  findWs: () => ws, getWorkspaceTerminals: () => terms,
  isLiveTerminal: t => !!t && !t.dead, browserHasContent: () => false,
  harnessOf: () => ({ name: 'Codex' }),
  checkTerminalRunning: async (id, fresh) => { checked.push({ id, fresh }); return 'node'; },
  dontAskAgain: key => key === 'closeprocess', // Legacy saved opt-out must never bypass a busy-tab confirmation.
  showCloseConfirm: (_name, _last, accept, cancel) => { confirm = { accept, cancel }; },
  findGroupContainingTerm: () => { closures++; return null; },
  beginTabClose: () => () => {},
});
vm.runInContext(source.slice(source.indexOf('  async function runningTabProcess('), source.indexOf('  async function closeTabs('))
  + source.slice(source.indexOf('  function removeTerminal('), source.indexOf('  function applyTabColor(')), ctx);
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
(async () => {
  ctx.removeTerminal('ws', 'agent'); await flush();
  assert(confirm, 'SDK chat agents must require confirmation even without a live PTY');
  assert.equal(closures, 0, 'closing must wait for confirmation');
  assert.equal(checked.length, 0, 'SDK agents must not depend on terminal process checks');
  confirm.cancel(); assert.equal(closures, 0);
  ctx.removeTerminal('ws', 'agent'); await flush(); confirm.accept();
  assert.equal(closures, 1, 'confirmation allows closing');
  agent._sdk.alive = false; starting.set(agent.id, {}); confirm = null;
  ctx.removeTerminal('ws', 'agent'); await flush();
  assert(confirm, 'an agent starting up must also require confirmation');
  starting.clear(); agent.dead = false; confirm = null;
  ctx.removeTerminal('ws', 'agent'); await flush();
  assert(confirm, 'PTY processes must require confirmation');
  assert.equal(checked.at(-1).fresh, true, 'closing must bypass stale process caches');
  for (const harness of ['claude', 'antigravity', 'codex']) {
    agents.set(agent.id, harness); confirm = null;
    ctx.checkTerminalRunning = async () => null;
    ctx.removeTerminal('ws', 'agent'); await flush();
    assert(confirm, harness + ' must confirm even when backend process lookup reports idle');
    confirm.cancel();
  }
  agents.clear(); agent.threadHistory = true; agent._chatShellUnused = true;
  agent.dead = false; agent._sdk.alive = false; confirm = null;
  const beforeClose = closures;
  ctx.checkTerminalRunning = () => { throw Error('untouched chat must not wait for a process scan'); };
  ctx.removeTerminal('ws', 'agent'); await flush();
  assert.equal(closures, beforeClose + 1, 'untouched chats close without a backend process scan');
  assert.equal(confirm, null, 'untouched chats do not need a process confirmation');
  agent._sdk.alive = true;
  ctx.removeTerminal('ws', 'agent'); await flush();
  assert(confirm, 'live SDK sessions still confirm in an untouched chat');
  confirm.cancel(); agent._sdk.alive = false;
  agent._cliView = true; confirm = null;
  let scanned = false;
  ctx.checkTerminalRunning = async () => { scanned = true; return 'node'; };
  ctx.removeTerminal('ws', 'agent'); await flush();
  assert(scanned && confirm, 'exposed chat terminals still check and confirm running processes');
  confirm.cancel();
  agent._cliView = false; delete agent._chatShellUnused; scanned = false; confirm = null;
  ctx.removeTerminal('ws', 'agent'); await flush();
  assert(scanned && confirm, 'returning to chat after using the terminal must retain process checks');
  confirm.cancel();
  let modalKey;
  ctx.showDangerConfirm = (_title, _message, _ok, _accept, _cancel, key) => { modalKey = key; };
  ctx.escHtml = String;
  vm.runInContext(source.slice(source.indexOf('  function showCloseConfirm('), source.indexOf('  // Shared destructive-style confirmation')), ctx);
  ctx.showCloseConfirm('Agent', false, () => {}, () => {});
  assert.equal(modalKey, undefined, 'running-process modal must not offer a persistent opt-out');
  console.log('PASS: live SDK, starting agents and PTY processes require confirmation; cancel preserves tabs');
})().catch(error => { console.error(error); process.exitCode = 1; });
