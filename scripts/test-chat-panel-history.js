// A merged chat is visible even when tab activation gives its slot display:none.
const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const r = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  for (const file of ['style.css', 'workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const loaders = source.slice(source.indexOf('  async function refreshThreadFlow('), source.indexOf('  function renderThreadFlow('));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div class="ws-pane-container"><div id="host"><div class="thr-flow"></div></div><div id="side"><div class="thr-flow"></div></div></div>';
    const host = { el: document.getElementById('host'), chat: { storeId: 'host' } };
    const side = { el: document.getElementById('side'), chat: { storeId: 'side' } };
    // Each fixture surface owns its flow, as in the real app.
    for (const tab of [host, side]) {
      const surface = document.createElement('div');
      surface.append(tab.el.firstChild); tab.el.append(surface);
    }
    let current = host, thrPage = host.el.firstChild, resolveRead;
    const curChat = () => current, threadSegments = () => [{}], threadMeta = tab => tab.chat;
    const pendingMessages = () => [], chatWorking = () => false;
    const renderThreadFlow = (_tab, _surface, flow, _segs, history) => {
      const message = document.createElement('div'); message.textContent = history[0].items[0].text;
      flow.replaceChildren(message); flow.dataset.seen = '1';
    };
    window.electronAPI = { threadHistory: () => new Promise(resolve => { resolveRead = resolve; }) };
    ${loaders}
    const finish = text => resolveRead([{ items: [{ role: 'user', text }] }]);
    for (const tab of [host, side]) {
      current = tab; thrPage = tab.el.firstChild;
      const read = refreshThreadFlow(tab);
      // Opening the merged panel or focusing its Ctrl+J terminal promotes the other chat.
      current = tab === host ? side : host; thrPage = current.el.firstChild;
      tab.el.style.display = 'none'; tab.el.classList.add('chat-panel-on');
      finish('Loaded ' + tab.chat.storeId); await read;
      check(tab.el.textContent === 'Loaded ' + tab.chat.storeId, 'Visible merged chat discarded its pending history');
    }
    current = side; thrPage = side.el.firstChild;
    const surface = host.el.firstChild, original = surface.textContent;
    host.el.classList.remove('chat-panel-on');
    const hiddenRead = refreshThreadFlow(host, surface);
    finish('Hidden update'); await hiddenRead;
    check(surface.textContent === original, 'An ordinary hidden tab accepted a late history response');
    host.el.classList.add('chat-panel-on');
    host.el.closest('.ws-pane-container').style.display = 'none';
    const hiddenWorkspace = refreshThreadFlow(host, surface);
    finish('Hidden workspace update'); await hiddenWorkspace;
    check(surface.textContent === original, 'A merged chat in a hidden workspace accepted history');
    const pane = document.createElement('div');
    pane.id = 'pane-area'; pane.style.cssText = 'position:fixed;inset:0;width:1000px;height:600px;min-height:0;flex:none';
    document.body.append(pane);
    const slot = document.createElement('div'); slot.className = 'term-slot chat-tab'; pane.append(slot);
    const page = document.createElement('div'); page.id = 'sbr-thread'; page.className = 'sbr-page'; page.style.display = 'flex';
    page.innerHTML = '<div class="thr-flow"><div>Existing message</div></div><div class="thr-composer-wrap"><textarea>Draft</textarea></div>';
    slot.append(page);
    for (const snapshot of [false, true]) {
      page.classList.toggle('thr-snapshot', snapshot);
      for (const [classes, height] of [['chat-bottom-open', 390], ['cmb-on', 564], ['cmb-on chat-bottom-open', 354]]) {
        slot.className = 'term-slot chat-tab ' + classes;
        check(Math.abs(page.offsetHeight - height) <= 1, 'Chat lost its height with ' + classes);
        check(page.querySelector('.thr-flow').offsetHeight > 0, 'History collapsed with ' + classes);
        const bounds = page.getBoundingClientRect(), composer = page.querySelector('.thr-composer-wrap').getBoundingClientRect();
        check(composer.top >= bounds.top && composer.bottom <= bounds.bottom + 1, 'Composer escaped chat with ' + classes);
      }
    }
    slot.className = 'term-slot chat-tab chat-panel-on chat-panel-host chat-cli';
    slot.style.display = 'none';
    const shell = document.createElement('div'); shell.className = 'term-wrap'; slot.append(shell);
    check(shell.getClientRects().length > 0 && getComputedStyle(shell).visibility === 'visible', 'Focusing the side chat hid the host shell');
    slot.classList.remove('chat-panel-on');
    check(!shell.getClientRects().length, 'Inactive shell tab remained visible');
    return 'PASS: chat and composer dimensions, pending history survives merged-panel focus changes; hidden tabs and workspaces stay untouched';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
