const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const tooltips = source.slice(source.indexOf('  function setupAppTooltips()'), source.indexOf("  window.addEventListener('error'"));
  const render = source.slice(source.indexOf('  function renderThreadsSidebar()'), source.indexOf("  tsList.addEventListener('click'"));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    let now = 10000;
    const Date = { now: () => now }, tsOpen = true, tsProject = null, tsSettledShown = 10, tsCollapsed = new Set();
    document.body.innerHTML = '<aside id="threads-sidebar"><input><div id="ts-list"></div></aside>';
    const tsList = document.getElementById('ts-list'), tsSearch = document.querySelector('input');
    const escHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const fmtSecs = n => n + 's', ago = ts => Math.floor((now - ts) / 1000) + 's ago';
    const projectIconHtml = () => '<i></i>', procIconHtml = () => '<i></i>', syncThreadSelection = () => {};
    const active = { w: { id: 'active', chat: {} }, title: 'Working thread', cwd: '/project', folder: 'Project', updated: 0, models: [], hs: [], work: { since: 0 } };
    const idle = { w: { id: 'idle', chat: {} }, title: 'Idle thread', cwd: '/project', folder: 'Project', updated: 0, models: [], hs: [], work: null };
    const chatThreads = () => [active, idle], threadInfo = x => x;
    ${tooltips}
    ${render}
    setupAppTooltips(); renderThreadsSidebar();
    const card = tsList.querySelector('[data-tab="active"]'), idleCard = tsList.querySelector('[data-tab="idle"]');
    const spinner = card.querySelector('.ts-spin');
    card.focus();
    card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 750));
    const tip = document.querySelector('.ui-tooltip');
    check(tip.classList.contains('show'), 'Tooltip should open');
    for (let i = 0; i < 5; i++) {
      now += 1000; renderThreadsSidebar();
      await Promise.resolve(); await Promise.resolve();
      check(card === tsList.querySelector('[data-tab="active"]') && card.isConnected, 'Countdown must preserve its hover target');
      check(tip.classList.contains('show'), 'Tooltip must stay visible during countdown ticks');
      check(card.querySelector('.ts-spin') === spinner && document.activeElement === card, 'Spinner and keyboard focus must remain stable');
    }
    check(card.querySelector('.ts-status').textContent === 'Working 15s', 'Working timer must keep updating');
    check(idleCard.querySelector('.ts-time').textContent === '15s ago', 'Idle age must also update without rebuilding');
    active.title = 'Renamed thread'; renderThreadsSidebar();
    check(tsList.querySelector('[data-tab="active"] .ts-title').textContent === 'Renamed thread', 'Real content changes must still render');
    return 'PASS: countdown updates preserve hovered tooltip, card identity, spinner, focus and idle ages';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
