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

module.exports = { load, save, envFor, argsFor, detect, status, sanitize, CONFIG_ENV };

if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(sanitize({
    codex: { enabled: true }, claude: { enabled: false, bin: '  ', configDir: '~/.claude_work', args: ['--chrome', 5, ''], env: { ANTHROPIC_API_KEY: 'k', 'bad key': 'x', N: 1 }, secret: ['ANTHROPIC_API_KEY', 'MISSING', 'ANTHROPIC_API_KEY'] },
    opencode: { configDir: '/x' }, '../evil': { bin: 'x' }, amp: {},
  }), { codex: { enabled: true }, claude: { enabled: false, configDir: '~/.claude_work', args: ['--chrome'], env: { ANTHROPIC_API_KEY: 'k' }, secret: ['ANTHROPIC_API_KEY'] } });
  assert.deepStrictEqual(sanitize(null), {});
  console.log('providers ok');
}
