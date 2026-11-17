// Sent image references must survive the same Markdown parser used for chat history.
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
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const imageReference = source.slice(source.indexOf('  function chatImageReferenceHtml('), source.indexOf('  function syncChatInputLinks('));
  const composerImages = source.slice(source.indexOf('  function syncChatInputLinks('), source.indexOf('  function insertChatMention('));
  const userHtml = source.slice(source.indexOf('  function userTextHtml('), source.indexOf('  const _pendingMsgs ='));
  const markdown = source.slice(source.indexOf('  function mdLite('), source.indexOf('  const toolIcon ='));
  const imageRegex = source.split('\n').filter(line => /^  const (IMAGE|ATTACHMENT)_PATH_RE =/.test(line)).join('\n');
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, msg) => { if (!ok) throw Error(msg); };
    const escHtml = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const _thrImgCache = new Map();
    const _chatAttachmentStats = new Map();
    const _thrImgSize = new Map([['/tmp/one/image.png', 83968]]), fmtBytes = n => Math.round(n / 1024) + ' KB';
    const linkFileIcon = () => 'ph-file';
    const hlCode = escHtml, codeLang = s => s, linkIconHtml = () => '', chatLinkPath = path => ({ path });
    ${imageRegex}
    ${markdown}
    ${imageReference}
    ${userHtml}
    ${composerImages}
    const scope = document.createElement('div');
    const render = text => { const result = userTextHtml(text); scope.innerHTML = result.html; return result; };
    const preview = 'data:image/png;base64,iVBORw0KGgo=';
    const thrPage = document.createElement('div'); thrPage.id = 'sbr-thread';
    thrPage.innerHTML = '<textarea id="sbr-thread-input"></textarea><div id="sbr-thread-input-links"></div>';
    document.body.append(thrPage);
    const threadPart = (surface, id) => surface.querySelector('#sbr-thread-' + id), threadSettings = { markdown: 'off' };
    const openMdTokens = () => {}, _chatFiles = [{ mention: '[Image 1]', path: '/tmp/one/image.png', name: 'image.png', preview, size: 83968 }];
    threadPart(thrPage, 'input').value = '[Image 1]';
    syncChatInputLinks();
    const inputLink = thrPage.querySelector('.thr-image-ref').outerHTML;
    const images = render('fix that i copy this /tmp/one/image.png , but i do not get the source text /tmp/two/image.png');
    check(scope.querySelectorAll('.thr-img-link').length === 2, 'Sent image references vanished');
    check(scope.querySelector('.thr-img-link-name').textContent === 'image.png', 'Image filename missing');
    check(scope.querySelector('.thr-img-size').textContent === '82KB', 'Image size missing');
    check(scope.querySelector('.thr-inline-image-icon img')?.getAttribute('src') === preview, 'Sent reference lost the input thumbnail');
    check(scope.querySelector('.thr-img-link').outerHTML === inputLink, 'Sent image reference differs from composer reference');
    check(images.paths.length === 2 && scope.querySelectorAll('.thr-img-link')[1].dataset.path === '/tmp/two/image.png', 'Image paths changed');
    check(!scope.querySelector('code'), 'Image path became an empty code pill');
    render('Use \`code\` with /tmp/one/image.png and \`more code\`');
    check(scope.querySelectorAll('code').length === 2 && scope.querySelector('code').textContent === 'code', 'Images corrupted inline code');
    check(scope.querySelector('.thr-img-link')?.dataset.path === '/tmp/one/image.png', 'Mixed code and image lost link');
    render('Compare "/tmp/folder with spaces/image.png" to /tmp/one/image.png');
    check(scope.querySelectorAll('.thr-img-link').length === 2 && scope.querySelector('.thr-img-link').dataset.path === '/tmp/folder with spaces/image.png', 'Quoted image path lost');
    render('> quoted context\\n\\nSee /tmp/one/image.png');
    check(scope.querySelector('.thr-cite') && scope.querySelector('.thr-img-link'), 'Citation and image references interfere');
    const docs = render("Review '/tmp/report final.pdf' /tmp/notes.txt '/tmp/README'");
    check(scope.querySelectorAll('.thr-img-link').length === 3 && docs.paths.length === 0, 'Documents must render as links without image previews');
    check(scope.querySelector('.thr-img-link-name').textContent === 'report final.pdf', 'Document filename missing');
    check(!scope.querySelector('img'), 'Documents must use a file icon');
    const revealed = [], previews = [];
    let statReads = 0;
    window.electronAPI = { showInFolder: path => revealed.push(path), attachmentInfo: async path => { statReads++; return { size: 2048 }; } };
    const openClaudeRefViewer = (...args) => previews.push(args);
    openChatAttachment({ path: '/tmp/report final.pdf' });
    openChatAttachment({ path: '/tmp/notes.txt' });
    openChatAttachment({ path: '/tmp/one/image.png' });
    check(revealed.length === 0 && previews.length === 3 && previews[0][1].kind === 'text-file' && previews[2][1].kind === 'file', 'Documents must open text previews while images retain their image viewer');
    document.body.append(scope);
    hydrateChatAttachmentSizes(scope); hydrateChatAttachmentSizes(scope);
    await new Promise(resolve => setTimeout(resolve, 0));
    check(statReads === 3 && [...scope.querySelectorAll('.thr-img-size')].every(label => label.textContent === '2KB'), 'Document sizes must load from file metadata without duplicate reads');
    render('Use https://example.com/report.pdf');
    check(!scope.querySelector('.thr-img-link'), 'Web URLs must not become local attachments');
    return 'PASS: sent image links, shared composer/message thumbnail, filename, size, original paths, inline code, spaces and citations';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
