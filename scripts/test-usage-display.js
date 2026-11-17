const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const sidebar = { innerHTML: '', setAttribute() {} }, body = { innerHTML: '' };
const threadSettings = { usageDisplay: 'consumed' };
let reads = 0;
const context = vm.createContext({
  Date, Math, Object, JSON, threadSettings, body, DETACHED_ONLY: false, SETTINGS_ONLY: false,
  window: { electronAPI: { usageLimits: async () => {
    reads++;
    return { codex: { windows: [{ label: 'Session', used: 97 }, { label: 'Weekly', used: 23 }] } };
  } } },
  document: { getElementById: () => sidebar },
  harnessOf: () => ({ name: 'Codex', bin: 'codex' }), procIconHtml: () => '', escHtml: String,
});
vm.runInContext(source.slice(source.indexOf('  const fmtLeft ='), source.indexOf('  async function loadUsageModal(')), context);
vm.runInContext('_usageModal = { querySelector: selector => selector === ".um-body" ? body : null };', context);
(async () => {
  await context.refreshUsageLimits(true);
  assert(sidebar.innerHTML.includes('--p:97') && sidebar.innerHTML.includes('97%'));
  assert(sidebar.innerHTML.includes('97% consumed'));
  assert(body.innerHTML.includes('97%</span>') && body.innerHTML.includes('consumed'));
  threadSettings.usageDisplay = 'remaining';
  context.renderUsageSidebar(); context.renderUsageModal();
  assert(sidebar.innerHTML.includes('--p:3') && sidebar.innerHTML.includes('3% remaining'));
  assert(sidebar.innerHTML.includes('77% remaining'), 'tooltip converts every window');
  assert(sidebar.innerHTML.includes('sb-usage-item full'), 'warnings reflect consumed quota in either mode');
  assert(body.innerHTML.includes('3%</span>') && body.innerHTML.includes('width:3%'));
  assert(body.innerHTML.includes('remaining'));
  assert.equal(reads, 1, 'changing display reuses cached limits');
  console.log('Usage display checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
