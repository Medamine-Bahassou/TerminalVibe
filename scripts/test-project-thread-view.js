const fs = require('node:fs'), path = require('node:path');
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio:'inherit', env:{...process.env, ELECTRON_RUN_AS_NODE:''},
  });
  process.exit(result.status ?? 1);
}
const {app, BrowserWindow} = require('electron');
const root = path.join(__dirname, '..');
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1200,height:800});
  await win.loadURL('about:blank');
  for (const file of ['style.css','workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(root,file),'utf8'));
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'project-thread-view.js'),'utf8'));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<main id="main" style="width:980px;height:700px;flex:none"><div id="pane-area"></div><div id="statusbar"></div></main>';
    const main = document.getElementById('main');
    let serial = 0, launches = [], focused, fail = false, changed = 0;
    const terminals = [];
    const api = {
      id:()=>String(++serial), terminals:()=>terminals, resize:()=>{}, changed:()=>changed++,
      focus:(ws,id)=>focused=id,
      launch:(ws, opts)=>{
        if(fail) throw Error('Backend disconnected');
        launches.push(opts);
        const t = {id:'term-'+serial, term:{buffer:{active:{length:2,getLine:i=>({translateToString:()=>['prompt','<script>agent output</script>'][i]})}}}};
        terminals.push(t); return t;
      },
    };
    const ws = {id:'w',label:'My thread',projectId:'p'};
    const projects = [{id:'p',name:'Project',cwd:'/tmp/project with spaces'},{id:'q',name:'Other',cwd:'/tmp/other'}];
    const view = new window.ProjectThreadView(main,api);
    view.render(ws,projects);
    check(main.classList.contains('thread-choosing-agent'), 'New thread did not show agent selection');
    check(document.querySelectorAll('.thread-agent-card').length===4, 'Missing agent cards');
    check(view.historyList.textContent.includes('Your thread starts here'), 'Missing empty history');
    const choose = provider => document.querySelector('[aria-label="Open '+provider+'"]');
    choose('Claude Code').click();
    check(launches.length===1 && launches[0].cwd===projects[0].cwd && launches[0].cmd==='claude', 'Wrong CLI or directory');
    check(!main.classList.contains('thread-choosing-agent') && terminals[0].keepOnExit, 'Terminal not shown or exit diagnostics lost');
    check(ws.threadRuns.length===1 && ws.threadRuns[0].output.includes('agent output'), 'Session/output not recorded');
    check(!view.history.querySelector('script'), 'Terminal output interpreted as HTML');
    view.showPicker(true); choose('Claude Code').click();
    check(launches.length===1 && focused===terminals[0].id, 'Existing agent duplicated');
    view.showPicker(true);
    const select=document.querySelector('.thread-folder-select'); select.value='q'; select.dispatchEvent(new Event('change'));
    choose('Codex').click();
    check(ws.projectId==='q' && launches[1].cwd==='/tmp/other' && launches[1].cmd==='codex', 'Folder selection did not affect new agent');
    check(ws.threadRuns.length===2, 'Switching agent lost history');
    // Two columns and a right history panel at desktop width.
    view.showPicker(true);
    const picker=view.chooser.getBoundingClientRect(), history=view.history.getBoundingClientRect();
    check(history.left>=picker.right-1 && history.width>=240, 'History not beside center workspace');
    check(view.chooser.querySelector('.thread-agent-grid').getBoundingClientRect().width<=picker.width, 'Agent grid overflows');
    view.render({id:'normal'},projects);
    check(!main.classList.contains('has-project-thread') && view.history.hidden, 'Normal workspace still shows thread UI');
    const saved=JSON.parse(JSON.stringify(ws));
    view.dispose();
    const restored=new window.ProjectThreadView(main,api); restored.render(saved,projects);
    check(saved.threadRuns.length===2 && launches.length===2, 'Restore lost history or launched agent');
    check(saved.threadRuns[0].output.includes('agent output'), 'Restore overwrote history with new shell');
    check(restored.historyList.textContent.includes('Saved session'), 'Restored history claims a running session');
    fail=true; choose('Gemini CLI').click();
    check(restored.status.textContent==='Backend disconnected' && saved.threadRuns.length===2, 'Failed launch recorded successful history');
    restored.dispose();
    check(!main.classList.contains('has-project-thread'), 'Profile teardown retained thread layout');
    return 'PASS: thread layout, four CLI cards, folder selection, live session reuse, output history, safe rendering, workspace switching, restart and launch errors';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});
