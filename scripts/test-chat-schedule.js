// Native scheduling dialog and the real queue dispatcher, with an isolated transport.
const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const run = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(run.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dialog = markup.match(/<dialog id="chat-schedule"[\s\S]*?<\/dialog>/)[0];
const composer = source.slice(source.indexOf('  let _chatCtrl = false'), source.indexOf('  function syncQueuedEditUI('));
const queue = source.slice(source.indexOf('  function updateChatQueue('), source.indexOf('  setInterval(', source.indexOf('  async function drainChatQueue(')));
const timeout = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(`(async () => {
    const check = (condition, reason) => { if (!condition) throw Error(reason); };
    document.body.innerHTML = ${JSON.stringify(dialog)} + '<div id="chat"><form id="sbr-thread-composer"><textarea></textarea><button type="submit"></button></form></div>';
    const thrPage = document.querySelector('#chat'), thrInput = thrPage.querySelector('textarea'), thrSend = thrPage.querySelector('button');
    const tab = { id: 'chat', chat: {} };
    const curChat = () => tab, chatOpts = () => ({ harness: 'codex', access: 'default' }), findTermById = () => ({ term: tab });
    const chatMessageText = (typed, files) => typed + files.map(file => ' ' + file.path).join('');
    const _chatStarting = new Map(), _chatSending = new Set(), _queueDraining = new Set(), _turns = new Map();
    const threadPart = () => null, syncQueuedEditUI = () => {}, renderChatFiles = () => {}, renderChatQueue = () => {};
    const syncThreadComposer = () => {}, renderThreadsSidebar = () => {}, saveState = () => {};
    const sent = [];
    let _chatFiles = [], busy = false, sequence = 0;
    const chatWorking = () => busy, liveThreadAgent = () => null, uuid = () => String(++sequence);
    const deliverChatMessage = async (_, message, steer) => { sent.push({ message, steer }); return true; };
    ${composer}
    ${queue}
    const open = text => {
      thrInput.value = text;
      thrInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
      check(scheduleDialog.open && thrSend.querySelector('.ph-clock'), 'Alt+Enter did not open the scheduler or show the clock');
    };
    _chatFiles = [{ path: '/tmp/image.png' }];
    open('Delayed prompt');
    const before = Date.now();
    scheduleForm.requestSubmit();
    const delayed = tab.chat.queuedMessages[0];
    check(!thrInput.value && delayed.sendAt >= before + 50000 && delayed.files[0].path === '/tmp/image.png', 'Scheduling lost the delay, draft, or attachment');
    check(thrSend.querySelector('.ph-clock') && !sent.length, 'Scheduling should leave a clock and defer delivery');
    await drainChatQueue(tab);
    check(!sent.length, 'Future message sent too early');
    delayed.sendAt = Date.now() - 1;
    busy = true;
    await drainChatQueue(tab);
    check(!sent.length, 'Due message interrupted a working agent');
    busy = false;
    tab.chat.queuePaused = true;
    await drainChatQueue(tab);
    check(!sent.length, 'Paused queue sent a scheduled message');
    tab.chat.queuePaused = false;
    await Promise.all([drainChatQueue(tab), drainChatQueue(tab)]);
    check(sent.length === 1 && !sent[0].steer && !tab.chat.queuedMessages.length, 'Due message should start a single new turn even with no live agent');

    open('Calendar prompt');
    const { mode, date } = scheduleForm.elements;
    mode.value = 'date';
    mode.dispatchEvent(new Event('change'));
    date.value = '2000-01-01T12:00';
    scheduleForm.requestSubmit();
    check(scheduleDialog.open && !date.validity.valid, 'Past date was accepted');
    date.value = '2099-06-05T14:30';
    date.dispatchEvent(new Event('input', { bubbles: true }));
    scheduleForm.requestSubmit();
    check(tab.chat.queuedMessages[0].sendAt === new Date(2099, 5, 5, 14, 30).getTime(), 'Local date and time were converted incorrectly');
    open('Keep this draft');
    scheduleForm.querySelector('[type="button"]').click();
    check(!scheduleDialog.open && thrInput.value === 'Keep this draft', 'Cancel discarded the draft');
  })()`);
  console.log('PASS: Alt+Enter, clock, delay, local date, cancellation, and one-time delivery.');
  clearTimeout(timeout);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
