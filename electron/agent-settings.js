'use strict';
// The model and effort an agent CLI started by hand runs with (its flags, else its config files),
// and the session it opened: `sessionId` when its flags name one, `resumeLast` for --continue / --last.
const fs = require('fs');
const os = require('os');
const path = require('path');

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
// `--flag value` or `--flag=value`, last one wins.
function flag(argv, names) {
  let value;
  argv.forEach((a, i) => {
    for (const n of names) {
      if (a === n && argv[i + 1] != null) value = argv[i + 1];
      else if (a.startsWith(n + '=')) value = a.slice(n.length + 1);
    }
  });
  return value;
}
// Codex `-c key=value` overrides (TOML values, maybe quoted).
function codexOverride(argv, key) {
  let value;
  argv.forEach((a, i) => {
    const kv = a === '-c' || a === '--config' ? argv[i + 1] : a.startsWith('--config=') ? a.slice(9) : null;
    const m = kv && kv.match(new RegExp(`^${key}\\s*=\\s*"?([^"]*)"?$`));
    if (m) value = m[1];
  });
  return value;
}
// Top-level `key = "value"` of a TOML file (before its first [table]).
function tomlTop(text, key) {
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) break;
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`));
    if (m) return m[1];
  }
}
// Claude model ids ("claude-opus-5-5") as the chat's family aliases.
const claudeAlias = m => (m && String(m).match(/opus|sonnet|haiku|fable/i)?.[0].toLowerCase()) || m;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function claudeSession(argv) {
  const id = flag(argv, ['--resume', '-r', '--session-id']);
  return { sessionId: ID.test(id || '') ? id : null, resumeLast: argv.includes('-c') || argv.includes('--continue') };
}
function codexSession(argv) {
  const i = argv.indexOf('resume'), next = i >= 0 ? argv[i + 1] : null;
  return { sessionId: next && ID.test(next) ? next : null, resumeLast: next === '--last' };
}

function agentSettings(harness, argv = [], cwd = null, home = os.homedir(), env = process.env) {
  if (harness === 'claude') {
    const config = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    const files = [path.join(config, 'settings.json'), ...(cwd ? [path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')] : [])];
    const merged = Object.assign({}, ...files.map(readJson));
    return { model: claudeAlias(flag(argv, ['--model']) || env.ANTHROPIC_MODEL || merged.model), effort: flag(argv, ['--effort']) || merged.effortLevel, ...claudeSession(argv) };
  }
  if (harness === 'codex') {
    const toml = readText(path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'));
    return { model: flag(argv, ['-m', '--model']) || codexOverride(argv, 'model') || tomlTop(toml, 'model'),
      effort: codexOverride(argv, 'model_reasoning_effort') || tomlTop(toml, 'model_reasoning_effort'), ...codexSession(argv) };
  }
  return {};
}

// The running agent of a PTY (by its shell's pid): its argv and cwd from /proc.
function ptyAgentSettings(harness, ptyPid) {
  const { foregroundPid, processWorkingDirectory } = require('./proc');
  const pid = foregroundPid(ptyPid);
  const argv = pid ? readText(`/proc/${pid}/cmdline`).split('\0').filter(Boolean) : [];
  return agentSettings(harness, argv, processWorkingDirectory(ptyPid));
}

module.exports = { agentSettings, ptyAgentSettings };

if (require.main === module) {
  const assert = require('assert');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-agent-settings-'));
  fs.mkdirSync(path.join(home, '.claude')); fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', effortLevel: 'medium' }));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "high"\n[profiles.x]\nmodel = "other"\n');
  const env = {};
  const id = '01234567-1234-1234-1234-123456789abc', fresh = { sessionId: null, resumeLast: false };
  assert.deepEqual(agentSettings('claude', ['claude'], null, home, env), { model: 'opus', effort: 'medium', ...fresh });
  assert.deepEqual(agentSettings('claude', ['claude', '--model=claude-sonnet-5', '--effort', 'high'], null, home, env), { model: 'sonnet', effort: 'high', ...fresh });
  assert.equal(agentSettings('claude', ['claude', '--resume', id], null, home, env).sessionId, id);
  assert.equal(agentSettings('claude', ['claude', '-c'], null, home, env).resumeLast, true);
  assert.deepEqual(agentSettings('codex', ['codex'], null, home, env), { model: 'gpt-5.6-luna', effort: 'high', ...fresh });
  assert.deepEqual(agentSettings('codex', ['codex', '-m', 'gpt-x', '-c', 'model_reasoning_effort="low"'], null, home, env), { model: 'gpt-x', effort: 'low', ...fresh });
  assert.equal(agentSettings('codex', ['codex', 'resume', id, '-m', 'x'], null, home, env).sessionId, id);
  assert.equal(agentSettings('codex', ['codex', 'resume', '--last'], null, home, env).resumeLast, true);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS: agent settings and session from flags and config files');
}
