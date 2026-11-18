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
    isLiveTerminal: () => state.live, agentRunning: async () => true, agentLocked: () => false, syncTabAgentIcon() {}, refreshWorkspaceProcsSoon() {},
    sendToAgent: async (_, text) => { state.sent.push(text); return true; },
    zoomBadge: text => state.notices.push(text), uuid: () => 'new-claude-id',
    threadMeta: t => ({ id: t.id }), window: { electronAPI: {} },
    // Terminal-path tests: structured sessions (chat-sdk) off unless a test turns them on.
    sdkHarness: () => false, sdkTurnOptions: o => ({ model: o.model, effort: o.effort, access: o.access }),
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
  // Structured sessions (electron/chat-sdk.js): Claude Code resumes its session over stream-json, no terminal agent,
  // no screen to wait for; the message goes straight to it.
  const sdk = setup([{ harness: 'claude', sessionId: 'existing', cwd: '/tmp/claude-home', used: true }], { harness: 'claude', model: 'sonnet', effort: 'low', access: 'default' });
  const sdkStarts = [];
  sdk.context.sdkHarness = () => true;
  sdk.context.window.electronAPI.chatSdkStart = async (key, opts) => { sdkStarts.push({ key, ...opts }); return { ok: true }; };
  assert(await sdk.context.startChatAgent(sdk.tab, sdk.tab, 'via sdk'));
  assert.equal(sdkStarts.length, 1);
  assert.equal(sdkStarts[0].cwd, '/tmp/claude-home', 'a resumed session runs in its own folder');
  assert(sdkStarts[0].argv.includes('--resume') && sdkStarts[0].argv.includes('existing'));
  assert.equal(sdk.state.starts.length, 0, 'no terminal agent for a structured session');
  assert.equal(sdk.state.waits, 0, 'a structured session has no screen to wait for');
  assert.deepEqual(sdk.state.sent, ['via sdk']);
  assert(sdk.tab._sdk.alive && sdk.context._tabAgent.get('chat') === 'claude');
  // Codex resumes its thread by id over app-server.
  const cx = setup([{ harness: 'codex', sessionId: 'thread-1', cwd: '/tmp/cx', used: true }], { harness: 'codex', model: 'gpt-x', effort: 'high', access: 'full' });
  const cxStarts = [];
  cx.context.sdkHarness = () => true;
  cx.context.window.electronAPI.chatSdkStart = async (key, opts) => { cxStarts.push(opts); return { ok: true, sessionId: 'thread-1' }; };
  assert(await cx.context.startChatAgent(cx.tab, cx.tab, 'hi'));
  assert.equal(cxStarts[0].resume, 'thread-1');
  assert.equal(cxStarts[0].options.access, 'full', 'Full access reaches Codex');
  // An untouched composer inherits the last picks until its first session becomes used.
  const inherited = setup([], { harness: 'codex', model: 'gpt-x', effort: 'low', access: 'full' });
  const optsSource = source.slice(source.indexOf('  const chatOpts ='), source.indexOf('  // Fast: every Claude model'));
  const sendSource = source.slice(source.indexOf('  function sendToAgent('), source.indexOf('  // A permission mode picked'));
  const turnAccess = [], sentImages = [];
  Object.assign(inherited.context, {
    lastChatOpts: () => ({ harness: 'codex', model: 'gpt-x', effort: 'low', access: 'full' }),
    chatModels: () => [{ id: 'gpt-x', efforts: ['low'], defaultEffort: 'low' }],
    chatCaps: () => ({}), sdkHarness: () => true, _turns: new Map(),
  });
  Object.assign(inherited.context.window.electronAPI, {
    chatSdkStart: async () => ({ ok: true, sessionId: 'new-thread' }),
    chatSdkSetAccess: (_, access) => turnAccess.push(access),
    chatSdkSend: async (_, text, { options, images }) => { sentImages.push(images); return { ok: options.access === 'full' }; },
  });
  delete inherited.context.chatOpts;
  vm.runInContext(optsSource + sendSource, inherited.context);
  const images = [{ image: true, path: '/tmp/image.png' }, { path: '/tmp/notes.txt' }];
  assert(await inherited.context.startChatAgent(inherited.tab, inherited.tab, 'first message', null, { files: images }));
  assert(inherited.tab.chat.segments[0].used);
  assert.equal(vm.runInContext('chatOpts', inherited.context)(inherited.tab).access, 'full', 'composer keeps Full access after first send');
  assert(await inherited.context.sendToAgent(inherited.tab, 'follow-up', true, images));
  assert.deepEqual(sentImages.map(paths => Array.from(paths)), [['/tmp/image.png'], ['/tmp/image.png']]);
  assert.deepEqual(turnAccess, ['full', 'full']);
  // Antigravity resumes its ACP session by id; the terminal view resumes it with --conversation.
  const agyHarnesses = [...harnesses, { id: 'antigravity', name: 'Antigravity CLI', bin: 'agy' }];
  const agy = setup([{ harness: 'antigravity', sessionId: 'conv-1', cwd: '/tmp/agy', used: true }], { harness: 'antigravity', model: 'gemini-3.8-flash', effort: 'low', access: 'auto' });
  agy.context.THREAD_HARNESSES = agyHarnesses; agy.context.harnessOf = id => agyHarnesses.find(h => h.id === id);
  agy.context.loadChatAgents = async () => ({ found: { agy: '/bin/agy' } });
  const agyStarts = [];
  agy.context.sdkHarness = () => true;
  agy.context.window.electronAPI.chatSdkStart = async (key, opts) => { agyStarts.push(opts); return { ok: true, sessionId: 'conv-1' }; };
  assert(await agy.context.startChatAgent(agy.tab, agy.tab, 'hello'));
  assert.equal(agyStarts[0].harness, 'antigravity');
  assert.equal(agyStarts[0].resume, 'conv-1');
  assert.equal(agyStarts[0].options.access, 'auto');
  const agyArgv = vm.runInContext('CHAT_AGENTS', agy.context).antigravity.argv({ model: 'gemini-3.8-flash', effort: 'low', access: 'auto' }, 'conv-1', true);
  assert.deepEqual(Array.from(agyArgv), ['--model', 'gemini-3.8-flash', '--effort', 'low', '--mode', 'auto', '--conversation', 'conv-1']);
  // The terminal view hands an idle structured session over to the real CLI; a busy one is never cut off.
  let stops = 0;
  sdk.context.window.electronAPI.chatSdkStop = async () => { stops++; };
  sdk.tab._sdk.busy = true;
  assert.equal(await sdk.context.ensureChatTerminalSession(sdk.tab), false);
  assert.equal(stops, 0, 'a working session was stopped for the terminal view');
  sdk.tab._sdk.busy = false;
  assert(await sdk.context.ensureChatTerminalSession(sdk.tab));
  assert.equal(stops, 1);
  assert.equal(sdk.tab._sdk.alive, false);
  assert.equal(sdk.state.starts.length, 1, 'the terminal view resumed the session in the CLI');
  // Chat-started Claude Code can read the threads folder (handoff.xml) without a permission prompt.
  const argv = vm.runInContext('CHAT_AGENTS', normal.context).claude.argv({ model: 'haiku', effort: 'low', access: 'default' }, 'sid', false, null, '/home/u/.terminalvibe/threads');
  assert.equal(argv[argv.indexOf('--add-dir') + 1], '/home/u/.terminalvibe/threads');
  // A permission prompt on the agent's screen becomes the chat's question card; a numbered list in a reply does not.
  const ask = vm.runInContext(source.slice(source.indexOf('  const ASK_OPT_RE'), source.indexOf('  // Codex runs a conversation in one process'))
    + '; parseAgentQuestion', vm.createContext({ TRUST_RE: /trust this folder/i }));
  const q = ask(['─────────────', ' Read file', '', '  Read(C:\\u\\.terminalvibe\\threads\\x\\handoff.xml)', '', ' Do you want to proceed?',
    ' ❯ 1. Yes', '   2. Yes, allow reading from /c/u/.terminalvibe/threads/x during', '      this session', '   3. No', '', ' Esc to cancel · Tab to amend'].join('\n'), 70);
  assert.equal(q.question, 'Do you want to proceed?');
  assert.deepEqual([...q.detail], ['Read file', 'Read(C:\\u\\.terminalvibe\\threads\\x\\handoff.xml)']);
  assert.deepEqual([...q.options.map(o => o.key + " " + o.label)], ['1 Yes', '2 Yes, allow reading from /c/u/.terminalvibe/threads/x during this session', '3 No']);
  assert.equal(ask('⏺ Which one?\n  1. Alpha\n  2. Beta\n\n❯ '), null);
  // AskUserQuestion: a description under each choice, and "Type something." as the free-text choice.
  const choice = ask([' ☐ Notes use', '', ' What should go in notes.txt?', '', ' ❯ 1. To-do list', '      A checklist of tasks to track.',
    '   2. Leave it empty', '      Keep the file blank for now.', '   3. Type something.', '', ' Enter to select · Esc to cancel'].join('\n'), 120);
  assert.deepEqual(JSON.parse(JSON.stringify(choice.options.map(o => [o.label, o.desc, o.input, o.selected]))),
    [['To-do list', 'A checklist of tasks to track.', false, true], ['Leave it empty', 'Keep the file blank for now.', false, false], ['Type something.', '', true, false]]);
  // Multi-select: no "?", "[ ]" boxes, a Submit row, and "Chat about this" below a divider.
  const multi = ask(['❯ ask multi select question', '────────────────', '← ☐ Notes topics ✔ Submit →', '', 'Which of these should notes.txt cover? Select all that apply.', '',
    '❯ 1. [ ] Tasks', '       Things you still need to do.', '  2. [✔] Ideas', '       Thoughts to try later.', '  3. [ ] Type something', '     Submit',
    '────────────────', '  4. Chat about this', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel'].join('\n'), 120);
  assert.equal(multi.question, 'Which of these should notes.txt cover? Select all that apply.');
  assert(multi.multi);
  assert.deepEqual([...multi.detail], ['☐ Notes topics ✔ Submit']);
  assert.deepEqual(JSON.parse(JSON.stringify(multi.options.map(o => [o.key, o.label, o.checked ?? null, !!o.submit, o.input]))),
    [['1', 'Tasks', false, false, false], ['2', 'Ideas', true, false, false], ['3', 'Type something', false, false, true], ['', 'Submit', null, true, false], ['4', 'Chat about this', null, false, false]]);
  console.log('PASS: terminal view resumes the owning harness/session/cwd, avoids duplicate launches and blank prompts, preserves busy processes, and handles restored ids.');
})().catch(error => { console.error(error); process.exitCode = 1; });
