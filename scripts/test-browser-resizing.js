// Isolated Electron regression: real guest resizing and browser overlay bounds.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
let win;
const timeout = setTimeout(() => { console.error('Browser resize test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1100, height: 800,
    webPreferences: { webviewTag: true, backgroundThrottling: false, offscreen: true } });
  await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'style.css'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const surfaceFactory = source.slice(source.indexOf('        function getBrowserSurface()'), source.indexOf('        function normalizeAssetUrl('));
  const sync = source.slice(source.indexOf('  function syncBrowserSlots()'), source.indexOf('   B R*OWSER TAB IFRAME'));
  const syncFunction = sync.slice(0, sync.lastIndexOf('  /*'));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const pane = document.createElement('div'); pane.id = 'pane-area';
    pane.style.cssText = 'position:absolute;inset:0;--bg:#25282d'; document.body.append(pane);
    const slot = document.createElement('div');
    slot.style.cssText = 'position:absolute;left:30px;top:50px;width:500px;height:500px'; pane.append(slot);
    const bc = document.createElement('div'); bc.className = 'browser-slot';
    bc.style.cssText = 'position:absolute;left:0;top:0;width:500px;height:500px'; pane.append(bc);
    const toolbar = document.createElement('div'); toolbar.className = 'browser-toolbar';bc.append(toolbar);
    const contentWrap = document.createElement('div'); contentWrap.className = 'browser-content';bc.append(contentWrap);
    const entry = { id:'browser', type:'browser', el:slot, browserContainer:bc, _viewCreated:true };
    const workspace = {id:'workspace', terminals:[entry]}, workspaces=[workspace], activeWsId=workspace.id;
    const activeWs = () => workspace, getWorkspaceTerminals = ws => ws.terminals;
    let settingsWindowOpen = false, nativeRect, shown = false;
    const isDesktop = () => true;
    window.electronAPI = {
      browserResize: (_id, rect) => { nativeRect = rect; },
      browserShow: () => { shown = true; }, browserHide: () => { shown = false; }
    };
    const focusSlot = () => {}, showLoading = () => {}, resumeBrowserTab = () => {};
    const syncUrl = () => {}, setBrowserHistoryTitle = () => {}, showError = () => {};
    ${syncFunction}
    ${surfaceFactory}
    syncBrowserSlots();
    const surface = getBrowserSurface();
    surface.src = 'data:text/html,' + encodeURIComponent('<html style="background:#25282d"><body style="margin:0"><div style="height:2000px">Resize fixture</div></body></html>');
    await new Promise(resolve => surface.addEventListener('dom-ready', resolve, {once:true}));
    let navigations = 0;
    surface.addEventListener('did-navigate', () => navigations++);
    await surface.executeJavaScript('window.fixtureState = 42; scrollTo(0, 180)');
    const frame = () => new Promise(resolve => setTimeout(resolve, 100));
    for (const [width, height] of [[800,600], [350,280], [920,650], [500,420]]) {
      slot.style.width = width + 'px'; slot.style.height = height + 'px';
      slot.style.left = (width / 20) + 'px';
      syncBrowserSlots();
      const expected = contentWrap.getBoundingClientRect();
      check(nativeRect.width === Math.round(expected.width) && nativeRect.height === Math.round(expected.height)
        && nativeRect.x === Math.round(expected.x) && nativeRect.y === Math.round(expected.y), 'Native bounds use stale overlay layout');
      check(shown, 'Visible browser was hidden during resizing');
      await frame();
      const inner = surface.shadowRoot.querySelector('iframe').getBoundingClientRect();
      check(Math.abs(inner.width - expected.width) < 1 && Math.abs(inner.height - expected.height) < 1, 'Guest frame leaves a gap');
      const viewport = await surface.executeJavaScript('({width:innerWidth, height:innerHeight, state:fixtureState, scroll:scrollY})');
      check(Math.abs(viewport.width - expected.width) < 1 && Math.abs(viewport.height - expected.height) < 1, 'Guest viewport did not follow split: ' + JSON.stringify({viewport, expected:{width:expected.width,height:expected.height}}));
      check(viewport.state === 42 && viewport.scroll === 180, 'Resizing lost page state');
    }
    check(navigations === 0, 'Resizing reloaded the guest');
    slot.style.display = 'none'; syncBrowserSlots(); check(!shown, 'Hidden browser remains visible');
    slot.style.display = ''; syncBrowserSlots(); check(shown, 'Browser did not restore');
    settingsWindowOpen = true; syncBrowserSlots(); check(!shown, 'Browser overlaps settings');
    return 'PASS: real webview grow/shrink, guest viewport, page state, current native bounds and visibility';
  })()`));
  clearTimeout(timeout); win.destroy(); app.quit();
}).catch(error => { console.error(error); win?.destroy(); app.exit(1); });
