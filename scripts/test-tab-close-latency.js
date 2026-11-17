const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const slice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
  await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8'));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (value, message) => { if (!value) throw Error(message); };
    document.body.innerHTML = '<div id="group-g"><div class="tg-tab" data-termid="closing">Closing</div><div class="tg-tab" data-termid="next">Next</div><div class="term-group-body"><div class="term-slot" id="slot-closing"></div><div class="term-slot" id="slot-next"></div></div></div>';
    const _multiSelected = new Set(), _processCheckPending = new Set(), _closeLockConfirmed = new Set(), _chatStarting = new Map(), _tabAgent = new Map(), _closingWs = new Set();
    let disposed = 0, bottomDisposed = 0, backendCloses = 0, processReply, confirmation;
    const make = id => ({ id, label: id, el: document.getElementById('slot-' + id), term: { focus() {}, dispose() { disposed++; } } });
    const closing = make('closing'), next = make('next');
    const group = { id: 'g', terminals: [closing, next], activeTermId: closing.id };
    const wsp = { id: 'ws', label: 'Workspace', layout: group, activeTermId: closing.id }, workspaces = [wsp];
    let activeWsId = wsp.id;
    const findWs = () => wsp, getWorkspaceTerminals = () => group.terminals;
    const findGroupContainingTerm = (_, id) => group.terminals.some(t => t.id === id) ? group : null;
    const isLiveTerminal = () => true, browserHasContent = () => false, dontAskAgain = () => false, harnessOf = () => null;
    const checkTerminalRunning = () => new Promise(resolve => { processReply = resolve; });
    const showCloseConfirm = (_label, _last, accept, cancel) => { confirmation = { accept, cancel }; };
    const showConfirm = (_label, accept, cancel) => { confirmation = { accept, cancel }; };
    const activateTerminal = (_, id) => {
      wsp.activeTermId = group.activeTermId = id;
      group.terminals.forEach(t => { t.el.style.display = t.id === id ? 'block' : 'none'; });
    };
    const disposeChatBottomTerminal = () => bottomDisposed++, rememberClosedThread = () => {};
    const sendControl = () => backendCloses++, _disposeTermRenderers = () => {};
    const _termFitObserver = { unobserve() {} };
    const countGroups = () => 1, removeEmptyGroups = layout => layout;
    const clearSlotFocus = () => {}, updateTabBarOverflow = () => {}, scrollTabIntoView = () => {}, syncBrowserSlots = () => {};
    const focusSlot = () => {}, fitTerm = () => {}, renderSidebar = () => {}, saveState = () => {};
    const pluginEmit = () => {}, syncThreadPanel = () => {}, renderThreadsSidebar = () => {};
    ${slice('  function beginTabClose(', '  // Close several tabs')}
    ${slice('  async function runningTabProcess(', '  async function closeTabs(')}
    ${slice('  function removeTerminal(', '  function applyTabColor(')}
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    const tab = () => document.querySelector('[data-termid="closing"]');
    removeTerminal(wsp.id, closing.id);
    check(getComputedStyle(tab()).display !== 'none', 'Tab must remain visible while the process scan is unresolved');
    check(wsp.activeTermId === closing.id, 'Process checks must preserve the selected tab');
    check(!disposed && !backendCloses, 'Pending checks must keep the session intact');
    processReply('node'); await flush();
    check(confirmation, 'Running processes must still require confirmation');
    check(getComputedStyle(tab()).display !== 'none' && wsp.activeTermId === closing.id && !disposed && !backendCloses, 'Confirmation must leave the tab selected and its session intact');
    confirmation.cancel();
    check(!closing._closePending && getComputedStyle(tab()).display !== 'none' && wsp.activeTermId === closing.id, 'Cancel must restore the tab and selection');
    removeTerminal(wsp.id, closing.id); processReply(null); await flush();
    check(!tab() && group.terminals.length === 1 && backendCloses === 1, 'Idle tab must close after its check finishes');
    check(!disposed, 'Terminal disposal must wait until after the visual close can paint');
    await new Promise(resolve => setTimeout(resolve, 150));
    check(disposed === 1 && bottomDisposed === 1, 'Resources must be cleaned exactly once');
    // Cancelling the workspace confirmation must restore a lone tab too.
    confirmation = null; removeTerminal(wsp.id, next.id); processReply(null); await flush();
    check(confirmation && next._closePending && getComputedStyle(next.el).display !== 'none', 'Last-tab confirmation must preserve the session');
    confirmation.cancel();
    check(!next._closePending && getComputedStyle(next.el).display !== 'none', 'Cancelling last-tab close must restore its content');
    // An unrelated tab switch must not be undone by a late cancellation.
    group.terminals.push(closing); closing.el = document.createElement('div');
    wsp.activeTermId = closing.id;
    const restore = beginTabClose(wsp, closing);
    wsp.activeTermId = 'another-tab'; restore();
    check(wsp.activeTermId === 'another-tab', 'Cancellation must preserve later navigation');
    return 'PASS: visible tabs during process scans and confirmation, cancellation, last-tab recovery and disposal after paint';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
