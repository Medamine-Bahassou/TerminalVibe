const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { once } = require('events');
const { createSkillManager } = require('../electron/skill-manager');
const { handleSkillRequest } = require('../electron/skill-http');

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-skills-'));
  let server;
  try {
    const manager = createSkillManager({ home, env: {} });
    const get = id => manager.list().find(skill => skill.id === id);
    assert(manager.list().every(skill => !skill.installed));
    assert.throws(() => manager.setEnabled('../escape', true), /Unknown/);
    assert.throws(() => manager.setEnabled('codex', 'false'), /boolean/);
    manager.setEnabled('claude', false);
    assert.equal(get('claude').installed, false);
    for (const id of ['claude', 'codex']) {
      manager.setEnabled(id, true);
      const active = get(id).path;
      assert.equal(get(id).enabled, true);
      assert.equal(get(id).installed, true);
      assert(fs.existsSync(path.join(active, 'SKILL.md')));
      assert(fs.existsSync(path.join(active, 'scripts', 'tv.js')));
      assert(fs.existsSync(path.join(active, 'agents', 'openai.yaml')));
      fs.writeFileSync(path.join(active, 'custom.txt'), 'preserve local changes');
      manager.setEnabled(id, true); // idempotent
      manager.setEnabled(id, false);
      manager.setEnabled(id, false);
      assert.equal(get(id).enabled, false);
      assert.equal(get(id).installed, true);
      assert(!fs.existsSync(active));
      assert.equal(fs.readFileSync(path.join(home, '.terminalvibe', 'disabled-skills', id, 'terminalvibe-orchestration', 'custom.txt'), 'utf8'), 'preserve local changes');
      manager.setEnabled(id, true);
      assert.equal(fs.readFileSync(path.join(active, 'custom.txt'), 'utf8'), 'preserve local changes');
    }
    // Conflicts never overwrite either copy.
    const inactive = path.join(home, '.terminalvibe', 'disabled-skills', 'codex', 'terminalvibe-orchestration');
    fs.mkdirSync(inactive, { recursive: true });
    assert.equal(get('codex').conflict, true);
    assert.throws(() => manager.setEnabled('codex', false), /Both active/);
    fs.rmSync(inactive, { recursive: true });
    // Honor a custom Claude configuration root.
    const custom = createSkillManager({ home, env: { CLAUDE_CONFIG_DIR: path.join(home, 'custom-claude') } });
    custom.setEnabled('claude', true);
    assert(fs.existsSync(path.join(home, 'custom-claude', 'skills', 'terminalvibe-orchestration', 'SKILL.md')));
    // A failed source copy never leaves a discoverable partial skill.
    const broken = createSkillManager({ home: path.join(home, 'broken'), env: {}, source: path.join(home, 'missing') });
    assert.throws(() => broken.setEnabled('codex', true));
    assert(broken.list().every(skill => !skill.installed));

    server = http.createServer((req, res) => handleSkillRequest(req, res, manager));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const endpoint = `${origin}/api/skills`;
    const post = (body, headers = {}) => fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await fetch(endpoint)).status, 200);
    assert.equal((await fetch(endpoint, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await post({ id: 'claude', enabled: false }, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal(get('claude').enabled, true);
    assert.equal((await post({ id: 'claude', enabled: false }, { 'Content-Type': 'text/plain' })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'PUT' })).status, 405);
    assert.equal((await post({ id: '../escape', enabled: true })).status, 400);
    assert.equal((await post({ id: 'claude', enabled: false })).status, 200);
    assert.equal(get('claude').enabled, false);
    assert.equal((await post({ id: 'claude', enabled: true })).status, 200);
    assert.equal(get('claude').enabled, true);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
    console.log('PASS: skill installation, toggles, preservation, conflicts, custom paths, failed copy cleanup and HTTP origin/method/input validation');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
