// Run with node scripts/test-terminal-rendering.js. Uses an isolated, hidden
// Electron window; no app profile, backend, or interactive terminals are opened.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const result = spawnSync(require('electron'), [__filename, '--no-sandbox'], {
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
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'vendor/xterm/xterm.css'), 'utf8'));
  for (const file of ['xterm', 'xterm-addon-canvas', 'xterm-addon-webgl']) {
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, `vendor/xterm/${file}.js`), 'utf8'));
  }
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const helpers = source.slice(source.indexOf('  const _WEBGL_MAX ='), source.indexOf('  function _createTermEntry('));
  const result = await win.webContents.executeJavaScript(`(async () => {
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
  console.log(result);
  clearTimeout(timeout);
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
