const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = source.indexOf('  function renderChatErrors(');
  const code = source.slice(start, source.indexOf('  async function refreshThreadFlow(', start));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="chat"><div class="thr-flow"><div class="thr-empty">Empty</div></div></div>';
    const thrPage = document.getElementById('chat'), tab = { chat: {} }, flow = thrPage.querySelector('.thr-flow');
    const curChat = () => tab, saveState = () => {}; let _flowSig = 'old';
    ${code}
    const message = 'Codex: Usage limit reached <script>unsafe</script>';
    noteChatError(tab, message);
    check(flow.querySelector('[role="alert"]').textContent === message, 'Errors must appear in chat');
    check(!flow.querySelector('script') && !flow.querySelector('.thr-empty'), 'Errors must be escaped and replace the empty state');
    noteChatError(tab, message);
    check(tab.chat.errors.length === 1 && flow.querySelectorAll('.thr-chat-error').length === 1, 'Repeated errors must not duplicate');
    const saved = JSON.parse(JSON.stringify(tab.chat));
    flow.innerHTML = '<div class="thr-msg user" data-ts="'+(Date.now()+10000)+'">Next message</div>';
    renderChatErrors({ chat: saved }, flow);
    check(flow.firstElementChild.classList.contains('thr-chat-error'), 'Saved errors must appear before later prompts');
    check(flow.querySelector('.thr-chat-error').textContent === message, 'Redraw must preserve errors');
    return 'PASS: errors render in chat, survive redraw and serialization, retain ordering and avoid duplicates';
  })()`)); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
