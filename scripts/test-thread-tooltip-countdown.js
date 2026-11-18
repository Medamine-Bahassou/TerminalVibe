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
  const projectKeys = source.slice(source.indexOf('  function normalizeThreadProjectPath('), source.indexOf("  // A project's own icon"));
  const render = source.slice(source.indexOf('  function renderThreadsSidebar()'), source.indexOf("  tsList.addEventListener('click'"));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    let now = 10000;
    const Date = { now: () => now }, tsOpen = true, tsLayout = { value: 'status' };
    const tsSettledShown = new Map(), tsCollapsed = new Map();
    document.body.innerHTML = '<aside id="threads-sidebar"><input><div id="ts-list"></div></aside>';
    const tsList = document.getElementById('ts-list'), tsSearch = document.querySelector('input');
    const escHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const fmtSecs = n => n + 's', ago = ts => Math.floor((now - ts) / 1000) + 's ago';
    const projectIconHtml = () => '<i></i>', procIconHtml = () => '<i></i>', syncThreadSelection = () => {};
    const active = { w: { id: 'active', chat: {} }, title: 'Working thread', cwd: '/project', folder: 'Project', updated: 0, models: [], hs: [], work: { since: 0 } };
    const idle = { w: { id: 'idle', chat: {} }, title: 'Idle thread', cwd: '/project', folder: 'Project', updated: 0, models: [], hs: [], work: null };
    const threads = [active, idle];
    const chatThreads = () => threads, threadInfo = x => x;
    const localStorage = { getItem: () => '/project/' };
    ${projectKeys}
    check(tsProject === '/project', 'Previously saved project filters should match the normalized path');
    tsProject = null;
    ${tooltips}
    ${render}
    setupAppTooltips(); renderThreadsSidebar();
    const card = tsList.querySelector('[data-tab="active"]'), idleCard = tsList.querySelector('[data-tab="idle"]');
    check(idleCard.querySelector('.ts-folder')?.textContent === 'Project', 'Status cards show the project name');
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
    check(!idleCard.querySelector('.ts-status.done'), 'An idle thread has no completion badge');
    idle.w.chat.unseenCompletion = true; renderThreadsSidebar();
    const done = tsList.querySelector('[data-tab="idle"] .ts-status.done');
    check(done?.textContent === 'Done' && done.querySelector('.ph-check-circle') && done.nextElementSibling.matches('.ts-time'), 'Unseen completion shows a check icon and label beside the age');
    delete idle.w.chat.unseenCompletion; renderThreadsSidebar();
    check(!tsList.querySelector('.ts-status.done'), 'A seen completion clears the badge');
    active.title = 'Renamed thread'; renderThreadsSidebar();
    check(tsList.querySelector('[data-tab="active"] .ts-title').textContent === 'Renamed thread', 'Real content changes must still render');
    const settled = Array.from({ length: 12 }, (_, i) => ({
      ...idle, cwd: '/project/', w: { id: 'settled-' + i, chat: { settledAt: 100 } }, updated: i,
    }));
    threads.push(...settled, {
      ...idle, w: { id: 'scratch', chat: { settledAt: 100 } }, cwd: '', folder: 'No project',
    });
    renderThreadsSidebar();
    check(tsList.querySelector('[data-sec="settled"] .ts-section-head').getAttribute('aria-expanded') === 'false', 'By Status keeps its collapsed Settled shelf');

    tsLayout.value = 'project';
    renderThreadsSidebar();
    const project = tsList.firstElementChild;
    const cards = Array.from(project.querySelectorAll(':scope > .ts-cards > .ts-card'));
    check(cards.length === 14 && !project.querySelector('.ts-section, .ts-more'), 'All project threads should be listed directly under the project');
    check(cards[0].dataset.tab === 'settled-11', 'Project threads should be ordered by latest activity');
    check(tsList.children.length === 2, 'Project paths with and without a trailing slash should share one group');
    check(cards.every(card => !card.matches('.slim') && !card.querySelector('.ts-act')), 'Project cards use the full style with no Settle or Un-settle action');
    check(project.querySelector('.ts-project-name')?.textContent === 'Project' && cards.every(card => !card.querySelector('.ts-folder')), 'Only the project header shows the project name and icon');
    check(cards[0].querySelector('.ts-title').parentElement === cards[0].querySelector('.ts-time').closest('.ts-row'), 'Project thread titles share a row with the timestamp');
    check(cards.some(card => card.dataset.tab === 'active'), 'Project cards preserve working threads');
    check(tsList.lastElementChild.querySelector(':scope > .ts-cards > [data-tab="scratch"]'), 'Settled threads without a project should be listed directly too');
    return 'PASS: thread countdown stability, status shelves and flat project groups';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
