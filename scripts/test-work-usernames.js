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
  const start = source.indexOf('  function decorateWorkUsernames(');
  const helper = source.slice(start, source.indexOf('  async function refreshThreadFlow(', start));
  const settingsStart = source.indexOf('  const loadThreadSettings =');
  const settings = source.slice(settingsStart, source.indexOf('\n  };', settingsStart) + 5);
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    let threadSettings = { usernames: 'show' };
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
    decorateWorkUsernames(document);
    check(document.querySelectorAll('.thr-work-username').length === 6, 'Repeated rendering must not nest username spans');
    const saved = JSON.parse(JSON.stringify(threadSettings));
    loadThreadSettings({ usernames: 'show' });
    check(getComputedStyle(users[0]).filter === 'none', 'Show must remove blur immediately');
    loadThreadSettings(saved);
    check(getComputedStyle(users[0]).filter === 'blur(4px)', 'Restored settings must reapply blur');
    return 'PASS: username-only blur, default show, live settings, restored preferences, syntax preservation and unchanged file paths';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
