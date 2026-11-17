const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const queue = source.slice(source.indexOf('  function renderChatQueue('), source.indexOf('  function updateChatQueue('));
  const start = source.indexOf('      if (curChat() === ws) {', source.indexOf('  async function deliverChatMessage('));
  const pending = source.slice(start, source.indexOf("      _flowSig = '';", start));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="chat"><div class="thr-flow" style="height:200px;overflow:auto;overflow-anchor:none"><div style="height:1000px">History</div><div id="queue"></div></div></div>';
    const thrPage = document.getElementById('chat'), flow = thrPage.querySelector('.thr-flow'), box = document.getElementById('queue');
    const ws = { id: 'chat', chat: { queuedMessages: [] } }, curChat = () => ws;
    const threadPart = (_surface, id) => id === 'flow' ? flow : id === 'queue' ? box : null;
    const hydrateChatFiles = () => {}, escHtml = String, queuedMessageTextHtml = () => 'Queued content';
    ${queue}
    flow.scrollTop = flow.scrollHeight - flow.clientHeight - 20;
    let before = flow.scrollTop;
    ws.chat.queuedMessages = [{ id: 'q', typed: 'Queued', files: [] }];
    renderChatQueue(ws);
    check(flow.scrollTop === before, 'Queue updates must not pull readers down even 20px from the bottom');
    flow.scrollTop = flow.scrollHeight;
    ws.chat.queuedMessages.push({ id: 'q2', typed: 'Second', files: [] }); renderChatQueue(ws);
    check(flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1, 'Queue updates must follow when already at the bottom');
    const pendingHtml = () => '<div class="thr-pending" style="height:150px">New message</div>', syncWorking = () => {};
    flow.scrollTop = flow.scrollHeight - flow.clientHeight - 10; before = flow.scrollTop;
    ${pending}
    check(flow.scrollTop === before, 'Sending while reading history must not jump to the end');
    flow.scrollTop = flow.scrollHeight;
    ${pending}
    check(flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1, 'Sending from the bottom must continue following');
    return 'PASS: queue updates and outgoing messages only follow at the exact bottom, preserving readers near the end';
  })()`)); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
