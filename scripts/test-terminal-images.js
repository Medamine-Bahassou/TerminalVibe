// Hidden Electron rendering tests. --yazi also tests the installed Yazi over a
// real PTY with isolated configuration, without opening user terminals.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { terminalEnv } = require('../electron/terminal-env');
const root = path.join(__dirname, '..');

if (process.argv.includes('--pty-host')) {
  const dir = process.argv[process.argv.indexOf('--pty-host') + 1];
  const env = terminalEnv({ ...process.env, TERM_PROGRAM: 'kitty',
    KONSOLE_VERSION: '240000', KITTY_WINDOW_ID: '123' });
  const pty = require('node-pty').spawn('yazi', [path.join(dir, 'red.png')], {
    name: env.TERM, cols: 100, rows: 30, cwd: dir,
    env: { ...env, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, XDG_STATE_HOME: dir },
  });
  pty.onData(data => process.stdout.write(data));
  process.stdin.on('data', data => pty.write(data.toString()));
  process.stdin.on('end', () => pty.kill());
  pty.onExit(() => process.exit(0));
} else if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2), '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(result.status ?? 1);
} else {
  const { app, BrowserWindow, ipcMain } = require('electron');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  let win, child, temp;
  const finish = code => {
    child?.stdin.end();
    child?.kill();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
    win?.destroy();
    app.exit(code);
  };
  const timeout = setTimeout(() => { console.error('Image test timed out'); finish(1); }, 30000);
  app.whenReady().then(async () => {
    const assert = require('assert/strict');
    const env = terminalEnv({ PATH: '/keep', TERM_PROGRAM: 'kitty', KONSOLE_VERSION: '1',
      KITTY_WINDOW_ID: '1', VSCODE_INJECTION: '1' });
    assert.equal(env.TERM_PROGRAM, 'TerminalVibe');
    assert.equal(env.PATH, '/keep');
    for (const key of ['KONSOLE_VERSION', 'KITTY_WINDOW_ID', 'VSCODE_INJECTION']) assert.equal(env[key], undefined);
    win = new BrowserWindow({ show: false, width: 1200, height: 800,
      webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', event => {
      if (event.level === 'error') console.error('[renderer]', event.message);
    });
    await win.loadURL('about:blank');
    await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'vendor/xterm/xterm.css'), 'utf8'));
    for (const file of ['xterm', 'xterm-addon-canvas', 'xterm-addon-webgl', 'xterm-addon-image']) {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, `vendor/xterm/${file}.js`), 'utf8'));
    }
    const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const helpers = source.slice(source.indexOf('  const _WEBGL_MAX ='), source.indexOf('  function _createTermEntry('));
    const png = await win.webContents.executeJavaScript(`(async () => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      const workspaces = [];
      const getWorkspaceTerminals = wsp => wsp.terminals;
      ${helpers}
      const term = new Terminal({ cols: 100, rows: 30, allowProposedApi: true, fontSize: 14 });
      _loadTerminalImages(term);
      const entry = { term }; workspaces.push({ terminals: [entry] });
      const host = document.createElement('div'); document.body.appendChild(host);
      term.open(host); _useCanvas(entry);
      const write = data => new Promise(resolve => term.write(data, resolve));
      const delay = () => new Promise(resolve => setTimeout(resolve, 100));
      let replies = '';
      term.onData(data => { replies += data; });
      await write('\\x1b[c\\x1b[16t');
      check(replies.includes('\\x1b[?62;4;9;22c'), 'SIXEL is not advertised to Yazi');
      check(/\\x1b\\[6;[1-9]\\d*;[1-9]\\d*t/.test(replies), 'Missing cell pixel size report');
      await delay();
      // A solid red SIXEL rectangle, independent of any external converter.
      await write('\\x1bP0;1q"1;1;24;24#0;2;100;0;0#0!24~-!24~-!24~-!24~\\x1b\\\\');
      await delay();
      const hasRed = () => {
        const canvas = host.querySelector('.xterm-image-layer');
        if (!canvas) return false;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 220 && pixels[i+1] < 30 && pixels[i+2] < 30 && pixels[i+3] > 200) return true;
        }
        return false;
      };
      check(hasRed(), 'SIXEL decoded but was not painted');
      _syncWebgl(entry, true); term.refresh(0, term.rows - 1); await delay();
      check(hasRed(), 'Images disappear when switching to WebGL');
      _releaseWebgl(entry); term.refresh(0, term.rows - 1); await delay();
      check(hasRed(), 'Images disappear when falling back to Canvas');
      term.reset();
      const image = document.createElement('canvas'); image.width = image.height = 64;
      const ctx = image.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 64, 64);
      const png = image.toDataURL('image/png').split(',')[1];
      await write('\\x1b]1337;File=inline=1;size=' + atob(png).length + ';width=64px;height=64px:' + png + '\\x07');
      await delay(); check(hasRed(), 'iTerm inline image was not painted');
      term.reset(); await delay();
      check(!hasRed(), 'Reset leaves stale images');
      window.imageTest = { term, hasRed, dispose: () => { _disposeTermRenderers(term); term.dispose(); } };
      return png;
    })()`);
    console.log('PASS: terminal identity, SIXEL detection, pixel reports, SIXEL/IIP painting, renderer switching and reset');
    if (process.argv.includes('--yazi')) {
      temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-images-'));
      fs.writeFileSync(path.join(temp, 'red.png'), Buffer.from(png, 'base64'));
      ipcMain.on('image-test-input', (_event, data) => child?.stdin.write(data));
      await win.webContents.executeJavaScript(`imageTest.term.onData(data => require('electron').ipcRenderer.send('image-test-input', data)); void 0;`);
      child = spawn('node', [__filename, '--pty-host', temp], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.stderr.on('data', data => process.stderr.write(data));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        win.webContents.executeJavaScript(`imageTest.term.write(${JSON.stringify(data)})`).catch(() => {});
      });
      await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const timer = setInterval(() => {
          if (imageTest.hasRed()) { clearInterval(timer); resolve(true); }
          else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Yazi did not paint an image preview')); }
        }, 100);
      })`);
      console.log('PASS: installed Yazi displays a real PNG over a PTY despite inherited Konsole/Kitty identity');
    }
    await win.webContents.executeJavaScript('imageTest.dispose()');
    clearTimeout(timeout);
    finish(0);
  }).catch(error => { console.error(error); clearTimeout(timeout); finish(1); });
}
