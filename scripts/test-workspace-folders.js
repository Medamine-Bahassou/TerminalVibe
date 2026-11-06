// Folder layout and action routing in isolated Chromium; no user state.
const fs=require('fs'),path=require('path');
if(!process.versions.electron) {
  const result=require('child_process').spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});process.exit(result.status??1);
}
const {app,BrowserWindow}=require('electron');
const timer=setTimeout(()=>app.exit(1),20000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:800,height:700});win.webContents.on('console-message',event=>{if(event.message?.startsWith('Error:')) console.error(event.message);});await win.loadURL('about:blank');
  for(const file of ['style.css','workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  const src=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const keyboard=src.slice(src.indexOf('  function makeKeyboardButton('),src.indexOf('  function renderSidebar('));
  const builder=src.slice(src.indexOf('    // ── Folder row builder'),src.indexOf('    // ── Render the top-level flow'));
  console.log(await win.webContents.executeJavaScript(`(()=>{try{
    const check=(ok,msg)=>{if(!ok)throw Error(msg);};
    document.body.className='roundless';document.body.innerHTML='<aside id="sidebar" class="expanded" style="width:200px;min-width:0"></aside>';
    const sb=document.querySelector('#sidebar');
    const folder={id:'folder',label:'A long folder title for clipping checks',pinned:true},folders=[folder],slot=0,activeWsId='active';
    const workspaces=[{id:'active',label:'Workspace 2'},{id:'other',label:'Another workspace'}];
    let collapsed=0,created=0,menu;
    const escHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>', '&gt;');
    const getGroupList=()=>workspaces;
    const toggleFolderCollapsed=()=>collapsed++;
    const createWorkspace=(label,id)=>{check(id===folder.id,'Wrong new workspace folder');created++;};
    const showCtxMenu=(event,type,id)=>{menu={event,type,id};};
    const buildWsBtn=w=>{const el=document.createElement('div');el.className='ws-btn';el.innerHTML='<div class="ws-info"><span class="ws-name">'+w.label+'</span></div><span class="ws-count">1</span>';return el;};
    ${keyboard}
    ${builder}
    const row=buildFolderEl(folder,0);sb.append(row);
    const header=row.querySelector('.ws-folder-header'),name=row.querySelector('.ws-folder-name'),more=row.querySelector('.ws-folder-more');
    for(const width of [160,200,280]) {
      sb.style.width=width+'px';more.focus();
      check(name.getBoundingClientRect().right<=more.parentElement.getBoundingClientRect().left,'Actions cover folder name');
      check(more.getBoundingClientRect().height>=28,'Folder action too small');
      check(getComputedStyle(header).borderRadius==='6px','Folder header not rounded in roundless mode');
      check(getComputedStyle(more.parentElement).pointerEvents==='auto','Keyboard focus does not reveal actions');
      for(const child of row.querySelectorAll('.ws-btn')) check(child.getBoundingClientRect().right<=sb.getBoundingClientRect().right,'Nested workspace overflows sidebar');
      check(getComputedStyle(row.querySelector('.ws-btn'),'::before').display==='none','Old tree connector remains');
    }
    more.click();check(collapsed===0 && menu.type==='folder' && menu.id===folder.id,'More action collapsed folder or opened wrong menu');
    check(Number.isFinite(menu.event.pageX)&&Number.isFinite(menu.event.pageY),'Browser menu lacks page coordinates');
    row.querySelector('.ws-folder-add').click();check(created===1 && collapsed===0,'Add action toggled folder');
    header.click();check(collapsed===1,'Folder toggle stopped working');
    folder.collapsed=true;const closed=buildFolderEl(folder,0);sb.replaceChildren(closed);
    check(closed.querySelectorAll('.ws-btn').length===1 && closed.querySelector('.ws-folder-header').getAttribute('aria-expanded')==='false','Collapsed active workspace behavior changed');
    sb.classList.remove('expanded');check(getComputedStyle(closed.querySelector('.ws-folder-header')).display==='none','Collapsed sidebar shows folder header');
    return 'PASS: narrow/wide folder layout, unobscured title, rounded styling, focus actions, add/menu routing, collapse behavior and sidebar modes';
  }catch(error){console.error(error.stack);throw error;}})()`));
  clearTimeout(timer);app.exit(0);
}).catch(e=>{console.error(e);clearTimeout(timer);app.exit(1);});
