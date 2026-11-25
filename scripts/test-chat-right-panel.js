// The thread's right panel (files, diffs and side chats as one tab strip): who owns it, closing, hiding.
const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const r = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timeout = setTimeout(() => app.exit(1), 20000);
const slice = (src, from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw Error('app.js changed: cannot find ' + (a < 0 ? from : to));
  return src.slice(a, b);
};
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '..', 'workspace.css'), 'utf8'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const helpers = slice(source, '  function chatPanelHost(t, group) {', '  // While a thread or its shown side chat')
    + slice(source, "  // Hide or bring back a thread's whole right panel", "  // The panel's top-bar buttons: hide it")
    + slice(source, "  // The panel on the right of a chat's tab", '  function openChatSkills() {');
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, msg) => { if (!ok) throw Error(msg); };
    const slot = id => { const el = document.createElement('div'); el.className = 'term-slot'; el.id = 'slot-' + id; el.style.cssText = 'position:absolute;inset:0'; document.body.append(el); return el; };
    const host = { id: 'host', key: 'k-host', threadHistory: true, chat: {}, el: slot('host') };
    const side = { id: 'side', key: 'k-side', threadHistory: true, chat: { title: 'Side', side: { parentId: 'k-host' } }, el: slot('side') };
    const group = { type: 'group', id: 'g', terminals: [host, side], activeTermId: 'host' };
    const ws = { id: 'ws', layout: group };
    const wsOf = () => ws, findGroupContainingTerm = () => group, threadKey = t => t.key;
    const activateTerminal = (_, id) => { group.activeTermId = id; syncChatPanels(ws); };
    const chatPanelSash = () => document.createElement('div'), focusSlot = () => {}, showCtxMenu = () => {};
    let badge = ''; const zoomBadge = m => { badge = m; };
    const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    ${helpers}
    const diff = () => openChatPanel(curOwner, { key: 'diff:1', title: '1 changed file', sub: '+4 -3', icon: 'ph-file-diff', rows: '', diff: true });
    const visible = () => !!host._filePanel?.isConnected && !host._filePanel.hidden && host.el.classList.contains('chat-file-open');
    let curOwner;

    // 1. A diff opened from the side chat goes to the thread's panel (not a second panel inside the side chat).
    host._panelGuest = 'side'; activateTerminal('ws', 'side');
    check(side.el.classList.contains('cmb-on'), 'side chat not shown in the panel');
    curOwner = side; const page = diff();
    check(host._filePanel && !side._filePanel && !side.el.querySelector('.cfp-page'), 'diff opened inside the side chat');
    check(group.activeTermId === 'host' && !host._panelGuest && visible(), 'diff did not take over the right panel');
    check([...host._filePanel.querySelectorAll('.cfp-tab')].map(t => t.dataset.side || 'file').join() === 'side,file', 'strip is not side chats then files');

    // 2. Closing the only diff tab closes the panel.
    host._filePanel.querySelector('.cfp-tab:not(.cmb-side) .cfp-tab-x').click();
    check(!host._filePanel && !page.isConnected && !host.el.classList.contains('chat-file-open'), 'last diff tab did not close');

    // 3. Hide / show with only a diff open.
    curOwner = host; diff();
    toggleChatRightPanel(host);
    check(host._filePanel.isConnected && host._filePanel.hidden && !host.el.classList.contains('chat-file-open'), 'hide did not hide a lone diff');
    toggleChatRightPanel(host);
    check(visible(), 'show did not bring the diff back');

    // 4. With the side chat shown: its strip lists the diff; closing it there closes the thread's panel.
    host._filePanel.querySelector('.cfp-tab.cmb-side').click();
    check(group.activeTermId === 'side' && host._panelGuest === 'side' && host._filePanel.hidden, 'side chat tab did not swap the panel');
    const proxy = side.el.querySelector('.cmb-strip .cfp-tab.cmb-file');
    check(proxy, 'side chat strip does not list the diff');
    proxy.querySelector('.cfp-tab-x').click();
    check(!host._filePanel && !side.el.querySelector('.cmb-strip .cmb-file'), 'closing the diff from the side chat strip failed');

    // 5. Hide with the side chat shown, then show: the same side chat comes back.
    toggleChatRightPanel(side);
    check(!host._panelGuest && group.activeTermId === 'host' && !side.el.classList.contains('cmb-on'), 'hide left the side chat shown');
    toggleChatRightPanel(host);
    check(host._panelGuest === 'side' && group.activeTermId === 'side', 'show did not bring the side chat back');

    // 6. Closing a side chat tab takes it out of the strip; showing it again brings it back.
    closeSideChatTab(host, 'side');
    check(!host._panelGuest && host._sideClosed.has('side'), 'side tab did not close');
    showSideChatTab(host, 'side');
    check(!host._sideClosed.has('side') && host._panelGuest === 'side', 'side tab did not come back');
    return 'PASS: right panel owner, last-tab close, hide/show (diff and side chat), side strip close, side tab close/reopen';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
