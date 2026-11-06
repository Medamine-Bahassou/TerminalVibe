// Exercise native-tooltip suppression and styled-tooltip timing in real Chromium.
const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const helper = source.slice(source.indexOf('  function setupAppTooltips()'), source.indexOf("  window.addEventListener('error'"));
  await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '../workspace.css'), 'utf8'));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    let now = 0, sequence = 0;
    const timers = new Map(), Date = { now: () => now };
    const setTimeout = (fn, delay) => { timers.set(++sequence, { fn, due:now + delay }); return sequence; };
    const clearTimeout = id => timers.delete(id);
    const advance = ms => { now += ms; for (const [id, task] of [...timers]) if (task.due <= now) { timers.delete(id); task.fn(); } };
    document.title = 'App title';
    document.body.innerHTML = '<div id="tab" title="animecopy"><button id="close" title="Close"><span>×</span></button></div><button id="icon" title="Settings"></button><svg><title>Expand</title></svg>';
    ${helper}
    setupAppTooltips();
    const tab = document.getElementById('tab'), close = document.getElementById('close'), icon = document.getElementById('icon');
    const tip = document.querySelector('.ui-tooltip');
    const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
    const hover = el => el.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
    check(!document.querySelector('[title]'), 'Initial titles were not removed');
    check(!document.querySelector('svg title') && document.querySelector('svg').getAttribute('aria-label') === 'Expand', 'SVG native tooltip remains');
    check(icon.getAttribute('aria-label') === 'Settings', 'Accessible icon label was lost');
    hover(close.firstElementChild); advance(699);
    check(!tip.classList.contains('show'), 'Tooltip ignored hover-intent delay');
    advance(1); check(tip.classList.contains('show') && tip.textContent === 'Close', 'Styled tooltip did not appear');
    check(!tab.hasAttribute('title') && !close.hasAttribute('title'), 'Ancestor native tooltip remains behind child tooltip');
    tab.title = 'New title'; await settle();
    check(tab.dataset.tip === 'New title' && !tab.hasAttribute('title'), 'Dynamic tab title reintroduced native tooltip');
    close.dispatchEvent(new MouseEvent('mouseout', { bubbles:true, relatedTarget:tab }));
    hover(tab); advance(100);
    check(tip.textContent === 'New title' && tip.classList.contains('show'), 'Adjacent tooltip lost warm delay');
    tab.dispatchEvent(new MouseEvent('mousedown', { bubbles:true })); advance(1000);
    check(!tip.classList.contains('show') && !document.querySelector('[title]'), 'Click restored a native title');
    window.dispatchEvent(new Event('blur'));
    check(!document.querySelector('[title]'), 'Blur restored native titles');
    const button = document.createElement('button'); button.title = 'Dynamic control'; document.body.append(button);
    await settle(); check(button.dataset.tip === 'Dynamic control' && !button.hasAttribute('title'), 'New controls were not normalized');
    hover(button); advance(700); check(tip.textContent === 'Dynamic control' && tip.classList.contains('show'), 'Dynamic styled tooltip failed');
    button.title = 'Updated control'; await settle(); check(tip.textContent === 'Updated control' && !button.hasAttribute('title'), 'Visible tooltip did not update');
    button.title = ''; await settle(); check(!tip.classList.contains('show'), 'Cleared tooltip remains visible');
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'title'); node.textContent = 'Later SVG title'; document.querySelector('svg').append(node);
    await settle(); check(!document.querySelector('svg title'), 'Dynamically added SVG title remains');
    check(document.title === 'App title', 'Document title was changed');
    check(document.querySelectorAll('.ui-tooltip').length === 1, 'Duplicate styled tooltips');
    const row = document.createElement('button'); row.className = 'session-row';
    row.style.cssText = 'position:fixed;left:10px;top:100px;width:260px;height:30px';
    const fullText = 'A full Claude session title that is much longer than the history row and must remain readable in its entirety. ' + 'LongUnbrokenText'.repeat(10) + '\\nSession date\\nClick to resume';
    row.title = fullText; document.body.append(row); await settle();
    hover(row); advance(700);
    check(tip.classList.contains('session-tooltip') && tip.textContent === fullText, 'Session tooltip lost full text');
    const bounds = tip.getBoundingClientRect(), rowBounds = row.getBoundingClientRect();
    check(bounds.left >= rowBounds.right + 5 && Math.abs(bounds.top - rowBounds.top) <= 1, 'Session tooltip must appear to the right of the row');
    check(bounds.height > 32 && tip.scrollWidth <= tip.clientWidth, 'Session tooltip must wrap full text without horizontal clipping');
    check(bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Session tooltip escaped viewport');
    hover(icon); advance(100);
    check(!tip.classList.contains('session-tooltip'), 'Session tooltip styling leaked to other controls');
    return 'PASS: native title/ancestor/SVG suppression, dynamic controls and updates, accessibility, hover delay, adjacent delay, dismissal and document title preservation';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
