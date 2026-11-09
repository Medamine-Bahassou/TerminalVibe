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
const { startAgentControl, validateLaunch, dispatchWithCapabilities, canReplaceSession } = require('../electron/agent-control');

// Windows: kill() terminates server.js only; its ConPTY children keep running
// with the temp dir as cwd, which locks it. Kill the whole tree instead.
const killTree = child => process.platform === 'win32'
  ? cp.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  : child.kill('SIGTERM');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-control-'));
  let bridge;
  let browserServer, browserClient, extraClient;
  try {
    assert.equal(canReplaceSession({running:false}), true);
    assert.equal(canReplaceSession({running:false,unknown:true}), false, 'Uninspectable sessions are never replaced');
    assert.equal(canReplaceSession({running:true,name:'claude'}, true), true);
    assert.equal(canReplaceSession({running:true,name:'claude'}), false);
    assert.equal(canReplaceSession({running:true,name:'unknown'}, true), false);
    assert.equal(canReplaceSession({running:true,name:'vim'}, true), false);
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
      workspaces, sideOrder: [], activeWsId: null, nativePtyReady: true, TextEncoder, URL,
      SPLIT_MIN_PX: 200, document: { getElementById: () => null },
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
    let legacyRenderer = false;
    const dispatch = request => {
      if (request.method === 'launch') validateLaunch(request.params);
      return dispatchWithCapabilities(request, req => legacyRenderer && req.method === 'list'
        ? { capabilities: { browserRead: true } } : sandbox.handleAgentRequest(req));
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

    const { linuxPath, wslInvocation } = require(cli);
    assert.equal(linuxPath('C:\\Users\\A B\\plan.json', 'Ubuntu'), '/mnt/c/Users/A B/plan.json');
    assert.equal(linuxPath('\\\\wsl.localhost\\Ubuntu\\home\\med', 'Ubuntu'), '/home/med');
    assert.throws(() => linuxPath('\\\\wsl$\\Debian\\home\\med', 'Ubuntu'), /different WSL/);
    const literalPrompt = 'test "quotes"; $(no expansion) & spaces';
    const relay = wslInvocation(['pair', '--provider', 'claude', '--prompt', literalPrompt, '--cwd', 'C:\\Project'],
      '\\\\wsl.localhost\\Ubuntu\\home\\med', { USERPROFILE: 'C:\\Users\\A B', TERMINALVIBE_PANE_ID: 'parent' },
      'C:\\Users\\A B\\skills\\tv.js');
    assert(relay.includes(literalPrompt), 'Prompt stays a single literal process argument');
    assert(relay.includes('/mnt/c/Users/A B/skills/tv.js'));
    assert(relay.includes('TERMINALVIBE_WINDOWS_HOME=/mnt/c/Users/A B'));
    assert(relay.includes('/mnt/c/Project'));
    assert.equal(wslInvocation([], 'C:\\Project'), null);

    const clientHome = path.join(temp, 'client-home');
    const clientDirectory = path.join(clientHome, '.terminalvibe', 'control');
    fs.mkdirSync(clientDirectory, { recursive: true });
    const selectedFile = path.join(clientDirectory, path.basename(bridge.file));
    fs.copyFileSync(bridge.file, selectedFile);
    fs.writeFileSync(path.join(clientDirectory, 'instance-123.json'), 'truncated JSON');
    const clientEnv = { ...process.env, HOME: clientHome, USERPROFILE: clientHome };
    delete clientEnv.TERMINALVIBE_CONTROL_FILE;
    delete clientEnv.TERMINALVIBE_PANE_ID;
    const client = (args, options = {}) => new Promise((resolve, reject) => {
      cp.execFile(process.execPath, [cli, ...args], { env: clientEnv, ...options },
        (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout)));
    });
    assert.equal((await client(['context'])).instance, selectedFile, 'Sole live instance is automatic; broken descriptors ignored');
    const duplicateFile = path.join(clientDirectory, 'instance-456.json');
    fs.copyFileSync(bridge.file, duplicateFile);
    await assert.rejects(client(['list']), /Multiple live instances/);
    fs.unlinkSync(duplicateFile);
    // The hosting instance (an ancestor process) beats a stale inherited
    // descriptor and an unrelated live instance.
    const { selectInstance } = require(cli);
    const other = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)']);
    const dead = cp.spawnSync(process.execPath, ['-e', '']).pid;
    try {
      const otherFile = path.join(clientDirectory, `instance-${other.pid}.json`);
      const staleFile = path.join(clientDirectory, `instance-${dead}.json`);
      for (const [file, pid] of [[otherFile, other.pid], [staleFile, dead]]) fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(bridge.file, 'utf8')), pid }));
      assert.equal((await client(['context'], { env: { ...clientEnv, TERMINALVIBE_CONTROL_FILE: staleFile } })).instance, selectedFile,
        'Stale env descriptor falls back to the instance hosting this process');
      const found = [{ file: selectedFile, pid: 10, alive: true }, { file: otherFile, pid: 20, alive: true }, { file: staleFile, pid: 30, alive: false }];
      assert.equal(selectInstance(found, otherFile, new Set([10])), selectedFile, 'Hosting instance outranks an inherited descriptor');
      assert.equal(selectInstance(found, otherFile, new Set()), otherFile, 'Live inherited descriptor is used outside an instance');
      assert.throws(() => selectInstance(found, staleFile, new Set()), /none hosts this process/);
      fs.unlinkSync(otherFile); fs.unlinkSync(staleFile);
    } finally { other.kill(); }

    const bomPlan = path.join(temp, 'bom-plan.json');
    fs.writeFileSync(bomPlan, '\uFEFF' + JSON.stringify({ workspaceId: target.id, layout: pane('BOM plan') }));
    const bomLaunch = await client(['launch', '--inspect', '--file', bomPlan]);
    assert.equal(bomLaunch.snapshots.length, 1);
    assert.equal(bomLaunch.snapshots[0].text, 'line 0\nline 1\nline 2');

    // Tab launches must leave the existing split tree, sizes, selection and PTYs intact.
    const tabTree = target.layout;
    const groupForTabs = sandbox.findGroupContainingTerm(tabTree, ids[0]);
    const selectedTab = groupForTabs.activeTermId;
    const selectedWorkspaceTab = target.activeTermId;
    const previousTabs = [...groupForTabs.terminals];
    const tabSpec = { workspaceId: target.id, anchorPaneId: ids[0], placement: { mode: 'tab' }, layout: pane('Same split') };
    const spawnedBeforeTabs = spawns.length;
    const tabLaunch = await client(['launch', '--inspect', JSON.stringify(tabSpec)]);
    assert.equal(tabLaunch.launches[0].started, true);
    assert.equal(tabLaunch.snapshots.length, 1);
    assert.equal(target.layout, tabTree, 'Tab launch preserves the split tree');
    assert.equal(sandbox.findGroupContainingTerm(tabTree, tabLaunch.launches[0].id), groupForTabs);
    assert.equal(groupForTabs.activeTermId, selectedTab);
    assert.equal(target.activeTermId, selectedWorkspaceTab);
    assert(previousTabs.every(t => groupForTabs.terminals.includes(t)));
    assert.equal(spawns.length, spawnedBeforeTabs + 1);
    assert.equal(spawns.at(-1).returnToShell, true, 'Ordinary orchestration commands recover a shell on exit');
    const activeGroup = sandbox.findGroupContainingTerm(tabTree, target.activeTermId);
    const activeTab = await call('launch', { workspaceId: target.id, placement: { mode: 'tab' }, layout: { ...pane('Active group'), returnToShell: false } });
    assert.equal(activeTab.status, 200);
    assert.equal(sandbox.findGroupContainingTerm(tabTree, activeTab.result.launches[0].id), activeGroup);
    assert.equal(spawns.at(-1).returnToShell, false, 'Explicit exited-pane opt-out is retained');
    {
      // Exit handling: a pane that returned to a shell closes; the opt-out pane stays to show its output.
      const exitSource = source.slice(source.indexOf('  function handleExit('), source.indexOf('  function handleError('));
      const removed = [], written = [];
      const entries = { shell: { id: 'shell', agentManaged: true }, kept: { id: 'kept', agentManaged: true, keepOnExit: true } };
      for (const t of Object.values(entries)) t.term = { write: s => written.push([t.id, s]), options: {} };
      const exits = vm.createContext({ workspaces: [{}, {}], DETACHED_ONLY: false, isDesktop: () => true,
        findTermById: id => ({ ws: { id: 'w' }, term: entries[id] }), getWorkspaceTerminals: () => [{}, {}],
        pluginEmit() {}, renderPaneArea() {}, saveState() {}, sendControl() {}, removeTerminal: (_w, id) => removed.push(id) });
      vm.runInContext(exitSource, exits);
      exits.handleExit('shell', 0);
      assert.deepEqual(removed, ['shell'], 'Exiting the shell an agent pane returned to closes the tab');
      exits.handleExit('kept', 1);
      assert.deepEqual(removed, ['shell'], 'A returnToShell:false pane stays open after exit');
      assert(written.some(([id, s]) => id === 'kept' && s.includes('[Agent process exited: 1]')));
      assert.equal(all(tabTree).find(t => t.id === activeTab.result.launches[0].id).keepOnExit, true, 'Launch marks the opt-out pane');
      assert(!all(tabTree).find(t => t.id === tabLaunch.launches[0].id).keepOnExit, 'Ordinary launches are not marked');
    }
    const tabsBeforeInvalid = all(tabTree).length, spawnsBeforeInvalid = spawns.length;
    for (const invalid of [
      { ...tabSpec, placement: { mode: 'unknown' } },
      { ...tabSpec, placement: { mode: 'tab', split: 'row' } },
      { ...tabSpec, layout: { split: 'row', children: [pane('A'), pane('B')] } },
      { ...tabSpec, layout: { ...pane('Bad flag'), returnToShell: 'yes' } },
      { name: 'No target', placement: { mode: 'tab' }, layout: pane('Bad') }
    ]) assert.equal((await call('launch', invalid)).status, 400);
    legacyRenderer = true;
    assert.match((await call('launch', tabSpec)).error, /launchAsTab/);
    await assert.rejects(client(['launch', JSON.stringify(tabSpec)]), /launchAsTab/);
    legacyRenderer = false;
    assert.equal(all(tabTree).length, tabsBeforeInvalid);
    assert.equal(spawns.length, spawnsBeforeInvalid, 'Invalid or unsupported tab launches create nothing');
    const browserTab = await call('launch', { ...tabSpec, layout: { name: 'Browser tab', type: 'browser', url: 'https://example.com/' } });
    assert.equal(browserTab.status, 200);
    assert.equal(sandbox.findGroupContainingTerm(tabTree, browserTab.result.launches[0].id), groupForTabs);
    assert.equal(spawns.length, spawnsBeforeInvalid, 'Browser tabs spawn no PTY');
    console.log('Tab launches: same split, active group, selection, validation, capability guards and shell recovery defaults passed');

    if (process.platform !== 'win32') {
      // A fake installed launcher verifies the one-command path without paid
      // provider sessions, logins or actual agent processes.
      const bin = path.join(clientHome, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'claude'), '#!' + process.execPath + '\nconsole.log("test-claude 1.0");\n', { mode: 0o755 });
      clientEnv.PATH = bin;
      clientEnv.TERMINALVIBE_PANE_ID = ids[0];
      sandbox.activeWsId = workspaces[1].id; // Parent environment wins over focus.
      const beforePair = spawns.length;
      const pairResult = await client(['pair', '--provider', 'claude', '--cwd', temp, '--prompt', literalPrompt]);
      assert.equal(pairResult.workspace.id, target.id);
      assert.equal(pairResult.launches.length, 2);
      assert.equal(pairResult.snapshots.length, 2);
      assert.equal(pairResult.launcher.version, 'test-claude 1.0');
      assert.equal(spawns.length, beforePair + 2);
      assert(spawns.slice(-2).every(spec => spec.argv[0] === literalPrompt));
      assert.equal(target.activeTermId, oldActive, 'Fast pair preserves the parent pane');
      assert.equal(target.layout.children[1].direction, 'row', 'Workers are side by side');
      assert.equal(target.layout.children[1].size.width, undefined, 'Bottom workers fill available width');
      assert.equal(target.layout.children[1].size.height, 'min', 'Fast pair minimizes worker subtree height');
      await assert.rejects(client(['pair', '--provider', 'missing']), /provider claude or codex/);
      await assert.rejects(client(['pair', '--provider', 'codex']), /launcher unavailable/);
      assert.equal(spawns.length, beforePair + 2, 'Unavailable providers never create or substitute agents');
    }
    console.log('Fast client: WSL path relay, literal args, auto-selection, ambiguity, BOM plans, pair launch and snapshots passed');

    const beforePlacementSpawns = spawns.length;
    const workerId = added.result.launches[0].id;
    const worker = all(target.layout).find(t => t.id === workerId);
    const beforePlacementEntries = all(target.layout);
    const resized = await call('resize', { paneId: workerId, width: 'min', height: 240 });
    assert.equal(resized.status, 200);
    let workerGroup = sandbox.findGroupContainingTerm(target.layout, workerId);
    assert.equal(workerGroup.size.width, 'min');
    assert.equal(workerGroup.size.height, 240);
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const moved = await call('place', { paneId: workerId, anchorPaneId: ids[0], side });
      assert.equal(moved.status, 200);
      const beside = sandbox.findGroupContainingTerm(target.layout, ids[0]);
      const findParent = n => n.type === 'split' ? n.children.includes(beside) ? n : n.children.map(findParent).find(Boolean) : null;
      const split = findParent(target.layout);
      assert.equal(split.direction, ['left', 'right'].includes(side) ? 'row' : 'column');
      assert.equal(split.children[['left', 'top'].includes(side) ? 0 : 1].terminals[0], worker);
      workerGroup = sandbox.findGroupContainingTerm(target.layout, workerId);
      assert.equal(workerGroup.size.width, ['left', 'right'].includes(side) ? 'min' : undefined);
      assert.equal(workerGroup.size.height, ['top', 'bottom'].includes(side) ? 'min' : undefined);
      assert.equal(target.activeTermId, oldActive);
      assert(beforePlacementEntries.every(entry => all(target.layout).includes(entry)));
    }
    const stableLayout = target.layout;
    for (const [method, params] of [
      ['resize', { paneId: workerId, width: -1 }], ['resize', { paneId: workerId }],
      ['place', { paneId: workerId, anchorPaneId: workerId, side: 'left' }],
      ['place', { paneId: workerId, anchorPaneId: 'missing', side: 'left' }],
      ['place', { paneId: workerId, anchorPaneId: ids[0], side: 'diagonal' }],
      ['place', { paneId: workerId, anchorPaneId: workspaces[1].activeTermId, side: 'right' }]
    ]) assert.equal((await call(method, params)).status, 400);
    assert.equal(target.layout, stableLayout, 'Invalid resizing/placement leaves the layout intact');
    await call('resize', { paneId: workerId, width: 'auto', height: 'auto' });
    assert.equal(workerGroup.size, undefined, 'auto releases compact constraints');
    const tab = sandbox._createTermEntry(target, 'existing-tab', 'Existing tab');
    const tabGroup = sandbox.findGroupContainingTerm(target.layout, ids[0]);
    tabGroup.terminals.push(tab);
    await call('place', { paneId: tab.id, anchorPaneId: ids[0], side: 'right', compact: false });
    assert.equal(sandbox.findGroupContainingTerm(target.layout, ids[0]).id, tabGroup.id, 'Moving one tab preserves sibling group');
    assert.equal(sandbox.findGroupContainingTerm(target.layout, tab.id).size, undefined);
    assert.equal(spawns.length, beforePlacementSpawns, 'Resizing and moving live panes never spawn/kill agents');
    await client(['resize', JSON.stringify({ paneId: workerId, width: 'min', height: 'min' })]);
    assert.equal(sandbox.findGroupContainingTerm(target.layout, workerId).size.width, 'min');
    console.log('Live pane control: resize, four placements, minimum sizing, tab preservation, validation and no respawn passed');
    const persistence = { _createTermEntry: (_ws, id, label) => ({ id, label }) };
    vm.createContext(persistence);
    vm.runInContext(source.slice(source.indexOf('  function shortTitle('), source.indexOf('  function renameWorkspace(')), persistence);
    vm.runInContext(source.slice(source.indexOf('  function serializeLayout('), source.indexOf('  /* Backgrounds and workspace icons')), persistence);
    const saved = persistence.serializeLayout(target.layout);
    const restored = persistence.deserializeLayout(JSON.parse(JSON.stringify(saved)), target);
    // Automatic labels intentionally reset for fresh shells; layout and metadata persist.
    const withoutLabels = value => JSON.stringify(value, (key, item) => key === 'label' ? undefined : item);
    assert.equal(withoutLabels(persistence.serializeLayout(restored)), withoutLabels(saved), 'Compact/pixel sizing survives a real save/restore roundtrip');

    const browserLeaf = { name: 'YouTube search', type: 'browser', url: 'https://www.google.com/search?q=youtube' };
    validateLaunch({ name: 'Browser', layout: browserLeaf });
    validateLaunch({ name: 'Browser shorthand', layout: { name: 'YouTube', url: 'https://www.youtube.com/' } });
    const stableBeforeBrowser = target.layout, spawnCount = spawns.length;
    legacyRenderer = true;
    const blockedPlan = { workspaceId: target.id, layout: { split: 'row', children: [pane('Would spawn'), browserLeaf] } };
    assert.match((await call('launch', blockedPlan)).error, /page lacks browserLaunch.*No panes were changed/);
    assert.equal(target.layout, stableBeforeBrowser, 'Old renderer receives no browser launch or placeholder panes');
    assert.equal(spawns.length, spawnCount, 'Mixed plans spawn no terminals on an old renderer');
    const blockedCli = await new Promise(resolve => cp.execFile(process.execPath,
      [cli, 'launch', JSON.stringify(blockedPlan), '--instance', bridge.file],
      (error, stdout, stderr) => resolve({ error, stdout, stderr })));
    assert(blockedCli.error, 'CLI rejects missing browser capabilities');
    assert.match(blockedCli.stderr, /lacks browserLaunch.*No panes were changed/);
    assert.equal(target.layout, stableBeforeBrowser);
    legacyRenderer = false;
    for (const layout of [
      { ...browserLeaf, url: 'javascript:alert(1)' }, { ...browserLeaf, url: '/relative' },
      { ...browserLeaf, url: undefined }, { ...browserLeaf, argv: ['fake-agent'], cwd: temp },
      { ...browserLeaf, type: 'terminal' }, { ...browserLeaf, type: 'unknown' },
      { split: 'row', children: [browserLeaf, { name: 'Bad', type: 'browser', url: 'file:///etc/passwd' }] }
    ]) assert.equal((await call('launch', { workspaceId: target.id, layout })).status, 400);
    assert.equal(target.layout, stableBeforeBrowser, 'Invalid browser plans leave layout unchanged');
    const openedBrowser = await call('launch', { workspaceId: target.id, anchorPaneId: ids[0],
      placement: { split: 'row', compact: false }, layout: browserLeaf });
    assert.equal(openedBrowser.status, 200);
    assert.equal(spawns.length, spawnCount, 'Browser launch does not create a PTY');
    assert.equal(target.activeTermId, oldActive, 'Browser split preserves parent selection');
    const browserId = openedBrowser.result.launches[0].id;
    const browserEntry = all(target.layout).find(t => t.id === browserId);
    assert.equal(browserEntry.type, 'browser');
    assert.equal(openedBrowser.result.workspace.panes.find(t => t.id === browserId).url, browserLeaf.url);
    const nextUrl = 'https://www.youtube.com/results?search_query=terminal+vibe';
    await client(['navigate', JSON.stringify({ paneId: browserId, url: nextUrl })]);
    assert.equal(browserEntry.url, nextUrl, 'Unopened tabs retain requested URL');
    let loadedUrl;
    browserEntry._loadUrl = async url => { loadedUrl = url; browserEntry.url = url; };
    assert.equal((await call('navigate', { paneId: browserId, url: browserLeaf.url })).status, 200);
    assert.equal(loadedUrl, browserLeaf.url, 'Open tabs use their existing navigation handler');
    assert.equal(target.activeTermId, oldActive, 'Navigation does not change focus');
    assert.equal((await call('navigate', { paneId: ids[0], url: nextUrl })).status, 400);
    assert.equal((await call('navigate', { paneId: browserId, url: 'javascript:alert(1)' })).status, 400);
    assert.equal(browserEntry.url, browserLeaf.url, 'Invalid navigation leaves URL unchanged');
    const mixed = await call('launch', { name: 'Mixed panes', layout: { split: 'row', children: [pane('Agent'), browserLeaf] } });
    assert.equal(mixed.status, 200);
    assert.equal(spawns.length, spawnCount + 1, 'Mixed layout spawns only terminal leaves');
    const browserSaved = persistence.serializeLayout(target.layout);
    const browserRestored = persistence.deserializeLayout(JSON.parse(JSON.stringify(browserSaved)), target);
    assert.equal(all(browserRestored).find(t => t.id === browserId).url, browserLeaf.url, 'Browser URL survives save/restore');
    console.log('Browser panes: launch, mixed layouts, no PTY, navigation, focus preservation, URL validation and persistence passed');

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
      env: { ...process.env, HOME: browserHome, USERPROFILE: browserHome, CLAUDE_CONFIG_DIR:path.join(browserHome,'.claude'), WS_PORT: String(wsPort), APP_PORT: String(appPort) },
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
    const serversUrl = `http://127.0.0.1:${appPort}/api/servers`;
    const discovered = await (await fetch(serversUrl)).json();
    assert(Array.isArray(discovered.servers) && !discovered.servers.some(server => server.port === appPort), 'Server discovery HTTP API lists only servers started from its terminals, not the app itself');
    assert.equal((await fetch(serversUrl, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(serversUrl, { method: 'POST' })).status, 405);
    const browserDescriptor = JSON.parse(fs.readFileSync(path.join(browserDirectory, fs.readdirSync(browserDirectory)[0]), 'utf8'));
    const historyUrl = `http://127.0.0.1:${appPort}/api/claude-sessions?cwd=${encodeURIComponent(temp)}`;
    assert.equal((await fetch(historyUrl)).status, 200);
    assert.equal((await fetch(historyUrl, { headers: { Origin:'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(historyUrl, { method:'POST' })).status, 405);
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
    let legacyWebPage = false, forwardedMutations = 0;
    browserClient.on('message', async (data, binary) => {
      if (binary) { captured += data.subarray(36).toString(); outputEvents.emit('output'); return; }
      const msg = JSON.parse(data.toString());
      if (msg.type === 'agent:created') {
        const pending = sandbox.agentCreates.get(msg.requestId);
        if (pending) { clearTimeout(pending.timer); sandbox.agentCreates.delete(msg.requestId); pending.resolve(msg.started); }
      } else if (msg.type === 'agent:request') {
        if (msg.method !== 'list') forwardedMutations++;
        try { browserClient.send(JSON.stringify({ type: 'agent:result', id: msg.id, result: legacyWebPage && msg.method === 'list'
          ? { capabilities: { browserRead: true } } : await sandbox.handleAgentRequest(msg) })); }
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
    const inheritedId = require('crypto').randomUUID();
    const inheritedCreated = new Promise((resolve,reject) => {
      const timer = setTimeout(()=>reject(new Error('Inherited terminal did not start')),5000);
      const listener = (data,binary) => {
        if (binary) return;
        const msg=JSON.parse(data.toString());
        if(msg.type==='agent:created' && msg.requestId==='cwd-inheritance') {
          clearTimeout(timer);browserClient.off('message',listener);resolve(msg.started);
        }
      };
      browserClient.on('message',listener);
    });
    browserClient.send(JSON.stringify({type:'create',id:inheritedId,requestId:'cwd-inheritance',
      inheritFromId:browserLaunch.result.launches[0].id,cwd:os.homedir(),executable:process.execPath,
      argv:['-e',"console.log('TV_INHERITED_CWD:'+process.cwd());process.stdin.resume();"]}));
    assert.equal(await inheritedCreated,true);
    if(process.platform==='linux') await waitOutput('TV_INHERITED_CWD:'+temp);

    const liveId = browserLaunch.result.launches[0].id;
    await waitOutput(`${liveId} true`);
    // Use the actual binary stdin framing from the frontend.
    sandbox._sendStdinRaw = (id, bytes) => {
      const prefix = Buffer.alloc(36, 32); prefix.write(id);
      browserClient.send(Buffer.concat([prefix, Buffer.from(bytes)]));
    };
    assert.equal((await browserCall('send', { paneId: liveId, text: 'hello browser', enter: true })).status, 200);
    await waitOutput('RECEIVED:hello browser');
    const blockedReplace = await sandbox.createAgentTerminal({ id:liveId, cwd:temp, executable:process.execPath,
      argv:['-e',"console.log('MUST-NOT-START')"], replaceIdle:true });
    assert.equal(blockedReplace, false, 'Atomic backend guard refuses to replace a running process');
    await browserCall('send', { paneId:liveId, text:'still alive after refused resume', enter:true });
    await waitOutput('RECEIVED:still alive after refused resume');
    const claudeGuardId = '01234567-1234-1234-1234-123456789abc';
    // Windows reports the image name, which process.title cannot change: run
    // node under the name a real install has (claude.exe).
    const claudeExe = process.platform === 'win32' ? path.join(temp, 'claude.exe') : process.execPath;
    if (claudeExe !== process.execPath) fs.copyFileSync(process.execPath, claudeExe);
    assert.equal(await sandbox.createAgentTerminal({ id:claudeGuardId,cwd:temp,executable:claudeExe,
      argv:['-e',"process.title='claude'; process.stdin.setRawMode(true); process.stdin.resume(); let draft='';process.stdin.on('data',b=>{draft+=b.toString();if(draft.includes('\\x1b[201~')) console.log(draft.startsWith('\\x1b[200~') && draft.endsWith('\\x1b[201~') && draft.includes('Fixture context') ? 'TV-CONTEXT-DRAFT-OK' : 'TV-CONTEXT-DRAFT-BAD');});console.log('TV-CLAUDE-GUARD-READY'); setInterval(()=>{},1000)"] }), true);
    await waitOutput('TV-CLAUDE-GUARD-READY');
    const contextDir=path.join(browserHome,'.claude','projects','fixture');fs.mkdirSync(contextDir,{recursive:true});
    fs.writeFileSync(path.join(contextDir,claudeGuardId+'.jsonl'),JSON.stringify({type:'user',cwd:temp,message:{content:'Fixture context'}}));
    const sendContext = (id,sessionId) => new Promise((resolve,reject)=>{
      const requestId='context-'+Math.random();
      const timer=setTimeout(()=>{browserClient.off('message',listener);reject(new Error('Context reply timed out'));},3000);
      const listener=(data,binary)=>{if(binary)return;const msg=JSON.parse(data.toString());if(msg.type==='session-context:result'&&msg.requestId===requestId){clearTimeout(timer);browserClient.off('message',listener);resolve(msg);}};
      browserClient.on('message',listener);browserClient.send(JSON.stringify({type:'session-context',id,sessionId,requestId}));
    });
    // Windows process snapshots refresh every few seconds; a just-started chat
    // is refused (unknown) until it appears.
    let attached;
    for (const deadline=Date.now()+10000;;) {
      attached=await sendContext(claudeGuardId,claudeGuardId);
      if (!attached.error || process.platform!=='win32' || Date.now()>deadline) break;
      await new Promise(r=>setTimeout(r,500));
    }
    assert(attached.result.chars>0);await waitOutput('TV-CONTEXT-DRAFT-OK');
    assert.match((await sendContext(liveId,claudeGuardId)).error,/running Claude/);
    assert.match((await sendContext('unknown-pane',claudeGuardId)).error,/Unknown chat target/);
    assert.equal(await sandbox.createAgentTerminal({ id:claudeGuardId,cwd:temp,executable:process.execPath,
      argv:['-e',"console.log('TV-SAME-PANE-RESUMED'); setInterval(()=>{},1000)"],replaceIdle:true }), false);
    assert.equal(await sandbox.createAgentTerminal({ id:claudeGuardId,cwd:temp,executable:process.execPath,
      argv:['-e',"console.log('TV-SAME-PANE-RESUMED'); setInterval(()=>{},1000)"],replaceIdle:true,replaceClaude:true }), true);
    await waitOutput('TV-SAME-PANE-RESUMED');
    const webBrowser = await browserCall('launch', { workspaceId: browserLaunch.result.workspace.id, layout: browserLeaf });
    assert.equal(webBrowser.status, 200);
    const webBrowserId = webBrowser.result.launches[0].id;
    assert.equal((await browserCall('navigate', { paneId: webBrowserId, url: nextUrl })).status, 200);
    assert.equal((await browserCall('list')).result.workspaces.flatMap(w => w.panes).find(t => t.id === webBrowserId).url, nextUrl);
    const browserAdded = await browserCall('launch', {
      workspaceId: browserLaunch.result.workspace.id, anchorPaneId: liveId,
      placement: { split: 'column', sizes: [35, 65] },
      layout: { name: 'Second real PTY', cwd: temp, argv: [process.execPath, '-e', "console.log('TV-SECOND-OK'); setInterval(()=>{},1000)"] }
    });
    assert.equal(browserAdded.status, 200);
    assert.equal(browserAdded.result.launches.length, 1);
    assert.equal(browserAdded.result.workspace.panes.length, 3);
    await waitOutput('TV-SECOND-OK');
    assert.equal((await browserCall('resize', { paneId: liveId, width: 'min', height: 'min' })).status, 200);
    assert.equal((await browserCall('place', { paneId: browserAdded.result.launches[0].id, anchorPaneId: liveId, side: 'right' })).status, 200);
    await browserCall('send', { paneId: liveId, text: 'parent still running', enter: true });
    await waitOutput('RECEIVED:parent still running');
    legacyWebPage = true;
    const mutationsBeforeMismatch = forwardedMutations;
    assert.match((await browserCall('launch', { workspaceId: browserLaunch.result.workspace.id, layout: browserLeaf })).error, /page lacks browserLaunch/);
    assert.match((await browserCall('navigate', { paneId: webBrowserId, url: browserLeaf.url })).error, /page lacks browserNavigate/);
    assert.equal(forwardedMutations, mutationsBeforeMismatch, 'Backend blocks browser mutations before they reach an outdated page');
    legacyWebPage = false;
    extraClient = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    await once(extraClient, 'open');
    await register(extraClient);
    assert.match((await browserCall('list')).error, /Multiple browser tabs/);
    extraClient.close(); await once(extraClient, 'close'); extraClient = null;
    browserClient.close(); await once(browserClient, 'close'); browserClient = null;
    killTree(browserServer); await once(browserServer, 'exit'); browserServer = null;
    console.log('Browser control: real server, WebSocket, PTY spawn, inherited instance, stdin and multi-tab protection passed');
    bridge.close();
    assert(!fs.existsSync(bridge.file));
    console.log('Agent control: validation, auth, launch, failures, arrangement, read, send, CLI and cleanup passed');
  } finally {
    if (extraClient) extraClient.terminate();
    if (browserClient) browserClient.terminate();
    if (browserServer) killTree(browserServer);
    if (bridge) bridge.close();
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
