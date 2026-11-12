// A settings change must reach disk before Electron tells the main window to read it.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const save=source.slice(source.indexOf('  function saveState()'),source.indexOf('  async function restoreState()'));
(async()=>{
  let complete,writes=0,notifications=0,disk={showWsProcs:false},observed;
  const live={workspaces:[{id:'live-workspace',layout:{id:'live-layout'}}],folders:[{id:'folder'}],sideOrder:[{type:'ws',id:'live-workspace'}]};
  const context=vm.createContext({
    _profileSwitching:false,SETTINGS_ONLY:true,STATE_KEY:'test-state',
    currentThemeName:'dark',currentColorScheme:'dark',currentFontSize:13,currentFontFamily:'mono',customFonts:{},
    currentLineHeight:1.2,currentCursorStyle:'block',currentCursorBlink:true,currentScrollback:1000,
    animationsEnabled:true,settingsCategory:'appearance',pinnedCollapsed:false,sidebarMode:'normal',showWsProcs:true,hideEmails:true,
    notifyOnCommandFinish:false,notificationSound:true,terminalLinkTarget:'tab',backgroundMode:'none',globalBackgroundImage:null,backgroundOpacity:0,
    customShortcuts:{},searchEngine:'google',customSearchUrl:'',defaultTerminalPath:'',defaultShell:'',_pluginStates:new Map(),_pluginConfigs:new Map(),
    localStorage:{getItem:()=>JSON.stringify(live)},
    persistStateToStorage:state=>{writes++;return new Promise(resolve=>{complete=()=>{disk=state;resolve();};});},
    window:{electronAPI:{settingsChanged:()=>{notifications++;observed=disk.showWsProcs;}}},
  });
  vm.runInContext(save,context);
  const pending=context.saveState();
  assert.equal(writes,1,'A settings change must issue one state write');
  assert.equal(notifications,0,'Do not notify while image/state persistence is still pending');
  assert.equal(disk.showWsProcs,false);
  complete();await pending;
  assert.equal(notifications,1);assert.equal(observed,true,'Main window must observe the new process visibility setting');
  assert.equal(JSON.stringify(disk.workspaces),JSON.stringify(live.workspaces),'Settings must preserve live workspace state');
  context.persistStateToStorage=()=>Promise.reject(Error('Disk write failed'));
  await assert.rejects(context.saveState(),/Disk write failed/);
  assert.equal(notifications,1,'Failed saves must not announce an unapplied setting');
  console.log('PASS: one settings write, notification after persistence, live workspace preservation and save-failure handling');
})().catch(error=>{console.error(error);process.exitCode=1;});
