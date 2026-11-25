const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const r = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 700, show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('about:blank');
  for (const file of ['style.css', 'workspace.css']) {
    await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  }
  const result = await win.webContents.executeJavaScript(`(async () => {
    const pane = document.createElement('div');
    pane.id = 'pane-area';
    pane.style.cssText = 'position:relative;width:1000px;height:600px';
    document.body.append(pane);

    const groupBody = document.createElement('div');
    groupBody.className = 'term-group-body';
    groupBody.style.cssText = 'position:relative;width:1000px;height:600px';
    pane.append(groupBody);

    // Host slot - no inline positioning, let CSS do it
    const hostSlot = document.createElement('div');
    hostSlot.className = 'term-slot chat-tab';
    hostSlot.id = 'slot-host';
    groupBody.append(hostSlot);

    // Guest slot - no inline positioning
    const guestSlot = document.createElement('div');
    guestSlot.className = 'term-slot chat-tab';
    guestSlot.id = 'slot-guest';
    groupBody.append(guestSlot);

    // Host snapshot surface
    const hostSurface = document.createElement('div');
    hostSurface.id = 'sbr-thread';
    hostSurface.className = 'sbr-page thr-snapshot';
    hostSurface.style.display = 'flex';
    hostSurface.setAttribute('aria-hidden', 'true');
    hostSurface.innerHTML = '<div class="thr-flow" style="flex:1;background:rgb(37,179,122)">Host chat</div>';
    hostSlot.append(hostSurface);

    // Bottom terminal
    const bottomTerm = document.createElement('section');
    bottomTerm.className = 'chat-bottom-terminal';
    bottomTerm.style.background = 'rgb(50,50,50)';
    bottomTerm.textContent = 'Terminal';
    hostSlot.append(bottomTerm);

    // Guest live surface
    const guestSurface = document.createElement('div');
    guestSurface.id = 'sbr-thread';
    guestSurface.className = 'sbr-page';
    guestSurface.style.display = 'flex';
    guestSurface.innerHTML = '<div class="thr-flow" style="flex:1;background:rgb(100,150,200)">Guest chat</div>';
    guestSlot.append(guestSurface);

    // Set active state: host is display:none from activateTerminal, guest is block
    hostSlot.style.display = 'none';
    guestSlot.style.display = 'block';

    // Now apply panel classes (like syncChatPanels does)
    hostSlot.classList.add('chat-panel-on', 'chat-panel-host', 'chat-bottom-open');
    guestSlot.classList.add('chat-panel-on', 'chat-panel-guest');

    // The CSS .chat-panel-on { display:block !important } should override the display:none
    
    await new Promise(r => setTimeout(r, 100));

    const hostComputed = getComputedStyle(hostSlot);
    const guestComputed = getComputedStyle(guestSlot);
    const hostSurfaceComputed = getComputedStyle(hostSurface);
    const hostSlotRect = hostSlot.getBoundingClientRect();
    const guestSlotRect = guestSlot.getBoundingClientRect();
    const hostSurfaceRect = hostSurface.getBoundingClientRect();
    const termRect = bottomTerm.getBoundingClientRect();

    return JSON.stringify({
      hostSlot: {
        display: hostComputed.display,
        right: hostComputed.right,
        width: hostSlotRect.width,
        height: hostSlotRect.height,
        visibility: hostComputed.visibility,
        inlineDisplay: hostSlot.style.display,
      },
      guestSlot: {
        display: guestComputed.display,
        left: guestComputed.left,
        width: guestSlotRect.width,
      },
      hostSurface: {
        position: hostSurfaceComputed.position,
        display: hostSurfaceComputed.display,
        width: hostSurfaceRect.width,
        height: hostSurfaceRect.height,
        inset: hostSurfaceComputed.inset,
        bottom: hostSurfaceComputed.bottom,
        visibility: hostSurfaceComputed.visibility,
      },
      terminal: {
        width: termRect.width,
        height: termRect.height,
        top: termRect.top,
      }
    }, null, 2);
  })()`);
  console.log(result);
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
