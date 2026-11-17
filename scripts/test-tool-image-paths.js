const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ctx = vm.createContext({ chatCwd: () => 'C:/project', curChat: () => ({}) });
vm.runInContext(source.slice(source.indexOf('  function chatLinkPath('), source.indexOf('  const thrInput =', source.indexOf('  function chatLinkPath('))), ctx);
assert.equal(ctx.chatLinkPath('/C:/Users/user/image.png').path, 'C:/Users/user/image.png');
assert.equal(ctx.chatLinkPath('/C:\\Users\\user\\image.png').path, 'C:\\Users\\user\\image.png');
assert.equal(ctx.chatLinkPath('/\\\\server\\share\\image.png').path, '\\\\server\\share\\image.png');
assert.equal(ctx.chatLinkPath('/home/user/image.png').path, '/home/user/image.png');
assert.equal(ctx.chatLinkPath('images/test.png').path, 'C:/project/images/test.png');
assert.equal(ctx.chatLinkPath('/C:/project/file.js:12:3').line, '12');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const paths = source.slice(source.indexOf('  function chatLinkPath('), source.indexOf('  const thrInput =', source.indexOf('  function chatLinkPath(')));
  const image = source.slice(source.indexOf('  const toolImageHtml ='), source.indexOf('  const clockTime =', source.indexOf('  const toolImageHtml =')));
  const loaderStart = source.indexOf("    flow.querySelectorAll('img.thr-img').forEach(async img =>");
  const loader = source.slice(loaderStart, source.indexOf('    // Image actions:', loaderStart));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const escHtml = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const chatCwd = () => 'C:/project', curChat = () => ({}), fmtBytes = n => n + ' B';
    const _thrImgCache = new Map(), _thrImgSize = new Map();
    const reads = [];
    window.electronAPI = { readImageFile: async p => {
      reads.push(p);
      return p === 'C:/Users/user/image.png' ? { mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=' } : { error: 'missing' };
    } };
    ${paths}
    ${image}
    const flow = document.createElement('div'); document.body.append(flow);
    flow.innerHTML = toolImageHtml({ name: 'view_image', detail: '/C:/Users/user/image.png' });
    ${loader}
    await new Promise(resolve => setTimeout(resolve, 100));
    check(reads[0] === 'C:/Users/user/image.png', 'Image reader must receive the normalized Windows path');
    const img = flow.querySelector('img');
    check(img && img.complete && img.naturalWidth === 1, 'Tool image must render instead of falling back to a filename');
    return 'PASS: Windows tool paths normalize and image previews render successfully';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
