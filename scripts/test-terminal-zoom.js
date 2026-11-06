// Real xterm mouse reporting and alternate-screen wheel handling in isolation.
const fs=require('fs'),path=require('path');
if(!process.versions.electron) {
  const result=require('child_process').spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  process.exit(result.status??1);
}
const {app,BrowserWindow}=require('electron');
const timer=setTimeout(()=>app.exit(1),20000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{offscreen:true,backgroundThrottling:false}});
  await win.loadURL('about:blank');
  const root=path.join(__dirname,'..');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root,'vendor/xterm/xterm.css'),'utf8'));
  for(const file of ['xterm','xterm-addon-fit'])await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'vendor/xterm',file+'.js'),'utf8'));
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const zoom=source.slice(source.indexOf('  const FONT_MIN ='),source.indexOf("  const searchbar ="));
  const sizing=source.slice(source.indexOf('  function syncTerminalSize('),source.indexOf('  // Auto-fit each terminal'));
  console.log(await win.webContents.executeJavaScript(`(async()=>{
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    document.body.innerHTML='<div id="pane-area" style="display:flex;width:900px;height:500px"></div>';
    const entries=new Map(),resizes=[],input=[];
    const findTermById=id=>entries.has(id)?{term:entries.get(id)}:null;
    const sendControl=spec=>resizes.push(spec);
    const currentFontSize=14;
    const make=id=>{
      const el=document.createElement('div');el.id='slot-'+id;el.className='term-slot';el.style.cssText='width:400px;height:450px';document.querySelector('#pane-area').append(el);
      const host=document.createElement('div');host.style.cssText='width:100%;height:100%';el.append(host);
      const term=new Terminal({fontSize:14,allowProposedApi:true});
      const fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(host);fit.fit();
      term.onData(text=>input.push({id,text}));
      const entry={id,el,term,fit};entries.set(id,entry);return entry;
    };
    const shell=make('shell'),claude=make('claude');
    const activeTerminal=()=>shell; // The pointer must override keyboard focus.
    ${sizing}
    ${zoom}
    const write=text=>new Promise(resolve=>claude.term.write(text,resolve));
    await write('\\x1b[?1049h\\x1b[?1000h\\x1b[?1006hClaude fixture');
    const wheel=(entry,ctrl,delta)=>{
      const screen=entry.term.element.querySelector('.xterm-screen'),rect=screen.getBoundingClientRect();
      const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:ctrl,deltaY:delta,clientX:rect.left+20,clientY:rect.top+20});
      screen.dispatchEvent(event);return event;
    };
    const originalCols=claude.term.cols,originalCell=claude.term._core._renderService.dimensions.css.cell.height;
    const zoomEvent=wheel(claude,true,-100);await wait(240);
    check(claude.term.options.fontSize===15 && shell.term.options.fontSize===14,'Ctrl+wheel must zoom the hovered Claude pane, not the focused shell');
    check(claude.term._core._renderService.dimensions.css.cell.height>originalCell,'Zoom must enlarge rendered glyph cells');
    check(claude.term.cols<originalCols && resizes.some(s=>s.id==='claude' && s.cols===claude.term.cols),'Zoom must fit the grid and resize the PTY');
    check(zoomEvent.defaultPrevented && input.length===0,'Ctrl+wheel must not reach Claude as terminal mouse input');
    wheel(claude,true,100);await wait(240);
    check(claude.term.options.fontSize===14,'Ctrl+wheel down must shrink Claude text');
    wheel(claude,false,100);check(input.some(row=>row.id==='claude'),'Unmodified scrolling must still reach Claude mouse reporting');input.length=0;
    await write('\\x1b[?1000l\\x1b[?1006l');
    wheel(claude,true,-100);await wait(240);
    check(claude.term.options.fontSize===15 && input.length===0,'Alternate-screen arrow scrolling must not swallow Ctrl+wheel');
    wheel(shell,true,-100);await wait(240);check(shell.term.options.fontSize===15,'Normal terminal zoom regressed');
    const drawer=document.createElement('div');drawer.className='session-overlay';claude.el.append(drawer);
    drawer.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true}));await wait(40);
    check(claude.term.options.fontSize===15 && shell.term.options.fontSize===15,'Drawer scrolling must not resize terminal text');drawer.remove();
    const browser=document.createElement('div');browser.className='term-slot';browser.id='slot-browser';document.querySelector('#pane-area').append(browser);entries.set('browser',{type:'browser'});
    const browserEvent=new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true});browser.dispatchEvent(browserEvent);
    check(!browserEvent.defaultPrevented,'Browser panes must retain their own zoom behavior');
    wheel(claude,true,-100);entries.delete('claude');await wait(240);
    check(claude.term.options.fontSize===15,'Pending zoom must not modify a closed or replaced pane');
    shell.term.dispose();claude.term.dispose();
    return 'PASS: Claude mouse/alternate-screen zoom, rendered glyph sizing, PTY resize, hovered-pane targeting, normal scrolling, browser/drawer isolation and closed-pane safety';
  })()`));
  clearTimeout(timer);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});
