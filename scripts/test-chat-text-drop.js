const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const hook = source.slice(source.indexOf('      editor._insertDroppedText ='), source.indexOf("      editor.addEventListener('keydown'", source.indexOf('      editor._insertDroppedText =')));
  const handlers = source.slice(source.indexOf('  const thrComposer ='), source.indexOf('  // ── Chat zoom:', source.indexOf('  const thrComposer =')));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<div id="sbr-thread"><form id="sbr-thread-composer"><div contenteditable="true">abcDEF</div><textarea></textarea></form></div>';
    const thrPage = document.getElementById('sbr-thread'), thrInput = document.querySelector('textarea'), editor = document.querySelector('[contenteditable]');
    thrInput.value = 'abcDEF'; thrInput.setSelectionRange(3, 3);
    const threadPart = () => editor, THREAD_DRAG = 'application/x-terminalvibe-thread';
    const isFileDrag = e => e.dataTransfer.types.includes('Files');
    let terminalDrops = 0, sends = 0, edits = 0, attached = 0, threads = 0;
    document.body.addEventListener('drop', () => terminalDrops++);
    document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); sends++; });
    const applyDraft = (value, caret) => { edits++; thrInput.value = value; thrInput.setSelectionRange(caret, caret); };
    const rememberChatEditorSelection = () => {};
    document.caretRangeFromPoint = () => null;
    const addChatFiles = () => attached++, addChatThreadRef = () => threads++;
    ${hook}
    ${handlers}
    const transfer = new DataTransfer(); transfer.setData('text/plain', '<tag>\\r\\ntext');
    const over = new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }); editor.dispatchEvent(over);
    check(over.defaultPrevented, 'Text drags must be accepted');
    const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }); editor.dispatchEvent(drop);
    check(drop.defaultPrevented && thrInput.value === 'abc<tag>\\ntextDEF', 'Dropped text must insert literally at the caret and preserve newlines');
    check(edits === 1 && !sends && !terminalDrops, 'Drops must be undoable draft edits without submitting or reaching the terminal');
    const files = new DataTransfer(); files.items.add(new File(['x'], 'image.png', { type: 'image/png' }));
    editor.dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }));
    check(attached === 1, 'File drops must still attach files');
    const thread = new DataTransfer(); thread.setData(THREAD_DRAG, 'thread-id'); thread.setData('text/plain', 'thread title');
    editor.dispatchEvent(new DragEvent('drop', { dataTransfer: thread, bubbles: true, cancelable: true }));
    check(threads === 1 && edits === 1, 'Thread drops must retain their context-reference behavior');
    return 'PASS: text drag/drop inserts into the chat draft, preserves text, avoids terminal routing and submission, and retains file/thread drops';
  })()`)); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
