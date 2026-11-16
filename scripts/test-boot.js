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
const { app, BrowserWindow } = require('electron');
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
require('../electron/main.js');
const finish = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`); app.exit(ok ? 0 : 1); };
setTimeout(async () => {
  // dist/index.html, or the dev server when one is running (main.js prefers it in development).
  const win = BrowserWindow.getAllWindows().find(w => /index\.html|^http:\/\/127\.0\.0\.1:\d+\/?$/.test(w.webContents.getURL()) && !/[?&](mode|detached)=/.test(w.webContents.getURL()));
  if (!win) return finish(false, `no main window (windows: ${JSON.stringify(BrowserWindow.getAllWindows().map(w => w.webContents.getURL()))}; errors: ${errors.join(' | ')})`);
  const s = await win.webContents.executeJavaScript(`({ ran: !!window.__tvAppJsRan, splash: document.getElementById('splash')?.className || 'gone' })`).catch(e => ({ err: e.message }));
  // Startup noise that isn't the app's (GPU, network) is not a boot failure.
  const real = errors.filter(m => !/GPU|gpu_|Autofill|dbus|net::ERR|DevTools/i.test(m));
  if (s.err) return finish(false, `window: ${s.err}`);
  if (real.length) return finish(false, `renderer errors during boot:\n  ${real.join('\n  ')}`);
  if (!s.ran || !/hide|gone/.test(s.splash)) return finish(false, `splash still up (app.js ran: ${s.ran}, splash: "${s.splash}")`);
  finish(true, 'the app boots past its splash with no renderer errors');
}, 12000);
