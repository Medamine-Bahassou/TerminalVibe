// Isolated session context-menu behavior; no real conversations are launched.
const fs=require('fs'),path=require('path');
if(!process.versions.electron) {
  const result=require('child_process').spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  process.exit(result.status??1);
}
const {app,BrowserWindow}=require('electron');
const timer=setTimeout(()=>app.exit(1),20000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
  await win.loadURL('about:blank');
  await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname,'../workspace.css'),'utf8'));
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../session-drawer.js'),'utf8'));
  console.log(await win.webContents.executeJavaScript(`(async()=>{
    const check=(ok,msg)=>{if(!ok)throw Error(msg);};
    const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
    const host=document.createElement('div');host.style.cssText='position:absolute;left:20px;top:30px;width:360px;height:500px';document.body.append(host);
    const history={sessions:[{id:'one',title:'Conversation <img src=x>',cwd:'/tmp/project',updatedAt:new Date().toISOString()}]};
    let started;
    const options={host,project:'/tmp/project',load:async()=>history,canReplace:async()=>false,start:async(s,m)=>{started={s,m};}};
    let terminalMenus=0, copied;
    host.addEventListener('contextmenu',()=>terminalMenus++);
    window.electronAPI={clipboardWrite:async text=>{copied=text;}};
    await openSessionDrawer(options);await tick();
    const contextRow=()=>{const row=document.querySelector('.session-row');row.closest('details').open=true;return row;};
    const rightClick=row=>row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:window.innerWidth-1,clientY:window.innerHeight-1}));
    rightClick(contextRow());
    check(terminalMenus===0,'Drawer context menu reached the terminal');
    let actions=[...document.querySelectorAll('.session-menu-item')];
    check(actions.map(b=>b.textContent).join('|')==='Resume here|Open in new split|Copy session ID|Copy project path','Wrong session menu options');
    check(actions[0].disabled && !actions[1].disabled,'Busy terminal must disable in-place resume but allow a new split');
    const menuBounds=document.querySelector('.session-context-menu').getBoundingClientRect();
    check(menuBounds.right<=window.innerWidth && menuBounds.bottom<=window.innerHeight,'Session menu escapes viewport');
    actions[2].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));actions[2].click();await tick();
    check(copied==='one' && host.querySelector('.session-overlay') && !document.querySelector('.session-context-menu'),'Copy ID must keep drawer open and close only the menu');
    rightClick(contextRow());
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    check(!document.querySelector('.session-context-menu') && host.querySelector('.session-overlay') && document.activeElement===contextRow(),'Menu Escape must restore the row without closing the drawer: '+JSON.stringify({menu:!!document.querySelector('.session-context-menu'),drawer:!!host.querySelector('.session-overlay'),focus:document.activeElement?.outerHTML?.slice(0,200)}));
    contextRow().dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));
    check(document.querySelector('.session-context-menu'),'Keyboard context menu did not open');
    document.querySelectorAll('.session-menu-item')[1].click();await tick();
    check(started?.s.id==='one' && started.m==='split' && !host.querySelector('.session-overlay'),'Split menu action must launch the selected conversation once');
    check(!document.querySelector('.session-context-menu'),'Closing drawer left an orphan menu');started=undefined;
    await openSessionDrawer({...options,canReplace:async()=>true});await tick();
    rightClick(contextRow());
    check(!document.querySelector('.session-menu-item').disabled,'Idle terminal must allow resume here');
    document.querySelector('.session-menu-item').click();await tick();
    check(started?.s.id==='one' && started.m==='here','Context menu failed to resume in place');started=undefined;
    await openSessionDrawer({...options,currentId:'one'});await tick();rightClick(contextRow());
    actions=[...document.querySelectorAll('.session-menu-item')];
    check(actions[0].disabled && actions[1].disabled,'Current session must not be resumed concurrently');
    document.querySelector('.session-close').click();
    check(!document.querySelector('.session-context-menu'),'Closing drawer must remove its menu');
    delete window.electronAPI;
    return 'PASS: drawer event isolation, conversation actions, busy/current-session guards, split/resume, copy, keyboard access, focus, viewport bounds and cleanup';
  })()`));
  clearTimeout(timer);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});
