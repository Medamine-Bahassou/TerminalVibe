// Real Chromium file drops through the actual preload/browser upload path and xterm.
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
if(!process.versions.electron) {
  const net=require('net');
  const port=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
  (async()=>{
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tv-file-drop-test-'));
    const wsPort=await port(),appPort=await port();
    const file=path.join(temp,"Fiche collaborateur O'Brien.pdf");fs.writeFileSync(file,'%PDF-1.4\nFixture bytes\n');
    const server=cp.spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,HOME:temp,USERPROFILE:temp,TMPDIR:temp,WS_PORT:String(wsPort),APP_PORT:String(appPort)},stdio:['ignore','pipe','pipe']});
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Test server did not start')),10000);
        server.stdout.on('data',chunk=>{if(String(chunk).includes('app server listening')){clearTimeout(timer);resolve();}});
        server.once('exit',code=>{clearTimeout(timer);reject(Error('Test server exited: '+code));});
      });
      const child=cp.spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'',TV_DROP_WS:String(wsPort),TV_DROP_APP:String(appPort),TV_DROP_FILE:file,TV_DROP_ROOT:temp}});
      process.exitCode=child.status??1;
    } finally { server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));fs.rmSync(temp,{recursive:true,force:true}); }
  })().catch(error=>{console.error(error);process.exitCode=1;});
} else {
  const {app,BrowserWindow,ipcMain}=require('electron');
  app.on('window-all-closed',()=>{});
  const {saveDroppedFile,decodeDroppedFile}=require('../electron/dropped-files');
  const timer=setTimeout(()=>app.exit(1),20000);
  app.whenReady().then(async()=>{
    const file=process.env.TV_DROP_FILE,bytes=fs.readFileSync(file),temp=process.env.TV_DROP_ROOT;
    assert.throws(()=>decodeDroppedFile('bad?'),/Invalid/);
    assert.throws(()=>decodeDroppedFile('ab=c'),/Invalid/);
    assert.deepEqual(decodeDroppedFile(bytes.toString('base64')),bytes);
    const saved=await saveDroppedFile('../../folder/document.pdf',bytes,temp);
    assert.equal(path.basename(saved),'document.pdf');assert.deepEqual(fs.readFileSync(saved),bytes);
    ipcMain.handle('file:save-temp',(_e,name,data)=>saveDroppedFile(name,data,temp));
    const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
    const helpers=source.slice(source.indexOf('  function shellQuote('),source.indexOf('  // Never let a file dropped outside'));
    const handlers=source.slice(source.indexOf('  function setupGroupDragAndDrop('),source.indexOf('  function handleTerminalDrop('));
    for(const desktop of [false,true]) {
      const win=new BrowserWindow({show:false,width:900,height:650,webPreferences:{backgroundThrottling:false,offscreen:true,...(desktop?{preload:path.join(root,'electron/preload.js')}:{})}});
      await win.loadURL('http://127.0.0.1:'+process.env.TV_DROP_APP+'/package.json');
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'vendor/xterm/xterm.js'),'utf8'));
      await win.webContents.executeJavaScript(`(async()=>{
        document.body.style.margin='0';document.body.innerHTML='<div id="body" style="width:800px;height:550px"><div id="terminal" style="width:100%;height:100%"></div></div>';
        const host=document.querySelector('#terminal');
        const term=new Terminal({allowProposedApi:true});term.open(host);
        await new Promise(resolve=>term.write('\\x1b[?2004h',resolve));
        window.pastes=[];term.onData(data=>pastes.push(data));
        const entry={id:'11111111-1111-4111-8111-111111111111',term,el:host};
        const findTermById=id=>id===entry.id?{term:entry}:null;
        const checkTerminalRunning=async()=> 'claude';
        const uuid=()=>crypto.randomUUID();
        let wsReady=false,fileDropReady=false,terminalBackendPlatform=null;
        const fileDropRequests=new Map();
        const ws=new WebSocket('ws://127.0.0.1:${process.env.TV_DROP_WS}');
        const connected=new Promise((resolve,reject)=>{
          ws.onerror=()=>reject(Error('WebSocket connection failed'));
          ws.onmessage=e=>{
            if(typeof e.data!=='string') return;
            const msg=JSON.parse(e.data);
            if(msg.type==='ready') {fileDropReady=msg.fileDrop;terminalBackendPlatform=msg.platform;wsReady=true;ws.send(JSON.stringify({type:'create',id:entry.id,requestId:'create'}));}
            if(msg.type==='agent:created') {if(msg.started) resolve();else reject(Error('Fixture terminal failed'));}
            if(msg.type==='file:result') {const pending=fileDropRequests.get(msg.requestId);if(pending){clearTimeout(pending.timer);fileDropRequests.delete(msg.requestId);msg.error?pending.reject(Error(msg.error)):pending.resolve(msg.path);}}
          };
        });
        await connected;
        ${helpers}
        ${handlers}
        setupGroupDragAndDrop(document.querySelector('#body'),{activeTermId:entry.id,terminals:[entry]},{},document.createElement('div'));
        window.dropFixture={entry,dropFilesIntoTerminal,close:()=>ws.close(),unsupported:()=>{fileDropReady=false;}};
      })()`);
      win.webContents.debugger.attach('1.3');
      for(const type of ['dragEnter','dragOver','drop']) await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type,x:300,y:300,data:{items:[],files:[file],dragOperationsMask:1}});
      const result=await win.webContents.executeJavaScript(`(async()=>{const deadline=Date.now()+5000;while(!pastes.length && !document.querySelector('.session-drop-feedback.is-error')){if(Date.now()>deadline)throw Error('Drop produced no draft or error');await new Promise(r=>setTimeout(r,20));}return {pastes,notice:document.querySelector('.session-drop-feedback')?.textContent};})()`);
      assert.equal(result.pastes.length,1,JSON.stringify(result));
      assert.match(result.pastes[0],/^\x1b\[200~.* \x1b\[201~$/);
      assert(!result.pastes[0].includes('\r'),'Drop must not submit the draft');
      const quoted=result.pastes[0].slice(6,-6).trim();
      const resolved=quoted.slice(1,-1).replace(/'\\''/g,"'");
      assert.deepEqual(fs.readFileSync(resolved),bytes);
      assert.equal(desktop?resolved===file:resolved!==file,true,'Desktop must preserve the original path; browser must transfer actual bytes');
      if(desktop) {
        const generated=await win.webContents.executeJavaScript(`(async()=>{await dropFixture.dropFilesIntoTerminal(dropFixture.entry,[new File(['generated PDF'],'generated.pdf')]);return pastes[pastes.length-1];})()`);
        const generatedPath=generated.slice(6,-6).trim();
        assert.equal(fs.readFileSync(generatedPath,'utf8'),'generated PDF','Files without original disk paths must cross the real IPC bridge');
      }
      if(!desktop) {
        const failed=await win.webContents.executeJavaScript(`(async()=>{dropFixture.unsupported();await dropFixture.dropFilesIntoTerminal(dropFixture.entry,[new File(['data'],'unsupported.pdf')]);return {count:pastes.length,message:[...document.querySelectorAll('.session-drop-feedback.is-error')].map(n=>n.textContent).join()};})()`);
        assert.equal(failed.count,1);assert.match(failed.message,/Restart.*backend/);
        const changed=await win.webContents.executeJavaScript(`(async()=>{let complete;window.electronAPI={getPathForFile:()=>'',saveTempFile:()=>new Promise(resolve=>complete=resolve)};const promise=dropFixture.dropFilesIntoTerminal(dropFixture.entry,[new File(['data'],'slow.pdf')]);while(!complete)await new Promise(r=>setTimeout(r,0));dropFixture.entry.locked=true;complete('/tmp/slow.pdf');await promise;return pastes.length;})()`);
        assert.equal(changed,1,'Do not paste after the target becomes locked');
      }
      await win.webContents.executeJavaScript('dropFixture.close()');win.destroy();
      console.log(`PASS: ${desktop?'Electron preload':'browser WebSocket'} real file drop, exact PDF bytes, spaces/apostrophes, xterm draft insertion and no submission`);
    }
    clearTimeout(timer);app.exit(0);
  }).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});
}
