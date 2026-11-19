// Chat surfaces survive pane focus, hidden workspaces, and layout reattachment.
const fs = require('fs');
const path = require('path');
if (!process.versions.electron) {
  const r = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('about:blank');
  for (const file of ['style.css', 'workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(root, file), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const focus = source.slice(source.indexOf('  function focusSlot(entry)'), source.indexOf('  let ws = null;'));
  const sync = source.slice(source.indexOf('  function syncThreadPanel(force)'), source.indexOf('  // Small popover list', source.indexOf('  function syncThreadPanel(force)')));
  const view = source.slice(source.indexOf('  function setChatView(tab, cli)'), source.indexOf('  // An agent finished its turn:', source.indexOf('  function setChatView(tab, cli)')));
  const refresh = source.slice(source.indexOf('  async function refreshThreadFlow('), source.indexOf('  // ── Find in the thread history:', source.indexOf('  async function refreshThreadFlow(')));
  const pending = source.slice(source.indexOf('  const pendingMessages ='), source.indexOf('  const _thrImgCache ='));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="sbr-thread" style="display:none"><div class="thr-flow" id="sbr-thread-flow"></div><textarea id="sbr-thread-input"></textarea><div class="attachments" id="sbr-thread-attachments"></div><button id="sbr-thread-model"><span>Model</span></button></div>';
    const thrPage = document.getElementById('sbr-thread'), thrInput = document.getElementById('sbr-thread-input');
    let _curChat = null, _preferChat = null, _threadPoll = null, _flowSig = '', _chatFiles = [];
    const curChat = () => _curChat;
    const autosizeThreadInput = () => {};
    const renderChatFiles = (files = _chatFiles, surface = thrPage) => { surface.querySelector('.attachments').textContent = files.map(f => f.name).join(','); };
    const syncThreadComposer = () => {}, fitTerm = () => {}, syncWorking = () => {}, _syncWebgl = () => {};
    const ensureChatTerminalSession = async () => true;
    const clearCitationFlash = () => {};
    const decorateWorkUsernames = () => {}; // Privacy rendering is covered by test-work-usernames.
    const renderChatErrors = () => {}, renderChatResume = () => {}, syncChatInterruption = () => {}, syncScrollEnd = () => {}, syncContextRing = () => {};
    const turnGitFiles = () => [];
    const hydrateChatAttachmentSizes = () => {};
    const threadSegments = tab => tab.chat?.segments || [], threadMeta = tab => ({ id: tab.id });
    const chatWorking = () => false, saveState = () => {}, setChatTabLabel = () => {};
    const _pendingMsgs = new Map(), _turns = new Map(), thrFind = { q: '' }, _thrImgSize = new Map(), _thrImgCache = new Map();
    const escHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const mdLite = escHtml, userTextHtml = s => ({ html: escHtml(s), paths: [] });
    ${pending}
    const harnessOf = () => ({ name: 'Codex', bin: 'codex' }), procIconHtml = () => '', clockTime = () => '', fmtSecs = s => s + 's';
    const historyLoads = [];
    let replySuffix = '';
    const copies = [], modelActions = [];
    const copyPrivateText = async text => copies.push(text);
    document.getElementById('sbr-thread-model').onclick = () => modelActions.push(_curChat.id);
    window.electronAPI = { threadHistory: async meta => {
      historyLoads.push(meta.id);
      await new Promise(resolve => setTimeout(resolve, 10));
      return [{ items: [
        { role: 'user', text: 'History for ' + meta.id, ts: '2026-11-15T00:00:00Z' },
        { role: 'thinking', text: 'Thinking for ' + meta.id, ts: '2026-11-15T00:00:01Z' },
        { role: 'assistant', text: 'Reply for ' + meta.id + replySuffix, ts: '2026-11-15T00:00:02Z' }
      ] }];
    }, clipboardWrite: text => copies.push(text) };
    ${refresh}
    const refreshHistory = refreshThreadFlow, historyErrors = [];
    refreshThreadFlow = (...args) => refreshHistory(...args).catch(error => { historyErrors.push(error); });
    const makeWs = () => { const el = document.createElement('div'); el.style.cssText = 'position:relative;width:400px;height:400px'; document.body.append(el); return { el, layout: {}, tabs: [] }; };
    const makeChat = (ws, id) => {
      const el = document.createElement('div'); el.className = 'term-slot'; el.style.cssText = 'position:relative;display:block;height:180px';
      el.innerHTML = '<div class="term-wrap">shell prompt</div>'; ws.el.append(el);
      const tab = { id, el, threadHistory: true, term: { focus() {} } }; ws.tabs.push(tab); return tab;
    };
    const a = makeWs(), b = makeWs(), empty = makeWs();
    const workspaces = [a, b, empty];
    const first = makeChat(a, 'first'), second = makeChat(a, 'second'), other = makeChat(b, 'other');
    const threadList = document.createElement('div'); threadList.id = 'ts-list';
    threadList.innerHTML = '<button class="ts-card" data-tab="first">First</button><button class="ts-card" data-tab="second">Second</button>';
    document.body.append(threadList);
    const firstButton = threadList.firstElementChild, secondButton = threadList.lastElementChild;
    let current = a; a.activeTermId = first.id; b.activeTermId = other.id;
    const firstTurn = { harness: 'codex', model: 'gpt-6.2-sol', effort: 'low' };
    second.chat = { title: 'Second chat', segments: [firstTurn], turnOptions: { '2026-11-15T00:00:00Z': firstTurn } };
    _pendingMsgs.set(second.id, { at: Date.now(), text: 'New prompt', options: firstTurn });
    check(pendingHtml(second).includes('New prompt') && !pendingHtml(second).includes('thr-seg'), 'Sending renders a temporary agent header');
    _pendingMsgs.delete(second.id);
    const activeWs = () => current, getWorkspaceTerminals = ws => ws.tabs;
    let focusedSlotId;
    const clearSlotFocus = () => {}, updateFocusedGroup = () => {};
    const findTermById = id => {
      const term = current.tabs.find(tab => tab.id === id);
      return term && { ws: current, term };
    };
    const findGroupContainingTerm = (_, id) => ({ activeTermId: id });
    ${focus}
    ${sync}
    ${view}
    syncThreadPanel();
    check(firstButton.classList.contains('active') && firstButton.getAttribute('aria-current') === 'true', 'Initial thread selection was not synchronous');
    const terminal = { id: 'terminal', el: document.createElement('div') };
    a.tabs.push(terminal);
    focusSlot(terminal);
    check(!firstButton.classList.contains('active') && firstButton.getAttribute('aria-current') === 'false', 'Focusing a terminal leaves the previous thread selected');
    check(thrPage.parentElement === first.el, 'Terminal focus displaced the visible split chat');
    focusSlot(first);
    check(firstButton.classList.contains('active'), 'Returning to the chat did not restore its sidebar selection');
    // Cold startup: the unfocused pane has never held the live page or a snapshot.
    const initial = second.el.querySelector('.thr-snapshot');
    check(initial && initial.offsetHeight > 0 && initial.querySelector('textarea'), 'Startup did not initialize the unfocused chat interface');
    check(getComputedStyle(second.el.querySelector('.term-wrap')).visibility === 'hidden', 'Startup sibling shows its shell');
    await new Promise(resolve => setTimeout(resolve, 30));
    if (historyErrors.length) throw historyErrors[0];
    check(historyLoads.includes('second') && initial.textContent.includes('History for second'), 'Startup sibling did not load its own history');
    check(initial.querySelectorAll('.thr-seg').length === 1, 'Session and turn metadata created duplicate agent headers');
    check(thrPage.parentElement === first.el && !thrPage.textContent.includes('History for second'), 'Startup history stole focus or overwrote the focused chat');
    const press = target => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      target.click();
    };
    const model = initial.querySelector('[data-thr-id="sbr-thread-model"] span');
    model.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    check(initial.isConnected && thrPage.parentElement === first.el, 'Mouse-down removed the action target too soon');
    model.click();
    check(modelActions.length === 1 && modelActions[0] === 'second', 'First click did not activate the composer action in its owning chat');
    check(secondButton.classList.contains('active') && !firstButton.classList.contains('active'), 'Thread button waits for polling after pane activation');
    await winTick();
    a.activeTermId = first.id; syncThreadPanel();
    press(second.el.querySelector('.thr-snapshot .thr-copy i'));
    await winTick();
    check(copies.length === 1 && copies[0] === 'History for second', 'First click did not copy the owning chat message exactly once');
    a.activeTermId = first.id; syncThreadPanel();
    press(second.el.querySelector('.thr-snapshot .thr-turn > summary span'));
    await winTick();
    check(thrPage.parentElement === second.el && thrPage.querySelector('.thr-turn').open, 'First click did not expand the history action');
    replySuffix = ' updated';
    await refreshThreadFlow(second);
    check(thrPage.querySelector('.thr-turn').open && thrPage.textContent.includes('Reply for second updated'), 'A changed turn lost its expanded state');
    a.activeTermId = first.id; syncThreadPanel();
    thrInput.value = 'unfinished prompt'; _chatFiles = [{ name: 'screenshot.png' }]; renderChatFiles();
    const flow = thrPage.querySelector('.thr-flow'); flow.innerHTML = '<details data-key="turn" open><summary>Steps</summary>Saved chat</details>';
    check(getComputedStyle(first.el.querySelector('.term-wrap')).visibility === 'hidden', 'Chat shows its underlying shell');
    // Switching workspaces hides the previous container before syncing its chat.
    a.el.style.display = 'none'; current = b; syncThreadPanel();
    let snap = first.el.querySelector('.thr-snapshot');
    check(snap && snap.querySelector('textarea').value === 'unfinished prompt', 'Hidden workspace lost its chat surface or draft');
    check(snap.querySelector('.thr-flow').inert, 'Hidden snapshot walked its history controls during the switch');
    check(snap.textContent.includes('screenshot.png') && snap.querySelector('details').open, 'Snapshot lost attachments or expanded history');
    a.activeTermId = second.id; b.el.style.display = 'none'; a.el.style.display = 'block'; current = a; syncThreadPanel();
    check(getComputedStyle(snap).display === 'flex' && snap.offsetHeight > 0, 'Unfocused chat requires a click to show');
    check(!snap.querySelector('.thr-flow').inert && snap.querySelector('summary').tabIndex === -1, 'Visible sibling did not restore clickable history with safe keyboard focus');
    check(getComputedStyle(snap).position === 'absolute', 'Chat is underneath the terminal layer');
    press(snap);
    check(thrPage.parentElement === first.el && !first.el.querySelector('.thr-snapshot'), 'Focusing snapshot did not restore the live chat');
    check(thrInput.value === 'unfinished prompt' && _chatFiles[0].name === 'screenshot.png' && flow.textContent.includes('Saved chat'), 'Restored chat lost its state');
    // No visible chat: parking the shared page must still save its draft.
    thrInput.value = 'saved while parked'; current = empty; syncThreadPanel();
    check(first._draft === 'saved while parked', 'Parking lost the draft');
    check(!threadList.querySelector('.active'), 'Parking leaves a stale selected thread button');
    current = a; a.activeTermId = first.id; syncThreadPanel();
    check(thrInput.value === 'saved while parked', 'Returning from a terminal-only workspace lost the draft');
    setChatView(first, true);
    check(getComputedStyle(first.el.querySelector('.term-wrap')).visibility === 'visible' && thrPage.style.display === 'none', 'Explicit terminal view is hidden');
    setChatView(first, false);
    const replacement = document.createElement('div'); document.body.append(replacement); replacement.append(first.el); syncThreadPanel();
    check(thrPage.parentElement === first.el && thrPage.style.display === 'flex', 'Layout reattachment lost chat view');
    // Different-length histories expose restoring scroll against the previous tab's markup.
    await winTick();
    first.chat = { title: 'First', segments: [{ harness: 'codex' }] };
    let revision = '', tailRevision = '';
    window.electronAPI.threadHistory = async meta => {
      await winTick();
      return [{ items: Array.from({ length: meta.id === 'first' ? 70 : 20 }, (_, i) => ({
        role: 'user', text: meta.id + ' message ' + i + revision + (i === 69 ? tailRevision : ''), ts: '2026-11-15T00:00:00Z'
      })) }];
    };
    function winTick() { return new Promise(resolve => setTimeout(resolve, 30)); }
    flow.style.cssText = 'height:130px;flex:none;overflow:auto';
    _flowSig = ''; await refreshThreadFlow(first);
    check(flow.scrollHeight > 1000, 'Scroll test needs an overflowing history');
    const firstMessage = flow.querySelector('.thr-msg');
    const flowMutations = new MutationObserver(() => {});
    flowMutations.observe(flow, { childList: true });
    flow.scrollTop = 370;
    a.activeTermId = second.id; syncThreadPanel();
    check(first.el.querySelector('.thr-snapshot .thr-flow') === flow, 'Switching parked the rows individually instead of moving the transcript');
    check(flowMutations.takeRecords().length === 0, 'Switching changed the transcript children');
    await winTick();
    check(first._scrollState.top === 370 && !first._scrollState.bottom, 'Switching failed to capture scroll before the scroll event');
    a.activeTermId = first.id; syncThreadPanel();
    check(thrPage.querySelector('.thr-flow') === flow, 'Switching back did not restore the same transcript element');
    flowMutations.disconnect();
    check(Math.abs(flow.scrollTop - 370) < 2, 'Tab switch jumps before history loads');
    await winTick();
    check(Math.abs(flow.scrollTop - 370) < 2, 'Async history redraw resets the scroll position');
    check(flow.querySelector('.thr-msg') === firstMessage, 'Switching rebuilt unchanged history nodes');
    const oldTail = flow.querySelector('.thr-msg[data-key="0:69"]');
    tailRevision = ' streaming update';
    await refreshThreadFlow(first);
    check(flow.querySelector('.thr-msg') === firstMessage, 'A tail update rebuilt finished turns');
    check(!oldTail.isConnected && flow.textContent.includes(tailRevision), 'The changed tail was not replaced');
    check(Math.abs(flow.scrollTop - 370) < 2, 'A tail update moved the reading position');
    revision = ' updated'; _flowSig = ''; await refreshThreadFlow(first);
    check(Math.abs(flow.scrollTop - 370) < 2, 'History refresh jumps to top while reading');
    rememberThreadScroll(first);
    first.el.style.display = 'none'; rememberThreadScroll(first);
    check(first._scrollState.top === 370, 'Hiding the tab overwrites the saved position with zero');
    first.el.style.display = 'block';
    flow.scrollTop = flow.scrollHeight;
    a.activeTermId = second.id; syncThreadPanel(); await winTick();
    a.activeTermId = first.id; syncThreadPanel(); await winTick();
    check(flow.scrollHeight - flow.clientHeight - flow.scrollTop < 2, 'Chat at the bottom loses its bottom position after switching');
    for (const tab of [second, first, second, first]) {
      a.activeTermId = tab.id; syncThreadPanel();
      check(threadList.querySelector('.active')?.dataset.tab === tab.id, 'Rapid tab switch delayed the selected thread button');
      check(threadList.querySelectorAll('[aria-current="true"]').length === 1, 'Multiple thread buttons marked current');
    }
    check(threadList.firstElementChild === firstButton && threadList.lastElementChild === secondButton, 'Selection replaced the thread buttons');
    const cold = makeChat(a, 'cold');
    cold.chat = { title: 'Cold chat', segments: [{ harness: 'codex' }] };
    const saved = { role: 'user', text: 'Recent saved message', ts: '2026-11-15T00:00:01Z' };
    let resolveLive;
    window.electronAPI.threadHistoryPreview = async meta => meta.id === cold.id ? [{ items: [saved] }] : null;
    window.electronAPI.threadHistory = async meta => meta.id === cold.id ? new Promise(resolve => { resolveLive = resolve; }) : [];
    a.activeTermId = cold.id; syncThreadPanel();
    check(thrPage.textContent.includes('Loading conversation'), 'Cold history has no loading state');
    await winTick();
    check(thrPage.textContent.includes('Recent saved message'), 'Saved messages did not appear ahead of the live transcript');
    for (let i = 0; !resolveLive && i < 10; i++) await winTick();
    check(resolveLive, 'Live history did not load after the preview');
    resolveLive([{ items: [{ role: 'user', text: 'Older history', ts: '2026-11-15T00:00:00Z' }, saved] }]);
    await winTick();
    check(thrPage.textContent.includes('Older history') && thrPage.textContent.includes('Recent saved message'), 'Full history did not replace the preview');
    const resumedAt = '2026-11-15T00:01:00Z', typedAt = '2026-11-15T00:02:00Z';
    cold.chat.resumes = JSON.parse(JSON.stringify([{ at: Date.parse(resumedAt) - 500, afterTs: Date.parse(saved.ts) }]));
    _pendingMsgs.set(cold.id, { at: Date.parse(resumedAt), text: resumePrompt, resume: true });
    check(pendingHtml(cold).includes('Resuming thread') && !pendingHtml(cold).includes(resumePrompt), 'Pending resume shows a status instead of the generated message');
    window.electronAPI.threadHistory = async () => [{ items: [
      saved, { role: 'user', text: resumePrompt, ts: resumedAt },
      { role: 'assistant', text: 'Continued reply', ts: '2026-11-15T00:01:02Z' },
      { role: 'user', text: resumePrompt, ts: typedAt },
    ] }];
    await refreshThreadFlow(cold);
    const resumed = thrPage.querySelector('.thr-resumed');
    check(resumed?.textContent === 'Thread resumed' && Number(resumed.dataset.ts) === Date.parse(resumedAt), 'Restored resume prompt shows its status');
    check(thrPage.querySelectorAll('.thr-resumed').length === 1 && thrPage.querySelectorAll('.thr-msg.user')[1].textContent.includes(resumePrompt), 'An identical manually typed prompt remains visible');
    const stoppedAt = Date.parse(typedAt) + 1000, nextAt = stoppedAt + 2000;
    cold.chat.stopped = [{ text: 'same message', at: stoppedAt, submitted: false, nextAt }];
    window.electronAPI.threadHistory = async () => [{ items: [
      { role: 'user', text: 'same message', ts: new Date(nextAt).toISOString() },
      { role: 'assistant', text: 'Reply to the new message', ts: new Date(nextAt + 1000).toISOString() },
    ] }];
    await refreshThreadFlow(cold);
    const repeated = [...thrPage.querySelectorAll('.thr-msg.user')];
    check(repeated.length === 2 && repeated[0].textContent.includes('Stopped') && !repeated[1].textContent.includes('Stopped'),
      'Sending the same text again must preserve the stopped message above it');
    if (historyErrors.length) throw historyErrors[0];
    clearInterval(_threadPoll);
    return 'Chat view regressions passed: immediate thread selection, rapid switching, first-click actions, startup, split focus, drafts, scroll restoration, hidden tabs, bottom position.';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
