'use strict';
// Settings > Providers: per-agent overrides kept in ~/.terminalvibe/providers.json and applied wherever the main
// process starts an agent CLI. { [id]: { enabled, bin, configDir, args: [], env: {} } }, ids as in THREAD_HARNESSES.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const FILE = path.join(os.homedir(), '.terminalvibe', 'providers.json');
// The config folder each CLI reads from an env var. It goes into process.env, so the transcript readers
// (threads.js, claude-sessions.js, …) and agents started by hand in a terminal use the same account.
const CONFIG_ENV = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
const ORIGINAL = Object.fromEntries(Object.values(CONFIG_ENV).map(k => [k, process.env[k]]));
const ID_OF_BIN = { agy: 'antigravity' }; // binary name -> provider id where they differ

const expand = p => p.replace(/^~(?=$|[\\/])/, os.homedir());
let cfg = null;

function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, c] of Object.entries(raw)) {
    if (!/^[\w-]{1,40}$/.test(id) || id === '__proto__' || !c || typeof c !== 'object') continue;
    const str = v => typeof v === 'string' && v.trim() && v.length <= 4096 ? v.trim() : undefined;
    const p = {};
    if (typeof c.enabled === 'boolean') p.enabled = c.enabled; // unset: on when installed
    if (str(c.bin)) p.bin = str(c.bin);
    if (CONFIG_ENV[id] && str(c.configDir)) p.configDir = str(c.configDir);
    const args = Array.isArray(c.args) ? c.args.filter(a => typeof a === 'string' && a.length && a.length <= 4096).slice(0, 64) : [];
    if (args.length) p.args = args;
    const env = Object.entries(c.env && typeof c.env === 'object' ? c.env : {})
      .filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k) && typeof v === 'string' && v.length <= 16384).slice(0, 64);
    if (env.length) p.env = Object.fromEntries(env);
    // Names whose values the settings page hides (display only: still plain text in the file).
    const secret = Array.isArray(c.secret) ? c.secret.filter(k => typeof k === 'string' && p.env && Object.hasOwn(p.env, k)) : [];
    if (secret.length) p.secret = [...new Set(secret)];
    if (Object.keys(p).length) out[id] = p;
  }
  return out;
}
function applyConfigDirs() {
  for (const [id, key] of Object.entries(CONFIG_ENV)) {
    const dir = cfg[id]?.configDir ? expand(cfg[id].configDir) : ORIGINAL[key];
    if (dir) process.env[key] = dir; else delete process.env[key];
  }
}
function load() {
  if (cfg) return cfg;
  try { cfg = sanitize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { cfg = {}; }
  applyConfigDirs();
  return cfg;
}
function save(raw) {
  const next = sanitize(raw);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  cfg = next;
  applyConfigDirs();
  return cfg;
}

// The env and extra launch arguments of one provider's agent processes.
const envFor = (id, base) => ({ ...base, ...(load()[id]?.env || {}) });
const argsFor = id => load()[id]?.args || [];

// A binary setting: a path, or a command name looked up on PATH like the defaults.
function resolveBin(bin, env) {
  if (/[\\/]/.test(bin)) { const p = expand(bin); try { return fs.statSync(p).isFile() ? p : null; } catch { return null; } }
  return require('./threads').detectAgents([bin], env)[bin] || null;
}
// detectAgents with the overrides: a disabled provider is not found, a set binary replaces the PATH lookup.
function detect(names, env, { includeDisabled = false } = {}) {
  const found = require('./threads').detectAgents(names, env);
  for (const name of Object.keys(found)) {
    const c = load()[ID_OF_BIN[name] || name];
    if (c?.enabled === false && !includeDisabled) found[name] = null;
    else if (c?.bin) found[name] = resolveBin(c.bin, env);
  }
  return found;
}

// For the settings page: where each agent is and its version (`--version`), disabled ones included.
async function status(names, env) {
  const found = detect(names, env, { includeDisabled: true });
  const { resolveLaunch } = require('./chat-sdk');
  const version = bin => new Promise(resolve => {
    const launch = resolveLaunch(bin, ['--version']);
    if (!launch) { resolve(null); return; }
    const p = execFile(launch.file, launch.args, { env, timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, out) => resolve(err ? null : String(out).match(/\d+\.\d+[\w.+-]*/)?.[0] || null));
    p.stdin?.end();
  });
  const entries = await Promise.all(Object.entries(found).map(async ([name, bin]) => [name, { path: bin, version: bin ? await version(bin) : null }]));
  return { config: load(), agents: Object.fromEntries(entries) };
}

const UPDATE_NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', opencode: 'OpenCode' };
const npmLatest = name => `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
const versionParts = version => /^(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?(?:\+[\w.-]+)?$/.exec(version);

function hasUpdate(installed, latest) {
  const current = versionParts(installed), release = versionParts(latest);
  if (!current || !release || release[4]) return null;
  for (let i = 1; i <= 3; i++) {
    if (Number(release[i]) !== Number(current[i])) return Number(release[i]) > Number(current[i]);
  }
  return Boolean(current[4]);
}

function updateUrl(name, installed) {
  if (name === 'agy') {
    const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
    const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
    return platform && arch && `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${platform}_${arch}.json`;
  }
  return npmLatest({
    claude: '@anthropic-ai/claude-code', codex: '@openai/codex',
    opencode: installed.startsWith('1.') ? 'opencode-ai' : '@opencode/cli',
  }[name]);
}

const isSystemBin = bin => process.platform === 'linux' && /^\/(?:usr\/)?(?:s?bin)\//.test(bin);
// Commands that update one package only. They are typed into a terminal for the user to review and run.
const PACKAGE_COMMANDS = {
  // Arch calls this a partial upgrade: if the new build needs newer libraries, `pacman -Syu` fixes it.
  pacman: pkg => `sudo pacman -Sy --needed ${pkg}`,
  paru: pkg => `paru -S --needed ${pkg}`,
  yay: pkg => `yay -S --needed ${pkg}`,
  apt: pkg => `sudo apt-get update && sudo apt-get install --only-upgrade ${pkg}`,
  dnf: pkg => `sudo dnf upgrade --refresh ${pkg}`,
  zypper: pkg => `sudo zypper update ${pkg}`,
  apk: pkg => `sudo apk add --update --upgrade ${pkg}`,
  npm: pkg => `sudo npm install -g ${pkg}@latest`,
  winget: pkg => `winget upgrade --id ${pkg} --exact`,
  scoop: pkg => `scoop update ${pkg}`,
  'scoop (global)': pkg => `scoop update --global ${pkg}`,
  choco: pkg => `choco upgrade ${pkg}`, // needs an administrator terminal
};
// Chocolatey's shims are binaries that don't name their package.
const CHOCO_PACKAGES = { claude: 'claude-code', codex: 'codex', opencode: 'opencode' };
// Windows has no owner database to ask: the install path says who manages it.
// npm and native installs return {}, because the CLI's own updater handles those.
function windowsManagerOf(id, bin, real, readShim) {
  const paths = [bin, real].map(file => file.replace(/\//g, '\\'));
  for (const file of paths) {
    const winget = /\\WinGet\\Packages\\([^\\_]+)_/i.exec(file)?.[1];
    if (winget) return managedBy('winget', winget);
  }
  if (paths.some(file => /\\WinGet\\Links\\/i.test(file))) return { managed: 'winget' };
  if (paths.some(file => /\\chocolatey\\/i.test(file))) return managedBy('choco', CHOCO_PACKAGES[id]);
  if (paths.some(file => /\\scoop\\/i.test(file))) {
    // A shim names its target in a sibling .shim file or in its own text.
    const target = [...paths, readShim(bin).replace(/\//g, '\\')].join('\n');
    if (/\\(node_modules|persist\\nodejs[^\\]*|apps\\nodejs[^\\]*)\\/i.test(target)) return {};
    const pkg = /\\scoop\\apps\\([^\\\r\n]+)\\/i.exec(target)?.[1];
    return managedBy(/\\ProgramData\\scoop\\/i.test(target) ? 'scoop (global)' : 'scoop', pkg);
  }
  return {};
}
function readShim(bin) {
  for (const file of [bin.replace(/\.[^.\\/]+$/, '.shim'), /\.(cmd|bat|ps1)$/i.test(bin) && bin]) {
    try { if (file) return fs.readFileSync(file, 'utf8'); } catch {}
  }
  return '';
}
function managedBy(manager, pkg) {
  const safe = /^(?:@[a-z0-9][\w.-]*\/)?[a-zA-Z0-9][\w.+-]*$/.test(pkg || '');
  return { managed: manager, command: safe && Object.hasOwn(PACKAGE_COMMANDS, manager) ? PACKAGE_COMMANDS[manager](pkg) : undefined };
}
// How a package-managed install gets updated. The CLI's own updater must not touch these.
async function managerOf(id, bin, env) {
  const windows = process.platform === 'win32';
  if (!windows && !isSystemBin(bin)) return {};
  const run = (file, args) => new Promise(resolve => {
    execFile(file, args, { env: { ...env, LC_ALL: 'C' }, timeout: 4000 }, (err, out) => resolve(err ? null : String(out).trim()));
  });
  const has = name => ['/usr/bin', '/bin', '/usr/sbin'].some(dir => fs.existsSync(path.join(dir, name)));
  let real = bin;
  try { real = fs.realpathSync(bin); } catch {}
  if (windows) return windowsManagerOf(id, bin, real, readShim);
  for (const file of new Set([bin, real])) {
    let pkg = await run('pacman', ['-Qoq', file]);
    if (pkg) {
      // Foreign packages (AUR) aren't in the repos, so pacman -S can't update them.
      if (await run('pacman', ['-Qmq', pkg]) === null) return managedBy('pacman', pkg);
      const helper = ['paru', 'yay'].find(has);
      return helper ? managedBy(helper, pkg) : { managed: 'AUR' };
    }
    pkg = /^([^:,\s]+)(?::[\w-]+)?: /.exec(await run('dpkg', ['-S', file]) || '')?.[1];
    if (pkg) return managedBy('apt', pkg);
    pkg = await run('rpm', ['-qf', '--qf', '%{NAME}', file]);
    if (pkg) return managedBy(has('dnf') ? 'dnf' : has('zypper') ? 'zypper' : 'rpm', pkg);
    pkg = await run('apk', ['info', '-q', '--who-owns', file]);
    if (pkg) return managedBy('apk', pkg);
  }
  const npm = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(real)?.[1];
  return npm ? managedBy('npm', npm) : { managed: 'system' };
}

async function checkUpdates(env) {
  const { agents } = await status(Object.keys(UPDATE_NAMES), env);
  return Promise.all(Object.entries(UPDATE_NAMES).map(async ([id, name]) => {
    const agent = agents[id];
    if (!agent?.path) return { id, name, status: 'missing' };
    const row = { id, name, installed: agent.version, ...await managerOf(id, agent.path, env) };
    const installed = agent.version;
    if (!versionParts(installed)) return { ...row, status: 'unavailable' };
    const url = updateUrl(id, installed);
    try {
      if (url) {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const { version: latest } = await response.json();
          const available = hasUpdate(installed, latest);
          if (available !== null) return { ...row, latest, status: available ? 'available' : 'current' };
        }
      }
    } catch {}
    return { ...row, status: 'unavailable' };
  }));
}

const UPDATE_TIMEOUT_MS = 30 * 60 * 1000;
let updating = false;
function updateProgress(line, previous) {
  const text = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  const phase = /^(?:[✓✔⠋→*=> ]*)(downloading|verifying|extracting|installing)\b/i.exec(text)?.[1]?.toLowerCase();
  const stage = phase || (previous?.stage === 'downloading' ? previous.stage : null);
  if (!stage) return null;
  const value = /(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*%/.exec(text)?.[1];
  const percent = value != null && Number(value) <= 100 ? Number(value) : null;
  if (!phase && percent === null) return null;
  return { stage, percent };
}
// Both CLIs download silently when piped, so the growing file is the only sign of progress.
function largestFile(dir) {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try { size = Math.max(size, entry.isDirectory() ? largestFile(full) : fs.statSync(full).size); } catch {}
    }
  } catch {}
  return size;
}
// Claude stages in <cache>/claude/staging/<version>.<its pid>.*
function claudeDownloadSize(env, pid) {
  const staging = path.join(env.XDG_CACHE_HOME || path.join(env.HOME || os.homedir(), '.cache'), 'claude', 'staging');
  try {
    const own = fs.readdirSync(staging).find(name => name.includes(`.${pid}.`));
    return own ? largestFile(path.join(staging, own)) : 0;
  } catch { return 0; }
}

async function updateAgent(id, env, onProgress = () => {}) {
  if (typeof id !== 'string' || !Object.hasOwn(UPDATE_NAMES, id)) return { error: 'Unknown agent harness.' };
  const bin = detect([id], env, { includeDisabled: true })[id];
  if (!bin) return { error: 'The installed executable could not be found.' };
  if ((await managerOf(id, bin, env)).managed) {
    return { error: 'This installation must be updated through its package manager.' };
  }
  if (updating) return { error: 'Another agent update is already running.' };
  const launch = require('./chat-sdk').resolveLaunch(bin, [id === 'opencode' ? 'upgrade' : 'update']);
  if (!launch) return { error: 'The updater could not be started.' };
  updating = true;
  let tmp, watch;
  try {
    // Codex's installer downloads into `mktemp -d`; a private TMPDIR makes that measurable.
    if (id === 'codex') tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-update-'));
    await new Promise((resolve, reject) => {
      // Agent binaries are hundreds of MB and a killed download restarts from zero, so allow slow connections.
      const proc = execFile(launch.file, launch.args, { env: tmp ? { ...env, TMPDIR: tmp, TMP: tmp, TEMP: tmp } : env, timeout: UPDATE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 },
        err => err ? reject(err) : resolve());
      let last, bytes = 0, at = Date.now();
      if (tmp || id === 'claude') watch = setInterval(() => {
        if (last && last.stage !== 'downloading') return;
        const size = tmp ? largestFile(tmp) : claudeDownloadSize(env, proc.pid);
        const now = Date.now();
        if (!size && bytes) onProgress(last = { stage: 'installing', percent: null }); // the staged file was moved into place
        else if (size) onProgress({ stage: 'downloading', percent: last?.percent ?? null, bytes: size, speed: Math.max(0, size - bytes) * 1000 / (now - at || 1) });
        bytes = size;
        at = now;
      }, 1000);
      for (const stream of [proc.stdout, proc.stderr]) {
        let remainder = '';
        stream?.setEncoding('utf8').on('data', chunk => {
          const lines = (remainder + chunk).split(/[\r\n]/);
          remainder = lines.pop();
          for (const line of lines) {
            const next = updateProgress(line, last);
            if (!next || (next.stage === last?.stage && next.percent === last.percent)) continue;
            last = next;
            onProgress(next);
          }
        });
      }
      proc.stdin?.end();
    });
    return {};
  } catch (err) {
    if (err.killed) return { error: 'The update timed out. Run the updater in a terminal.' };
    return { error: 'The updater failed. Check the installation method for this agent.' };
  } finally {
    clearInterval(watch);
    if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} // Windows may still hold a file
    updating = false;
  }
}

module.exports = { load, save, envFor, argsFor, detect, status, checkUpdates, updateAgent, sanitize, CONFIG_ENV };

if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(sanitize({
    codex: { enabled: true }, claude: { enabled: false, bin: '  ', configDir: '~/.claude_work', args: ['--chrome', 5, ''], env: { ANTHROPIC_API_KEY: 'k', 'bad key': 'x', N: 1 }, secret: ['ANTHROPIC_API_KEY', 'MISSING', 'ANTHROPIC_API_KEY'] },
    opencode: { configDir: '/x' }, '../evil': { bin: 'x' }, amp: {},
  }), { codex: { enabled: true }, claude: { enabled: false, configDir: '~/.claude_work', args: ['--chrome'], env: { ANTHROPIC_API_KEY: 'k' }, secret: ['ANTHROPIC_API_KEY'] } });
  assert.deepStrictEqual(sanitize(null), {});
  const win = (bin, shim = '', real = bin) => windowsManagerOf('opencode', bin, real, () => shim).command;
  const home = 'C:\\Users\\me';
  assert.equal(win(`${home}\\AppData\\Local\\Microsoft\\WinGet\\Links\\opencode.exe`, '',
    `${home}\\AppData\\Local\\Microsoft\\WinGet\\Packages\\SST.opencode_Microsoft.Winget.Source_8wekyb3d8bbwe\\opencode.exe`), 'winget upgrade --id SST.opencode --exact');
  assert.equal(win(`${home}\\scoop\\shims\\opencode.exe`, `path = "${home}\\scoop\\apps\\opencode\\current\\opencode.exe"`), 'scoop update opencode');
  assert.equal(win('C:\\ProgramData\\scoop\\shims\\opencode.exe', 'path = "C:\\ProgramData\\scoop\\apps\\opencode\\current\\opencode.exe"'), 'scoop update --global opencode');
  assert.equal(win(`${home}\\scoop\\apps\\nodejs\\current\\bin\\opencode.cmd`), undefined);
  assert.equal(win('C:\\ProgramData\\chocolatey\\bin\\opencode.exe'), 'choco upgrade opencode');
  assert.deepStrictEqual(windowsManagerOf('opencode', `${home}\\AppData\\Roaming\\npm\\opencode.cmd`, '', () => ''), {});
  assert.equal(managedBy('pacman', 'opencode').command, 'sudo pacman -Sy --needed opencode');
  assert.equal(managedBy('npm', '@opencode/cli').command, 'sudo npm install -g @opencode/cli@latest');
  assert.equal(managedBy('apt', 'x; rm -rf ~').command, undefined);
  assert.equal(managedBy('pacman', '-Rns').command, undefined);
  assert.equal(managedBy('AUR', 'opencode-bin').command, undefined);
  assert.equal(hasUpdate('2.9.0', '2.10.0'), true);
  assert.equal(hasUpdate('2.10.0-beta.1', '2.10.0'), true);
  assert.equal(hasUpdate('2.10.0', '2.10.0'), false);
  assert.equal(hasUpdate('2.10.1', '2.10.0'), false);
  assert.equal(hasUpdate('2.10.0', undefined), null);
  const download = { stage: 'downloading', percent: 42 };
  assert.deepStrictEqual(updateProgress('Downloading update 42%', null), download);
  assert.deepStrictEqual(updateProgress(' 75% ', download), { stage: 'downloading', percent: 75 });
  assert.deepStrictEqual(updateProgress('Installing update', download), { stage: 'installing', percent: null });
  assert.equal(updateProgress('Checking for updates', download), null);
  assert.equal(updateUrl('opencode', '1.19.6'), npmLatest('opencode-ai'));
  assert.equal(updateUrl('opencode', '2.0.31'), npmLatest('@opencode/cli'));
  console.log('providers ok');
}
