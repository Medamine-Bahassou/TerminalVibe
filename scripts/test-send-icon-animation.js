const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..'), timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } }); await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, 'workspace.css'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const functions = source.slice(source.indexOf('  function syncSendBtn()'), source.indexOf('  function stopChatTurn('));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.body.innerHTML = '<div id="sbr-thread"><button class="thr-send"></button></div>';
    document.body.classList.add('ui-animations');
    const thrSend = document.querySelector('button'), thrInput = { value: 'hello' }, tab = { id: 'a' };
    const curChat = () => tab, syncQueuedEditUI = () => {}, _chatFiles = [], _chatStarting = new Map(), queueIcon = '<svg></svg>';
    let working = false, _chatCtrl = false, reduced = false;
    const chatWorking = () => working;
    const iconAnimations = () => [...thrSend.querySelectorAll('.thr-send-icon')].flatMap(icon => icon.getAnimations());
    window.matchMedia = () => ({ matches: reduced });
    ${functions}
    syncSendBtn();
    const rect = thrSend.getBoundingClientRect();
    working = true; syncSendBtn();
    check(thrSend.getAttribute('aria-label') === 'Steer' && thrSend.querySelector('.ph-arrow-elbow-up-right'), 'Steer action and icon update immediately');
    check(thrSend.querySelectorAll('.thr-send-icon').length === 2 && iconAnimations().length === 2, 'Icon switches must crossfade');
    await wait(20); _chatCtrl = true; syncSendBtn();
    await wait(20); thrInput.value = ''; _chatCtrl = false; syncSendBtn();
    check(thrSend.getAttribute('aria-label') === 'Stop' && !thrSend.disabled, 'Rapid changes keep the latest button action');
    // Hidden Chromium windows may not advance the rendering timeline; finish it explicitly.
    iconAnimations().forEach(animation => animation.finish());
    await wait(0);
    check(thrSend.querySelectorAll('.thr-send-icon').length === 1 && thrSend.querySelector('.ph-stop'), 'Outgoing icons must be removed after rapid switches');
    check(thrSend.getBoundingClientRect().width === rect.width && thrSend.getBoundingClientRect().height === rect.height, 'Transitions must not shift the button');
    reduced = true; working = false; thrInput.value = 'hello'; syncSendBtn();
    check(thrSend.querySelectorAll('.thr-send-icon').length === 1 && !iconAnimations().length, 'Reduced motion must switch icons immediately');
    reduced = false; document.body.classList.remove('ui-animations'); working = true; syncSendBtn();
    check(!iconAnimations().length, 'Animations setting must be respected');
    return 'PASS: smooth icon crossfades, rapid mode changes, no layout shift, reduced motion and animations setting';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
