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
const context = {
  activeWsId: workspace.id, defaultTerminalPath: '',
  findWs: () => workspace, _getFocusedCwd: () => '/project', uuid: () => 'terminal',
  getWorkspaceTerminals: () => [], activeTerminal: () => null,
  _createTermEntry: (_ws, id, label) => ({ id, label }),
  renderPaneArea() {}, activateTerminal() {}, renderSidebar() {}, saveState() {}, pluginEmit() {},
  getSlotDimensions: () => ({ cols: 120, rows: 40 }),
  sendControl: message => {
    assert.equal(workspace.layout.terminals[0].id, message.id);
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
assert.equal(controls[0].cols, 120);
assert.equal(controls[0].rows, 40);
assert.equal(frames.length, 1);
console.log('PASS: new tab spawns immediately with measured dimensions and inherited cwd');

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
  for (const dir of [...generated, home]) fs.rmSync(dir, { recursive: true, force: true });
}
