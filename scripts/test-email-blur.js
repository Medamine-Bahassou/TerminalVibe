// Email addresses in a real xterm get a blur decoration; a click reveals that address.
const fs=require('fs'),path=require('path');
if(!process.versions.electron) {
  const result=require('child_process').spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  process.exit(result.status??1);
}
const {app,BrowserWindow}=require('electron');
setTimeout(()=>app.exit(1),20000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{offscreen:true,backgroundThrottling:false}});
  await win.loadURL('about:blank');
  const root=path.join(__dirname,'..');
  await win.webContents.insertCSS(fs.readFileSync(path.join(root,'vendor/xterm/xterm.css'),'utf8'));
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'vendor/xterm/xterm.js'),'utf8'));
  const src=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const termRow=src.slice(src.indexOf('  function termRow('),src.indexOf('  // Join terminal rows'));
  const blur=src.slice(src.indexOf('  const EMAIL_RE ='),src.indexOf('  // opts (plugins: api.terminal.open)'));
  try {
    console.log(await win.webContents.executeJavaScript(`(async()=>{
      const check=(ok,m)=>{if(!ok)throw Error(m);};
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
      ${termRow}
      ${blur}
      const host=document.createElement('div');host.style.cssText='width:800px;height:400px';document.body.append(host);
      const term=new Terminal({allowProposedApi:true,cols:80,rows:10});term.open(host);
      blurTermEmails(term);
      await new Promise(r=>term.write('user: dev@example.com\\r\\nno mail here\\r\\n',r));await frame();
      const els=()=>[...host.querySelectorAll('.term-email-blur:not(.shown)')].filter(e=>e.style.display!=='none');
      check(els().length===1,'one blur expected, got '+els().length);
      const el=els()[0];
      check(el.style.left==='0px'||parseFloat(el.style.left)>0,'positioned');
      el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(50);
      check(els().length===0,'click must reveal');
      await new Promise(r=>term.write('again dev@example.com other@x.io\\r\\n',r));await frame();
      check(els().length===2,'each occurrence reveals on its own: the repeat and the new address stay blurred');
      check(host.querySelectorAll('.term-email-blur.shown').length===1,'the clicked one stays shown');
      const shown=()=>host.querySelectorAll('.term-email-blur.shown').length;
      // A TUI redraw: erase the revealed row, then (next write) put the same text back.
      await new Promise(r=>term.write('\x1b[1;1H\x1b[2K',r));await frame();
      await new Promise(r=>term.write('user: dev@example.com',r));await frame();
      check(shown()===1 && els().length===2,'a redraw in place must keep the address shown');
      // Redrawn one row lower: the revealed state follows it.
      await new Promise(r=>term.write('\x1b[1;1H\x1b[2K\x1b[2;1H\x1b[2Kmoved dev@example.com',r));await frame();
      check(shown()===1 && els().length===2,'a redraw on another row must keep the address shown, got '+shown()+'/'+els().length);
      return 'PASS: email blur decorations';
    })()`));
    app.exit(0);
  } catch(e){ console.error('FAIL:',e.message); app.exit(1); }
});
