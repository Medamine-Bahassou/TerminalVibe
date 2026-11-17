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
  const userHtml = source.slice(source.indexOf('  function userTextHtml('), source.indexOf('  const _pendingMsgs ='));
  const markdown = source.slice(source.indexOf('  function mdLite('), source.indexOf('  const toolIcon ='));
  const imageRegex = source.split('\n').find(line => line.startsWith('  const IMAGE_PATH_RE ='));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, msg) => { if (!ok) throw Error(msg); };
    const escHtml = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const _thrImgSize = new Map([['/tmp/one/image.png', 83968]]), fmtBytes = n => Math.round(n / 1024) + ' KB';
    const hlCode = escHtml, codeLang = s => s, linkIconHtml = () => '', chatLinkPath = path => ({ path });
    ${imageRegex}
    ${markdown}
    ${userHtml}
    const scope = document.createElement('div');
    const render = text => { const result = userTextHtml(text); scope.innerHTML = result.html; return result; };
    const images = render('fix that i copy this /tmp/one/image.png , but i do not get the source text /tmp/two/image.png');
    check(scope.querySelectorAll('.thr-img-link').length === 2, 'Sent image references vanished');
    check(scope.querySelector('.thr-img-link-name').textContent === 'image.png', 'Image filename missing');
    check(scope.querySelector('.thr-img-size').textContent === '82 KB', 'Image size missing');
    check(scope.querySelector('.thr-inline-image-icon'), 'Image reference icon missing');
    check(images.paths.length === 2 && scope.querySelectorAll('.thr-img-link')[1].dataset.path === '/tmp/two/image.png', 'Image paths changed');
    check(!scope.querySelector('code'), 'Image path became an empty code pill');
    render('Use \`code\` with /tmp/one/image.png and \`more code\`');
    check(scope.querySelectorAll('code').length === 2 && scope.querySelector('code').textContent === 'code', 'Images corrupted inline code');
    check(scope.querySelector('.thr-img-link')?.dataset.path === '/tmp/one/image.png', 'Mixed code and image lost link');
    render('Compare "/tmp/folder with spaces/image.png" to /tmp/one/image.png');
    check(scope.querySelectorAll('.thr-img-link').length === 2 && scope.querySelector('.thr-img-link').dataset.path === '/tmp/folder with spaces/image.png', 'Quoted image path lost');
    render('> quoted context\\n\\nSee /tmp/one/image.png');
    check(scope.querySelector('.thr-cite') && scope.querySelector('.thr-img-link'), 'Citation and image references interfere');
    return 'PASS: sent image links, filename, icon, size, original paths, inline code, spaces and citations';
  })()`));
  clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
