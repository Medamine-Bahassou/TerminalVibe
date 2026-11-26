// The real app boots past its splash screen: start electron/main.js as `electron .` does (dist/index.html)
// and fail on any renderer error during startup. app.js sets its liveness flag on its first line, so a throw
// later in its top-level code (for example a `let` used before its declaration) leaves the splash up forever
// without tripping index.html's boot watchdog: only a real boot shows it.
// Unpackaged, main.js loads the dev server (as `npm run electron:dev`), so this starts it too.
// Uses its own config folder, never your ~/.terminalvibe.
if (!process.versions.electron) {
  const path = require('path'), cp = require('child_process'), fs = require('fs');
  const home = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tv-boot-'));
  const server = cp.spawn(process.execPath, [path.join(__dirname, '..', 'electron', 'dev-server.js')], { stdio: 'ignore' });
  const r = cp.spawnSync(require('electron'), [__filename, '--no-sandbox'],
    { stdio: 'inherit', env: { ...process.env, HOME: home, USERPROFILE: home, ELECTRON_ENABLE_LOGGING: '0' } });
  server.kill();
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow, ipcMain } = require('electron');
const providers = require('../electron/providers');
const updatedAgents = [];
providers.checkUpdates = async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
  return Object.entries({ claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex' }).map(([id, name]) => ({
    id, name, installed: '1.0.0', latest: '1.1.0',
    status: updatedAgents.includes(id) ? 'current' : 'available',
    ...(id === 'opencode' && { managed: 'pacman', command: 'sudo pacman -Sy --needed opencode' }),
  }));
};
providers.updateAgent = async (id, _env, onProgress) => {
  if (id === 'claude') {
    onProgress({ stage: 'downloading', percent: null, bytes: 134217728, speed: 1363149 });
    await new Promise(resolve => setTimeout(resolve, 350));
    onProgress({ stage: 'installing', percent: null });
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  updatedAgents.push(id);
  return {};
};
const errors = [];
app.on('web-contents-created', (_e, wc) => {
  // Electron 35+ passes one event object; older versions (event, level, message).
  wc.on('console-message', (e, level, message) => {
    const lvl = e?.level ?? level, msg = e?.message ?? message;
    if (lvl === 'error' || lvl === 3) errors.push(String(msg));
  });
  wc.on('preload-error', (_e, file, err) => errors.push(`preload ${file}: ${err.message}`));
  wc.on('render-process-gone', (_e, d) => errors.push(`renderer gone: ${d.reason}`));
});
const optionalRequests = new Set(['usage:limits', 'chat-sdk:models', 'git:pull-requests']);
const startupRequests = [];
const handle = ipcMain.handle;
ipcMain.handle = function (channel, listener) {
  if (optionalRequests.has(channel)) {
    return handle.call(this, channel, () => { startupRequests.push(channel); });
  }
  if (channel === 'threads:agents') {
    return handle.call(this, channel, async (...args) => {
      const result = await listener(...args);
      return { ...result, found: { ...result.found, agy: '/fixture/agy' } };
    });
  }
  return handle.call(this, channel, listener);
};
require('../electron/main.js');
ipcMain.handle = handle;
const finish = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`); app.exit(ok ? 0 : 1); };
setTimeout(async () => {
  // dist/index.html, or the dev server when one is running (main.js prefers it in development).
  const win = BrowserWindow.getAllWindows().find(w => /index\.html|^http:\/\/127\.0\.0\.1:\d+\/?$/.test(w.webContents.getURL()) && !/[?&](mode|detached)=/.test(w.webContents.getURL()));
  if (!win) return finish(false, `no main window (windows: ${JSON.stringify(BrowserWindow.getAllWindows().map(w => w.webContents.getURL()))}; errors: ${errors.join(' | ')})`);
  const s = await win.webContents.executeJavaScript(`({ terminals: document.querySelectorAll('.term-slot .xterm').length, ran: !!window.__tvAppJsRan, splash: document.getElementById('splash')?.className || 'gone' })`).catch(e => ({ err: e.message }));
  // Startup noise that isn't the app's (GPU, network) is not a boot failure.
  const real = errors.filter(m => !/GPU|gpu_|Autofill|dbus|net::ERR|DevTools/i.test(m));
  if (s.err) return finish(false, `window: ${s.err}`);
  if (real.length) return finish(false, `renderer errors during boot:\n  ${real.join('\n  ')}`);
  if (!s.ran || !/hide|gone/.test(s.splash)) return finish(false, `splash still up (app.js ran: ${s.ran}, splash: "${s.splash}")`);
  if (!s.terminals) return finish(false, 'no workspace terminal was created');
  if (startupRequests.length) return finish(false, `optional commands ran at startup (${startupRequests.join(', ')})`);
  const updates = await win.webContents.executeJavaScript(`(async () => {
    const button = document.getElementById('btn-agent-updates');
    if (!button?.getClientRects().length) return 'update button is missing';
    if (button.querySelector('.agent-update-count')) return 'the update button still has a badge';
    button.click();
    if (!document.getElementById('agent-updates').open) return 'update dialog did not open';
    if (!button.querySelector('.ph-arrows-clockwise')) return 'checking icon was not shown';
    const spinner = document.querySelector('#agent-updates .ph-circle-notch');
    if (!spinner || getComputedStyle(spinner).transform !== 'none'
      || getComputedStyle(spinner, '::before').content !== '""') return 'the spinner does not use a fixed ring';
    const settle = async () => {
      for (let i = 0; i < 100 && document.querySelector('[data-update-agent]:disabled'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    };
    await settle();
    document.getElementById('btn-update-all-agents').click();
    const state = () => document.querySelector('.agent-update-state')?.textContent || '';
    const waitFor = async condition => {
      for (let i = 0; i < 100; i++) {
        if (condition()) return true;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return false;
    };
    if (!await waitFor(() => /^Downloading · 128 MB · 1[.]3 MB[/]s · [0-9]+:[0-9][0-9]$/.test(state()))) {
      return 'download size and speed did not reach the row';
    }
    if (!await waitFor(() => /^Installing · [0-9]+:[0-9][0-9]$/.test(state()))) return 'install stage did not reach the row';
    await settle();
    if (state()) return 'progress stayed visible after the update';
    if (!button.querySelector('.ph-arrow-circle-up')) return 'idle icon was not restored';
    if (document.querySelector('[data-update-agent]') || !document.getElementById('btn-update-all-agents').hidden
      || !document.querySelector('[data-terminal-update="opencode"]')) {
      return 'Update all did not update only the unmanaged agents';
    }
    return '';
  })()`).catch(e => e.message);
  if (updates || updatedAgents.join() !== 'claude,codex') {
    return finish(false, updates || 'the wrong agents were updated');
  }
  win.focus();
  for (const type of ['mouseDown', 'mouseUp']) {
    win.webContents.sendInputEvent({ type, x: 8, y: 80, button: 'left', clickCount: 1 });
  }
  for (let i = 0; i < 20; i++) {
    if (await win.webContents.executeJavaScript("!document.getElementById('agent-updates').open")) {
      return finish(true, 'agent updates flow and backdrop dismissal');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  finish(false, 'clicking outside did not close the update dialog');
}, 12000);
