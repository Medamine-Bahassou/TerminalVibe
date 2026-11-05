// Trusted Chromium mouse drag, not synthetic DOM drag events. No user terminals.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
if(!process.versions.electron) {
  const r=require('child_process').spawnSync(require('electron'),[__filename,'--no-sandbox'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:''}});process.exit(r.status??1);
}
const {app,BrowserWindow}=require('electron');
let win;const timeout=setTimeout(()=>{console.error('Native session drag timed out');app.exit(1);},20000);
app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,width:1000,height:740,webPreferences:{backgroundThrottling:false,offscreen:true}});
  await win.loadURL('about:blank');
  for(const file of ['style.css','workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../session-drawer.js'),'utf8'));
  const src=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const handler=src.slice(src.indexOf('  function setupGroupDragAndDrop('),src.indexOf('  function handleTerminalDrop('));
  const coords=await win.webContents.executeJavaScript(`(async()=>{
    const body=document.createElement('div');body.style.cssText='position:absolute;left:0;top:0;width:900px;height:600px';document.body.append(body);
    const host=document.createElement('div');host.style.cssText='position:absolute;inset:0';body.append(host);
    const input=document.createElement('textarea');input.id='draft';input.style.cssText='position:absolute;left:300px;top:400px;width:400px;height:100px';host.append(input);
    window.dropResults=[];window.nativeEvents=[];window.resumed=false;window.inputConsumedDrop=false;
    body.addEventListener('dragstart',e=>nativeEvents.push({type:e.type,trusted:e.isTrusted}),true);
    input.addEventListener('drop',e=>{e.stopPropagation();window.inputConsumedDrop=true;});
    const attachContextToChat=(target,id)=>{dropResults.push({target:target.id,id});input.value='Saved context for '+id;};
    const isFileDrag=()=>false;
    const checkTerminalRunning=async()=> 'claude';
    ${handler}
    setupGroupDragAndDrop(body,{activeTermId:'chat',terminals:[{id:'chat',el:host}]},{},document.createElement('div'));
    await openSessionDrawer({host,cwd:'Test',load:async()=>({sessions:[{id:'saved-session',cwd:'/project',title:'Saved conversation',updatedAt:new Date().toISOString()}]}),canReplace:async()=>true,start:async()=>{window.resumed=true;}});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const source=document.querySelector('.session-row').getBoundingClientRect(),target=input.getBoundingClientRect();
    return {source:{x:source.x+source.width/2,y:source.y+source.height/2},target:{x:target.x+target.width/2,y:target.y+target.height/2}};
  })()`);
  win.webContents.debugger.attach('1.3');
  const send=(name,args)=>win.webContents.debugger.sendCommand(name,args);
  const intercepted=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Chromium did not start the session drag')),4000);
    win.webContents.debugger.on('message',(_e,method,params)=>{if(method==='Input.dragIntercepted'){clearTimeout(timer);resolve(params.data);}});
  });
  await send('Input.setInterceptDrags',{enabled:true});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...coords.source});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...coords.source,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:coords.source.x+20,y:coords.source.y+10,button:'left',buttons:1});
  const data=await intercepted;
  assert(data.items.some(item=>item.mimeType==='application/x-terminalvibe-session'&&item.data==='saved-session'));
  for(const type of ['dragEnter','dragOver','drop']) await send('Input.dispatchDragEvent',{type,...coords.target,data});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...coords.target,button:'left',clickCount:1});
  const result=await win.webContents.executeJavaScript('({drops:dropResults,events:nativeEvents,resumed,inputConsumedDrop,draft:document.querySelector("#draft").value})');
  assert.deepEqual(result.drops,[{target:'chat',id:'saved-session'}]);assert(result.events.some(e=>e.trusted));assert.equal(result.resumed,false);assert.equal(result.inputConsumedDrop,false);assert.match(result.draft,/Saved context/);
  console.log('PASS: real Chromium session drag reaches chat draft before terminal input handlers and never resumes the source session');
  clearTimeout(timeout);win.destroy();app.quit();
}).catch(e=>{console.error(e);win?.destroy();app.exit(1);});
