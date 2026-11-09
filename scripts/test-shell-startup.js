const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { prepareShellStartup } = require('../electron/shell-startup');

// Execute the actual new-tab handler with layout/transport stubs. Starting
// the PTY must not depend on a timer or animation frame (throttled offscreen).
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const workspace = { id: 'workspace', layout: null };
const controls = [], frames = [];
let sequence = 0;
const all = node => !node ? [] : node.type === 'group' ? node.terminals : node.children.flatMap(all);
const first = node => !node ? null : node.type === 'group' ? node : first(node.children[0]);
const group = (node, predicate) => !node ? null : node.type === 'group' ? predicate(node) ? node : null : node.children.map(n => group(n,predicate)).find(Boolean);
const context = {
  activeWsId: workspace.id, defaultTerminalPath: '/project',
  findWs: () => workspace, uuid: () => ++sequence === 1 ? 'terminal' : 'terminal-'+sequence,
  findFirstGroup: first, findGroupById: (node,id) => group(node,g => g.id === id),
  findGroupContainingTerm: (node,id) => group(node,g => g.terminals.some(t => t.id === id)),
  document: { getElementById: () => null },
  getWorkspaceTerminals: ws => all(ws.layout),
  _createTermEntry: (_ws, id, label) => ({ id, label }),
  renderPaneArea() {}, activateTerminal() {}, renderSidebar() {}, saveState() {}, pluginEmit() {},
  getSlotDimensions: () => ({ cols: 120, rows: 40 }),
  sendControl: message => {
    assert(all(workspace.layout).some(t => t.id === message.id));
    controls.push(message);
  },
  requestAnimationFrame: callback => frames.push(callback), fitTerm() {},
  setTimeout: () => { throw new Error('New tab must start without a timer'); },
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function addTerminal('), source.indexOf('  function addBrowserTab(')), context);
context.addTerminal();
assert.equal(controls.length, 1);
assert.equal(controls[0].cwd, '/project');
assert.equal(workspace.layout.terminals[0].label, 'project', 'New tab must not inherit a previous CLI title');
assert.equal(controls[0].cols, 120);
assert.equal(controls[0].rows, 40);
assert.equal(frames.length, 1);
const left = {type:'group',id:'left',activeTermId:'left-parent',terminals:[{id:'left-parent',cwd:'/repo/left'}]};
const right = {type:'group',id:'right',activeTermId:'right-parent',terminals:[{id:'right-parent',cwd:'/repo/right'}]};
workspace.layout = {type:'split',children:[left,right]};workspace.activeTermId = 'left-parent';
context.defaultTerminalPath = '/configured-default';
context.addTerminal();
assert.equal(controls.at(-1).cwd,'/repo/left','Previous tab must take priority over the configured default');
assert.equal(controls.at(-1).inheritFromId,'left-parent');
context.addTerminal(workspace.id,'right');
assert.equal(controls.at(-1).cwd,'/repo/right','A split plus button must use that split, not the focused one');
assert.equal(controls.at(-1).inheritFromId,'right-parent');
right.terminals.push({id:'browser',type:'browser'});right.activeTermId='browser';right._history=['right-parent'];
context.addTerminal(workspace.id,'right');
assert.equal(controls.at(-1).cwd,'/repo/right','Browser tabs must retain the split’s previous terminal directory');
const forwarded = [];
const transport = vm.createContext({isDesktop:()=>true,nativePtyReady:true,findTermById:()=>null,
  window:{electronAPI:{terminalCreate:spec=>{forwarded.push(spec);return Promise.resolve(true);}}}});
vm.runInContext(source.slice(source.indexOf('  function sendControl('),source.indexOf('  function _sendStdinRaw(')),transport);
transport.sendControl({type:'create',id:'new',cols:80,rows:24,cwd:'/cached',inheritFromId:'previous'});
assert.equal(forwarded[0].inheritFromId,'previous','Native IPC must preserve the source terminal ID');
console.log('PASS: immediate new tabs, correct split directory, previous-tab precedence, default fallback and native inheritance forwarding');

const osc = vm.createContext({ TextDecoder });
vm.runInContext(source.slice(source.indexOf('  function _extractOSC7Cwd('), source.indexOf('  function _getFocusedCwd(')), osc);
const parse = uri => osc._extractOSC7CwdStr(`\x1b]7;${uri}\x07`);
assert.equal(parse('file:///C%3A%5CUsers%5Cdemo%20%C3%A9'), 'C:\\Users\\demo é');
assert.equal(parse('file:///%5C%5Cwsl.localhost%5CUbuntu%5Chome'), '\\\\wsl.localhost\\Ubuntu\\home');
assert.equal(parse('file://host/home/demo%20dir'), '/home/demo dir');
assert.equal(osc._extractOSC7Cwd(new TextEncoder().encode('\x1b]7;file:///C%3A%5Cbytes\x07')), 'C:\\bytes');
for (const shell of ['powershell.exe', 'pwsh.exe']) assert.equal(prepareShellStartup(shell).args[0], '-NoExit');
if (process.platform === 'win32') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tv ps é '));
  const hook = prepareShellStartup('powershell.exe').args[2];
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `function prompt { 'custom> ' }; ${hook}; prompt`],
    { cwd, encoding: 'utf8', timeout: 30000 });
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  assert.equal(path.basename(osc._extractOSC7CwdStr(out)), path.basename(cwd));
  assert(out.includes('custom> '), 'The user prompt must still render');
  assert(out.includes('\x1b]133;A\x07'), 'PowerShell must signal the prompt so the tab title resets to the folder');
}
const titles = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function shortTitle('), source.indexOf('  function renameWorkspace(')), titles);
assert.equal(titles.shortTitle('C:\\Users\\demo\\my project'), 'my project');
assert.equal(titles.shortTitle('C:\\'), 'C:');
assert.equal(titles.shortTitle('\\\\wsl.localhost\\Ubuntu\\home'), 'home');
assert.equal(titles.shortTitle('/home/demo'), 'demo');
assert.equal(titles.shortTitle('user@host:/home/demo'), 'demo');
console.log('PASS: Windows and POSIX OSC 7 paths, PowerShell cwd hook, Windows tab titles');

const { parseWslList, windowsShells, posixShells, findShell, resolveExecutable } = require('../electron/shells');
{
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-bin-'));
  for (const name of ['tool.exe', 'helper.com', 'npm.cmd', 'tool']) fs.writeFileSync(path.join(bin, name), '');
  fs.mkdirSync(path.join(bin, 'folder.exe'));
  // ';' join, as on Windows, with an empty entry and a quoted one.
  const env = { PATH: ['', `"${bin}"`].join(';') };
  const win = name => resolveExecutable(name, env, 'win32');
  assert.equal(win('tool'), path.join(bin, 'tool.exe'), 'A bare name finds the .exe, not the extensionless file');
  assert.equal(win('tool.exe'), path.join(bin, 'tool.exe'));
  assert.equal(win('helper'), path.join(bin, 'helper.com'));
  assert.equal(win('npm.cmd'), path.join(bin, 'npm.cmd'), 'An explicit extension is kept');
  assert.equal(win('npm'), 'npm', 'A bare name never picks a .cmd script');
  assert.equal(win('folder'), 'folder', 'Folders are not programs');
  assert.equal(win('missing'), 'missing', 'Not found leaves the name for node-pty to report');
  assert.equal(win('C:\\Windows\\System32\\wsl.exe'), 'C:\\Windows\\System32\\wsl.exe');
  assert.equal(win('.\\tool.exe'), '.\\tool.exe');
  assert.equal(resolveExecutable('tool', env, 'linux'), 'tool', 'Other systems use their own PATH lookup');
  fs.rmSync(bin, { recursive: true, force: true });
}
assert.deepEqual(parseWslList(Buffer.from('docker-desktop\r\nUbuntu\r\n\r\nDebian\r\n', 'utf16le')), ['Ubuntu', 'Debian']);
const winEnv = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
const installed = new Set([
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Windows\\system32\\cmd.exe',
  'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Windows\\System32\\wsl.exe',
]);
const detected = windowsShells(winEnv, file => installed.has(file), () => ['Ubuntu']);
assert.deepEqual(detected.map(shell => shell.id), ['powershell', 'cmd', 'git-bash', 'wsl:Ubuntu'], 'Missing PowerShell 7 must not be offered');
assert.deepEqual(detected.at(-1).args, ['-d', 'Ubuntu']);
assert.deepEqual(windowsShells({ SystemRoot: 'C:\\Windows' }, () => false, () => ['Ubuntu']), [], 'Nothing installed offers nothing');
assert.deepEqual(posixShells(() => '# comment\n/bin/bash\n/usr/bin/bash\n/usr/sbin/nologin\n/usr/bin/tmux\n/bin/zsh\n/bin/gone\n', file => file !== '/bin/gone').map(shell => shell.id),
  ['/bin/bash', '/bin/zsh'], 'Duplicates, non-shells and missing files must be dropped');
assert.deepEqual(posixShells(() => { throw new Error('no /etc/shells'); }), []);
assert.equal(findShell('shell-that-was-uninstalled'), null, 'A missing saved shell must fall back to the system default');
assert.equal(findShell(''), null);
const cmdPrompt = prepareShellStartup('cmd.exe', { PROMPT: '$G' }).env.PROMPT;
assert(cmdPrompt.startsWith('$e]7;file:///$P$e\\$e]133;A$e\\') && cmdPrompt.endsWith('$G'), 'cmd must signal its folder and keep the user prompt');
console.log('PASS: shell detection, uninstalled shell fallback, cmd folder and prompt signals');

const icons = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'proc-icons.js'), 'utf8'), icons);
vm.runInContext(source.slice(source.indexOf('  const SHELL_GLYPHS = {'), source.indexOf('  async function refreshDefaultShellSetting(')), icons);
const logos = icons.window.PROC_ICON_PATHS;
const iconFor = (id, label) => icons.shellIconPath({ id, label });
const generic = iconFor('', 'System default');
assert.equal(iconFor('git-bash', 'Git Bash'), logos.git);
assert.equal(iconFor('wsl:Ubuntu-22.04', 'Ubuntu-22.04'), logos.ubuntu);
assert.equal(iconFor('wsl:MyDistro', 'MyDistro'), logos.linux, 'Unknown WSL distros use the Linux logo');
for (const [label, slug] of [['bash', 'gnubash'], ['zsh', 'zsh'], ['fish', 'fishshell'], ['nu', 'nushell']]) assert.equal(iconFor(`/bin/${label}`, label), logos[slug]);
for (const name of ['debian', 'alpine', 'fedora', 'archlinux', 'opensuse', 'kali-linux', 'almalinux']) assert(iconFor(`wsl:${name}`, name) && iconFor(`wsl:${name}`, name) !== logos.linux, `${name} needs its logo`);
assert.equal(iconFor('cmd', 'Command Prompt'), generic);
assert.notEqual(iconFor('powershell', 'Windows PowerShell'), generic);
assert.equal(iconFor('pwsh', 'PowerShell 7'), iconFor('powershell', 'Windows PowerShell'));

const splitStart = source.indexOf('  function splitGroupDirectly(');
const splitEnd = source.indexOf('\n  function ', source.indexOf('  function splitGroupNodeInTree('));
const splitWs = { id: 'w', layout: { type: 'group', id: 'root', terminals: [] } };
let splitIds = 0;
const splits = vm.createContext({
  findWs: () => splitWs, _getFocusedCwd: () => null, defaultTerminalPath: '', SPLIT_MIN_PX: 1, document: { getElementById: () => null },
  findGroupById: (node, id) => { const find = n => n.id === id ? n : (n.children || []).map(find).find(Boolean); return find(node); },
  uuid: () => String(++splitIds), _createTermEntry: (_w, id, label) => ({ id, label }), renderPaneArea() {}, activateTerminal() {}, saveState() {},
  setTimeout() {},
});
vm.runInContext(source.slice(splitStart, splitEnd), splits);
splits.splitGroupDirectly('w', 'root', 'row');
const [originalPane, addedPane] = splitWs.layout.children;
assert.equal(splitWs.layout.direction, 'row');
assert.equal(originalPane.id, 'root', 'Splitting the only pane must put the new pane on the right');
splits.splitGroupDirectly('w', addedPane.id, 'column');
const [upperPane, lowerPane] = splitWs.layout.children[1].children;
assert.equal(upperPane.id, addedPane.id, 'Splitting a nested pane must put the new pane at the bottom');
assert.notEqual(lowerPane.id, addedPane.id);
splitWs.layout = { type: 'group', id: 'root', terminals: [] };
splits.splitGroupDirectly('w', 'root', 'column');
assert.equal(splitWs.layout.children[0].id, 'root', 'Splitting the only pane must put the new pane at the bottom');
console.log('PASS: shell icons, new split pane goes right or below');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-startup-test-'));
const generated = [];
function run(shell, command, extraEnv = {}) {
  const env = { ...process.env, HOME: home, ...extraEnv };
  delete env.ZDOTDIR;
  Object.assign(env, extraEnv);
  const startup = prepareShellStartup(shell, env);
  if (startup.tmpDir) generated.push(startup.tmpDir);
  return execFileSync(shell, [...startup.args, '-i', '-c', command], {
    env: { ...env, ...startup.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  });
}
try {
  if (process.platform === 'win32') {
    console.log('Shell startup: POSIX fixtures skipped on Windows');
  } else {
    fs.writeFileSync(path.join(home, '.bashrc'), '(( TV_RC_COUNT += 1 ))\nPROMPT_COMMAND=("printf user-hook")\n');
    for (const name of ['.bash_profile', '.profile']) fs.writeFileSync(path.join(home, name), 'echo UNEXPECTED_LOGIN_PROFILE\nsource ~/.bashrc\n');
    const bash = run('/bin/bash', 'printf "count=%s hooks=%s,%s\\n" "$TV_RC_COUNT" "${PROMPT_COMMAND[0]}" "${PROMPT_COMMAND[1]}"; __terminal_vibe_cwd');
    assert.match(bash, /count=1 hooks=__terminal_vibe_cwd,printf user-hook/);
    assert(!bash.includes('UNEXPECTED_LOGIN_PROFILE'));
    assert.match(bash, /\x1b\]7;file:\/\//);
    assert.match(bash, /\x1b\]133;A\x07/);
    fs.mkdirSync(path.join(home, 'my project é'));
    const spaced = run('/bin/bash', 'cd "$HOME/my project é"; __terminal_vibe_cwd');
    assert.match(spaced, /\/my%20project%20é\x07/, 'A folder with a space must not be read as a printf format');
    const wrapped = prepareShellStartup('bash.exe');
    generated.push(wrapped.tmpDir);
    assert.equal(wrapped.args[0], '--rcfile', 'Windows executable names must get the shell hook');

    // WSL: fake wslpath, getent and shells, so this runs on any Linux.
    const wslStartup = prepareShellStartup('wsl.exe', { WSLENV: 'MINE/p' });
    generated.push(wslStartup.tmpDir);
    assert.deepEqual(wslStartup.args.slice(0, 3), ['-e', 'sh', '-c']);
    assert.equal(wslStartup.env.WSLENV, 'MINE/p:TV_WSL_DIR/p', 'The user\'s WSLENV must be kept');
    const fakes = path.join(home, 'fakes');
    fs.mkdirSync(fakes);
    const fake = (name, body) => fs.writeFileSync(path.join(fakes, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const wslFolder = '\\\\wsl.localhost\\Ubuntu\\tmp\\my 100% é';
    fake('wslpath', `printf '%s\\n' '${wslFolder}'`);
    const fakePath = `${fakes}:${process.env.PATH}`;
    const wslEnv = { ...process.env, HOME: home, PATH: fakePath, TV_WSL_DIR: wslStartup.tmpDir };
    delete wslEnv.ZDOTDIR;
    fs.writeFileSync(path.join(home, '.bash_profile'), 'TV_PROFILE=1\n');
    const wslRc = path.join(wslStartup.tmpDir, 'bashrc');
    const wslBash = execFileSync('/bin/bash', ['--rcfile', wslRc, '-i', '-c', 'printf "profile=%s\\n" "$TV_PROFILE"; __terminal_vibe_cwd'], { env: wslEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    assert.match(wslBash, /profile=1/, 'A WSL tab must read login files, as a plain WSL tab does');
    assert.equal(osc._extractOSC7CwdStr(wslBash), wslFolder);
    assert.match(wslBash, /\x1b\]133;A\x07/);
    fake('wslpath', 'exit 1');
    const noPath = execFileSync('/bin/bash', ['--rcfile', wslRc, '-i', '-c', '__terminal_vibe_cwd'], { env: wslEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    assert(!noPath.includes('\x1b]7;'), 'A failed wslpath must not report a folder');
    if (spawnSync('/bin/zsh', ['--version']).status === 0) {
      fake('wslpath', `printf '%s\\n' '${wslFolder}'`);
      fs.writeFileSync(path.join(home, '.zprofile'), 'TV_ZPROFILE=$(( TV_ZPROFILE + 1 ))\n');
      fs.writeFileSync(path.join(home, '.zshrc'), 'TV_ZSHRC=$(( TV_ZSHRC + 1 ))\n');
      const wslZsh = execFileSync('/bin/zsh', ['-l', '-i', '-c', 'printf "zprofile=%s zshrc=%s zdotdir=[%s]\\n" "$TV_ZPROFILE" "$TV_ZSHRC" "$ZDOTDIR"; __terminal_vibe_cwd'],
        { env: { ...wslEnv, ZDOTDIR: wslStartup.tmpDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
      assert(wslZsh.includes('zprofile=1 zshrc=1 zdotdir=[]'), wslZsh);
      assert.equal(osc._extractOSC7CwdStr(wslZsh), wslFolder);
      const hookedZsh = (extraEnv) => execFileSync('/bin/zsh', ['-l', '-i', '-c', 'print -r -- "body=$TV_COMPINIT"'],
        { env: { ...wslEnv, ZDOTDIR: wslStartup.tmpDir, ...extraEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
      const hookDump = path.join(wslStartup.tmpDir, '.zcompdump');
      // Ubuntu's own compinit, where the distro has one.
      fs.writeFileSync(path.join(home, '.zprofile'), '');
      hookedZsh({});
      assert(!fs.existsSync(hookDump), 'The distro compinit must not rebuild its dump in the hook folder for every tab');
      // A single compinit at the same stage, on any distro: .zprofile also runs while ZDOTDIR is the hook folder.
      fs.writeFileSync(path.join(home, '.zprofile'), 'autoload -U compinit; compinit\n');
      fs.rmSync(path.join(home, '.zcompdump'), { force: true });
      hookedZsh({ skip_global_compinit: '1' });
      assert(!fs.existsSync(hookDump), 'compinit must not write its dump to the hook folder');
      assert(fs.existsSync(path.join(home, '.zcompdump')), 'compinit must use the user\'s normal dump');
      // Nobody called it yet: the user's .zshrc must see the normal compinit.
      fs.writeFileSync(path.join(home, '.zprofile'), '');
      fs.writeFileSync(path.join(home, '.zshrc'), 'TV_COMPINIT=${functions[compinit]}\n');
      assert(!hookedZsh({ skip_global_compinit: '1' }).includes('__terminal_vibe'), 'The redirect must be gone before the user\'s .zshrc');
    }
    const startWith = (login, dir) => {
      fake('getent', `echo "me:x:1:1::/home/me:${login}"`);
      return execFileSync('sh', ['-c', wslStartup.args[3]], { env: { ...wslEnv, TV_WSL_DIR: dir, ZDOTDIR: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
    };
    for (const name of ['zsh', 'bash', 'fish']) fake(name, `echo "${name} $* zdotdir=$ZDOTDIR"`);
    const hookDir = wslStartup.tmpDir;
    assert.equal(startWith(path.join(fakes, 'zsh'), hookDir), `zsh -l zdotdir=${hookDir}`);
    assert.equal(startWith(path.join(fakes, 'bash'), hookDir), `bash --rcfile ${hookDir}/bashrc zdotdir=`);
    assert.equal(startWith(path.join(fakes, 'fish'), hookDir), 'fish -l zdotdir=', 'Other shells still open, as login shells');
    assert.equal(startWith(path.join(fakes, 'zsh'), '/not/reachable'), 'zsh -l zdotdir=', 'Unreachable hook files must not stop the tab opening');

    if (spawnSync('/bin/zsh', ['--version']).status === 0) {
      const custom = path.join(home, "custom ' dotdir");
      fs.mkdirSync(custom);
      fs.writeFileSync(path.join(home, '.zshenv'), '(( TV_ENV_COUNT += 1 ))\n');
      const rc = '(( TV_RC_COUNT += 1 ))\nTV_CACHE_DIR=${ZDOTDIR:-$HOME}\nprecmd_functions=(user_hook)\n';
      fs.writeFileSync(path.join(home, '.zshrc'), rc);
      const command = 'printf "env=%s rc=%s cache=%s hooks=%s\\n" "$TV_ENV_COUNT" "$TV_RC_COUNT" "$TV_CACHE_DIR" "${(j:,:)precmd_functions}"; __terminal_vibe_cwd';
      for (let i = 0; i < 2; i++) {
        const zsh = run('/bin/zsh', command);
        assert(zsh.includes(`env=1 rc=1 cache=${home} hooks=user_hook,__terminal_vibe_cwd`), zsh);
        assert.match(zsh, /\x1b\]7;file:\/\//);
        assert.match(zsh, /\x1b\]133;A\x07/);
      }
      fs.writeFileSync(path.join(custom, '.zshenv'), '(( TV_ENV_COUNT += 1 ))\n');
      fs.writeFileSync(path.join(custom, '.zshrc'), rc);
      assert(run('/bin/zsh', command, { ZDOTDIR: custom }).includes(`env=1 rc=1 cache=${custom}`));
      // A user's .zshenv can redirect the rest of startup to another directory.
      fs.writeFileSync(path.join(home, '.zshenv'), '(( TV_ENV_COUNT += 1 ))\nZDOTDIR="$HOME/custom \' dotdir"\n');
      assert(run('/bin/zsh', command).includes(`env=1 rc=1 cache=${custom}`));
      assert.equal(fs.readFileSync(path.join(home, '.zshrc'), 'utf8'), rc);
    }
    assert.deepEqual(prepareShellStartup('/usr/bin/fish'), { args: [], env: {}, tmpDir: null });
    console.log('PASS: single startup load, no login profiles, stable zsh cache directory, custom ZDOTDIR, cwd hooks and Bash prompt arrays');
  }
} finally {
  for (const dir of [...generated, home]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
