// Real xterm parsing, including fragmented OSC messages and repeat app launches.
const fs = require('fs'), path = require('path');
// Restored titles must be correct before any PTY output or delayed shell startup.
{
  const assert = require('node:assert/strict');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const context = vm.createContext({ _createTermEntry: (_ws, id, label) => ({ id, label }) });
  vm.runInContext(source.slice(source.indexOf('  function shortTitle('), source.indexOf('  function renameWorkspace(')), context);
  vm.runInContext(source.slice(source.indexOf('  function deserializeLayout('), source.indexOf('  /* Backgrounds and workspace icons')), context);
  const saved = { type:'group', id:'group', activeTermId:'shell', terminals:[
    {id:'shell', label:'✳ Claude Code', cwd:'/projects/TerminalVibe'},
    {id:'unknown', label:'Old command'},
    {id:'custom', label:'My tab', pinLabel:true, cwd:'/projects/demo'},
    {id:'browser', type:'browser', label:'Docs', url:'https://example.com/'},
    {id:'launcher', label:'Reviewer', argv:['claude'], cwd:'/projects/demo'}
  ] };
  const restored = context.deserializeLayout(saved, {}).terminals;
  assert.equal(restored[0].label, 'TerminalVibe');
  assert.equal(restored[0].pending, true);
  assert.equal(restored[1].label, 'Terminal');
  assert.equal(restored[2].label, 'My tab');
  assert.equal(restored[3].label, 'Docs');
  assert.equal(restored[4].label, 'Reviewer');
  assert.equal(saved.terminals[0].label, '✳ Claude Code', 'Do not mutate saved state or templates');
  console.log('PASS: restored automatic titles reset immediately; custom, browser and launcher names survive');
}
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '../vendor/xterm/xterm.js'), 'utf8'));
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const helpers = source.slice(source.indexOf('  function setAutomaticTerminalTitle('), source.indexOf('  function _createTermEntry('));
  const short = source.slice(source.indexOf('  function shortTitle('), source.indexOf('  function renameWorkspace('));
  const cwd = source.slice(source.indexOf('  function _extractOSC7CwdStr('), source.indexOf('  function _getFocusedCwd('));
  console.log(await win.webContents.executeJavaScript(`(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const renderSidebar = () => {};
    let processName = 'claude', probe = async () => processName;
    const checkTerminalRunning = () => probe();
    const findTermById = id => id === entry.id ? { term:entry } : null;
    ${short}
    ${cwd}
    ${helpers}
    document.body.innerHTML = '<div class="tg-tab" data-termid="one"><span class="tg-tab-name"></span><button data-claude-history="one"></button></div><div id="terminal"></div>';
    const term = new Terminal({ allowProposedApi: true }); term.open(document.getElementById('terminal'));
    const entry = { id:'one', term, label:'Terminal', cwd:'/projects/demo' };
    setupTerminalTitles(entry);
    const write = text => new Promise(resolve => term.write(text, resolve));
    await write('\\x1b]0;Claude Code\\x07'); check(entry.label === 'Claude Code', 'CLI title was not immediate');
    await write('\\x1b]7;file://localhost/projects/ani');
    await write('mecopy\\x07\\x1b]133;A\\x07');
    check(entry.label === 'animecopy' && entry.cwd === '/projects/animecopy', 'Shell prompt did not clear old CLI title with fragmented cwd');
    check(document.querySelector('.tg-tab-name').textContent === 'animecopy', 'Visible tab remains stale');
    check(document.querySelector('[data-claude-history]').hidden, 'Claude-only control remains visible at shell prompt');
    await write('\\x1b]0;Claude Code\\x07');
    check(entry.label === 'Claude Code', 'Relaunching the same CLI must restore its title');
    check(!document.querySelector('[data-claude-history]').hidden, 'Claude control should reappear on launch');
    await write('\\x1b]2;✳ Redesign Terminal Workspace\\x07');
    check(!document.querySelector('[data-claude-history]').hidden, 'Task titles must retain known Claude identity');
    entry.pinLabel = true; entry.label = 'Pinned reviewer';
    await write('\\x1b]2;Claude Code\\x07');
    check(entry.label === 'Pinned reviewer' && !document.querySelector('[data-claude-history]').hidden, 'Pinned labels must not block history visibility updates');
    processName = null;
    await write('\\x1b]133;A\\x07');
    check(document.querySelector('[data-claude-history]').hidden, 'Pinned Claude tab must hide history at the shell');
    // Detect Claude by process even when it emits no identifying title, and
    // even when the last visible state was a shell prompt.
    processName = 'claude';
    await refreshClaudeHistoryButton(entry);
    check(!document.querySelector('[data-claude-history]').hidden, 'Process detection must reveal history without waiting for a title');
    let resolveTaskProbe;
    probe = () => new Promise(resolve => resolveTaskProbe = resolve);
    const taskProbe = refreshClaudeHistoryButton(entry);
    await write('\\x1b]2;✳ Updated task title\\x07');
    resolveTaskProbe('claude'); await taskProbe;
    check(!document.querySelector('[data-claude-history]').hidden, 'Task title updates must not invalidate Claude process detection');
    let resolveProbe;
    probe = () => new Promise(resolve => resolveProbe = resolve);
    const staleProbe = refreshClaudeHistoryButton(entry);
    await write('\\x1b]133;A\\x07');
    resolveProbe('claude'); await staleProbe;
    check(document.querySelector('[data-claude-history]').hidden, 'A stale process response must not revive history after a shell prompt');
    probe = async () => processName;
    processName = 'claude';
    refreshClaudeHistoryAfterInput(entry);
    await new Promise(resolve => setTimeout(resolve, 220));
    check(!document.querySelector('[data-claude-history]').hidden, 'Command input must reveal history promptly without the periodic poll');
    entry._historyInputTimers.forEach(clearTimeout);
    processName = 'yazi';
    await refreshClaudeHistoryButton(entry);
    check(document.querySelector('[data-claude-history]').hidden, 'Other programs must not expose Claude history');
    entry.pinLabel = true; entry.label = 'My terminal';
    await write('\\x1b]2;Yazi: demo\\x07\\x1b]133;A\\x07');
    check(entry.label === 'My terminal', 'Custom title was overwritten');
    entry.pinLabel = false; entry.argv = ['claude']; entry.label = 'Agent';
    await write('\\x1b]2;Different title\\x07'); check(entry.label === 'Agent', 'Explicit agent label was overwritten');
    clearTimeout(entry._historyTimer);
    term.dispose();
    return 'PASS: immediate app titles, prompt resets, fragmented cwd, repeated CLI launch, visible labels, pinned titles, task titles, immediate Claude detection and stale-response protection';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
