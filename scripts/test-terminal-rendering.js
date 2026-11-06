// Run with node scripts/test-terminal-rendering.js. Uses an isolated, hidden
// Electron window; no app profile, backend, or interactive terminals are opened.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2), '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const timeout = setTimeout(() => { console.error('Renderer test timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'vendor/xterm/xterm.css'), 'utf8'));
  for (const file of ['xterm', 'xterm-addon-canvas', 'xterm-addon-webgl']) {
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, `vendor/xterm/${file}.js`), 'utf8'));
  }
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const helpers = source.slice(source.indexOf('  const _WEBGL_MAX ='), source.indexOf('  function _createTermEntry('));
  const result = !process.argv.includes('--layout-only') && await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const workspaces = [];
    const getWorkspaceTerminals = wsp => wsp.terminals;
    ${helpers}
    check(terminalFontFamily("'Courier New', monospace") === "'Courier New', monospace", 'Explicit Courier changed');
    check(terminalFontFamily("'Missing font', 'Courier New', monospace").includes('DejaVu Sans Mono'), 'Missing Linux fallback');
    const makeEntry = () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const term = new Terminal({ cols: 12, rows: 4, fontSize: 14, lineHeight: 1.4,
        fontFamily: 'DejaVu Sans Mono, monospace', allowTransparency: true, customGlyphs: true });
      term.open(el);
      const entry = { term };
      workspaces.push({ terminals: [entry] });
      return entry;
    };
    const write = term => new Promise(resolve => term.write('\\x1b[38;2;255;100;50m████\\r\\n████', resolve));
    const entry = makeEntry();
    const RealWebgl = WebglAddon.WebglAddon;
    WebglAddon.WebglAddon = class { constructor() { throw new Error('Simulated unavailable GPU'); } };
    _syncWebgl(entry, true);
    check(entry._webglUnavailable && entry.term._canvasAddon, 'GPU failure did not select Canvas');
    await write(entry.term);
    await new Promise(resolve => setTimeout(resolve, 100));
    const canvas = entry.term.element.querySelector('.xterm-text-layer');
    check(canvas, 'Canvas renderer did not draw');
    const dims = entry.term._core._renderService.dimensions.device.cell;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    // Full blocks must touch across both column and row boundaries, including
    // at 1.4 line height (the DOM renderer leaves font-shaped gaps here).
    for (let y = 1; y < dims.height * 2 - 1; y++) {
      for (let x = 1; x < dims.width * 4 - 1; x++) {
        const i = (y * canvas.width + x) * 4;
        check(pixels.data[i] === 255 && pixels.data[i + 1] === 100 && pixels.data[i + 2] === 50,
          'Gap in block graphics at ' + x + ',' + y);
      }
    }
    _syncWebgl(entry, false);
    _syncWebgl(entry, true);
    check(entry.term._canvasAddon && !entry.term._webglAddon, 'Failed GPU retried on tab switch');
    WebglAddon.WebglAddon = RealWebgl;
    const accelerated = [];
    for (let i = 0; i < 9; i++) {
      const next = makeEntry();
      _syncWebgl(next, true);
      check(next.term._webglAddon, 'Test WebGL context unavailable');
      accelerated.push(next);
    }
    check(!accelerated[0].term._webglAddon && accelerated[0].term._canvasAddon, 'Evicted context did not fall back');
    const last = accelerated[8];
    last.term._webglAddon._onContextLoss.fire();
    check(last._webglUnavailable && !last.term._webglAddon && last.term._canvasAddon, 'Context loss did not recover');
    await write(last.term);
    _syncWebgl(accelerated[0], true);
    check(accelerated[0].term._webglAddon && !accelerated[0].term._canvasAddon, 'Canvas did not switch back to WebGL');
    for (const wsp of workspaces) for (const t of wsp.terminals) {
      _disposeTermRenderers(t.term);
      t.term.dispose();
    }
    return 'PASS: font fallback, seamless Canvas blocks, GPU failure, context eviction/loss, renderer switching and disposal';
  })().catch(error => { throw new Error(error.stack); })`);
  if (result) console.log(result);
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'style.css'), 'utf8'));
  const sizing = source.slice(source.indexOf('  function getMinSizes('), source.indexOf('  // ── Tab bar:'));
  const buildStart = source.indexOf('  function buildNodeDom(');
  const splitBuilder = source.slice(buildStart, source.indexOf("    if (node.type === 'group') {", buildStart));
  const syncSizes = source.slice(source.indexOf('  function syncSplitSizes('), source.indexOf('  const ro = new ResizeObserver('));
  const sash = source.slice(source.indexOf('  function makeSashDraggableTree('), source.indexOf('   D R*AG AND DROP HANDLERS'));
  // The extraction ends inside the following section comment.
  const sashFunction = sash.slice(0, sash.lastIndexOf('  /*'));
  const layoutResult = await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const SPLIT_MIN_PX = 200;
    let _suppressResize = false;
    const activeWs = () => ({ layout });
    const getWorkspaceTerminals = () => [];
    const fitTerm = () => {}, saveState = () => {}, startResizing = () => {}, stopResizing = () => {};
    let browserSyncs = 0;
    const syncBrowserSlots = () => { browserSyncs++; };
    ${sizing}
    ${syncSizes}
    ${sashFunction}
    ${splitBuilder}
      const el = document.createElement('div');
      el.className = 'term-group'; el.id = 'group-' + node.id;
      applyLayoutNodeSize(el, node, parentDirection);
      return el;
    }
    const group = id => ({ type: 'group', id });
    const workerA = group('worker-a'), workerB = group('worker-b');
    const workers = { type: 'split', id: 'workers', direction: 'row', sizes: [50,50],
      size: { width: 'min', height: 'min' }, children: [workerA, workerB] };
    const layout = { type: 'split', id: 'root', direction: 'column', sizes: [50,50], children: [group('parent'), workers] };
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%' });
    document.body.appendChild(host);
    const render = () => host.replaceChildren(buildNodeDom(layout, activeWs()));
    const bounds = id => document.getElementById('group-' + id).getBoundingClientRect();
    render();
    check(bounds('worker-a').height === 200 && bounds('worker-b').height === 200, 'Bottom row is not minimum height');
    check(bounds('worker-a').left === bounds('parent').left && bounds('worker-b').right === bounds('parent').right, 'Bottom workers leave unused width');
    check(Math.abs(bounds('worker-a').width - bounds('worker-b').width) < 1, 'Bottom workers are not equal width');
    check(bounds('worker-a').right <= bounds('worker-b').left, 'Worker panes overlap');
    layout.direction = 'row'; workers.direction = 'column';
    render();
    check(bounds('worker-a').width === 200 && bounds('worker-b').width === 200, 'Side column is not minimum width');
    check(bounds('worker-a').top === bounds('parent').top && bounds('worker-b').bottom === bounds('parent').bottom, 'Side workers leave unused height');
    layout.direction = 'column'; workers.direction = 'row';
    workerA.size = { width: 300, height: 240 };
    render();
    check(bounds('worker-a').width === 300 && bounds('worker-a').height === 240, 'Live pixel size not applied');
    workerA.size = { width: 10, height: 10 };
    render();
    check(bounds('worker-a').width === 200 && bounds('worker-a').height === 200, 'Minimum size not enforced');
    const handle = document.getElementById('split-workers').querySelector('.sash');
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: bounds('worker-a').right }));
    check(!workers.size && !workerA.size, 'Manual drag did not release compact sizing');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(browserSyncs === 1, 'Browser overlay does not follow the divider in the next frame');
    document.dispatchEvent(new MouseEvent('mouseup'));
    check(bounds('worker-a').width >= 200 && bounds('worker-b').width >= 200, 'Manual drag violated pane minimums');
    // An outer divider must release explicit sizes inside the worker subtree.
    workerA.size = { height: 300 };
    workerB.size = { height: 300 };
    workers.size = { height: 'min' };
    render();
    const outerHandle = document.getElementById('split-root').querySelector(':scope > .sash');
    const before = bounds('parent');
    const beforeWorker = bounds('worker-a');
    outerHandle.dispatchEvent(new MouseEvent('mousedown', { clientY: before.bottom }));
    check(Math.abs(bounds('parent').height - before.height) < 1, 'Divider jumps on mouse-down');
    check(Math.abs(bounds('worker-a').height - beforeWorker.height) < 1, 'Workers jump on mouse-down');
    check(!workerA.size && !workerB.size && !workers.size, 'Nested size requests still lock the outer divider');
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: before.bottom + 60 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    check(Math.abs(bounds('worker-a').height - (beforeWorker.height - 60)) < 1, 'Outer divider cannot shrink explicitly sized workers');
    const draggedHeight = bounds('worker-a').height;
    render();
    check(Math.abs(bounds('worker-a').height - draggedHeight) < 1, 'Rerender restores the old locked size');
    host.style.height = '700px';
    check(bounds('worker-a').height > draggedHeight, 'Released workers do not scale with the window');
    host.remove();
    return 'PASS: nested agent sizing releases on drag without jumping, persists on rerender and scales with the window; bottom workers fill width at minimum height, side workers fill height at minimum width, legacy compact layouts, pixel resizing and manual sash override';
  })()`);
  console.log(layoutResult);
  const dropdownSetup = source.slice(source.indexOf('  function setupServersDropdown('), source.indexOf('  setupServersDropdown();'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const toolbar = html.slice(html.indexOf('  <div id="titlebar">'), html.indexOf('  <div id="app">'));
  const dropdownResult = await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, text) => { if (!ok) throw new Error(text); };
    const host = document.createElement('div'); host.innerHTML = ${JSON.stringify(toolbar)}; document.body.appendChild(host);
    document.getElementById('titlebar').classList.add('active');
    let data = [{ process: '<script>unsafe</script>', port: 3000, pid: 12, url: 'http://127.0.0.1:3000' }];
    let fail = false, hiddenViews = false, opened = null;
    window.electronAPI = { listRunningServers: async () => { if (fail) throw new Error('Test failure'); return data; } };
    const syncBrowserSlots = () => { hiddenViews = !document.getElementById('servers-dropdown').hidden; };
    const activeWs = () => ({ id: 'workspace' });
    const addBrowserTab = (ws, group, url) => { opened = { ws, url }; };
    const openExternalUrl = () => { throw new Error('Expected an internal browser tab'); };
    const procIconHtml = () => '<i class="ph ph-globe"></i>';
    ${dropdownSetup}
    setupServersDropdown();
    const button = document.getElementById('btn-servers'), dropdown = document.getElementById('servers-dropdown');
    const refresh = document.getElementById('servers-refresh');
    const settled = () => new Promise(resolve => setTimeout(resolve, 0));
    check(dropdown.hidden, 'Dropdown starts visible');
    button.click(); await settled();
    check(!dropdown.hidden && hiddenViews, 'Dropdown does not hide native browser views');
    check(button.getAttribute('aria-expanded') === 'true', 'Expanded state is missing');
    check(dropdown.querySelector('.server-name').textContent === '<script>unsafe</script>' && !dropdown.querySelector('script'), 'Process name is treated as HTML');
    dropdown.querySelector('.server-row').click();
    check(dropdown.hidden && !hiddenViews && opened.ws === 'workspace' && opened.url === 'http://127.0.0.1:3000/', 'Server did not open in an internal browser tab');
    data = []; button.click(); await settled();
    check(dropdown.querySelector('.server-row'), 'Reopening must retain cached servers');
    refresh.click(); await settled();
    check(dropdown.textContent.includes('No listening servers'), 'Missing empty state');
    fail = true; refresh.click(); await settled();
    check(dropdown.textContent.includes('No listening servers') && refresh.title.includes('Could not refresh') && !refresh.disabled, 'Refresh errors must preserve cached results and allow retry');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(dropdown.hidden && document.activeElement === button, 'Escape did not close and restore focus');
    fail = false; button.click(); await settled();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    check(dropdown.hidden, 'Outside click did not close dropdown');
    host.remove();
    return 'PASS: server dropdown toggle, native view overlay, safe labels, browser opening, empty/error/refresh states and dismissal';
  })()`);
  console.log(dropdownResult);
  clearTimeout(timeout);
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
