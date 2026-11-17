const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const helpers = source.slice(source.indexOf('  function chatEditorText('), source.indexOf('  function rememberChatEditorSelection('));
  const message = source.slice(source.indexOf('  function chatMessageText('), source.indexOf('  function renderChatFiles('));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const shellQuote = text => "'" + text + "'";
    const _chatFiles = [{ mention: '[Image 1]', path: '/tmp/image one.png', image: true }, { mention: '[Image 2]', path: '/tmp/unselected.png', image: true }];
    ${helpers}
    ${message}
    const editor = document.createElement('div'); editor.contentEditable = 'true';
    editor.innerHTML = 'Review <span contenteditable="false" data-mention="[Image 1]"><a><img><span>image.png</span><small>138KB</small></a></span> please';
    document.body.append(editor);
    const selection = window.getSelection(), range = document.createRange();
    const copy = () => {
      let result;
      copyChatInputSelection({ preventDefault() {}, clipboardData: { setData: (type, text) => { check(type === 'text/plain', 'Must copy plain source text'); result = text; } } }, editor);
      return result;
    };
    range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
    check(copy() === "Review '/tmp/image one.png' please", 'Copy must preserve text and resolve the image reference to its source path');
    range.selectNodeContents(editor.querySelector('a > span')); selection.removeAllRanges(); selection.addRange(range);
    check(copy() === "'/tmp/image one.png'", 'Copying an image label must resolve its atomic reference');
    range.setStart(editor.firstChild, 0); range.setEnd(editor.firstChild, 6); selection.removeAllRanges(); selection.addRange(range);
    check(copy() === 'Review', 'Text-only selections must not append unrelated attachments');
    return 'PASS: input copy preserves text, image source paths and atomic references without filename/size UI decoration';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
