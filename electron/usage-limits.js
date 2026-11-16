'use strict';
// Plan usage limits of the agent CLIs, asked through each CLI with its own login (as T3 Code does):
// Claude Code's get_usage control request, Codex app-server's account/rateLimits/read.
// Each window: { label, used (0-100), resetsAt (ms), mins (window length) }.
const { spawn } = require('child_process');

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

const pct = n => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

async function claudeUsage(bin, env) {
  const res = await ask(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], env,
    [{ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } },
      { type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } }],
    j => j.type === 'control_response' && j.response?.request_id === 'usage' ? (j.response.response || null) : undefined);
  if (!res?.rate_limits_available || !res.rate_limits) return null;
  // The session and weekly windows, then any per-model weekly one (seven_day_opus → "Weekly · Opus").
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const keys = ['five_hour', 'seven_day', ...Object.keys(res.rate_limits).filter(k => /^seven_day_(opus|sonnet|haiku|fable)$/.test(k))];
  const windows = keys.map(k => {
    const w = res.rate_limits[k];
    if (!w || w.utilization == null) return null;
    const label = k === 'five_hour' ? 'Session' : k === 'seven_day' ? 'Weekly' : `Weekly · ${cap(k.slice(10))}`;
    return { label, used: pct(w.utilization), resetsAt: Date.parse(w.resets_at) || null, mins: k === 'five_hour' ? 300 : 10080 };
  }).filter(Boolean);
  return windows.length ? { plan: res.subscription_type || null, windows } : null;
}

async function codexUsage(bin, env) {
  const res = await ask(bin, ['app-server'], env,
    [{ method: 'initialize', id: 1, params: { clientInfo: { name: 'terminalvibe', title: 'TerminalVibe', version: '1.0.0' } } }],
    j => j.id === 2 ? (j.result || null) : undefined,
    (j, p) => { if (j.id === 1) { p.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'); p.stdin.write(JSON.stringify({ method: 'account/rateLimits/read', id: 2, params: null }) + '\n'); } });
  const rl = res?.rateLimits;
  if (!rl) return null;
  const label = mins => !mins ? 'Limit' : mins <= 300 ? 'Session' : mins >= 43200 ? 'Monthly' : mins >= 10080 ? 'Weekly' : `${Math.round(mins / 60)}-hour`;
  const windows = [rl.primary, rl.secondary].filter(w => w && typeof w.usedPercent === 'number')
    .map(w => ({ label: label(w.windowDurationMins), used: pct(w.usedPercent), resetsAt: w.resetsAt ? w.resetsAt * 1000 : null, mins: w.windowDurationMins || null }));
  return windows.length ? { plan: rl.planType || null, windows } : null;
}

// { claude?: {plan, windows}, codex?: … } for the installed agents that report limits.
// ponytail: cached for a minute; every refresh spawns each CLI briefly (~1-2s, no model call).
let cache = null;
async function usageLimits(found, env, fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 60000) return cache.value;
  const [claude, codex] = await Promise.all([
    found.claude ? claudeUsage(found.claude, env).catch(() => null) : null,
    found.codex ? codexUsage(found.codex, env).catch(() => null) : null,
  ]);
  const value = { ...(claude ? { claude } : {}), ...(codex ? { codex } : {}) };
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { usageLimits };
