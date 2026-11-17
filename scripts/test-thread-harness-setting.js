const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const select = { options: [], value: '', replaceChildren(...options) { this.options = options; }, add(option) { this.options.push(option); } };
let resolve;
const ctx = vm.createContext({
  document: { getElementById: () => select, querySelector: () => null },
  Option: function(text, value) { Object.assign(this, { text, value, dataset: {} }); },
  THREAD_HARNESSES: [{ id: 'claude', name: 'Claude Code', bin: 'claude' }, { id: 'codex', name: 'Codex', bin: 'codex' }],
  CHAT_AGENTS: { claude: {}, codex: {} }, _chatAgentsFound: null,
  threadSettings: { harness: 'codex' },
  loadChatAgents: () => new Promise(r => { resolve = r; }),
});
vm.runInContext(source.slice(source.indexOf('  function refreshThreadHarnessSetting('), source.indexOf('  function openSettings(cat)')), ctx);
(async () => {
  ctx.refreshThreadHarnessSetting();
  assert.equal(select.options.length, 1, 'no unverified agents while detection is pending');
  resolve({ found: { claude: null, codex: '/usr/bin/codex' } });
  await Promise.resolve();
  assert.deepEqual(select.options.map(o => o.value), ['', 'codex']);
  assert.equal(select.options[1].dataset.agent, 'codex', 'installed option carries its brand identity');
  assert.equal(select.value, 'codex', 'saved installed agent stays selected');
  ctx.threadSettings.harness = 'claude';
  ctx._chatAgentsFound = { codex: '/usr/bin/codex' };
  ctx.refreshThreadHarnessSetting();
  assert.equal(select.value, '', 'uninstalled saved agent falls back to Last used');
  assert.equal(ctx.threadSettings.harness, 'claude', 'rendering does not overwrite saved preferences');
  console.log('Installed thread agent setting checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
