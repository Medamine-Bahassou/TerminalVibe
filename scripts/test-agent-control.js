#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const { startAgentControl, validateLaunch } = require('../electron/agent-control');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-control-'));
  let bridge;
  try {
    const pane = name => ({ name, cwd: temp, argv: ['fake-agent', 'literal prompt; $(no expansion)'] });
    const plan = { name: 'Team', layout: { split: 'row', sizes: [60, 40], children: [pane('Lead'), { split: 'column', children: [pane('A'), pane('B')] }] } };
    validateLaunch(plan);
    assert.throws(() => validateLaunch({ ...plan, layout: { ...plan.layout, sizes: [0, 100] } }));
    assert.throws(() => validateLaunch({ ...plan, layout: { split: 'row', children: [pane('A'), pane('A')] } }));
    assert.throws(() => validateLaunch({ ...plan, layout: { ...pane('Bad'), cwd: 'relative' } }));
    assert.throws(() => validateLaunch({ ...plan, layout: { ...pane('Bad'), argv: [] } }));

    // Exercise the real renderer handler without starting the application or paid agents.
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const handler = source.slice(source.indexOf('  async function handleAgentRequest'), source.indexOf("  const AR_KEY ="));
    let sequence = 0, activeWsId, spawns = [], writes = [];
    const workspaces = [];
    const all = node => node.type === 'split' ? node.children.flatMap(all) : node.terminals;
    const sandbox = {
      workspaces, sideOrder: [], nativePtyReady: true, TextEncoder,
      uuid: () => `id-${++sequence}`,
      getWorkspaceTerminals: wsp => all(wsp.layout),
      serializeLayout: node => JSON.parse(JSON.stringify(node, (key, value) => key === 'term' ? undefined : value)),
      findWs: id => workspaces.find(w => w.id === id),
      findTermById: id => {
        for (const ws of workspaces) { const term = all(ws.layout).find(t => t.id === id); if (term) return { ws, term }; }
      },
      _createTermEntry: (_ws, id, label) => ({ id, label, term: { buffer: { active: { length: 3, getLine: i => ({ translateToString: () => `line ${i}` }) } }, write() {}, options: {} } }),
      renderSidebar() {}, renderPaneArea() {}, saveState() {},
      activateWorkspace: id => { activeWsId = id; }, activateTerminal() {},
      getSlotDimensions: () => ({ cols: 80, rows: 24 }),
      _sendStdinRaw: (id, data) => writes.push({ id, text: new TextDecoder().decode(data) }),
      window: { electronAPI: { terminalCreate: async spec => { spawns.push(spec); return spec.argv[0] !== 'fail'; } } }
    };
    vm.createContext(sandbox);
    vm.runInContext(handler, sandbox);
    const dispatch = request => {
      if (request.method === 'launch') validateLaunch(request.params);
      return sandbox.handleAgentRequest(request);
    };
    bridge = await startAgentControl({ directory: temp, dispatch });
    const descriptor = JSON.parse(fs.readFileSync(bridge.file, 'utf8'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(bridge.file).mode & 0o777, 0o600);
    const call = async (method, params, headers = {}) => {
      const response = await fetch(descriptor.url, { method: 'POST', headers: { Authorization: `Bearer ${descriptor.token}`, ...headers }, body: JSON.stringify({ method, params }) });
      return { status: response.status, ...await response.json() };
    };
    assert.equal((await call('list', {}, { Authorization: 'Bearer wrong' })).status, 403);
    assert.equal((await call('list', {}, { Origin: 'https://untrusted.example' })).status, 403);
    const launched = await call('launch', plan);
    assert.equal(launched.status, 200);
    const wsp = workspaces[0], terms = all(wsp.layout);
    assert.equal(activeWsId, wsp.id);
    assert.equal(spawns.length, 3);
    assert.equal(spawns[0].executable, 'fake-agent');
    assert.equal(spawns[0].argv[0], 'literal prompt; $(no expansion)');
    assert(terms.every(t => t.agentManaged));
    const ids = terms.map(t => t.id);
    const original = wsp.layout;
    assert.equal((await call('arrange', { workspaceId: wsp.id, layout: { paneId: ids[0] } })).status, 400);
    assert.equal(wsp.layout, original, 'Invalid arrangement leaves layout intact');
    const arranged = await call('arrange', { workspaceId: wsp.id, layout: { split: 'column', children: [{ paneId: ids[2] }, { split: 'row', children: [{ paneId: ids[1] }, { paneId: ids[0] }] }] } });
    assert.equal(arranged.status, 200);
    assert.equal(all(wsp.layout)[0], terms[2], 'Rearrangement preserves terminal objects');
    assert.equal(spawns.length, 3, 'Rearrangement never respawns');
    assert.equal((await call('read', { paneId: ids[0], lines: 2 })).result.text, 'line 1\nline 2');
    assert.equal((await call('read', { paneId: ids[0], lines: 2001 })).status, 400);
    await call('send', { paneId: ids[0], text: 'follow up', enter: true });
    assert.deepEqual(writes, [{ id: ids[0], text: 'follow up\r' }]);
    terms[0].locked = true;
    assert.equal((await call('send', { paneId: ids[0], text: 'no' })).status, 400);
    assert.equal(writes.length, 1);
    const failed = await call('launch', { name: 'Failure', layout: { ...pane('Failure'), argv: ['fake-agent', 'fail'] } });
    assert.equal(failed.result.launches[0].started, false);
    assert.equal(failed.result.workspace.panes[0].dead, true);
    assert.equal((await call('launch', { ...plan, layout: pane('Only'), name: '' })).status, 400);
    assert.equal(workspaces.length, 2, 'Invalid launch creates no workspace');
    // End-to-end portable client talking to the live bridge.
    const cli = path.join(__dirname, '..', 'skills', 'terminalvibe-orchestration', 'scripts', 'tv.js');
    const output = await new Promise((resolve, reject) => cp.execFile(process.execPath, [cli, 'list', '--instance', bridge.file], (err, stdout) => err ? reject(err) : resolve(stdout)));
    assert.equal(JSON.parse(output).workspaces.length, 2);
    bridge.close();
    assert(!fs.existsSync(bridge.file));
    console.log('Agent control: validation, auth, launch, failures, arrangement, read, send, CLI and cleanup passed');
  } finally {
    if (bridge) bridge.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
