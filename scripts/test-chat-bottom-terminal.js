const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const r = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const helpers = source.slice(source.indexOf('  function disposeChatBottomTerminal('), source.indexOf('  // An agent finished its turn:'));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, msg) => { if (!ok) throw Error(msg); };
    const owner = { id: 'chat', threadHistory: true, el: document.createElement('div'), term: { focus: () => focused = 'chat' } };
    document.body.append(owner.el);
    let focused, created = 0, disposed = 0, wsReady = true;
    const controls = [], wsp = {}, uuid = () => 'shell', chatCwd = () => '/project/chat';
    const activeTerminal = () => owner, focusSlot = () => {};
    const findTermById = () => ({ ws: wsp });
    const sendControl = msg => controls.push(msg), fitTerm = () => {};
    const _termFitObserver = { observe() {}, unobserve() {} }, _disposeTermRenderers = () => {};
    const _createTermEntry = () => { created++; return { id: 'shell', term: { cols: 80, rows: 24, open() {}, focus() { focused = 'shell'; }, dispose() { disposed++; } } }; };
    ${helpers}
    const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true }));
    press(); await new Promise(requestAnimationFrame);
    check(created === 1 && focused === 'shell', 'Ctrl+J did not open and focus shell');
    check(controls[0].cwd === '/project/chat', 'Shell did not start in chat project');
    press(); check(owner._bottomTerminal.el.hidden && focused === 'chat', 'Ctrl+J did not hide shell and restore chat focus');
    press(); await new Promise(requestAnimationFrame);
    check(created === 1 && !owner._bottomTerminal.el.hidden, 'Reopen created another shell');
    owner._cliView = true; press(); check(!owner._bottomTerminal.el.hidden, 'Shortcut affected CLI view');
    owner._cliView = false; owner._bottomTerminal.el.querySelector('button').click();
    check(owner._bottomTerminal.el.hidden, 'Close button did not hide shell');
    disposeChatBottomTerminal(owner);
    check(disposed === 1 && !owner._bottomTerminal && controls.at(-1).type === 'close', 'Shell cleanup failed');
    return 'PASS: Ctrl+J open/hide/reopen, project cwd, focus, CLI isolation, close button and cleanup';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
