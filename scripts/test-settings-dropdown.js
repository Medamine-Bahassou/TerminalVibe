// Isolated Chromium layout/keyboard regression checks; never opens user sessions.
const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('about:blank');
  for (const file of ['style.css', 'workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const helper = source.slice(source.indexOf('  let closeActiveDropdown ='), source.indexOf('  // Init all custom dropdowns'));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    document.body.innerHTML = '<div id="settings-modal" style="display:block;position:fixed;inset:20px;width:700px;height:500px;overflow:hidden;transform:translateX(0)"><div class="settings-content" style="position:absolute;inset:0;overflow:auto"><div style="height:440px"></div><select id="example" hidden><option value="off">Disabled</option><option value="on">Enabled</option><option value="other" disabled>Unavailable</option></select><div class="custom-dropdown" data-for="example" style="width:160px;margin-left:500px"></div><div style="height:200px"></div></div></div>';
    ${helper}
    const dd = document.querySelector('.custom-dropdown'), select = document.querySelector('select');
    let changes = 0; select.onchange = () => changes++;
    initCustomDropdown(dd);
    let button = dd.querySelector('button'), menu = dd.querySelector('[popover]');
    button.click();
    check(menu.matches(':popover-open'), 'Menu is not in top layer');
    let anchor = button.getBoundingClientRect(), rect = menu.getBoundingClientRect();
    check(rect.bottom <= anchor.top && rect.top >= 20, 'Menu must flip above the bottom trigger');
    check(document.elementFromPoint(rect.left + 10, rect.top + 10)?.closest('[role="listbox"]') === menu, 'Menu is clipped or covered');
    dd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    check(!menu.matches(':popover-open') && document.activeElement === button, 'Escape must close and restore focus');
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    dd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    dd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    check(select.value === 'on' && changes === 1 && !menu.matches(':popover-open'), 'Keyboard selection failed');
    button.click(); document.dispatchEvent(new Event('scroll'));
    check(!menu.matches(':popover-open'), 'Scrolling parent must dismiss menu');
    // Rebuilding must dispose old handlers, not double-toggle keyboard actions.
    initCustomDropdown(dd); button = dd.querySelector('button'); menu = dd.querySelector('[popover]');
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    check(menu.matches(':popover-open') && document.activeElement.dataset.value === 'on', 'Reinitialization leaked handlers');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    check(!menu.matches(':popover-open'), 'Outside click must dismiss');
    document.querySelector('.settings-content').scrollTop = 400;
    button.click(); anchor = button.getBoundingClientRect(); rect = menu.getBoundingClientRect();
    check(rect.top >= anchor.bottom && rect.right <= 720, 'Menu must open downward when there is space');
    return 'PASS: dropdown top-layer clipping, upward/downward positioning, keyboard selection, Escape, scroll/outside dismissal and reinitialization';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
