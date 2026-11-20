const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const body = { innerHTML: '' };
const threadSettings = { usageDisplay: 'consumed' };
const storage = new Map();
let reads = 0;
let windows = [{ label: 'Session', used: 97 }, { label: 'Weekly', used: 23 }];
const context = vm.createContext({
  Date, Math, Object, JSON, threadSettings, body, DETACHED_ONLY: false, SETTINGS_ONLY: false,
  window: { electronAPI: { usageLimits: async () => {
    reads++;
    return { codex: { windows } };
  } } },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  harnessOf: () => ({ name: 'Codex', bin: 'codex' }), procIconHtml: () => '', escHtml: String,
});
vm.runInContext(source.slice(source.indexOf('  const fmtLeft ='), source.indexOf('  async function loadUsageModal(')), context);
vm.runInContext('_usageModal = { querySelector: selector => selector === ".um-body" ? body : null };', context);
const shows = pct => body.innerHTML.includes(`um-num">${pct}%</span>`);
(async () => {
  await context.refreshUsageLimits(true);
  assert(shows(97) && shows(23) && body.innerHTML.includes('consumed'), 'the modal shows every window, consumed');
  threadSettings.usageDisplay = 'remaining';
  context.renderUsageModal();
  assert(shows(3) && shows(77) && body.innerHTML.includes('width:3%') && body.innerHTML.includes('remaining'), 'remaining mode converts every window');
  assert.equal(reads, 1, 'changing display reuses cached limits');
  let finishOld, finishNew;
  context.window.electronAPI.usageLimits = () => new Promise(resolve => { finishOld = resolve; });
  const oldRequest = context.refreshUsageLimits(true);
  context.window.electronAPI.usageLimits = () => new Promise(resolve => { finishNew = resolve; });
  const newRequest = context.refreshUsageLimits(true, true);
  finishNew({ codex: { windows: [{ label: 'Weekly', used: 40 }] } }); await newRequest;
  finishOld({ codex: { windows: [{ label: 'Weekly', used: 1 }] } }); await oldRequest;
  assert(shows(60), 'a slow older reading must not overwrite a fresh reading');
  vm.runInContext('_usageLimits = readUsageCache(); renderUsageModal();', context);
  assert(shows(60), 'a restart must show the last saved quota before refreshing');
  context.window.electronAPI.usageLimits = async () => ({});
  await context.refreshUsageLimits(true);
  assert(shows(60), 'an empty refresh must keep the last known quota');
  context.window.electronAPI.usageLimits = async () => ({ codex: { windows: [{ label: 'Weekly', used: 25 }] } });
  await context.refreshUsageLimits(true);
  assert(shows(75), 'a successful refresh must replace the restored quota');
  assert.equal(JSON.parse(storage.get('tv-usage-limits')).codex.windows[0].used, 25);
  console.log('Usage display and restart cache checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
