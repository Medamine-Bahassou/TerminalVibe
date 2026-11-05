#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const net = require('net');
const { once } = require('events');
const WebSocket = require('ws');
const { startAgentControl, validateLaunch } = require('../electron/agent-control');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-control-'));
  let bridge;
  let browserServer, browserClient, extraClient;
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
    const handler = source.slice(source.indexOf('  function createAgentTerminal'), source.indexOf("  const AR_KEY ="));
    let sequence = 0, activeWsId, spawns = [], writes = [];
    const workspaces = [];
    const all = node => node.type === 'split' ? node.children.flatMap(all) : node.terminals;
    const sandbox = {
      workspaces, sideOrder: [], activeWsId: null, nativePtyReady: true, TextEncoder,
      uuid: () => `id-${++sequence}`,
      getWorkspaceTerminals: wsp => all(wsp.layout),
      serializeLayout: node => JSON.parse(JSON.stringify(node, (key, value) => key === 'term' ? undefined : value)),
      findWs: id => workspaces.find(w => w.id === id),
      findTermById: id => {
        for (const ws of workspaces) { const term = all(ws.layout).find(t => t.id === id); if (term) return { ws, term }; }
      },
      findGroupContainingTerm: (node, id) => {
        const find = n => n.type === 'split' ? n.children.map(find).find(Boolean) : n.terminals.some(t => t.id === id) ? n : null;
        return find(node);
      },
      _createTermEntry: (_ws, id, label) => ({ id, label, term: { buffer: { active: { length: 3, getLine: i => ({ translateToString: () => `line ${i}` }) } }, write() {}, options: {} } }),
      renderSidebar() {}, renderPaneArea() {}, saveState() {},
      activateWorkspace: id => { activeWsId = id; sandbox.activeWsId = id; }, activateTerminal() {},
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
    const capabilities = (await call('list')).result;
    assert.equal(capabilities.capabilities.launchIntoWorkspace, true);
    assert.equal(capabilities.activeWorkspaceId, activeWsId);
    const target = workspaces[0], oldLayout = target.layout, oldActive = target.activeTermId;
    const beforeSpawns = spawns.length;
    assert.equal((await call('launch', { workspaceId: 'missing', layout: pane('New') })).status, 400);
    assert.equal((await call('launch', { workspaceId: target.id, anchorPaneId: workspaces[1].activeTermId, layout: pane('New') })).status, 400);
    assert.equal((await call('launch', { workspaceId: target.id, placement: { sizes: [80, 80] }, layout: pane('New') })).status, 400);
    assert.equal(target.layout, oldLayout, 'Bad destinations and placement do not change the tree');
    assert.equal(spawns.length, beforeSpawns, 'Bad destinations never spawn agents');
    const added = await call('launch', { workspaceId: target.id, placement: { split: 'column', sizes: [40, 60] }, layout: {
      split: 'row', children: [pane('Reviewer 1'), pane('Reviewer 2')]
    } });
    assert.equal(added.status, 200);
    assert.equal(workspaces.length, 2, 'Existing-workspace launch creates no workspace');
    assert.equal(added.result.launches.length, 2);
    assert.equal(spawns.length, beforeSpawns + 2, 'Only new agents are spawned');
    assert.equal(target.activeTermId, oldActive, 'Parent pane stays active');
    assert.equal(target.layout.children[0], oldLayout, 'Existing tree and terminal objects survive');
    assert.equal(target.layout.direction, 'column');
    assert.equal(target.layout.sizes.join(','), '40,60');
    assert(terms.every(t => all(target.layout).includes(t)));
    const parentGroup = sandbox.findGroupContainingTerm(target.layout, ids[0]);
    const anchored = await call('launch', { anchorPaneId: ids[0], placement: { before: true, sizes: [25, 75] }, layout: pane('Beside parent') });
    assert.equal(anchored.status, 200);
    assert.equal(anchored.result.workspace.id, target.id);
    const enclosing = node => node.type === 'split' ? node.children.includes(parentGroup) ? node : node.children.map(enclosing).find(Boolean) : null;
    const docked = enclosing(target.layout);
    assert.equal(docked.children[1], parentGroup, 'Anchored launch preserves parent group and places worker before it');
    const current = await call('launch', { workspaceId: 'current', layout: pane('Current workspace') });
    assert.equal(current.status, 200);
    assert.equal(current.result.workspace.id, target.id);
    assert.equal(workspaces.length, 2);
    // End-to-end portable client talking to the live bridge.
    const cli = path.join(__dirname, '..', 'skills', 'terminalvibe-orchestration', 'scripts', 'tv.js');
    const output = await new Promise((resolve, reject) => cp.execFile(process.execPath, [cli, 'list', '--instance', bridge.file], (err, stdout) => err ? reject(err) : resolve(stdout)));
    assert.equal(JSON.parse(output).workspaces.length, 2);

    // Real browser transport and real PTY in an isolated server/home. No user
    // dev processes, browser sessions, provider logins or workspaces are touched.
    const freePort = async () => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = server.address().port;
      await new Promise(resolve => server.close(resolve));
      return port;
    };
    const wsPort = await freePort(), appPort = await freePort();
    const browserHome = path.join(temp, 'browser-home');
    fs.mkdirSync(browserHome);
    browserServer = cp.spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, HOME: browserHome, USERPROFILE: browserHome, WS_PORT: String(wsPort), APP_PORT: String(appPort) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    browserServer.stderr.on('data', data => { logs += data; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Browser server startup timed out: ${logs}`)), 10000);
      const onExit = code => { clearTimeout(timer); reject(new Error(`Browser server exited ${code}: ${logs}`)); };
      browserServer.once('exit', onExit);
      browserServer.stdout.on('data', data => {
        logs += data;
        if (logs.includes('[agent-control] Ready:') && logs.includes('app server listening')) {
          clearTimeout(timer); browserServer.removeListener('exit', onExit); resolve();
        }
      });
    });
    const browserDirectory = path.join(browserHome, '.terminalvibe', 'control');
    const browserDescriptor = JSON.parse(fs.readFileSync(path.join(browserDirectory, fs.readdirSync(browserDirectory)[0]), 'utf8'));
    const browserCall = async (method, params) => {
      const response = await fetch(browserDescriptor.url, { method: 'POST', headers: { Authorization: `Bearer ${browserDescriptor.token}` }, body: JSON.stringify({ method, params }) });
      return { status: response.status, ...await response.json() };
    };
    assert.match((await browserCall('list')).error, /No ready browser tab/);
    browserClient = new WebSocket(`ws://127.0.0.1:${wsPort}`, { origin: `http://127.0.0.1:${appPort}` });
    let captured = '';
    const outputEvents = new (require('events').EventEmitter)();
    sandbox.nativePtyReady = false;
    sandbox.wsReady = true;
    sandbox.agentCreates = new Map();
    sandbox.ws = browserClient;
    sandbox.setTimeout = setTimeout;
    sandbox.clearTimeout = clearTimeout;
    browserClient.on('message', async (data, binary) => {
      if (binary) { captured += data.subarray(36).toString(); outputEvents.emit('output'); return; }
      const msg = JSON.parse(data.toString());
      if (msg.type === 'agent:created') {
        const pending = sandbox.agentCreates.get(msg.requestId);
        if (pending) { clearTimeout(pending.timer); sandbox.agentCreates.delete(msg.requestId); pending.resolve(msg.started); }
      } else if (msg.type === 'agent:request') {
        try { browserClient.send(JSON.stringify({ type: 'agent:result', id: msg.id, result: await sandbox.handleAgentRequest(msg) })); }
        catch (error) { browserClient.send(JSON.stringify({ type: 'agent:result', id: msg.id, error: error.message })); }
      }
    });
    await once(browserClient, 'open');
    const register = async client => {
      const pong = new Promise(resolve => {
        const listener = (data, binary) => {
          if (!binary && JSON.parse(data.toString()).type === 'pong') { client.off('message', listener); resolve(); }
        };
        client.on('message', listener);
      });
      client.send(JSON.stringify({ type: 'agent:ready' }));
      client.send(JSON.stringify({ type: 'ping' }));
      await pong;
    };
    await register(browserClient);
    const waitOutput = marker => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { outputEvents.off('output', check); reject(new Error(`Missing PTY output ${marker}: ${captured}`)); }, 5000);
      function check() { if (captured.includes(marker)) { clearTimeout(timer); outputEvents.off('output', check); resolve(); } }
      outputEvents.on('output', check); check();
    });
    const browserLaunch = await browserCall('launch', { name: 'Browser transport test', layout: {
      name: 'Real PTY', cwd: temp,
      argv: [process.execPath, '-e', "console.log('TV-PTY-OK '+process.env.TERMINALVIBE_PANE_ID+' '+!!process.env.TERMINALVIBE_CONTROL_FILE); process.stdin.on('data', d => process.stdout.write('RECEIVED:'+d)); setInterval(()=>{},1000)"]
    } });
    assert.equal(browserLaunch.status, 200);
    assert.equal(browserLaunch.result.launches[0].started, true);
    await waitOutput('TV-PTY-OK');
    const liveId = browserLaunch.result.launches[0].id;
    await waitOutput(`${liveId} true`);
    // Use the actual binary stdin framing from the frontend.
    sandbox._sendStdinRaw = (id, bytes) => {
      const prefix = Buffer.alloc(36, 32); prefix.write(id);
      browserClient.send(Buffer.concat([prefix, Buffer.from(bytes)]));
    };
    assert.equal((await browserCall('send', { paneId: liveId, text: 'hello browser', enter: true })).status, 200);
    await waitOutput('RECEIVED:hello browser');
    const browserAdded = await browserCall('launch', {
      workspaceId: browserLaunch.result.workspace.id, anchorPaneId: liveId,
      placement: { split: 'column', sizes: [35, 65] },
      layout: { name: 'Second real PTY', cwd: temp, argv: [process.execPath, '-e', "console.log('TV-SECOND-OK'); setInterval(()=>{},1000)"] }
    });
    assert.equal(browserAdded.status, 200);
    assert.equal(browserAdded.result.launches.length, 1);
    assert.equal(browserAdded.result.workspace.panes.length, 2);
    await waitOutput('TV-SECOND-OK');
    await browserCall('send', { paneId: liveId, text: 'parent still running', enter: true });
    await waitOutput('RECEIVED:parent still running');
    extraClient = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    await once(extraClient, 'open');
    await register(extraClient);
    assert.match((await browserCall('list')).error, /Multiple browser tabs/);
    extraClient.close(); await once(extraClient, 'close'); extraClient = null;
    browserClient.close(); await once(browserClient, 'close'); browserClient = null;
    browserServer.kill('SIGTERM'); await once(browserServer, 'exit'); browserServer = null;
    console.log('Browser control: real server, WebSocket, PTY spawn, inherited instance, stdin and multi-tab protection passed');
    bridge.close();
    assert(!fs.existsSync(bridge.file));
    console.log('Agent control: validation, auth, launch, failures, arrangement, read, send, CLI and cleanup passed');
  } finally {
    if (extraClient) extraClient.terminate();
    if (browserClient) browserClient.terminate();
    if (browserServer) browserServer.kill('SIGTERM');
    if (bridge) bridge.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
