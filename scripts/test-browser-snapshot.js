#!/usr/bin/env node
// Isolated real Electron guests: no user tabs, sessions, or network requests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
  });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow, WebContentsView } = require('electron');
const snapshot = require('../browser-snapshot');
const root = path.join(__dirname, '..');
let win, native;
const timer = setTimeout(() => { console.error('Browser snapshot test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, backgroundThrottling: false } });
  await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const handler = source.slice(source.indexOf('  function createAgentTerminal'), source.indexOf('  const AR_KEY ='));
  const fixture = '<title>Gmail results</title><input aria-label="Search" value="gmail"><input type="password" value="secret-value"><input type="hidden" value="hidden-secret"><div style="display:none">hidden text</div><h1>Gmail - Google</h1><a href="https://mail.google.com/">Gmail</a><p>' + 'result '.repeat(100) + '</p>';
  const result = await win.webContents.executeJavaScript(`(async () => {
    const check = (value, message) => { if (!value) throw new Error(message); };
    const snapshotBrowserPage = ${snapshot.toString()};
    const surface = document.createElement('webview');
    surface.style.cssText = 'display:flex;width:600px;height:400px';
    surface.src = 'data:text/html,' + encodeURIComponent(${JSON.stringify(fixture)});
    document.body.append(surface);
    await new Promise(resolve => surface.addEventListener('dom-ready', resolve, {once:true}));
    const entry = { id:'browser', type:'browser', url:'https://www.google.com/search?q=google', browserContainer:document.body };
    surface.className = 'browser-surface';
    const workspace = {id:'workspace', terminals:[entry]}, workspaces = [workspace];
    const findTermById = id => id === entry.id ? {term:entry, ws:workspace} : null;
    const getWorkspaceTerminals = ws => ws.terminals;
    ${handler}
    const read = options => handleAgentRequest({method:'read', params:{paneId:entry.id, ...options}});
    const first = await read({maxChars:40});
    check(first.accessible && first.title === 'Gmail results', 'Cannot read real webview');
    check(first.storedUrl.includes('q=google') && first.controls[0].value === 'gmail', 'Live search field was guessed from URL');
    check(first.truncated && first.text.length === 40, 'Text limit not enforced');
    check(first.links[0].url === 'https://mail.google.com/', 'Missing live link');
    check(first.controls[1].redacted && !JSON.stringify(first.controls).includes('secret-value'), 'Password leaked');
    check(!JSON.stringify(first.controls).includes('hidden-secret') && !first.text.includes('hidden text'), 'Hidden content leaked');
    const next = await read({maxChars:100000, offset:40});
    check(!next.truncated && first.text.length + next.text.length === next.totalChars, 'Pagination lost text');
    let rejected = false;
    try { await read({maxChars:100001}); } catch { rejected = true; }
    check(rejected, 'Invalid read size accepted');
    await surface.executeJavaScript('document.title = "Updated"; document.querySelector("input").value = "draft search"');
    const updated = await read({});
    check(updated.title === 'Updated' && updated.controls[0].value === 'draft search', 'Snapshot is stale');
    surface.remove();
    const frame = document.createElement('iframe'); frame.className = 'browser-surface';
    frame.srcdoc = ${JSON.stringify(fixture)};
    const loaded = new Promise(resolve => frame.onload = resolve); document.body.append(frame); await loaded;
    check((await read({})).accessible, 'Same-origin iframe unreadable');
    const blocked = new Promise(resolve => frame.onload = resolve);
    frame.srcdoc = ''; frame.removeAttribute('srcdoc'); frame.src = 'data:text/html,<h1>Other origin</h1>'; await blocked;
    const unavailable = await read({});
    check(!unavailable.accessible && unavailable.reason && !unavailable.text, 'Cross-origin content fabricated');
    frame.remove();
    const unloaded = await read({});
    check(!unloaded.accessible && /not been opened/.test(unloaded.reason), 'Unloaded page misreported');
    return 'PASS: live webview search/content changes, pagination, redaction, same-origin iframe, blocked/unloaded pages';
  })()`);
  console.log(result);
  // Exercise the actual native IPC handler against a real WebContentsView.
  native = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  native.setBounds({ x:0, y:0, width:600, height:400 });
  await native.webContents.loadURL('data:text/html,' + encodeURIComponent(fixture));
  const mainSource = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const ipcSource = mainSource.slice(mainSource.indexOf("ipcMain.handle('browser:read'"), mainSource.indexOf('// Keys pressed inside a <webview>'));
  let ipcRead;
  vm.runInNewContext(ipcSource, {
    ipcMain: { handle: (_name, fn) => { ipcRead = fn; } }, mainWindow:win,
    bviews:new Map([['native',native]]), require: () => snapshot
  });
  const nativeResult = await ipcRead({sender:win.webContents}, 'native', {maxChars:100});
  assert.equal(nativeResult.title, 'Gmail results');
  assert.equal(nativeResult.controls[0].value, 'gmail');
  await assert.rejects(() => ipcRead({sender:native.webContents}, 'native'), /Unauthorized/);
  await assert.rejects(() => ipcRead({sender:win.webContents}, 'missing'), /not ready/);
  console.log('PASS: native browser snapshot and IPC ownership checks');
  clearTimeout(timer); native.webContents.close(); win.destroy(); app.quit();
}).catch(error => { console.error(error); native?.webContents.close(); win?.destroy(); app.exit(1); });
