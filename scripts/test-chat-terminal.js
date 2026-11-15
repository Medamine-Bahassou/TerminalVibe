// Resume the owning chat session without launching a second agent or submitting a prompt.
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const agentConfig = source.slice(source.indexOf('  const CHAT_AGENTS = {'), source.indexOf('  // The other agent CLIs'));
const launch = source.slice(source.indexOf('  function ensureChatTerminalSession('), source.indexOf('  // ── Attachments: picked'));
const harnesses = [{ id: 'claude', name: 'Claude Code', bin: 'claude' }, { id: 'codex', name: 'Codex', bin: 'codex' }];
function setup(segments, picks = { harness: 'claude', model: 'sonnet', effort: 'low', access: 'plan' }) {
  const tab = { id: 'chat', threadHistory: true, cwd: '/tmp/other-folder', chat: { segments },
    term: { options: { disableStdin: true }, reset() { state.resets++; } } };
  const state = { process: null, live: true, resets: 0, starts: [], sent: [], waits: 0, stopped: 0, notices: [] };
  const context = vm.createContext({
    THREAD_HARNESSES: harnesses, harnessOf: id => harnesses.find(h => h.id === id),
    _chatStarting: new Map(), _chatSending: new Set(), _tabAgent: new Map(),
    findTermById: id => id === tab.id && state.live ? { term: tab } : null,
    threadSegments: t => t.chat.segments, chatOpts: () => picks,
    checkTerminalRunning: async () => state.process,
    loadChatAgents: async () => ({ found: { claude: '/bin/claude', codex: '/bin/codex' } }),
    getWorkspaceTerminals: () => [tab], wsOf: () => ({}), chatCwd: t => t.cwd,
    getSlotDimensions: () => ({ cols: 80, rows: 24 }),
    stopTabAgent: async () => { state.stopped++; return true; },
    createAgentTerminal: async request => { state.starts.push(request); state.process = path.basename(request.executable); return true; },
    modelName: o => o.harness, syncThreadComposer() {}, saveState() {}, curChat: () => null,
    removeTerminal: () => { throw Error('Unexpected removal of another chat tab'); },
    waitAgentReady: async () => { state.waits++; return 'ready'; },
    isLiveTerminal: () => state.live, agentRunning: async () => true,
    sendToAgent: async (_, text) => { state.sent.push(text); return true; },
    zoomBadge: text => state.notices.push(text), uuid: () => 'new-claude-id',
    threadMeta: t => ({ id: t.id }), window: { electronAPI: {} },
  });
  vm.runInContext(agentConfig + launch, context);
  return { tab, state, context };
}
(async () => {
  const segments = [
    { harness: 'claude', sessionId: 'claude-old', cwd: '/tmp/claude', used: true },
    { harness: 'codex', sessionId: 'codex-last', cwd: '/tmp/codex', model: 'gpt-saved', effort: 'high', used: true },
  ];
  const { tab, state, context } = setup(segments);
  assert(await context.ensureChatTerminalSession(tab));
  assert.equal(state.starts.length, 1);
  assert.equal(state.starts[0].executable, '/bin/codex', 'last session wins over an unsent model-picker change');
  assert.equal(state.starts[0].cwd, '/tmp/codex');
  assert.deepEqual(Array.from(state.starts[0].argv.slice(0, 2)), ['resume', 'codex-last']);
  assert(state.starts[0].argv.includes('gpt-saved'));
  assert(!state.starts[0].argv.includes('plan'), 'do not carry Claude permissions into Codex');
  assert.equal(tab.chat.segments.length, 2, 'resuming must not create a new conversation segment');
  assert.equal(tab.term.options.disableStdin, false);
  assert.equal(state.waits, 0, 'terminal mode must let the user answer trust/permission prompts');
  assert.equal(state.sent.length, 0, 'switching views must not submit a blank message');
  assert(await context.ensureChatTerminalSession(tab));
  assert.equal(state.starts.length, 1, 'already-running owning session was restarted');
  state.process = 'vim';
  assert.equal(await context.ensureChatTerminalSession(tab), false);
  assert.equal(state.starts.length, 1, 'switching views overwrote another running process');

  const restored = setup([{ harness: 'codex', sessionId: null, used: true, cwd: '/tmp/restored' }]);
  restored.context.window.electronAPI.threadHistory = async () => [{ sessionId: 'discovered-session', items: [{ role: 'user' }] }];
  assert(await restored.context.ensureChatTerminalSession(restored.tab));
  assert.equal(restored.state.starts[0].argv[1], 'discovered-session');
  assert.equal(restored.tab.chat.segments.length, 1);

  const legacy = setup([{ harness: 'claude', sessionId: 'legacy-id', cwd: '/tmp/legacy' }]);
  assert(await legacy.context.ensureChatTerminalSession(legacy.tab));
  assert(legacy.state.starts[0].argv.includes('--resume') && legacy.state.starts[0].argv.includes('legacy-id'), 'saved ids resume even before the used flag is restored');

  const concurrent = setup([{ harness: 'claude', sessionId: 'same-session', used: true }]);
  let release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  concurrent.context.createAgentTerminal = async request => {
    concurrent.state.starts.push(request); arrived();
    await new Promise(resolve => { release = resolve; }); return true;
  };
  const first = concurrent.context.ensureChatTerminalSession(concurrent.tab);
  const second = concurrent.context.ensureChatTerminalSession(concurrent.tab);
  assert.equal(first, second);
  await started; release(); await Promise.all([first, second]);
  assert.equal(concurrent.state.starts.length, 1, 'repeated switches created duplicate agent processes');

  const unresolved = setup([{ harness: 'codex', used: true }]);
  assert.equal(await unresolved.context.ensureChatTerminalSession(unresolved.tab), false);
  assert.equal(unresolved.state.starts.length, 0, 'missing session id silently started another conversation');
  const frozen = setup([{ harness: 'claude', sessionId: 'parent', used: true, frozen: true }]);
  assert.equal(await frozen.context.ensureChatTerminalSession(frozen.tab), false);
  assert.equal(frozen.state.starts.length, 0, 'a fork must not resume and modify its parent session');

  const busy = setup([{ harness: 'claude', sessionId: 'saved', used: true }]);
  let checks = 0;
  busy.context.checkTerminalRunning = async () => checks++ ? 'vim' : null;
  assert.equal(await busy.context.ensureChatTerminalSession(busy.tab), false);
  assert.equal(busy.state.resets, 0, 'late process startup was overwritten');

  const closed = setup([{ harness: 'codex', used: true }]);
  closed.context.window.electronAPI.threadHistory = async () => { closed.state.live = false; return [{ sessionId: 'late', items: [] }]; };
  assert.equal(await closed.context.ensureChatTerminalSession(closed.tab), false);
  assert.equal(closed.state.starts.length, 0, 'closed tab was restarted after history lookup');

  const empty = setup([]);
  assert(await empty.context.ensureChatTerminalSession(empty.tab));
  assert(empty.state.starts[0].argv.includes('--session-id'));
  assert.equal(empty.state.sent.length, 0);
  // The ordinary send path continues to resume and send the actual user message.
  const normal = setup([{ harness: 'claude', sessionId: 'existing', used: true }]);
  assert(await normal.context.startChatAgent(normal.tab, normal.tab, 'real message'));
  assert.deepEqual(normal.state.sent, ['real message']);
  console.log('PASS: terminal view resumes the owning harness/session/cwd, avoids duplicate launches and blank prompts, preserves busy processes, and handles restored ids.');
})().catch(error => { console.error(error); process.exitCode = 1; });
