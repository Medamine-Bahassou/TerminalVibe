// Exercise both PTY backends with a local fixture instead of a real agent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const pty = require('node-pty');
const { prepareShellStartup } = require('../electron/shell-startup');
const { processWorkingDirectory } = require('../electron/proc');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-history-terminal-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await delay(20);
  }
}

function desktopBackend() {
  const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const ptys = new Map();
  let output = '', exits = 0, spawns = 0;
  const context = vm.createContext({
    require, fs, path, processWorkingDirectory, process: { env: { SHELL: '/bin/bash' }, platform: process.platform },
    pty: { spawn(...args) { spawns++; return pty.spawn(...args); } }, ptys,
    terminalEnv: () => ({ ...process.env, HOME: temp }), prepareShellStartup, agentControl: null,
    detachedWindows: new Map(), notifyBusy: new Map(), console, setTimeout, clearTimeout,
    sendToRenderer(channel, payload) {
      if (channel === 'terminal:data') output += payload.data;
      if (channel === 'terminal:exit') exits++;
    },
  });
  vm.runInContext(source.slice(source.indexOf('function createTerminal('), source.indexOf("ipcMain.handle('terminal:create', createTerminal)")), context);
  return {
    start(spec) { assert.equal(context.createTerminal({}, spec), true); },
    write(data) { ptys.get('history').write(data); },
    close() { for (const [id,terminal] of ptys) { ptys.delete(id);terminal.kill(); } },
    get output() { return output; }, get exits() { return exits; }, get spawns() { return spawns; },
  };
}
function webBackend() {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const SESSIONS = {};
  let output = '', exits = 0, spawns = 0, session;
  const context = vm.createContext({
    fs, os, path, Buffer, process: { env: { SHELL: '/bin/bash' }, platform: process.platform },
    pty: { spawn(...args) { spawns++; return pty.spawn(...args); } },
    terminalEnv: () => ({ ...process.env, HOME: temp }), agentControl: null,
    prepareShellStartup, SESSIONS, ID_LEN: 36, setTimeout, clearTimeout,
  });
  vm.runInContext(source.slice(source.indexOf('class PTYSession {'), source.indexOf('const wss =')) + '\nthis.PTYSession = PTYSession;', context);
  return {
    start(spec) {
      session = new context.PTYSession(spec.id, 100, 30, data => {
        if (Buffer.isBuffer(data)) output += data.subarray(36).toString();
        else if (JSON.parse(data).type === 'exit') exits++;
      }, spec.cwd, spec.executable, spec.argv, spec.returnToShell);
      SESSIONS[spec.id] = session;
      session.start();
    },
    write(data) { session.write(data); }, close() { session?.close(); },
    get output() { return output; }, get exits() { return exits; }, get spawns() { return spawns; },
  };
}

async function checkHistoryLaunches() {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const entry = { id: 'history', cwd: temp, term: { options: {}, write() {} } };
  const session = { id: 'saved-session', cwd: temp };
  let drawer, created, launched;
  const context = vm.createContext({
    window: {
      openSessionDrawer(options) { drawer = options; },
      electronAPI: { claudeSessions: async () => ({ executable: '/fixture/claude', cwd: temp, sessions:[] }) },
    },
    findTermById: () => ({ term: entry }), checkTerminalRunning: async () => null,
    getSlotDimensions: () => ({ cols: 100, rows: 30 }),
    createAgentTerminal: async spec => { created = spec; return true; },
    handleAgentRequest: async request => { launched = request; return { launches: [{ id: entry.id, started: true }] }; },
    saveState() {}, renderPaneArea() {},
  });
  vm.runInContext(source.slice(source.indexOf('  const claudeHistoryCache ='), source.indexOf('  function addTabSessionHistory(')), context);
  await context.openClaudeHistory({ id: 'workspace' }, entry);
  await drawer.load();
  await drawer.start(session, 'here');
  assert.equal(created.returnToShell, true);
  assert.equal(created.replaceClaude, true);
  assert.equal(created.argv[0], '--resume');
  await drawer.start(session, 'split');
  assert.equal(launched.params.layout.returnToShell, true);
  console.log('PASS: history resumes in place and in splits request a shell after agent exit');
}

async function checkNativeDirectoryInheritance() {
  if (process.platform !== 'linux') return;
  const directory = path.join(temp,'changed project');fs.mkdirSync(directory);
  const backend = desktopBackend();
  try {
    backend.start({id:'source',cwd:temp,cols:100,rows:30,executable:process.execPath,
      argv:['-e',`process.chdir(${JSON.stringify(directory)});console.log('CWD_SOURCE_READY');process.stdin.resume();`]});
    await waitFor(()=>backend.output.includes('CWD_SOURCE_READY'),'Cwd fixture did not start');
    backend.start({id:'history',cwd:temp,inheritFromId:'source',cols:100,rows:30,executable:process.execPath,
      argv:['-e',"console.log('INHERITED_CWD:'+process.cwd());process.stdin.resume();"]});
    await waitFor(()=>backend.output.includes('INHERITED_CWD:'+directory),'Native new tab did not inherit the live process cwd');
    console.log('PASS: Electron inherits a running process directory even without OSC cwd updates');
  } finally { backend.close(); }
}

async function checkBackend(name, make) {
  for (const mode of ['interrupt', 'normal', 'close']) {
    const backend = make();
    try {
      backend.start({ id: 'history', cwd: temp, cols: 100, rows: 30, executable: process.execPath,
        argv: ['-e', "console.log('FIXTURE_READY');process.stdin.resume();process.stdin.on('data',()=>process.exit(0));"], returnToShell: true });
      await waitFor(() => backend.output.includes('FIXTURE_READY'), `${name}: fixture did not start`);
      if (mode === 'close') {
        backend.close();
        await delay(150);
        assert.equal(backend.spawns, 1, `${name}: closing a pane must not restart it`);
        continue;
      }
      backend.write(mode === 'interrupt' ? '\x03' : 'quit\r');
      await waitFor(() => backend.spawns === 2, `${name}: no shell after ${mode}`);
      assert.equal(backend.exits, 0, `${name}: agent exit leaked to renderer`);
      await waitFor(() => backend.output.includes('\x1b]133;A\x07'), `${name}: recovered shell has no prompt title reset`);
      backend.write("printf 'SHELL_%s\\n' 'USABLE'; pwd\r");
      await waitFor(() => backend.output.includes('SHELL_USABLE') && backend.output.includes(temp), `${name}: shell is not usable in the session directory`);
      backend.write('exit\r');
      await waitFor(() => backend.exits === 1, `${name}: shell exit was not reported`);
      assert.equal(backend.spawns, 2, `${name}: exiting the shell must not restart it`);
    } finally { backend.close(); }
  }
  console.log(`PASS: ${name}: Ctrl+C and normal agent exit return to a usable shell; shell exit and pane close stay closed`);
}

(async () => {
  if (process.platform === 'win32') return console.log('POSIX PTY signal fixtures skipped on Windows');
  await checkHistoryLaunches();
  await checkNativeDirectoryInheritance();
  await checkBackend('Electron', desktopBackend);
  await checkBackend('WebSocket', webBackend);
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
