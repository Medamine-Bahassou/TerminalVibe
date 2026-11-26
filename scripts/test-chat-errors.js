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
  const loginStart = source.indexOf('  const PROV_LOGIN =');
  const loginCode = source.slice(loginStart, source.indexOf('  const PROV_ENV_NAME', loginStart));
  const quoteStart = source.indexOf('  function shellQuote(');
  const quoteCode = source.slice(quoteStart, source.indexOf('\n  // Dropped files', quoteStart));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="chat"><div class="thr-flow"><div class="thr-empty">Empty</div></div></div>';
    const thrPage = document.getElementById('chat'), tab = { chat: {} }, flow = thrPage.querySelector('.thr-flow');
    const curChat = () => tab, saveState = () => {}, onThreadPage = () => {}, markChatInterrupted = () => {}; let _flowSig = 'old';
    const settingsOverlay = document.createElement('div'), activeWsId = 'workspace', _prov = null;
    const terminalBackendPlatform = 'linux', _chatAgentsFound = { claude: '/CLI tools/claude' };
    const closeSettings = () => { throw Error('Chat sign-in must work without Settings open'); };
    const harnessOf = id => ({ id, bin: id, name: 'Claude Code' });
    const launches = [], addTerminal = (...args) => launches.push(args);
    ${quoteCode}
    ${loginCode}
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
    check(!flow.querySelector('button'), 'Usage errors must have no sign-in action');
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
    const expired = 'Failed to authenticate: OAuth session expired and could not be refreshed';
    flow.replaceChildren();
    tab.chat = {};
    noteChatError(tab, 'Claude Code: ' + expired);
    const signIn = '.thr-claude-sign-in';
    check(flow.querySelector('.thr-chat-error > ' + signIn)?.textContent === 'Sign in to Claude', 'Expired Claude OAuth must offer sign-in');
    flow.querySelector(signIn).click();
    check(launches.length === 1 && launches[0][0] === activeWsId && launches[0][2].cmd === "'/CLI tools/claude' auth login", 'Sign-in must start the discovered Claude CLI in a terminal');
    seg.harness = 'claude';
    const weeklyLimit = "You've hit your weekly limit · resets 8am (Africa/Casablanca)";
    const firstAt = Date.now();
    flow.innerHTML = msgHtml({ role: 'assistant', text: weeklyLimit }, '0:5')
      + msgHtml({ role: 'user', text: 'Queued follow-up', ts: new Date(firstAt + 1000).toISOString() }, '0:6')
      + msgHtml({ role: 'assistant', text: weeklyLimit }, '0:7');
    renderChatErrors({ chat: { errors: [{ at: firstAt, message: 'Claude Code: ' + weeklyLimit }] } }, flow);
    check(flow.querySelectorAll('.thr-msg.assistant.thr-msg-error').length === 2, 'A queued follow-up must show its Claude limit error even without a second saved error event');
    check(!flow.querySelector('.thr-chat-error, ' + signIn), 'Claude limit replies must appear once per turn without a sign-in action');
    flow.innerHTML = msgHtml({ role: 'assistant', text: 'API Error: ' + expired }, '0:4');
    renderChatErrors({ chat: {} }, flow);
    check(flow.querySelector('.thr-msg-error > ' + signIn), 'Transcript-only OAuth errors must offer sign-in');
    renderChatErrors(tab, flow);
    check(flow.querySelectorAll(signIn).length === 1 && !flow.querySelector('.thr-chat-error'), 'A saved error and matching reply must share one sign-in action');
    return 'PASS: chat errors keep their order and deduplicate; Claude OAuth errors open terminal sign-in';
  })()`)); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
