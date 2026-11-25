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
  const needleCode = source.slice(source.indexOf('  const chatErrorNeedle ='), start);
  const code = source.slice(start, source.indexOf('  async function refreshThreadFlow(', start));
  const msgStart = source.indexOf('      const msgHtml = (');
  const msgHtmlCode = source.slice(msgStart, source.indexOf("      // The agent's thinking:", msgStart));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="chat"><div class="thr-flow"><div class="thr-empty">Empty</div></div></div>';
    const thrPage = document.getElementById('chat'), tab = { chat: {} }, flow = thrPage.querySelector('.thr-flow');
    const curChat = () => tab, saveState = () => {}, onThreadPage = () => {}, markChatInterrupted = () => {}; let _flowSig = 'old';
    ${needleCode}
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
    const seg = { harness: 'antigravity' }, res = { items: [] }, ws = { chat: {} }, t = {}, texts = new Map(), resumed = new Set();
    const mdLite = s => s, clockTime = () => '', bgEventHtml = () => '', resumeStatusHtml = () => '';
    const mergePrNumber = () => 0, mergeStatusHtml = () => '', userTextHtml = () => ({ html: '', paths: [] }), threadImagesHtml = () => '';
    const ATTACHMENT_PATH_RE = /never/;
    ${msgHtmlCode}
    const quota = '⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 165h28m17s.';
    const styled = msgHtml({ role: 'assistant', text: quota, ts: new Date().toISOString() }, '0:1');
    check(styled.includes('thr-msg-error'), 'Antigravity quota replies must be styled as errors');
    check(!styled.includes('⚠') && !styled.includes('️'), 'The warning glyph must not appear twice beside the error icon');
    const emojiQuota = msgHtml({ role: 'assistant', text: '⚠️ Quota reached. Resets soon.', ts: new Date().toISOString() }, '0:3');
    check(emojiQuota.includes('thr-msg-error') && !emojiQuota.includes('⚠'), 'An emoji warning glyph must be styled as an error too');
    check(!msgHtml({ role: 'assistant', text: 'All done', ts: new Date().toISOString() }, '0:2').includes('thr-msg-error'), 'Normal replies must not be styled as errors');
    return 'PASS: errors render in chat, survive redraw and serialization, retain ordering and avoid duplicates; Antigravity quota replies use the error style';
  })()`)); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
