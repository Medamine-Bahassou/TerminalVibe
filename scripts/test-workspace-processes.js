// Isolated process-list interaction and layout checks; never opens user terminals.
const fs=require('fs'),path=require('path');
if(!process.versions.electron) {
  const r=require('child_process').spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});process.exit(r.status??1);
}
const {app,BrowserWindow}=require('electron');
const timer=setTimeout(()=>app.exit(1),20000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:800,height:700});await win.loadURL('about:blank');
  for(const file of ['style.css','workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  const src=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const helpers=src.slice(src.indexOf('  const _wsProcsCache ='),src.indexOf('  /* ═══════════════════════════════════════════════════════════════\n   C O*NTEXT MENU'));
  const tooltips=src.slice(src.indexOf('  function setupAppTooltips()'),src.indexOf("  window.addEventListener('error'"));
  const middle=src.slice(src.indexOf('  function _handleWsMiddleClick('),src.indexOf("  document.addEventListener('mousedown'",src.indexOf('  function _handleWsMiddleClick(')));
  console.log(await win.webContents.executeJavaScript(`(async()=>{
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    document.body.className='roundless';
    document.body.innerHTML='<aside id="sidebar" class="expanded" style="width:200px;min-width:0"><div class="ws-btn active" data-wsid="ws"><div class="ws-info"><span class="ws-name">Main</span><div class="ws-procs"></div></div><span class="ws-count">5</span></div></aside>';
    const sidebar=document.querySelector('#sidebar'),btn=document.querySelector('.ws-btn'),list=document.querySelector('.ws-procs');
    const terms=[{id:'a',label:'Claude one',cwd:'/one'},{id:'b',label:'Claude two',cwd:'/two'},{id:'c',label:'Build APK'},{id:'d',label:'Development server'},{id:'idle',label:'Idle shell'}];
    let names={a:'claude',b:'claude',c:'node',d:'npm',idle:'vite'},parentClicks=0,opened=[],removed=0,_suppressPasteUntil=0;
    const workspace={id:'ws'};
    const escHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const getWorkspaceTerminals=()=>terms;
    const isLiveTerminal=t=>!t.dead;
    const checkTerminalRunning=async id=>names[id];
    const findTermById=id=>{const term=terms.find(t=>t.id===id);return term?{ws:workspace,term}:null;};
    const activateWorkspace=id=>opened.push(id);
    const activateTerminal=(ws,id)=>opened.push(id);
    const removeWorkspace=()=>removed++;
    ${helpers}
    ${tooltips}
    setupAppTooltips();
    ${middle}
    btn.addEventListener('click',()=>parentClicks++);
    document.addEventListener('mousedown',e=>{if(e.button===1)_handleWsMiddleClick(e);},true);
    const update=async()=>{updateWorkspaceProcs(workspace,btn);await Promise.resolve();await Promise.resolve();};
    await update();
    const count=list.lastElementChild, tip=document.querySelector('.ui-tooltip');
    check(list.children.length===4 && count.textContent==='+1','Workspace must show three processes then the remaining count');
    check([...list.children].slice(0,3).map(row=>row.textContent).join(',')==='2claude,node,npm' && list.firstElementChild.querySelector('.ws-proc-count')?.textContent==='2' && !count.hasAttribute('aria-expanded'),'Duplicate processes must collapse into one row with a count');
    check(!list.querySelector('button:not(.ws-proc-more),a'),'Inline processes must not be clickable controls');
    list.firstElementChild.click();check(opened.length===0 && parentClicks===1,'Process row must activate its workspace card exactly once');
    list.firstElementChild.querySelector('span:not(.ws-proc-count)').click();check(parentClicks===2,'Process name must activate its workspace card');
    list.firstElementChild.querySelector('i,svg').dispatchEvent(new MouseEvent('click',{bubbles:true}));check(parentClicks===3,'Process icon must activate its workspace card');
    for(const width of [200,136,280]) {
      sidebar.style.width=width+'px';
      check(count.getBoundingClientRect().right<=sidebar.getBoundingClientRect().right,'Count overflows sidebar');
    }
    count.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,750));
    check(tip.classList.contains('show') && tip.classList.contains('ws-process-tooltip'),'Process tooltip did not appear');
    check(tip.querySelector('.ws-process-tooltip-heading').textContent==='Main','Tooltip lost workspace heading');
    const rows=[...tip.querySelectorAll('.ws-process-tooltip-row')];
    check(rows.map(row=>row.textContent).join(',')==='claude,claude,node,npm,vite','Tooltip lost processes or duplicates');
    check(rows.every(row=>row.querySelector('.ws-proc-icon')) && !tip.querySelector('button,a'),'Tooltip processes must be read-only with icons');
    check(tip.getBoundingClientRect().left>=btn.getBoundingClientRect().right,'Tooltip must appear to the right');
    check(btn.getAttribute('aria-describedby')===tip.id,'Tooltip is not accessible');
    for (const area of [btn,btn.querySelector('.ws-name'),btn.querySelector('.ws-count'),list.firstElementChild,count]) {
      area.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
      check(tip.classList.contains('show') && btn.getAttribute('aria-describedby')===tip.id,'Moving inside workspace changed or dismissed the tooltip');
    }
    await update();check(list.lastElementChild===count,'Polling replaced the count');
    names.b='go';_wsProcsCache.clear();await update();
    await Promise.resolve();
    check(list.lastElementChild===count && count.textContent==='+2','Live remaining count is incorrect or replaced');
    check(tip.querySelectorAll('.ws-process-tooltip-row').length===5,'Visible tooltip did not refresh');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    check(!tip.classList.contains('show') && !btn.hasAttribute('aria-describedby'),'Escape did not dismiss tooltip');
    count.click();check(opened.length===0 && parentClicks===4 && list.children.length===4,'Remaining count must activate workspace without expanding the process list');
    check(count.tagName==='SPAN' && !list.querySelector('button,a'),'Process details must not create nested interactive controls');
    for(const area of [btn,btn.querySelector('.ws-name'),btn.querySelector('.ws-info'),btn.querySelector('.ws-count')]) area.click();
    check(parentClicks===8,'Card, title, empty info space and tab count must all activate the workspace');
    count.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:1}));check(removed===0,'Count middle click closed workspace');
    btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:1}));check(removed===1,'Workspace middle click no longer works');
    for (const total of [3,2,1]) {
      names={a:total>=1?'claude':'bash',b:total>=2?'node':'zsh',c:total>=3?'npm':'bash',d:'bash',idle:'bash'};
      _wsProcsCache.clear();await update();
      check(list.children.length===total && !list.querySelector('.ws-proc-more'),'Count should be hidden with three or fewer processes');
    }
    names.a='bash';_wsProcsCache.clear();await update();check(list.children.length===0 && !btn.dataset.tipProcesses,'Empty process list left controls behind');
    btn.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));
    btn.querySelector('.ws-name').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,750));
    check(tip.classList.contains('show') && tip.textContent==='Main' && tip.getBoundingClientRect().left>=btn.getBoundingClientRect().right,'Idle workspace tooltip must also appear on the right');
    return 'PASS: three inline processes plus remaining count, right-side tooltip, complete read-only process list, icons, duplicates, accessibility, whole-card click activation and middle-click safety, stable polling and live updates';
  })()`));
  clearTimeout(timer);app.exit(0);
}).catch(e=>{console.error(e);clearTimeout(timer);app.exit(1);});
