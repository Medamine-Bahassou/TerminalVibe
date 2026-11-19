const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = source.indexOf('  function syncChatInterruption(');
  const resumePrompt = source.match(/^  const resumePrompt =.*$/m)[0];
  const helpers = source.slice(start, source.indexOf('  function renderChatErrors(', start));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="chat"><div class="thr-flow"></div><textarea>Unsent draft</textarea><button id=send></button></div>';
    const thrPage = document.getElementById('chat'), tab = { id: 'chat', chat: {} }, sent = [];
    const _chatStarting = new Map(), _chatSending = new Set(), curChat = () => tab, chatWorking = () => false, uuid = () => 'message';
    const syncSendBtn = () => { document.getElementById('send').disabled = !tab.chat?.interruptedAt || !!tab._resuming; };
    const syncWorking = () => renderChatResume(tab);
    const deliverChatMessage = async (_tab, message) => { sent.push(message); await Promise.resolve(); delete tab.chat.interruptedAt; return true; };
    ${resumePrompt}
    ${helpers}
    for (const kind of ['reply', 'tool', 'crash']) {
      tab.chat = {}; syncChatInterruption(tab, [{ items: [{ role: 'assistant', interrupted: kind, ts: '2026-01-01T00:00:00Z' }] }]);
      check(tab.chat.interruptedAt, kind + ' interruptions must offer continuation');
    }
    tab.chat = {}; syncChatInterruption(tab, [{ items: [], turnState: { status: 'aborted', at: 123 } }]);
    renderChatResume(tab);
    check(thrPage.querySelector('.thr-flow').lastElementChild?.textContent.includes('Interrupted'), 'Interrupted status must appear at the bottom even with no transcript interruption marker');
    renderChatResume(tab);
    check(thrPage.querySelectorAll('.thr-interruption-status').length === 1, 'Repeated updates must not duplicate interruption status');
    const button = document.getElementById('send');
    button.onclick = () => { void continueInterruptedChat(tab); };
    check(!button.disabled && !thrPage.querySelector('.thr-continue'), 'Continuation must enable the composer control without adding a transcript button');
    button.click(); button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    check(sent.length === 1 && sent[0].text === 'continue from where you left' && sent[0].typed === sent[0].text && sent[0].resume === true, 'Click must send the exact continuation query once');
    check(document.querySelector('textarea').value === 'Unsent draft' && sent[0].files.length === 0, 'Continuing must not consume the current draft or attachments');
    check(!thrPage.querySelector('.thr-interruption-status'), 'Continuation must clear the pending interruption status');
    check(button.disabled && !thrPage.querySelector('.thr-continue'), 'Successful continuation must reset the composer control');
    tab.chat = JSON.parse(JSON.stringify({ interruptions: [{ at: 100 }, { at: 300 }] }));
    const flow = thrPage.querySelector('.thr-flow');
    flow.innerHTML = '<div class="thr-msg user" data-ts="200">Next message</div><div class="thr-msg user" data-ts="400">Another message</div>';
    renderChatResume(tab);
    check(flow.querySelectorAll('.thr-interruption-status').length === 2, 'Each saved interruption must survive new messages and restored history');
    check(flow.querySelector('[data-ts="200"]').previousElementSibling.dataset.interruptedAt === '100', 'First interruption must precede the next message');
    check(flow.querySelector('[data-ts="400"]').previousElementSibling.dataset.interruptedAt === '300', 'Second interruption must remain in its own turn');
    renderChatResume(tab);
    check(flow.querySelectorAll('.thr-interruption-status').length === 2, 'History updates must not duplicate interruptions');
    tab.chat = { interruptions: [{ at: 300 }] };
    flow.innerHTML = '<div class="thr-seg">Previous model</div><div class="thr-msg user" data-ts="200">Stopped prompt</div>'
      + '<div class="thr-seg">Next model</div><div class="thr-note">Session note</div><div class="thr-msg user" data-ts="400">Continue</div>';
    renderChatResume(tab);
    const resumedHeader = flow.querySelectorAll('.thr-seg')[1], stopped = resumedHeader.previousElementSibling;
    check(stopped.dataset.interruptedAt === '300' && stopped.previousElementSibling.dataset.ts === '200', 'The interruption must sit between the stopped turn and the next model header');
    stopped.classList.remove('thr-interruption-status');
    renderChatResume(tab);
    check(flow.querySelectorAll('.thr-status-line').length === 1, 'A model header must not cause a duplicate transcript interruption');
    tab.chat = { interruptions: [{ at: 300, promptTs: 400 }] };
    flow.innerHTML = '<div class="thr-msg user" data-ts="400">First message</div><div class="thr-msg user" data-ts="500">Next message</div>';
    renderChatResume(tab);
    check(flow.querySelector('[data-ts="400"]').nextElementSibling.dataset.interruptedAt === '300', 'An interruption before the first transcript write belongs after the stopped prompt');
    tab.chat = { lastContinueAt: 1000 }; syncChatInterruption(tab, [{ items: [], turnState: { status: 'aborted', at: 123 } }]);
    check(!tab.chat.interruptedAt, 'Old interruptions must not reappear after continuation');
    return 'PASS: reply/tool/crash/aborted interruptions show Continue; play sends exact query once without consuming drafts';
  })()`)); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
