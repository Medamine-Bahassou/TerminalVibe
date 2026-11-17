const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const sidebar = { innerHTML: '', setAttribute() {}, classList: { contains: () => false, remove() {}, toggle() {} } }, body = { innerHTML: '' };
const threadSettings = { usageDisplay: 'consumed' };
let reads = 0;
let windows = [{ label: 'Session', used: 97 }, { label: 'Weekly', used: 23 }];
const context = vm.createContext({
  Date, Math, Object, JSON, threadSettings, body, DETACHED_ONLY: false, SETTINGS_ONLY: false,
  window: { electronAPI: { usageLimits: async () => {
    reads++;
    return { codex: { windows } };
  } } },
  document: { getElementById: () => sidebar },
  harnessOf: () => ({ name: 'Codex', bin: 'codex' }), procIconHtml: () => '', escHtml: String,
});
vm.runInContext(source.slice(source.indexOf('  const fmtLeft ='), source.indexOf('  async function loadUsageModal(')), context);
vm.runInContext('_usageModal = { querySelector: selector => selector === ".um-body" ? body : null };', context);
(async () => {
  await context.refreshUsageLimits(true);
  assert(sidebar.innerHTML.includes('--p:23') && sidebar.innerHTML.includes('23%'));
  assert(sidebar.innerHTML.includes('97% consumed'));
  assert(body.innerHTML.includes('97%</span>') && body.innerHTML.includes('consumed'));
  threadSettings.usageDisplay = 'remaining';
  context.renderUsageSidebar(); context.renderUsageModal();
  assert(sidebar.innerHTML.includes('--p:77') && sidebar.innerHTML.includes('77% remaining'));
  assert(sidebar.innerHTML.includes('77% remaining'), 'tooltip converts every window');
  assert(!sidebar.innerHTML.includes('sb-usage-item full'), 'warnings reflect the displayed weekly quota');
  assert(body.innerHTML.includes('3%</span>') && body.innerHTML.includes('width:3%'));
  assert(body.innerHTML.includes('remaining'));
  assert.equal(reads, 1, 'changing display reuses cached limits');
  windows = [{ label: 'Session', used: 2 }, { label: 'Weekly', used: 97 }];
  threadSettings.usageDisplay = 'consumed';
  await context.refreshUsageLimits(true);
  assert(sidebar.innerHTML.includes('--p:97"') && sidebar.innerHTML.includes('sb-usage-pct">97%'), 'sidebar must show weekly usage even when session usage is lower');
  assert(sidebar.innerHTML.includes('Session: 2% consumed') && sidebar.innerHTML.includes('Weekly: 97% consumed'), 'tooltip must identify the displayed window and retain weekly limits');
  assert(sidebar.innerHTML.includes('sb-usage-item full'), 'ring warnings must match the displayed weekly quota');
  threadSettings.usageDisplay = 'remaining'; context.renderUsageSidebar();
  assert(sidebar.innerHTML.includes('--p:3"') && sidebar.innerHTML.includes('sb-usage-pct">3%'), 'remaining mode must show remaining weekly quota');
  windows = [{ label: 'Weekly · Opus', used: 100, mins: 10080 }, { label: 'Weekly', used: 15, mins: 10080 }, { label: 'Session', used: 90, mins: 300 }];
  threadSettings.usageDisplay = 'consumed';
  await context.refreshUsageLimits(true);
  assert(sidebar.innerHTML.includes('--p:15"'), 'shared weekly quota takes precedence over model-specific weekly limits');
  threadSettings.usageDisplay = 'remaining';
  windows = [{ label: 'Model A', used: 5 }, { label: 'Model B', used: 70 }];
  await context.refreshUsageLimits(true);
  assert(sidebar.innerHTML.includes('Model B: 30% remaining'), 'model-only providers must identify their selected model window');
  let finishOld, finishNew;
  context.window.electronAPI.usageLimits = () => new Promise(resolve => { finishOld = resolve; });
  const oldRequest = context.refreshUsageLimits(true);
  context.window.electronAPI.usageLimits = () => new Promise(resolve => { finishNew = resolve; });
  const newRequest = context.refreshUsageLimits(true, true);
  finishNew({ codex: { windows: [{ label: 'Weekly', used: 40 }] } }); await newRequest;
  finishOld({ codex: { windows: [{ label: 'Weekly', used: 1 }] } }); await oldRequest;
  assert(sidebar.innerHTML.includes('--p:60"'), 'a slow older reading must not overwrite a fresh reading');
  console.log('Usage display checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
