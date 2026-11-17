// Exercise queued editing through the real composer submit event in Chromium.
const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="sbr-thread"><form id="sbr-thread-composer"><textarea></textarea><button type="submit" id="send"></button></form></div>';
    const thrPage = document.getElementById('sbr-thread'), thrInput = document.querySelector('textarea'), thrSend = document.getElementById('send');
    const originalFile = { name: 'draft.png', path: '/draft.png', image: true };
    const image = { name: 'queued.png', path: '/queued.png', image: true, mention: '@image' };
    const message = { id: 'q1', typed: 'Review @image', text: 'Review /queued.png', files: [image], after: 123 };
    const ws = { id: 'a', chat: { draft: 'Unsent draft', queuedMessages: [message] } };
    const other = { id: 'b', chat: {} };
    let current = ws, _chatFiles = [originalFile], _chatCtrl = true;
    thrInput.value = 'Unsent draft';
    const curChat = () => current, chatWorking = () => true;
    const _chatStarting = new Map(), _chatSending = new Set(), _queueDraining = new Set();
    const queueIcon = '', renderChatFiles = () => {}, autosizeThreadInput = () => {}, updateChatQueue = () => {}, saveState = () => {};
    const chatMessageText = (typed, files) => [typed, ...files.map(f => f.path)].filter(Boolean).join(' ');
    const stopChatTurn = () => { throw Error('Editing must not stop the agent'); };
    const deliverChatMessage = () => { throw Error('Saving edits must not send to the agent'); };
    ${slice('  function syncSendBtn()', '  function stopChatTurn(')}
    ${slice('  function syncQueuedEditUI(', '  // The first-message title shows')}
    ${slice("  thrPage.querySelector('#sbr-thread-composer')?.addEventListener('submit'", '  function clearChatDraft(')}
    beginQueuedEdit(ws, message);
    check(thrInput.value === 'Review @image', 'Edit loads queued text into the input');
    check(_chatFiles[0].path === image.path && _chatFiles[0] !== image, 'Attachments are editable copies');
    check(thrSend.getAttribute('aria-label') === 'Save queued message', 'Composer shows save action while agent is working');
    check(thrPage.querySelector('.thr-queue-edit'), 'Editing notice and cancel control appear');
    thrInput.value = 'Updated @image';
    _chatFiles.push({ name: 'extra.png', path: '/extra.png', image: true });
    thrInput.form.requestSubmit(thrSend);
    check(message.typed === 'Updated @image' && message.files.length === 2, 'Submit saves text and attachments');
    check(message.id === 'q1' && message.after === 123 && ws.chat.queuedMessages.length === 1, 'Save preserves queue order and dispatch metadata');
    check(thrInput.value === 'Unsent draft' && _chatFiles[0] === originalFile, 'Save restores the previous draft');
    check(!ws._editingQueued && !thrPage.querySelector('.thr-queue-edit'), 'Save exits editing');
    beginQueuedEdit(ws, message);
    thrInput.value = 'Discard me'; _chatFiles.pop();
    thrPage.querySelector('.thr-queue-edit button').click();
    check(message.typed === 'Updated @image' && message.files.length === 2, 'Cancel leaves queued content intact');
    check(thrInput.value === 'Unsent draft', 'Cancel restores the draft');
    beginQueuedEdit(ws, message);
    current = other; syncSendBtn();
    check(!thrPage.querySelector('.thr-queue-edit'), 'Editing controls do not leak to another thread');
    current = ws; syncSendBtn();
    check(thrPage.querySelector('.thr-queue-edit'), 'Returning to thread restores editing controls');
    finishQueuedEdit(ws, false);
    return 'PASS: queued edits use the composer, save without dispatch, preserve attachments and order, restore drafts, cancel, and isolate thread controls';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
