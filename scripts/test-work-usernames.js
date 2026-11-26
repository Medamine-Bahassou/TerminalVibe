const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'workspace.css'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const start = source.indexOf('  function applyWorkUsernamePrivacy(');
  const helper = source.slice(start, source.indexOf('  async function refreshThreadFlow(', start));
  const settingsStart = source.indexOf('  const loadThreadSettings =');
  const settings = source.slice(settingsStart, source.indexOf('\n  };', settingsStart) + 5);
  const privacy = source.slice(source.indexOf('  const EMAIL_RE ='), source.indexOf('  function blurTermEmails('));
  const terminalMask = source.slice(source.indexOf('  const _termUsers ='), source.indexOf('  function writePtyData('));
  const terminalDecorations = source.slice(source.indexOf('  function blurTermEmails('), source.indexOf('  // opts: { cwd, cmd, label }'));
  const termRow = source.slice(source.indexOf('  function termRow('), source.indexOf('  // Join terminal rows'));
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'vendor/xterm/xterm.js'), 'utf8'));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    let threadSettings = { usernames: 'show' };
    document.body.innerHTML = '<div class="tg-tab" data-termid="one"><span class="tg-tab-name">SampleUser</span></div>';
    const entry = { label: 'SampleUser' };
    const findTermById = () => ({ term: entry });
    ${terminalMask}
    const esc = String.fromCharCode(27);
    const prompt = esc + '[36m/mnt/c/Users/' + esc + '[1mSample' + esc + '[22mUser' + esc + '[0m ❯';
    threadSettings.usernames = 'blur';
    document.body.classList.add('blur-work-usernames');
    learnTerminalOutputUsernames(prompt);
    const hideEmails = false;
    ${source.match(/^  const EMAIL_RE = .*$/m)[0]}
    ${termRow}
    ${terminalDecorations}
    const terminal = new Terminal({ allowProposedApi: true });
    const host = document.body.appendChild(document.createElement('div'));
    terminal.open(host);
    blurTermEmails(terminal);
    await new Promise(resolve => terminal.write(prompt + String.fromCharCode(13, 10) + '/home/**** **********', resolve));
    for (let attempt = 0; attempt < 20 && !host.querySelector('.term-user-blur'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    check(host.querySelectorAll('.term-user-blur').length === 1, 'Only the redacted username should have a blur decoration');
    const blur = host.querySelector('.term-user-blur');
    check(getComputedStyle(blur).backdropFilter === 'blur(4px)' && getComputedStyle(blur).display !== 'none',
      'Username redaction must use the email blur even with email hiding turned off');
    check(terminal.buffer.active.getLine(0).translateToString(true).includes('SampleUser'),
      'Username blur must leave the terminal cells and their colors intact');
    terminal.dispose();
    const tab = document.querySelector('.tg-tab');
    check(tab.textContent === entry.label && tab.title === '**********', 'The username tab must blur the original title and mask its tooltip');
    check(tab.querySelector('.tg-tab-name').classList.contains('username-redacted'), 'The username tab must display the blur treatment');
    threadSettings.usernames = 'show';
    refreshTerminalTabLabels();
    check(tab.textContent === entry.label && tab.title === entry.label, 'Turning privacy off must restore the original title');
    return 'PASS: terminal username masking preserves ANSI colors and updates tab titles and tooltips';
  })()`));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    let threadSettings = { usernames: 'show' };
    ${terminalMask}
    const _workUsernameRecords = new Map(), _workUsernameMarkup = new WeakMap();
    const hideEmails = false, copied = [];
    window.electronAPI = { clipboardWrite: text => copied.push(text) };
    ${privacy}
    ${settings}
    ${helper}
    document.body.innerHTML = '<div id="sbr-thread"><div class="thr-tools-text"></div><pre class="thr-tool-detail"></pre><pre class="thr-tool-output"></pre><div class="thr-tool-image-path"></div><p class="thr-msg-text"></p></div>';
    const summary = document.querySelector('.thr-tools-text'), detail = document.querySelector('.thr-tool-detail'), output = document.querySelector('.thr-tool-output');
    summary.textContent = 'Read C:\\\\Users\\\\MOHAME~1\\\\image.png and /home/med/file.js';
    detail.innerHTML = 'cat /Users/<span class="tk-s">Alice</span>/image.png';
    output.textContent = '/home/bob/file.txt\\nC:/Users/Carol/project';
    document.querySelector('.thr-tool-image-path').textContent = '/C:/Users/David/image.png';
    document.querySelector('.thr-msg-text').textContent = '/home/notblurred/message';
    const original = document.getElementById('sbr-thread').textContent;
    decorateWorkUsernames(document);
    const users = [...document.querySelectorAll('.thr-work-username')];
    check(users.map(n => n.textContent).join(',') === 'MOHAME~1,med,Alice,bob,Carol,David', 'Only home-directory username components should be wrapped');
    check(document.getElementById('sbr-thread').textContent === original, 'Decorating must preserve original paths and copyable text');
    check(detail.querySelector('.tk-s'), 'Syntax highlighting must remain intact across wrapped usernames');
    check(getComputedStyle(users[0]).filter === 'none', 'Usernames must be shown by default');
    loadThreadSettings({ usernames: 'blur' });
    check(getComputedStyle(users[0]).filter === 'blur(4px)', 'Setting must blur existing work immediately');
    check(users.every(span => /^[a-f0-9]{12}$/.test(span.textContent)), 'Hidden text must be random fixed-length content, not the original username');
    check(!summary.textContent.includes('MOHAME~1') && !summary.textContent.includes('/home/med/'), 'Rendered work text must not retain actual usernames');
    check(users[0].getBoundingClientRect().width === users[1].getBoundingClientRect().width, 'Different username lengths must occupy the same width');
    check(!users[0].outerHTML.includes('MOHAME~1'), 'Username markup must not contain the original value in text or attributes');
    const snapshot = document.createElement('div'); snapshot.innerHTML = summary.outerHTML; document.body.append(snapshot);
    decorateWorkUsernames(document);
    check(document.querySelectorAll('#sbr-thread .thr-work-username').length === 6, 'Repeated rendering must not nest username spans');
    const saved = JSON.parse(JSON.stringify(threadSettings));
    loadThreadSettings({ usernames: 'show' });
    check(getComputedStyle(users[0]).filter === 'none', 'Show must remove blur immediately');
    check(document.getElementById('sbr-thread').textContent === original, 'Show must restore original usernames');
    check(detail.querySelector('.tk-s'), 'Show must restore syntax markup');
    check(snapshot.textContent.includes('MOHAME~1'), 'Cloned split panes must restore usernames when shown');
    loadThreadSettings(saved);
    check(getComputedStyle(users[0]).filter === 'blur(4px)', 'Restored settings must reapply blur');
    check(!snapshot.textContent.includes('MOHAME~1'), 'Cloned panes must also replace actual usernames when hidden');
    const selection = window.getSelection(), range = document.createRange();
    range.setStart(users[0].firstChild, 1); range.setEnd(users[0].firstChild, 4);
    selection.removeAllRanges(); selection.addRange(range);
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
    users[0].dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 50));
    check(event.defaultPrevented && copied[0]?.startsWith('[user-') && !copied[0].includes('OHA'), 'Partial username selections must copy a token, never the hidden substring');
    range.selectNodeContents(summary); selection.removeAllRanges(); selection.addRange(range);
    summary.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    check(copied[1] && !copied[1].includes('MOHAME~1') && !copied[1].includes('/home/med/'), 'Whole paths must sanitize every hidden username');
    return 'PASS: fixed-width random username substitution, show/blur settings, cloned panes, and sanitized selection copying';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
