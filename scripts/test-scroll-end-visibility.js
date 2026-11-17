const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }); process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = source.indexOf('  function syncScrollEnd()');
  const helper = source.slice(start, source.indexOf('  let scrollEndFrame', start));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.style.margin = '0';
    document.body.innerHTML = '<div id="chat"><div class="thr-flow" style="box-sizing:border-box;height:200px;overflow:auto;padding-bottom:100px"><div style="height:1000px">Messages</div><div hidden>Empty queue</div></div><div class="thr-composer-wrap" style="position:fixed;top:200px;height:100px"><button>Scroll to end</button></div></div>';
    const thrPage = document.getElementById('chat'), flowEl = thrPage.querySelector('.thr-flow'), scrollEndBtn = thrPage.querySelector('button');
    ${helper}
    flowEl.scrollTop = flowEl.scrollHeight; syncScrollEnd();
    check(scrollEndBtn.hidden, 'Button must be hidden at the physical bottom');
    flowEl.scrollTop -= 20; const top = flowEl.scrollTop; syncScrollEnd();
    check(scrollEndBtn.hidden, 'Empty composer padding must not cause a false scroll-to-end button');
    check(flowEl.scrollTop === top, 'Visibility updates must never force scrolling');
    flowEl.scrollTop -= 150; syncScrollEnd();
    check(!scrollEndBtn.hidden, 'Button must appear when real message content is out of view');
    flowEl.firstElementChild.style.height = '20px'; syncScrollEnd();
    check(scrollEndBtn.hidden, 'Shrinking content must hide stale scroll-to-end controls');
    return 'PASS: scroll-to-end hides at the end and over empty padding, appears for hidden messages and never changes reading position';
  })()`)); clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
