// Exercise workspace drops through real DOM capture and the guarded backend paste.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const { attachWorkspaceContext } = require('../electron/session-context');
const os = require('os');
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const isolation = src.slice(src.indexOf('  function setupWorkspaceDragIsolation('), src.indexOf('  // Clipboard images take priority'));
  const handlers = src.slice(src.indexOf('  function setupGroupDragAndDrop('), src.indexOf('  function handleTerminalDrop('));
  const builder = src.slice(src.indexOf('  async function buildWorkspaceContext('), src.indexOf('  async function attachContextToChat('));
  const traversal = src.slice(src.indexOf('  function getWorkspaceTerminals('), src.indexOf('  function findTermById('));
  const attachment = src.slice(src.indexOf('  async function attachContextToChat('), src.indexOf('  async function openClaudeHistory('));
  const context = await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    document.body.innerHTML = '<nav id="sidebar"><div id="source"></div></nav><div class="term-group-body" style="position:absolute;left:200px;top:0;width:500px;height:500px"><div id="host" style="height:100%"><textarea></textarea></div><div class="drag-indicator-overlay"></div></div><div id="header"></div>';
    const pane = document.querySelector('.term-group-body'), host = document.querySelector('#host'), input = host.querySelector('textarea');
    const target = { id:'claude', el:host }, group = { activeTermId:target.id, terminals:[target] };
    let name = 'claude', attached = [], leaked = 0, sidebarDrops = 0;
    const isFileDrag = () => false;
    const checkTerminalRunning = async () => name;
    ${traversal}
    const buffer = { length:100, getLine:i => ({ translateToString:() => 'line ' + i + ' useful output' }) };
    const workspace = { id:'workspace', label:'Main', tabs:[{ id:'code', label:'Build', cwd:'/project', term:{buffer:{normal:buffer,active:buffer,alternate:{length:1,getLine:()=>({translateToString:()=> 'ALTERNATE SCREEN DATA'})}}} }, {id:'web',type:'browser',label:'Docs',url:'https://example.com/docs'}, {id:'claude',label:'Claude',cwd:'/project',term:{buffer:{active:{length:1,getLine:()=>({translateToString:()=> 'RECEIVING CHAT DATA'})}}}}] };
    workspace.layout = {type:'split',id:'root',direction:'row',sizes:[50,50],children:[
      {type:'group',id:'first',activeTermId:'claude',terminals:[workspace.tabs[2]]},
      {type:'split',id:'nested',direction:'column',sizes:[50,50],children:[
        {type:'group',id:'second',activeTermId:'code',terminals:[workspace.tabs[0]]},
        {type:'group',id:'third',activeTermId:'web',terminals:[workspace.tabs[1]]}]}]};
    const findWs = id => id === workspace.id ? workspace : null;
    const attachContextToChat = async (t, id, collect) => attached.push({target:t.id, context:await collect()});
    const handleAgentRequest = async request => {
      check(request.params.full === true, 'Browser export was excerpted');
      return {accessible:true,text:'PAGE CONTENT '.repeat(12000),url:'https://example.com/live'};
    };
    ${builder}
    ${isolation}
    ${handlers}
    setupGroupDragAndDrop(pane, group, {}, pane.querySelector('.drag-indicator-overlay'));
    input.addEventListener('drop', () => leaked++);
    document.querySelector('#header').addEventListener('drop', () => leaked++);
    document.querySelector('#source').addEventListener('drop', () => sidebarDrops++);
    window.draggedWsId = workspace.id;
    const drag = (type, element=input, mime='application/x-terminalvibe-workspace', id=workspace.id) => {
      const transfer = new DataTransfer(); transfer.setData(mime,id);
      const e = new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:250,clientY:100});
      element.dispatchEvent(e); return e;
    };
    drag('dragenter'); await Promise.resolve();
    check(host.querySelector('.session-context-drop-effect span')?.textContent === 'Drop workspace to attach', 'Missing workspace drop cue');
    check(drag('dragover').defaultPrevented, 'Claude did not accept workspace');
    drag('drop'); await new Promise(r=>setTimeout(r,0));
    check(attached.length === 1 && attached[0].target === 'claude', 'Context did not reach target');
    check(!host.querySelector('.session-context-drop-effect'), 'Drop cue not cleared');
    const text = attached[0].context.text;
    check(text.includes('/project') && text.includes('https://example.com/docs') && text.includes('useful output'), 'Workspace snapshot missing context');
    check(text.includes('line 0 ') && text.includes('line 99 ') && text.includes('RECEIVING CHAT DATA'), 'Missing retained scrollback or receiving chat');
    check(text.includes('ALTERNATE SCREEN DATA') && text.includes('nested') && text.includes('third'), 'Missing alternate buffer or split layout');
    check(text.includes('https://example.com/live') && text.length > 100000, 'Missing full browser document');
    for (const state of [{locked:true}, {dead:true}, {type:'browser'}]) {
      Object.assign(target,state); drag('dragover'); drag('drop');
      delete target.locked; delete target.dead; delete target.type;
    }
    name = 'bash'; await new Promise(r=>setTimeout(r,550)); drag('dragenter'); await Promise.resolve(); drag('drop');
    drag('drop',input,'application/x-terminalvibe-folder');
    drag('drop',document.querySelector('#header'));
    drag('drop',document.querySelector('#source'));
    check(attached.length === 1 && leaked === 0 && sidebarDrops === 1, 'Unsafe drop or sidebar regression');
    workspace.tabs = Array.from({length:100},(_,i)=>({id:'t'+i,label:'x'.repeat(1000),cwd:'x'.repeat(4000),term:{buffer:{active:buffer}}}));
    workspace.layout = {type:'group',id:'many-tabs',activeTermId:'t0',terminals:workspace.tabs};
    const complete = await buildWorkspaceContext(workspace);
    check(complete.text.includes('Tab ID: t99') && complete.text.length > 64000, 'Export silently omitted tabs or content');
    const isDesktop = () => true;
    const realAttach = ${attachment.trim()};
    window.electronAPI = {attachSessionContext:()=>{throw Error('Workspace reached legacy saved session API');}};
    await realAttach(target,null,()=>buildWorkspaceContext(workspace));
    check(host.textContent.includes('fully restart TerminalVibe'), 'Old preload did not receive an actionable error');
    let exported;
    window.electronAPI.attachWorkspaceContext = async (id, context) => {exported={id,context}; return {file:'/tmp/context.md'};};
    await realAttach(target,null,()=>buildWorkspaceContext(workspace));
    check(exported.id === target.id && exported.context.text.includes('Tab ID: t99'), 'Dedicated workspace API did not receive complete content');
    return attached[0].context;
  })()`);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tv-workspace-test-'));
  const config=process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR=temp;
    const id='01234567-1234-1234-1234-123456789abc';
    const project=path.join(temp,'projects','project');fs.mkdirSync(project,{recursive:true});
    const log=JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',input:{data:'COMPLETE TOOL RECORD'}}]}})+'\n'+ 'old log data '.repeat(12000);
    fs.writeFileSync(path.join(project,id+'.jsonl'),log);
    context.sessionIds=[id];
    const token = {}, writes = [], getTarget = () => ({token,info:{running:true,name:'claude'}});
    const result=await attachWorkspaceContext({context,getTarget,contextRoot:temp,write:(t,text)=>writes.push(text)});
    assert.equal(writes.length,1);assert(writes[0].startsWith('\x1b[200~'));assert(writes[0].endsWith('\x1b[201~'));
    assert(writes[0].includes('@'+result.file));assert(writes[0].length<1000,'Large context was pasted into draft');
    const exported=fs.readFileSync(result.file,'utf8');
    assert(exported.includes(context.text));assert(exported.includes(log));assert(exported.includes('COMPLETE TOOL RECORD'));
    if(process.platform!=='win32') assert.equal(fs.statSync(result.file).mode&0o777,0o600);
    await attachWorkspaceContext({context:{title:'Test',text:'hello\x1b[201~\nworld'},getTarget,contextRoot:temp,write:(t,text)=>assert.equal((text.match(/\x1b/g)||[]).length,2)});
    for (const name of ['bash','codex','unknown']) await assert.rejects(() => attachWorkspaceContext({context,getTarget:()=>({token,info:{running:true,name}}),write:()=>assert.fail('Unsafe paste')}), /running Claude/);
    let calls=0;const before=fs.readdirSync(temp).length;
    await assert.rejects(()=>attachWorkspaceContext({context,getTarget:()=>({token:++calls===1?token:{},info:{running:true,name:'claude'}}),contextRoot:temp,write:()=>assert.fail('Stale write')}),/target chat changed/);
    assert.equal(fs.readdirSync(temp).length,before,'Failed attachment left an orphan snapshot');
    await assert.rejects(()=>attachWorkspaceContext({context:{title:'Bad',text:'data',sessionIds:['../escape']},getTarget}),/Invalid workspace context/);
    console.log('PASS: all workspace tabs and full scrollback/browser content, dedicated API and stale-preload detection, complete session logs, private file attachment and target checks');
  } finally {
    if(config===undefined) delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=config;
    fs.rmSync(temp,{recursive:true,force:true});
  }
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
