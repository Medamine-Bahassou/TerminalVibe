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
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '..', 'workspace.css'), 'utf8'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const helpers = slice(source, '  function chatPanelHost(t, group) {', '  // While a thread or its shown side chat')
    + slice(source, "  // Hide or bring back a thread's whole right panel", "  // The panel's top-bar buttons: hide it")
    + slice(source, '  async function openChatFileLink(', '  // Right-click in the chat')
    + slice(source, '  function chatLinkPath(', '  const thrInput =')
    + slice(source, '  function openChatFilePanel(', "  // A turn's changed files")
    + slice(source, "  // The panel on the right of a chat's tab", '  function openChatSkills() {');
  const trayClick = slice(source, "  thrChip('sides')?.addEventListener('click'", '  // Mode chip:');
  const shortcut = slice(source, '  // Ctrl+Alt+B:', '  // An agent finished its turn:');
  const click = slice(source.slice(source.indexOf('  async function answerAgentQuestion(')), "  onThreadPage('click'", '  // A sent @path chip');
  const menu = slice(source, "    } else if (type === 'chat-link') {", "    } else if (type === 'chat-thread') {");
  const wslCwd = '\\\\wsl.localhost\\Ubuntu\\home\\user\\project';
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, msg) => { if (!ok) throw Error(msg); };
    const slot = id => { const el = document.createElement('div'); el.className = 'term-slot'; el.id = 'slot-' + id; el.style.cssText = 'position:absolute;inset:0'; document.body.append(el); return el; };
    const host = { id: 'host', key: 'k-host', threadHistory: true, chat: {}, el: slot('host') };
    const side = { id: 'side', key: 'k-side', threadHistory: true, chat: { title: 'Side', side: { parentId: 'k-host' } }, el: slot('side') };
    const group = { type: 'group', id: 'g', terminals: [host, side], activeTermId: 'host' };
    const ws = { id: 'ws', layout: group };
    const wsOf = () => ws, findGroupContainingTerm = () => group, threadKey = t => t.key;
    const activateTerminal = (_, id) => { group.activeTermId = id; syncChatPanels(ws); };
    const syncThreadPanel = () => syncChatPanels(ws);
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
    check(host._panelGuest === 'side' && group.activeTermId === 'host', 'Reopening the panel moved focus away from the main thread');

    {
      const tray = document.createElement('div');
      tray.innerHTML = '<button class="thr-side-chip" data-side="side"><span>Side chat</span></button>';
      host.el.append(tray);
      const thrChip = () => tray, curChat = () => host, findChatThread = id => id === side.id && side;
      const syncThreadComposer = () => {}, openChatTab = tab => activateTerminal(ws.id, tab.id);
      ${trayClick}
      for (let i = 0; i < 3; i++) tray.querySelector('span').click();
      check(group.activeTermId === host.id && host._panelGuest === side.id, 'Reclicking the visible side chat replaced the active main chat');
      toggleChatRightPanel(host);
      tray.querySelector('span').click();
      check(group.activeTermId === side.id && host._panelGuest === side.id, 'Clicking a hidden side chat failed to open it');
    }
    // 6. Closing a side chat tab takes it out of the strip; showing it again brings it back.
    closeSideChatTab(host, 'side');
    check(!host._panelGuest && host._sideClosed.has('side'), 'side tab did not close');
    showSideChatTab(host, 'side');
    check(!host._sideClosed.has('side') && host._panelGuest === 'side', 'side tab did not come back');
    // A burst of shortcut presses toggles once; the next deliberate press still works.
    const activeTerminal = () => group.terminals.find(t => t.id === group.activeTermId);
    ${shortcut}
    const pressPanel = (repeat = false) => document.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyB', key: 'b', ctrlKey: true, altKey: true, repeat, bubbles: true, cancelable: true
    }));
    pressPanel(true);
    check(host._panelGuest === 'side', 'Key repeat toggled the panel');
    pressPanel();
    check(!host._panelGuest && group.activeTermId === 'host', 'Shortcut did not hide the panel');
    for (let i = 0; i < 100; i++) pressPanel();
    check(!host._panelGuest && group.activeTermId === 'host', 'Shortcut burst reopened the panel before focus settled');
    await new Promise(resolve => setTimeout(resolve, 200));
    pressPanel();
    check(host._panelGuest === 'side' && group.activeTermId === 'host', 'Shortcut failed to restore the side chat alongside the active thread');
    for (let i = 0; i < 100; i++) pressPanel();
    check(host._panelGuest === 'side' && side.el.classList.contains('cmb-on'), 'Shortcut burst hid the reopened side chat');
    // 7. A WSL file link clicked in a side chat opens at its line in the merged strip.
    const chatCwd = () => ${JSON.stringify(wslCwd)}, curChat = () => side;
    const flow = document.createElement('div'); flow.id = 'sbr-thread-flow'; side.el.append(flow);
    const onThreadPage = (type, handler) => flow.addEventListener(type, handler);
    let loaded, revealed, vscode, copied;
    window.electronAPI = { platform: 'win32', readAttachmentPreview: async path => {
      loaded = path;
      return { text: 'first\\nsecond' };
    }, showInFolder: async path => { revealed = path; }, openInVSCode: async target => { vscode = target; return true; },
      clipboardWrite: async text => { copied = text; } };
    ${click}
    flow.innerHTML = '<button type="button" class="thr-link" data-href="/home/user/project/app.js:2">app.js</button>';
    flow.firstChild.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    check(loaded === ${JSON.stringify(wslCwd + '\\app.js')}, 'The editor received the wrong WSL path');
    check(visible() && !side._filePanel && host._filePanel.querySelector('.cfp-target')?.textContent === '2second', 'The linked line did not open in the merged editor tab');
    check(host._filePanel.querySelector('.cfp-tab:not(.cmb-side)').title === 'app.js', 'Editor tab tooltip exposed the full path');
    const actions = new Map(), item = (_, label, _key, action) => actions.set(label, action), sep = () => {};
    const type = 'chat-link', data = '/home/user/project/app.js:2:3';
    if (false) {
    ${menu}
    }
    await actions.get('Open in VS Code')();
    await actions.get('Reveal in Files')();
    check(vscode === loaded + ':2:3' && revealed === loaded, 'External actions used a different path or lost the source location');
    actions.get('Copy relative path')();
    check(copied === 'app.js', 'Copy relative path included the project directory');
    actions.get('Copy full path')();
    check(copied === loaded, 'Copy full path used a different path from the editor');

    const count = 18000, targetLine = 13038;
    const largeFile = Array.from({ length: count }, (_, i) => ('line ' + (i + 1) + ' ').repeat(i % 4 + 1)).join('\\n');
    openChatFilePanel(host, '/tmp/large.js', 'large.js', largeFile, targetLine);
    const large = host._filePanel.querySelector('.cfp-page:not([hidden])');
    const body = large.querySelector('.cfp-body'), code = large.querySelector('.cfp-code');
    const target = code.querySelector('.cfp-target');
    check(code.children.length === 200 && target.firstChild.textContent === String(targetLine), 'Large file must open at the requested line with only nearby rows mounted');
    const targetOffset = () => target.getBoundingClientRect().top - body.getBoundingClientRect().top;
    const initialOffset = targetOffset();
    for (let i = 0; i < 200 && code.children.length < count; i++) await new Promise(resolve => setTimeout(resolve, 25));
    check(code.children.length === count && code.firstChild.firstChild.textContent === '1' && code.lastChild.firstChild.textContent === String(count), 'Deferred rows must fill the entire file in order, mounted ' + code.children.length);
    check(Math.abs(targetOffset() - initialOffset) <= 2, 'Filling earlier lines moved the visible linked line');
    return 'PASS: merged right panel, WSL file links and context actions, and fast opening of a large file';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
