const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
(async () => {
  let disk;
  const context = vm.createContext({
    _profileSwitching:false, SETTINGS_ONLY:false, DETACHED_ONLY:false, STATE_KEY:'test',
    currentThemeName:'dark',currentColorScheme:'dark',currentFontSize:13,currentFontFamily:'mono',customFonts:{},
    currentLineHeight:1.2,currentCursorStyle:'block',currentCursorBlink:true,currentScrollback:1000,
    animationsEnabled:true,settingsCategory:'appearance',pinnedCollapsed:false,sidebarMode:'normal',showWsProcs:true,
    notifyOnCommandFinish:false,notificationSound:true,terminalLinkTarget:'tab',backgroundMode:'none',globalBackgroundImage:null,backgroundOpacity:0,
    customShortcuts:{},searchEngine:'google',customSearchUrl:'',defaultTerminalPath:'',defaultShell:'',_pluginStates:new Map(),_pluginConfigs:new Map(),

    projectThreadView:null,
    projects:[{id:'p',name:'Project',cwd:'/tmp/project with spaces',collapsed:true}], projectsCollapsed:true,
    workspaces:[{id:'w',label:'Thread',projectId:'p',threadRuns:[{id:'run',provider:'codex',name:'Codex',cwd:'/tmp/project with spaces',createdAt:1,termId:'t',output:'saved output'}],resumeCommand:'codex resume exact-id',activeTermId:'t',
      layout:{type:'group',id:'g',activeTermId:'t',terminals:[{id:'t',label:'Terminal',cwd:'/tmp/project with spaces'}]}}],
    folders:[], sideOrder:[{type:'ws',id:'w'}], activeWsId:'w', wsCount:0,
    syncBrowserShortcuts:()=>{}, document:{getElementById:()=>({classList:{contains:()=>true,toggle:()=>{}},offsetWidth:0})},
    persistStateToStorage:async state=>{disk=JSON.parse(JSON.stringify(state));},
    configApi:()=>({configReadState:async()=>disk}), resolveStateImages:async()=>{}, THEMES:{},
    injectCustomFonts:()=>{}, applyAnimationsSetting:()=>{}, DEFAULT_SHORTCUTS:{}, window:{},
    normalizeOrder:()=>{}, sanitizeSideOrder:()=>{}, rebuildSideOrder:()=>{},
    _createTermEntry:(ws,id,label)=>({id,label}), shortTitle:x=>x,
  });
  vm.runInContext(between('  function serializeLayout(', '  /* Backgrounds and workspace icons') +
    between('  function saveState()', '  /* ═══════════════════════════════════════════════════════════════\n   P R*OFILES'), context);
  await context.saveState();
  assert.equal(disk.workspaces[0].projectId,'p');
  assert.equal(disk.workspaces[0].resumeCommand,'codex resume exact-id');
  context.workspaces=[]; context.projects=[]; context.sideOrder=[];
  assert.equal(await context.restoreState(),true);
  assert.equal(context.projects[0].cwd,'/tmp/project with spaces');
  assert.equal(context.projects[0].collapsed,true);
  assert.equal(context.projectsCollapsed,true);
  assert.equal(context.workspaces[0].projectId,'p');
  assert.equal(context.workspaces[0].threadRuns[0].output,'saved output');
  assert.equal(context.workspaces[0].resumeCommand,'codex resume exact-id');
  assert.equal(context.workspaces[0].layout.terminals[0].cwd,'/tmp/project with spaces');
  assert.equal(context.workspaces[0].layout.terminals[0].runCmd,undefined);
  delete disk.projects; delete disk.projectsCollapsed;
  context.workspaces=[]; context.sideOrder=[];
  assert.equal(await context.restoreState(),true);
  assert.equal(context.projects.length,0);
  assert.equal(context.workspaces[0].projectId,undefined,'Orphan thread should become a regular workspace');
  console.log('PASS: real save/restore preserves projects, threads, commands and cwd; legacy state restores without auto-launch');
})().catch(error=>{console.error(error);process.exitCode=1;});
