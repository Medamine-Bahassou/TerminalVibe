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
  const mentions = source.slice(source.indexOf('  function insertChatMention('), source.indexOf('  const THREAD_DRAG ='));
  const imagePattern = source.split('\n').filter(line => /^  const (IMAGE|ATTACHMENT)_PATH_RE =/.test(line)).join('\n');
  const markdownCopy = source.slice(source.indexOf('  function mdFromDom('), source.indexOf('  // Escape first, then the markdown agents use:'));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const shellQuote = text => "'" + text + "'";
    let _chatFiles = [{ mention: '[Image 1]', path: '/tmp/image one.png', image: true }, { mention: '[Image 2]', path: '/tmp/unselected.png', image: true }];
    const thrInput = document.createElement('textarea'), _thrImgSize = new Map();
    ${imagePattern}
    ${mentions}
    ${helpers}
    ${message}
    ${markdownCopy}
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
    _chatFiles = [];
    const pasted = prepareChatPastedText("Review '/tmp/image one.png' please");
    check(pasted.text === 'Review [Image 1] please' && pasted.files[0].path === '/tmp/image one.png', 'Pasting copied text must rebuild the inline image reference');
    check(_chatFiles.length === 0, 'Preparing a paste must not mutate the old undo snapshot');
    _chatFiles = pasted.files; thrInput.value = pasted.text;
    const repeated = prepareChatPastedText("'/tmp/image one.png'");
    check(repeated.files.length === 1 && repeated.text === '[Image 1]', 'Repeated pasted paths must reuse the attachment');
    const windowsPath = ['C:', 'Users', 'user', 'image.png'].join(String.fromCharCode(92));
    const windows = prepareChatPastedText("'" + windowsPath + "'");
    check(windows.files[1].path === windowsPath && windows.text === '[Image 2]', 'Windows image paths must get collision-free references');
    const sent = document.createElement('div');
    sent.innerHTML = 'Review <span class="thr-inline-ref"><a class="thr-image-ref thr-img-link"><span class="thr-inline-image-icon"><img></span><span class="thr-img-link-name">image.png</span><small>38KB</small></a></span> please';
    sent.querySelector('a').dataset.path = windowsPath;
    range.selectNodeContents(sent);
    const copiedMessage = mdFromRange(range, sent);
    check(copiedMessage === "Review '" + windowsPath + "' please", 'Sent message copy must use the image path, excluding filename and size decoration');
    _chatFiles = []; thrInput.value = '';
    const restored = prepareChatPastedText(copiedMessage);
    check(restored.text === 'Review [Image 1] please' && restored.files[0].path === windowsPath, 'Copied sent message must paste back as an image reference');
    range.selectNodeContents(sent.querySelector('.thr-img-link-name'));
    check(mdFromRange(range, sent) === "'" + windowsPath + "'", 'Selecting only the image label must retain the source path');
    range.selectNodeContents(sent.querySelector('small'));
    check(mdFromRange(range, sent) === "'" + windowsPath + "'", 'Selecting the image size must copy the image reference');
    range.setStart(sent.firstChild, 0); range.setEnd(sent.firstChild, 6);
    check(mdFromRange(range, sent) === 'Review', 'Text-only copies must not add an unselected image');
    _chatFiles = []; thrInput.value = '';
    const documents = prepareChatPastedText("Review '/tmp/report final.pdf' /tmp/notes.txt '/tmp/README'");
    check(documents.files.length === 3 && documents.files.every(file => file.image === false), 'PDF, text and extensionless files must become attachments');
    check(documents.text === 'Review [File 1] [File 2] [File 3]', 'Documents must use atomic file mentions');
    check(chatMessageText(documents.text, documents.files) === "Review '/tmp/report final.pdf' '/tmp/notes.txt' '/tmp/README'", 'Document mentions must serialize their original paths');
    _chatFiles = documents.files; thrInput.value = documents.text;
    check(prepareChatPastedText("'/tmp/report final.pdf'").files.length === 3, 'Repasting a document must reuse its attachment');
    const windowsDocument = windowsPath.replace('image.png', 'report final.pdf');
    const pastedDocument = prepareChatPastedText("'" + windowsDocument + "'");
    check(pastedDocument.files[3].path === windowsDocument && pastedDocument.text === '[File 4]', 'Windows document paths with spaces must preserve their source');
    return 'PASS: copy/paste roundtrip restores inline image references, supports Windows paths and avoids duplicate attachments';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
