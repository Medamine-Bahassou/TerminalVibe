// Thread folders: transcript parsing, ~/.terminalvibe/threads/<id>/ files,
// keeping history after a transcript is deleted, handoff and delete.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
const { saveThreadAttachment, syncThread, threadHistory, threadHistoryPreview, subagentStatus, writeHandoff, forkThread, deleteThread, parseCodex } = require('../electron/threads');

const task = (type, timestamp) => ({ type: 'event_msg', timestamp, payload: { type } });
assert.deepStrictEqual(parseCodex([task('task_started', '2026-01-01T10:00:00Z')]).turnState,
  { status: 'working', at: Date.parse('2026-01-01T10:00:00Z') });
assert.strictEqual(parseCodex([task('task_complete', '2026-01-01T10:00:01Z'), task('task_started', '2026-01-01T10:00:02Z')]).turnState.status, 'working', 'an old completion cannot release the next turn');
assert.strictEqual(parseCodex([task('turn_aborted', '2026-01-01T10:00:01Z')]).turnState.status, 'aborted', 'interruptions must not auto-send queued messages');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-threads-'));
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
const cwd = path.join(home, 'project');
fs.mkdirSync(cwd);

const claudeId = '11111111-2222-4333-8444-555555555555';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
const claudeFile = path.join(home, '.claude', 'projects', 'p', claudeId + '.jsonl');
fs.mkdirSync(path.dirname(claudeFile), { recursive: true });
fs.writeFileSync(claudeFile, jsonl([
  { type: 'user', cwd, timestamp: '2026-01-01T10:00:00Z', message: { content: [
    { type: 'text', text: 'Fix the build <terminalvibe_context history="C:/u/.terminalvibe/threads/t/handoff.xml">Read the history only if my message depends on earlier work.</terminalvibe_context>' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] } },
  { type: 'assistant', timestamp: '2026-01-01T10:00:05Z', message: { content: [
    { type: 'tool_use', id: 't0', name: 'Read', input: { file_path: 'C:\\u\\.terminalvibe\\threads\\t\\handoff.xml' } },
    { type: 'text', text: 'Running the tests.' },
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
  { type: 'user', timestamp: '2026-01-01T10:00:09Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'fail' }] } },
  { type: 'user', isMeta: true, message: { content: 'hidden' } },
]));

const now = new Date();
const codexDir = path.join(home, '.codex', 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
fs.mkdirSync(codexDir, { recursive: true });
fs.writeFileSync(path.join(codexDir, 'rollout-x-codex-1.jsonl'), jsonl([
  { type: 'session_meta', payload: { id: 'codex-1', cwd } },
  task('task_started', '2026-01-01T10:00:00Z'),
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue this conversation. The full history with the previous agent is in C:/x/handoff.md - read it first.' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Now add docs [TerminalVibe thread history: C:/x/handoff.md - read it first for context]' },
    { type: 'input_text', text: '<image name=[Image #1]>' }, { type: 'input_image', image_url: 'data:image/png;base64,' + PNG }] } },
  { type: 'response_item', payload: { type: 'local_shell_call', call_id: 'c1', action: { command: ['ls', '-la'] } } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ metadata: { exit_code: 2 } }) } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Docs added.' }] } },
  task('task_complete', '2026-01-01T10:00:10Z'),
]));

const meta = { id: 'thread-1', title: 'Fix the build', projectId: 'p1', cwd, createdAt: 1, segments: [
  { harness: 'claude', sessionId: claudeId, cwd, since: 100, model: 'opus', effort: 'high' },
  { harness: 'codex', sessionId: null, cwd, since: Date.now() - 60000, handoff: true },
  { harness: 'opencode', sessionId: null, cwd, since: Date.now() },
] };

(async () => {
  const dir = path.join(home, '.terminalvibe', 'threads', 'thread-1');
  const original = Buffer.from(PNG, 'base64');
  const attachment = await saveThreadAttachment(meta.id, '../image.png', original, home);
  assert.strictEqual(path.basename(attachment), 'image.png');
  assert.strictEqual(path.relative(dir, attachment).split(path.sep)[0], 'attachments');
  assert.deepStrictEqual(fs.readFileSync(attachment), original, 'attachment bytes survive independently of the source');
  await assert.rejects(saveThreadAttachment('../other', 'image.png', original, home), /Invalid thread id/);
  const [claude, codex, opencode] = await syncThread(meta, home);
  assert.strictEqual(codex.turnState.status, 'completed', 'completion status reaches the renderer');
  assert.deepStrictEqual(claude.items.map(i => i.role), ['user', 'tool', 'assistant', 'tool'], 'the handoff read shows as a step, like in the CLI');
  assert.strictEqual(claude.items[0].text, 'Fix the build', 'context note is not shown as part of the message');
  assert.strictEqual(claude.items[3].summary, 'npm test');
  assert.strictEqual(claude.items[3].detail, 'npm test', 'tool detail keeps the full command');
  assert.strictEqual(claude.items[3].error, true);
  assert.deepStrictEqual(codex.items.map(i => i.role), ['user', 'tool', 'assistant'], 'codex skips <environment_context>');
  assert.strictEqual(codex.items[0].text, 'Now add docs', 'handoff pointer is not shown as part of the message');
  assert.strictEqual(codex.items[1].summary, 'ls -la');
  assert.strictEqual(codex.items[1].detail, 'ls -la');
  assert.strictEqual(codex.items[1].error, true);
  assert.strictEqual(codex.sessionId, 'codex-1', 'codex id found from cwd + start time');
  assert(!opencode.unsupported && !opencode.items.length, 'a terminal OpenCode with no session yet is just empty');
  // Its first prompt creates the session in OpenCode's database: found by folder + start time.
  const ocDir = path.join(home, '.local', 'share', 'opencode');
  fs.mkdirSync(ocDir, { recursive: true });
  const db = new (require('node:sqlite').DatabaseSync)(path.join(ocDir, 'opencode.db'));
  db.exec('CREATE TABLE session_v2 (id, directory, parent_id, time_updated); CREATE TABLE session_message (session_id, type, seq, time_created, data)');
  db.prepare('INSERT INTO session_v2 VALUES (?, ?, NULL, ?)').run('ses_terminal1', cwd, Date.now());
  const add = db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?)');
  add.run('ses_terminal1', 'user', 1, Date.now(), JSON.stringify({ text: 'hello' }));
  add.run('ses_terminal1', 'assistant', 2, Date.now(), JSON.stringify({ content: [{ type: 'text', text: 'hi' },
    { type: 'tool', name: 'shell', state: { status: 'error', input: { command: 'ls' }, content: [{ type: 'text', text: 'no' }] } }] }));
  db.close();
  const [oc] = await syncThread({ id: 'thread-oc', segments: [{ harness: 'opencode', sessionId: null, cwd, since: Date.now() - 60000 }] }, home);
  assert.strictEqual(oc.sessionId, 'ses_terminal1');
  assert.deepStrictEqual(oc.items.map(i => i.role), ['user', 'assistant', 'tool']);
  assert(oc.items[2].error && oc.items[2].summary === 'ls');
  // Pasted images are saved in the thread folder and shown by path, not as base64.
  const [img] = claude.items[0].images;
  assert(img.startsWith(path.join(dir, 'images')) && fs.readFileSync(img).equals(Buffer.from(PNG, 'base64')), 'claude image saved');
  assert.deepStrictEqual(codex.items[0].images, [img], 'codex image saved once (same bytes)');

  const thread = JSON.parse(fs.readFileSync(path.join(dir, 'thread.json'), 'utf8'));
  assert.strictEqual(thread.title, 'Fix the build');
  assert.strictEqual(thread.segments[1].sessionId, 'codex-1');
  assert.strictEqual(thread.segments[1].handoff, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).segments[0].items.length, 4);

  const longMeta = { id: 'long-history', segments: [{ harness: 'claude', since: 1, frozen: true }, { harness: 'codex', since: 2, frozen: true }] };
  const longDir = path.join(home, '.terminalvibe', 'threads', longMeta.id), historyFile = path.join(longDir, 'history.json');
  fs.mkdirSync(longDir, { recursive: true });
  const stored = { segments: longMeta.segments.map((s, i) => ({
    ...s, items: Array.from({ length: i ? 650 : 50 }, (_, j) => ({ role: 'user', text: String(j) })),
  })) };
  fs.writeFileSync(historyFile, JSON.stringify(stored));
  const preview = await threadHistoryPreview(longMeta, home);
  assert.deepStrictEqual(preview.map(s => s.items.length), [0, 100], 'Preview returns only the recent saved tail');
  assert.strictEqual(preview[1].items[0].text, '550');
  assert.strictEqual(preview[1].previewOffset, 500, 'Preview indices align with the complete visible history');
  assert(!fs.existsSync(path.join(longDir, 'thread.json')), 'Preview does not synchronize or write thread metadata');
  const full = await threadHistory(longMeta, home);
  assert.deepStrictEqual(full.map(s => s.items.length), [0, 600], 'An exhausted budget does not include older sessions');
  const stamp = fs.statSync(historyFile).mtimeMs;
  await threadHistory(longMeta, home);
  assert.strictEqual(fs.statSync(historyFile).mtimeMs, stamp, 'Unchanged history is not written again');
  assert.strictEqual(await threadHistoryPreview({ ...longMeta, segments: [] }, home), null, 'A changed segment list does not show stale preview messages');

  // The agent's transcript is gone: the thread keeps its own copy.
  fs.rmSync(claudeFile);
  const shown = await threadHistory(meta, home);
  assert.strictEqual(shown[0].items.length, 4);
  assert.deepStrictEqual(shown[0].items[0].images, [img], 'image survives a deleted transcript');

  const md = fs.readFileSync(await writeHandoff({ ...meta, names: { claude: 'Claude Code' } }, home), 'utf8');
  for (const text of ['<terminalvibe_handoff project=', '<instructions>', '<session agent="Claude Code" model="opus">', `<message role="user">\nFix the build\n<image path="${img}"/>\n</message>`,
    'Docs added.', '<tool name="Bash" failed="true">npm test</tool>', '<session agent="opencode">', '</terminalvibe_handoff>']) assert(md.includes(text), text);
  assert(!md.includes('handoff.xml'), 'the agent reading the handoff file is not part of the history');

  // Fork from the first Codex message: Claude's session whole, Codex's cut after that message.
  const forkSegs = await forkThread({ meta, seg: 1, item: 0, id: 'fork-1', title: 'Fork: Fix the build' }, home);
  assert.deepStrictEqual(forkSegs.map(s => [s.harness, s.frozen]), [['claude', true], ['codex', true]]);
  const forkMeta = { id: 'fork-1', title: 'Fork', cwd, segments: forkSegs };
  const forked = await threadHistory(forkMeta, home);
  assert.deepStrictEqual(forked.map(s => s.items.length), [4, 1], 'history ends at the fork point');
  assert.strictEqual(forked[1].items[0].text, 'Now add docs');
  const forkImg = forked[0].items[0].images[0];
  assert(forkImg.startsWith(path.join(home, '.terminalvibe', 'threads', 'fork-1', 'images')) && fs.existsSync(forkImg), 'images copied into the fork');
  const forkMd = fs.readFileSync(await writeHandoff(forkMeta, home), 'utf8');
  assert(forkMd.includes('Now add docs') && !forkMd.includes('Docs added.'), 'the handoff stops at the fork point');
  await assert.rejects(forkThread({ meta, seg: 1, item: 99, id: 'fork-2' }, home), /Invalid fork point/);
  await deleteThread('fork-1', home);

  await assert.rejects(syncThread({ ...meta, id: '../escape' }, home), /Invalid thread id/);
  await assert.rejects(deleteThread('..', home), /Invalid thread id/);
  await deleteThread('thread-1', home);
  assert(!fs.existsSync(dir));

  // TerminalVibe started from an agent: agents in its tabs must not look like child sessions
  // (Claude Code then stops saving transcripts and the thread stays empty).
  const env = require('../electron/terminal-env').terminalEnv({ PATH: '/keep', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_USE_BEDROCK: '1', T3CODE_THREAD_ID: 'y' });
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'T3CODE_THREAD_ID']) assert(!(key in env), key);
  assert.strictEqual(env.CLAUDE_CODE_USE_BEDROCK, '1', 'user Claude settings stay');
  assert.strictEqual(env.PATH, '/keep');

  // A question Claude asked (AskUserQuestion) keeps each question with the answer given.
  const { parseClaude } = require('../electron/threads');
  const q = 'What should notes.txt hold?';
  const asked = parseClaude([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: q, header: 'Notes', options: [{ label: 'Tasks' }, { label: 'Ideas' }] }] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'The user answered' }] }, toolUseResult: { answers: { [q]: ['Tasks', 'Ideas'] } } },
  ]);
  assert.deepStrictEqual(asked[0].qa, [{ question: q, answer: 'Tasks, Ideas' }]);
  const open = parseClaude([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q2', name: 'AskUserQuestion', input: { questions: [{ question: q }] } }] } }]);
  assert.deepStrictEqual(open[0].qa, [{ question: q, answer: null }], 'a question not answered yet has no answer');

  // A steer (a message sent while Claude works) is only a queued_command attachment: it shows as the user's
  // message, marked steered, once even if Claude Code also writes it as a user row; its own notices stay hidden.
  const steer = (prompt, extra = {}) => ({ type: 'attachment', timestamp: 't2', attachment: { type: 'queued_command', prompt, commandMode: 'prompt', timestamp: 't2', ...extra } });
  const steered = parseClaude([
    { type: 'user', message: { content: 'build it' }, timestamp: 't1' },
    steer('make it black and white'),
    steer('<task-notification><task-id>x</task-id></task-notification>'),
    { type: 'user', message: { content: 'make it black and white' }, timestamp: 't3' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] }, timestamp: 't4' },
  ]);
  assert.deepStrictEqual(steered.map(m => [m.role, m.text, !!m.steered]), [['user', 'build it', false], ['user', 'make it black and white', true], ['assistant', 'Done.', false]]);

  // Antigravity (ACP) history: the transcript TerminalVibe records; the handoff note is hidden, empty text skipped.
  const { parseAcp } = require('../electron/threads');
  const acp = parseAcp([{ role: 'user', text: 'hi <terminalvibe_context history="x">n</terminalvibe_context>', ts: 't1' }, { role: 'thinking', text: '' },
    { role: 'tool', name: 'run_command', summary: 'echo hi', detail: '{}', error: true }, { role: 'assistant', text: 'done' }, { role: 'bogus', text: 'x' }]);
  assert.deepStrictEqual(acp.map(i => [i.role, i.text ?? i.summary]), [['user', 'hi'], ['tool', 'echo hi'], ['assistant', 'done']]);
  assert.strictEqual(acp[1].error, true);
  // The agent died mid-turn: its "interrupt" record flags the step before it (the chat's "Interrupted" line).
  const crashed = parseAcp([{ role: 'user', text: 'go', ts: 't1' }, { role: 'tool', name: 'run_command', summary: 'python3 x', error: true, ts: 't2' },
    { role: 'interrupt', reason: 'crash', text: 'crashed (SIGSEGV)', ts: 't3' }]);
  assert.deepStrictEqual(crashed.map(i => [i.role, i.interrupted || null]), [['user', null], ['tool', 'crash']]);

  // delegate_task subagents: the same prompt delegated three times keeps three runs. A finished call finds its run by
  // the session in its result; a running one takes the next unclaimed run; a run whose process died shows stopped.
  {
    const { delegateKey } = require('../electron/delegate-mcp');
    const prompt = 'say hi', key = delegateKey('opencode', prompt), runs = path.join(home, '.terminalvibe', 'subagents');
    fs.mkdirSync(runs, { recursive: true });
    const t0 = Date.parse('2026-05-01T10:00:00Z');
    const run = (n, sessionId, status, pid) => fs.writeFileSync(path.join(runs, `${key}.${t0 + n * 1000}.1.${n}.json`),
      JSON.stringify({ harness: 'opencode', sessionId, status, pid, model: null, startedAt: t0 + n * 1000, endedAt: status === 'running' ? null : t0 + n * 1000 + 500 }));
    run(1, 'ses_first00001', 'completed', 1);
    run(2, 'ses_second0001', 'running', process.pid);
    run(3, 'ses_third00001', 'running', 999999999);
    const call = (n, output) => ({ role: 'tool', name: 'terminalvibe_delegate_task', summary: 'Hi', detail: '{}', input: { harness: 'opencode', description: 'Hi', prompt },
      callId: 'c' + n, ts: new Date(t0 + n * 1000 - 200).toISOString(), ...(output ? { output } : {}) });
    const sid = 'ses_delegparent1';
    fs.mkdirSync(path.join(home, '.terminalvibe', 'acp'), { recursive: true });
    fs.writeFileSync(path.join(home, '.terminalvibe', 'acp', sid + '.jsonl'), jsonl([{ role: 'user', text: 'three subagents', ts: new Date(t0).toISOString() },
      call(1, '[OpenCode session ses_first00001]\nhi one'), call(2), call(3)]));
    const [seg] = await threadHistory({ id: 'deleg', segments: [{ harness: 'opencode', sessionId: sid, since: 0 }] }, home);
    const agents = seg.items.filter(x => x.agent).map(x => [x.agent.sessionId, x.agent.status, x.output ?? null]);
    assert.deepStrictEqual(agents, [['ses_first00001', 'completed', 'hi one'], ['ses_second0001', 'running', null], ['ses_third00001', 'stopped', null]]);
    assert.strictEqual(new Set(seg.items.filter(x => x.agent).map(x => x.agent.toolUseId)).size, 3, 'one id per call');
    const runningCall = seg.items.find(x => x.agent?.status === 'running').agent.toolUseId;
    const live = await subagentStatus({ id: 'deleg', segments: [{ harness: 'opencode', sessionId: sid, since: 0 }] }, runningCall, home);
    assert.deepStrictEqual([live.status, live.since > 0, live.last], ['running', true, null], 'a subagent thread reads its live state from the parent call');
  }

  // Background commands (Claude Code's Bash with run_in_background): a running one has its latest output read live,
  // a finished one its status, and its end is an "event" (once, though Claude logs it as queued and as a turn).
  // A background subagent's row is finished by the same notification.
  {
    const bgSid = 'bbbbbbbb-1111-2222-3333-444444444444', tasks = path.join(home, 'bgtasks', 'tasks');
    fs.mkdirSync(tasks, { recursive: true });
    fs.writeFileSync(path.join(tasks, 'run1.output'), 'line 1\n\x1b[32mline 2\x1b[0m\n');
    const note = (id, tool, status) => `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>${tool}</tool-use-id>\n<status>${status}</status>\n<summary>Background command "Build" ${status} (exit code 2)</summary>\n</task-notification>`;
    const use = (id, name, input, t) => ({ type: 'assistant', timestamp: t, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id, name, input }] } });
    const result = (id, text, tur, t) => ({ type: 'user', timestamp: t, toolUseResult: tur, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
    const dir = path.join(home, '.claude', 'projects', 'bg');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, bgSid + '.jsonl'), jsonl([
      { type: 'user', timestamp: '2026-05-02T10:00:00Z', message: { role: 'user', content: 'start two jobs' } },
      use('tu1', 'Bash', { command: 'npm run watch', description: 'Watch', run_in_background: true }, '2026-05-02T10:00:01Z'),
      result('tu1', `Command running in background with ID: run1. Output is being written to: ${path.join(tasks, 'run1.output')}`, { backgroundTaskId: 'run1' }, '2026-05-02T10:00:02Z'),
      use('tu2', 'Bash', { command: 'make', description: 'Build', run_in_background: true }, '2026-05-02T10:00:03Z'),
      result('tu2', 'Command running in background with ID: run2. Output is being written to: /x/tasks/run2.output', { backgroundTaskId: 'run2' }, '2026-05-02T10:00:04Z'),
      use('tu3', 'Agent', { description: 'Research', prompt: 'look', subagent_type: 'general-purpose', run_in_background: true }, '2026-05-02T10:00:05Z'),
      result('tu3', 'Async agent launched', { status: 'async_launched', agentId: 'a1' }, '2026-05-02T10:00:06Z'),
      { type: 'assistant', timestamp: '2026-05-02T10:00:07Z', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'started' }] } },
      { type: 'attachment', timestamp: '2026-05-02T10:00:20Z', attachment: { type: 'queued_command', prompt: note('run2', 'tu2', 'failed'), timestamp: '2026-05-02T10:00:20Z' } },
      { type: 'user', timestamp: '2026-05-02T10:00:21Z', message: { role: 'user', content: note('run2', 'tu2', 'failed') } },
      { type: 'user', timestamp: '2026-05-02T10:00:30Z', message: { role: 'user', content: note('a1', 'tu3', 'completed') } },
      // Ended while the agent was still between tool steps: queued mid-turn.
      { type: 'user', timestamp: '2026-05-02T10:01:00Z', message: { role: 'user', content: 'serve it' } },
      use('tu4', 'Bash', { command: 'vercel dev', description: 'Serve', run_in_background: true }, '2026-05-02T10:01:01Z'),
      result('tu4', 'Command running in background with ID: run4.', { backgroundTaskId: 'run4' }, '2026-05-02T10:01:02Z'),
      use('tu5', 'Bash', { command: 'sleep 5' }, '2026-05-02T10:01:03Z'),
      { type: 'attachment', timestamp: '2026-05-02T10:01:04Z', attachment: { type: 'queued_command', prompt: note('run4', 'tu4', 'failed'), timestamp: '2026-05-02T10:01:04Z' } },
    ]));
    const [seg] = await threadHistory({ id: 'bg', segments: [{ harness: 'claude', sessionId: bgSid, since: 0 }] }, home);
    const byId = n => seg.items.find(x => x.role === 'tool' && x.summary === n || x.input?.description === n);
    const watch = seg.items.find(x => x.bg?.command === 'npm run watch'), build = seg.items.find(x => x.bg?.command === 'make');
    assert.deepStrictEqual([watch.bg.status, watch.bg.taskId, watch.bg.tail], ['running', 'run1', 'line 1\nline 2\n'], 'running: live output, colors stripped');
    assert.deepStrictEqual([build.bg.status, build.bg.summary.includes('exit code 2')], ['failed', true]);
    const events = seg.items.filter(x => x.role === 'event');
    assert.deepStrictEqual(events.map(e => [e.kind, e.status, e.title]), [['bg', 'failed', 'Build'], ['agent', 'completed', 'Research'], ['bg', 'failed', 'Serve']], 'one event per task, where it ended');
    assert.deepStrictEqual(events.map(e => !!e.inTurn), [false, false, true], 'only one that ended mid-turn stays in its turn');
    assert.strictEqual(seg.items.find(x => x.agent)?.agent.status, 'completed', 'the background subagent is finished by its notification');
    assert(!seg.items.some(x => x.role === 'user' && /task-notification/.test(x.text || '')), 'notifications are not shown as prompts');
    void byId;
  }

  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS: thread folders keep every agent session, survive deleted transcripts, hand off and delete');
})().catch(err => { console.error(err); fs.rmSync(home, { recursive: true, force: true }); process.exit(1); });
