// Cache real loader calls and exercise drawer state without accessing user chats.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
async function cacheChecks() {
  const loader=source.slice(source.indexOf('  const claudeHistoryCache ='),source.indexOf('  async function openClaudeHistory('));
  let calls=0,now=1000,complete,fail;
  const context=vm.createContext({Date:{now:()=>now},window:{electronAPI:{claudeSessions:cwd=>{calls++;return new Promise((resolve,reject)=>{complete=resolve;fail=reject;});}}}});
  vm.runInContext(loader,context);
  const first=context.loadClaudeHistory('/one'),duplicate=context.loadClaudeHistory('/one');
  assert.equal(first,duplicate);assert.equal(calls,1);
  const data={cwd:'/one',executable:'/fixture/claude',sessions:[{id:'one',title:'First conversation'}]};
  complete(data);await first;
  assert.equal(context.cachedClaudeHistory('/one'),data);
  assert.equal(await context.loadClaudeHistory('/one'),data);assert.equal(calls,1,'Fresh reopens must not scan chat logs again');
  now+=31000;const stale=context.loadClaudeHistory('/one');
  assert.equal(context.cachedClaudeHistory('/one'),data,'Stale data must remain immediately available during refresh');
  fail(Error('offline'));await assert.rejects(stale,/offline/);
  assert.equal(context.cachedClaudeHistory('/one'),data,'Failed refresh must preserve chats');
  const forced=context.loadClaudeHistory('/one',true);complete({...data,sessions:[]});await forced;assert.equal(calls,3);
  const other=context.loadClaudeHistory('/two');complete({...data,cwd:'/two'});await other;
  assert.equal(context.cachedClaudeHistory('/one').cwd,'/one');assert.equal(context.cachedClaudeHistory('/two').cwd,'/two','New-session directory metadata must not leak between projects');
  context.window.electronAPI=null;
  context.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({sessions:[],scope:'project-only'})});
  await assert.rejects(context.loadClaudeHistory('/browser'),/outdated/);
  context.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({...data,scope:'all-projects'})});
  await context.loadClaudeHistory('/browser');
  console.log('PASS: shared pending history request, cached reopens, stale/error retention, forced refresh, project isolation and browser validation');
}
if(!process.versions.electron) {
  cacheChecks().then(()=>{
    const result=require('child_process').spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
    process.exit(result.status??1);
  }).catch(error=>{console.error(error);process.exitCode=1;});
} else {
  const {app,BrowserWindow}=require('electron');
  const timeout=setTimeout(()=>app.exit(1),20000);
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:800,height:700,webPreferences:{backgroundThrottling:false}});await win.loadURL('about:blank');
    await win.webContents.insertCSS(fs.readFileSync(path.join(root,'workspace.css'),'utf8'));
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'session-drawer.js'),'utf8'));
    console.log(await win.webContents.executeJavaScript(`(async()=>{
      const check=(ok,message)=>{if(!ok)throw Error(message);};
      const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
      const host=document.createElement('div');host.style.cssText='position:relative;width:360px;height:450px';document.body.append(host);
      const data={executable:'/fixture/claude',sessions:Array.from({length:16},(_,i)=>({id:'id-'+i,title:'Chat '+i,cwd:'/project',updatedAt:new Date().toISOString()}))};
      let finishLoad,finishPermission,forceSeen;
      const options={host,project:'/project',cwd:'All projects',load:()=>new Promise(resolve=>finishLoad=resolve),canReplace:()=>new Promise(resolve=>finishPermission=resolve),start:async()=>{}};
      const first=openSessionDrawer(options);await tick();
      finishLoad(data);await tick();
      check(document.querySelectorAll('.session-row').length===5 && !document.querySelector('.session-search').disabled,'Chat data must render before a slow permission check completes');
      check(document.querySelector('.session-primary').disabled,'Slow permission checks must not allow unsafe resume');
      finishPermission(true);await first;
      document.querySelector('.session-more').click();await tick();
      const list=document.querySelector('.session-list');list.scrollTop=180;const oldScroll=list.scrollTop;
      document.querySelector('.session-close').click();
      const reopened=openSessionDrawer({...options,initialData:data,canReplace:async()=>true,load:()=>new Promise(resolve=>finishLoad=resolve)});
      check(document.querySelectorAll('.session-row').length===16,'Cached chats and Show more must render synchronously on reopen');
      check(document.querySelector('.session-list').scrollTop===oldScroll,'Reopening must restore scroll position');
      check(!document.querySelector('.session-status').textContent.includes('Loading'),'Cached reopens must not flash a loading message');
      const original=document.querySelector('.session-row');finishLoad(data);await reopened;
      check(document.querySelector('.session-row')===original,'Unchanged results must preserve row nodes');
      const search=document.querySelector('.session-search');search.value='Chat 12';search.dispatchEvent(new Event('input'));
      document.querySelector('.session-close').click();
      const searching=openSessionDrawer({...options,initialData:data,canReplace:async()=>true,load:async()=>data});
      check(document.querySelector('.session-search').value==='Chat 12' && document.querySelectorAll('.session-row').length===1,'Reopen must preserve the search and filtered chats');await searching;
      document.querySelector('.session-close').click();
      await openSessionDrawer({...options,initialData:data,canReplace:async()=>true,load:async()=>{throw Error('offline');}});
      check(document.querySelectorAll('.session-row').length===1 && document.querySelector('.session-refresh').title.includes('Could not refresh'),'Refresh failures must retain cached rows and expose retry');
      document.querySelector('.session-close').click();
      await openSessionDrawer({...options,initialData:data,canReplace:async()=>true,load:async force=>{forceSeen=force;return data;}});
      document.querySelector('.session-refresh').click();await tick();check(forceSeen===true,'Manual refresh must bypass the history cache');
      document.querySelector('.session-search').value='';document.querySelector('.session-search').dispatchEvent(new Event('input'));
      document.querySelector('details').open=false;
      document.querySelector('.session-close').click();
      await openSessionDrawer({...options,initialData:data,canReplace:async()=>true,load:async()=>data});
      check(!document.querySelector('details').open,'Closing a folder must remain remembered even when history closes immediately');
      document.querySelector('.session-close').click();
      const closing=openSessionDrawer({...options,initialData:data,canReplace:async()=>true,load:()=>new Promise(resolve=>finishLoad=resolve)});
      document.querySelector('.session-close').click();finishLoad(data);await closing;
      check(!host.querySelector('.session-overlay'),'A late response must not reopen a closed drawer');
      const noCacheHost=document.createElement('div');noCacheHost.style.cssText=host.style.cssText;document.body.append(noCacheHost);
      await openSessionDrawer({...options,host:noCacheHost,canReplace:async()=>true,load:async()=>{throw Error('initial failure');}});
      check(document.querySelector('.session-status').textContent==='initial failure' && document.querySelector('.session-search').disabled && !document.querySelector('.session-refresh').disabled,'Cold failures must show a retryable error without enabling unsafe actions');
      return 'PASS: immediate cached chats, independent permission checks, remembered search/folders/Show more/scroll, stable rows, refresh/retry and closed-drawer safety';
    })()`));
    clearTimeout(timeout);app.exit(0);
  }).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1);});
}
