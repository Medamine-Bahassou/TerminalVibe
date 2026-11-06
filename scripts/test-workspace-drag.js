// Real DOM event propagation: sidebar items must never become terminal-tab drops.
const fs = require('fs'), path = require('path');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const isolation = source.slice(source.indexOf('  function setupWorkspaceDragIsolation('), source.indexOf('  // Clipboard images take priority'));
  const handlers = source.slice(source.indexOf('  function setupGroupDragAndDrop('), source.indexOf('  function handleTerminalDrop('));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<nav id="sidebar"><div id="workspace"></div></nav><div id="pane"><div class="drag-indicator-overlay"></div></div><div id="header"></div>';
    ${isolation}
    const pane = document.getElementById('pane'), overlay = pane.querySelector('.drag-indicator-overlay');
    let sidebarDrops = 0, tabDrops = 0, nativeDrops = 0;
    document.getElementById('workspace').addEventListener('drop', () => sidebarDrops++);
    document.getElementById('header').addEventListener('drop', () => nativeDrops++);
    const isFileDrag = e => e.dataTransfer.types.includes('Files');
    const findGroupContainingTerm = () => true;
    const handleTerminalDrop = () => tabDrops++;
    ${handlers}
    setupGroupDragAndDrop(pane, {id:'group'}, {layout:{}}, overlay);
    const drag = (element, type, mime, payload = 'workspace-id') => {
      const transfer = new DataTransfer(); transfer.setData(mime, payload);
      const event = new DragEvent(type, { bubbles:true, cancelable:true, dataTransfer:transfer, clientX:10, clientY:10 });
      element.dispatchEvent(event); return event;
    };
    for (const mime of ['application/x-terminalvibe-workspace', 'application/x-terminalvibe-folder']) {
      drag(pane, 'dragenter', mime); drag(pane, 'dragover', mime); drag(pane, 'drop', mime);
      check(!overlay.classList.contains('active') && tabDrops === 0, 'Sidebar drag reached terminal split handlers');
      drag(document.getElementById('header'), 'drop', mime);
      check(nativeDrops === 0, 'Sidebar drag reached tab header');
      drag(document.getElementById('workspace'), 'drop', mime);
    }
    check(sidebarDrops === 2, 'Sidebar reordering was blocked');
    window.draggedWsId = 'legacy-workspace';
    drag(pane, 'dragover', 'text/plain'); drag(pane, 'drop', 'text/plain');
    check(!overlay.classList.contains('active') && tabDrops === 0, 'Legacy local workspace drag was misclassified');
    window.draggedWsId = null;
    drag(pane, 'dragover', 'text/plain', 'unrelated text'); drag(pane, 'drop', 'text/plain', 'unrelated text');
    check(!overlay.classList.contains('active') && tabDrops === 0, 'Plain text must not move terminals');
    window.draggedTermId = 'tab-one';
    drag(pane, 'dragenter', 'application/x-terminalvibe-tab', 'tab-one');
    drag(pane, 'dragover', 'application/x-terminalvibe-tab', 'tab-one');
    check(overlay.classList.contains('active'), 'Real tab lost its split preview');
    drag(pane, 'drop', 'application/x-terminalvibe-tab', 'tab-one');
    check(tabDrops === 1, 'Real tab splitting no longer works');
    return 'PASS: workspace/folder isolation, sidebar reordering, tab-header isolation, plain-text rejection and terminal split preservation';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
