'use strict';
// Plan usage limits of the agent CLIs, asked through each CLI with its own login (as T3 Code does):
// Claude Code's get_usage control request, Codex app-server's account/rateLimits/read, Antigravity's `agy -p /usage`.
// Each window: { label, used (0-100), resetsAt (ms), mins (window length) }.
const { spawn, execFile } = require('child_process');

// One JSON-lines exchange with a CLI: write `lines`, resolve with the first reply `pick` accepts (null on
// timeout, exit or error). `onLine` may answer along the way.
function ask(bin, args, env, lines, pick, onLine, timeoutMs = 15000) {
  return new Promise(resolve => {
    let p;
    try { p = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin) }); }
    catch { resolve(null); return; }
    let buf = '', done = false;
    const finish = v => { if (done) return; done = true; clearTimeout(timer); try { p.kill(); } catch {} resolve(v); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    p.on('error', () => finish(null));
    p.on('exit', () => finish(null));
    p.stdin.on('error', () => {});
    p.stdout.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let j; try { j = JSON.parse(line); } catch { continue; }
        onLine?.(j, p);
        const v = pick(j);
        if (v !== undefined) finish(v);
      }
    });
    for (const l of lines) p.stdin.write(JSON.stringify(l) + '\n');
  });
}

const number = n => (typeof n === 'number' || typeof n === 'string' && n.trim()) && Number.isFinite(Number(n)) ? Number(n) : null;
const pct = n => { const v = number(n); return v == null || v < 0 || v > 100 ? null : Math.round(v); };
const resetTime = value => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? (value < 1e12 ? value * 1000 : value) : null;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

async function claudeUsage(bin, env) {
  let email = null; // the signed-in account, from the initialize reply
  const res = await ask(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], env,
    [{ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } },
      { type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } }],
    j => j.type === 'control_response' && j.response?.request_id === 'usage' ? (j.response.response || null) : undefined,
    j => { if (j.type === 'control_response' && j.response?.request_id === 'init') email = j.response.response?.account?.email || null; });
  const usage = parseClaudeUsage(res);
  return usage && { ...usage, email };
}
function parseClaudeUsage(res) {
  if (!res?.rate_limits_available || !res.rate_limits) return null;
  // The session and weekly windows, then any per-model weekly one (seven_day_opus → "Weekly · Opus").
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const keys = ['five_hour', 'seven_day', ...Object.keys(res.rate_limits).filter(k => /^seven_day_(opus|sonnet|haiku|fable)$/.test(k))];
  const windows = keys.map(k => {
    const w = res.rate_limits[k];
    const used = pct(w?.utilization);
    if (used == null) return null;
    const label = k === 'five_hour' ? 'Session' : k === 'seven_day' ? 'Weekly' : `Weekly · ${cap(k.slice(10))}`;
    return { label, used, resetsAt: resetTime(w.resets_at), mins: k === 'five_hour' ? 300 : 10080 };
  }).filter(Boolean);
  return windows.length ? { plan: res.subscription_type || null, windows } : null;
}

async function codexUsage(bin, env) {
  // Rate limits (id 2) and the signed-in account (id 3); an error reply to either still counts as answered.
  let limits, email = null, replies = 0;
  const res = await ask(bin, ['app-server'], env,
    [{ method: 'initialize', id: 1, params: { clientInfo: { name: 'terminalvibe', title: 'TerminalVibe', version: '1.0.0' } } }],
    j => {
      if (j.id === 2) { limits = j.result || null; replies++; }
      else if (j.id === 3) { email = j.result?.account?.email || null; replies++; }
      return replies === 2 ? limits : undefined;
    },
    (j, p) => {
      if (j.id !== 1) return;
      p.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      p.stdin.write(JSON.stringify({ method: 'account/rateLimits/read', id: 2, params: null }) + '\n');
      p.stdin.write(JSON.stringify({ method: 'account/read', id: 3, params: { refreshToken: false } }) + '\n');
    });
  const usage = parseCodexUsage(res);
  return usage && { ...usage, email };
}
function parseCodexUsage(res) {
  // The keyed Codex bucket is authoritative when multiple quota pools exist.
  const rl = res?.rateLimitsByLimitId?.codex || res?.rateLimits;
  if (!rl) return null;
  const label = mins => !mins ? 'Limit' : mins === 300 ? 'Session' : mins === 10080 ? 'Weekly' : mins === 43200 ? 'Monthly' : mins < 60 ? `${mins}-minute` : `${mins / 60}-hour`;
  const windows = [rl.primary, rl.secondary].filter(w => w && pct(w.usedPercent) != null)
    .map(w => { const mins = number(w.windowDurationMins); return { label: label(mins > 0 ? mins : null), used: pct(w.usedPercent), resetsAt: resetTime(w.resetsAt), mins: mins > 0 ? mins : null }; });
  return windows.length ? { plan: rl.planType || null, windows } : null;
}

// Antigravity's per-model quotas from `agy -p /usage --output-format json` (answered without starting an agent).
// Only explicit numeric quota fields count; a reset time alone does not report usage.
function parseAgyUsage(res) {
  const windows = new Map();
  const pick = (o, ...ks) => ks.map(k => o[k]).find(v => v != null);
  (function walk(o, name) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, name)); return; }
    const own = pick(o, 'display_name', 'displayName', 'label', 'model_name', 'modelName', 'model', 'name');
    if (typeof own === 'string') name = own;
    const frac = pick(o, 'remaining_fraction', 'remainingFraction'), left = pick(o, 'remaining_percentage', 'remainingPercentage');
    const reset = pick(o, 'reset_time', 'resetTime', 'resets_at', 'resetsAt'), secs = pick(o, 'reset_in_seconds', 'resetInSeconds');
    const fraction = number(frac), remaining = number(left);
    const used = pct(frac != null ? (fraction != null && fraction >= 0 && fraction <= 1 ? 100 - fraction * 100 : null)
      : left != null ? (remaining != null && remaining >= 0 && remaining <= 100 ? 100 - remaining : null)
      : pick(o, 'used_percentage', 'usedPercentage'));
    if (used != null && name && !windows.has(name)) {
      const seconds = number(secs);
      windows.set(name, { label: name, used, resetsAt: resetTime(reset) || (seconds != null && seconds >= 0 ? Date.now() + seconds * 1000 : null), mins: null });
    }
    for (const v of Object.values(o)) walk(v, name);
  })(res);
  return windows.size ? { plan: null, windows: [...windows.values()] } : null;
}
async function agyUsage(bin, env) {
  const out = await new Promise(resolve => {
    const p = execFile(bin, ['-p', '/usage', '--output-format', 'json'], { env, timeout: 20000, windowsHide: true, maxBuffer: 4 << 20,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin) }, (err, stdout) => resolve(err ? '' : stdout));
    p.stdin?.end(); // signed out, it waits for a login code: answer nothing
  });
  let res;
  try { res = JSON.parse(out); } catch { res = out.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  return parseAgyUsage(res);
}

// { claude?: {plan, windows}, codex?: … } for the installed agents that report limits.
// ponytail: cached for a minute; every refresh spawns each CLI briefly (~1-2s, no model call).
let cache = null, pending = null, readSequence = 0;
// envFor(id): each provider's env (its config folder and env vars from Settings > Providers).
async function usageLimits(found, envFor, fresh = false) {
  const scope = JSON.stringify([found, ...['claude', 'codex', 'antigravity'].map(id => envFor(id))]);
  if (pending?.scope === scope) return pending.promise;
  if (!fresh && cache?.scope === scope && Date.now() - cache.at < 60000) return cache.value;
  const sequence = ++readSequence;
  const promise = (async () => {
    const [claude, codex, antigravity] = await Promise.all([
      found.claude ? claudeUsage(found.claude, envFor('claude')).catch(() => null) : null,
      found.codex ? codexUsage(found.codex, envFor('codex')).catch(() => null) : null,
      found.agy ? agyUsage(found.agy, envFor('antigravity')).catch(() => null) : null,
    ]);
    const value = { ...(claude ? { claude } : {}), ...(codex ? { codex } : {}), ...(antigravity ? { antigravity } : {}) };
    if (sequence === readSequence) cache = { scope, at: Date.now(), value };
    return value;
  })();
  pending = { scope, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}

module.exports = { usageLimits };

if (require.main === module) {
  const assert = require('assert');
  const u = parseAgyUsage({ models: [
    { label: 'Gemini 3 Pro', quotaInfo: { remainingFraction: 0.25, resetTime: '2030-01-01T00:00:00Z' } },
    { label: 'Claude Sonnet', quotaInfo: { remainingFraction: 0, resetTime: '2030-01-01T00:00:00Z' } },
    { label: 'No quota' }] });
  assert.deepStrictEqual(u.windows.map(w => [w.label, w.used]), [['Gemini 3 Pro', 75], ['Claude Sonnet', 100]]);
  assert.strictEqual(u.windows[0].resetsAt, Date.parse('2030-01-01T00:00:00Z'));
  assert.strictEqual(parseAgyUsage([{ display_name: 'x', remaining_percentage: 40 }]).windows[0].used, 60);
  assert.strictEqual(parseAgyUsage({}), null);
  assert.strictEqual(parseAgyUsage({ label: 'Unknown quota', quotaInfo: { resetTime: '2030-01-01T00:00:00Z' } }), null, 'a reset alone must not invent exhausted usage');
  for (const value of [null, '', 'invalid', NaN, Infinity, -1, 101]) {
    assert.strictEqual(parseClaudeUsage({ rate_limits_available: true, rate_limits: { seven_day: { utilization: value } } }), null, 'invalid Claude values must not become zero');
    assert.strictEqual(parseCodexUsage({ rateLimits: { primary: { usedPercent: value } } }), null, 'invalid Codex values must not become zero');
  }
  const claude = parseClaudeUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 2 }, seven_day: { utilization: 97, resets_at: '2030-01-01T00:00:00Z' } } });
  assert.deepStrictEqual(claude.windows.map(w => [w.label, w.used, w.mins]), [['Session', 2, 300], ['Weekly', 97, 10080]]);
  const codex = parseCodexUsage({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: { codex: { planType: 'plus', primary: { usedPercent: 6, windowDurationMins: 10080, resetsAt: 1893456000 }, secondary: null } } });
  assert.deepStrictEqual(codex, { plan: 'plus', windows: [{ label: 'Weekly', used: 6, resetsAt: 1893456000000, mins: 10080 }] });
  assert.strictEqual(parseCodexUsage({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 15 } } }).windows[0].label, '15-minute');
  assert.strictEqual(parseCodexUsage({ rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300 } } }).windows[0].used, 0, 'reported zero usage is valid');
  assert.strictEqual(parseAgyUsage({ name: 'Invalid model', remainingFraction: 'unknown' }), null);
  console.log('usage-limits ok');
}
