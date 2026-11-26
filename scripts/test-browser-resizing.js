// Isolated Electron regression: real guest resizing and browser overlay bounds.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(result.status ?? 1);
}
const { app, BaseWindow, BrowserWindow, WebContentsView, webContents } = require('electron');
let win;
const timeout = setTimeout(() => { console.error('Browser resize test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1100, height: 800,
    webPreferences: { webviewTag: true, backgroundThrottling: false, offscreen: true } });
  await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'style.css'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const faviconHelpers = source.slice(source.indexOf('  function syncBrowserTabIcon('), source.indexOf('  function addBrowserTab('));
  const surfaceFactory = source.slice(source.indexOf('        function getBrowserSurface()'), source.indexOf('        function normalizeAssetUrl('));
  const historyDrawer = source.slice(source.indexOf('  function toggleBrowserHistoryDrawer('), source.indexOf('  // ── Snippets'));
  const sync = source.slice(source.indexOf('  function syncBrowserSlots()'), source.indexOf('   B R*OWSER TAB IFRAME'));
  const syncFunction = sync.slice(0, sync.lastIndexOf('  /*'));
  const pageId = await win.webContents.executeJavaScript(`(async () => {
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
    let browserMoreOpen = false, browserModalOpen = false, devToolsBounds;
    const isDesktop = () => true;
    window.electronAPI = {
      browserResize: (_id, rect) => { nativeRect = rect; },
      browserShow: () => { shown = true; }, browserHide: () => { shown = false; },
      browserDevToolsBounds: (_id, rect) => { devToolsBounds = rect; },
    };
    const focusSlot = () => {}, showLoading = () => {}, resumeBrowserTab = () => {};
    const syncUrl = () => {}, setBrowserHistoryTitle = () => {}, showError = () => {};
    ${syncFunction}
    ${faviconHelpers}
    ${surfaceFactory}
    syncBrowserSlots();
    const surface = getBrowserSurface();
    surface.src = 'data:text/html,' + encodeURIComponent('<html style="background:#25282d"><body style="margin:0"><div style="height:2000px">Resize fixture</div></body></html>');
    await new Promise(resolve => surface.addEventListener('dom-ready', resolve, {once:true}));
    const tab = document.createElement('div'); tab.className = 'tg-tab'; tab.dataset.termid = entry.id;
    tab.innerHTML = '<span class="tg-tab-icon"></span>'; document.body.append(tab);
    const favicon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>');
    surface.dispatchEvent(Object.assign(new Event('page-favicon-updated'), { favicons: [favicon] }));
    check(tab.querySelector('img')?.src === favicon, 'Website favicon did not reach tab');
    syncBrowserTabIcon(entry, tab);
    check(tab.querySelector('img')?.src === favicon, 'Tab redraw lost website favicon');
    surface.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://example.test' }));
    check(!tab.querySelector('img') && tab.querySelector('svg'), 'Navigation retained previous website icon');
    surface.dispatchEvent(Object.assign(new Event('page-favicon-updated'), { favicons: [favicon] }));
    tab.querySelector('img').dispatchEvent(new Event('error'));
    check(!tab.querySelector('img') && tab.querySelector('svg'), 'Broken icon did not fall back to globe');
    setBrowserTabFavicon(entry, ['javascript:alert(1)']);
    check(!entry._favicon, 'Invalid favicon URL accepted');
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
    const loadBrowserHistory = () => [];
    ${historyDrawer}
    toggleBrowserHistoryDrawer(entry, contentWrap);
    const drawer = contentWrap.querySelector('.browser-history-drawer');
    const slide = drawer.getAnimations()[0];
    slide.currentTime = 90;
    toggleBrowserHistoryDrawer(entry, contentWrap);
    check(drawer.inert && slide.currentTime === 90, 'Closing jumped from the opening position');
    toggleBrowserHistoryDrawer(entry, contentWrap);
    check(!drawer.inert && contentWrap.querySelectorAll('.browser-history-drawer').length === 1,
      'Reopening did not reuse the closing drawer');
    toggleBrowserHistoryDrawer(entry, contentWrap);
    await slide.finished;
    await frame();
    check(!drawer.isConnected, 'History drawer remained after closing');
    settingsWindowOpen = false;
    entry._devtools = { dock: 'right', el: contentWrap };
    watchBrowserModalLayers();
    syncBrowserSlots();
    check(devToolsBounds?.width, 'Docked DevTools must start visible');
    const dialog = document.createElement('dialog');
    const prompt = document.createElement('div'); prompt.id = 'prompt-overlay';
    document.body.append(dialog, prompt);
    dialog.showModal();
    await Promise.resolve();
    check(devToolsBounds === null, 'Native DevTools must stay behind a dialog');
    prompt.classList.add('open');
    dialog.close();
    await Promise.resolve();
    check(devToolsBounds === null, 'Closing one dialog must leave the other unobstructed');
    prompt.classList.remove('open');
    await Promise.resolve();
    check(devToolsBounds?.width, 'DevTools must return after the last dialog closes');
    return surface.getWebContentsId();
  })()`);
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const handlers = {};
  const register = (channel, handler) => { handlers[channel] = handler; };
  const views = new Function('ipcMain', 'BaseWindow', 'BrowserWindow', 'WebContentsView', 'webContents',
    main.slice(main.indexOf('const devtoolsViews ='), main.indexOf('// A browser tab\'s right-click menu'))
      + '\nreturn devtoolsViews;')({ handle: register, on: register }, BaseWindow, BrowserWindow, WebContentsView, webContents);
  const event = { sender: win.webContents };
  const page = webContents.fromId(pageId);
  const dock = placement => handlers['browser:devtools'](event, pageId, true, placement);
  const opened = new Promise(resolve => page.once('devtools-opened', resolve));
  dock('bottom');
  await opened;
  const { view } = views.get(pageId);
  win.showInactive();
  handlers['browser:devtools-bounds'](event, pageId, { x: 0, y: 0, width: 460, height: 320 });
  await new Promise(resolve => setTimeout(resolve, 150));
  const capturing = handlers['browser:devtools-preview'](event, pageId);
  handlers['browser:devtools-bounds'](event, pageId, null);
  const preview = await capturing;
  assert.match(preview || '', /^data:image\/png;base64,/, 'Docked DevTools must supply a background preview');
  for (const placement of ['left', 'right', 'external', 'bottom']) {
    dock(placement);
    const state = views.get(pageId);
    assert.equal(state.view, view, 'Moving DevTools replaced the debugging session');
    assert.equal(state.host === win, placement !== 'external');
  }
  dock('external');
  const closed = new Promise(resolve => page.once('devtools-closed', resolve));
  views.get(pageId).external.close();
  await closed;
  assert.equal(views.has(pageId), false, 'Closing the external window left DevTools registered');
  console.log('PASS: webview sizing, page state, tab favicons, history reversal, DevTools docking and modal layering');
  clearTimeout(timeout); win.destroy(); app.quit();
}).catch(error => { console.error(error); win?.destroy(); app.exit(1); });
