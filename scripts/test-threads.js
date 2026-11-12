// Thread folders: transcript parsing, ~/.terminalvibe/threads/<id>/ files,
// keeping history after a transcript is deleted, handoff and delete.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
const { syncThread, threadHistory, writeHandoff, forkThread, deleteThread } = require('../electron/threads');

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
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue this conversation. The full history with the previous agent is in C:/x/handoff.md - read it first.' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Now add docs [TerminalVibe thread history: C:/x/handoff.md - read it first for context]' },
    { type: 'input_text', text: '<image name=[Image #1]>' }, { type: 'input_image', image_url: 'data:image/png;base64,' + PNG }] } },
  { type: 'response_item', payload: { type: 'local_shell_call', call_id: 'c1', action: { command: ['ls', '-la'] } } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ metadata: { exit_code: 2 } }) } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Docs added.' }] } },
]));

const meta = { id: 'thread-1', title: 'Fix the build', projectId: 'p1', cwd, createdAt: 1, segments: [
  { harness: 'claude', sessionId: claudeId, cwd, since: 100, model: 'opus', effort: 'high' },
  { harness: 'codex', sessionId: null, cwd, since: Date.now() - 60000, handoff: true },
  { harness: 'opencode', sessionId: null, cwd, since: Date.now() },
] };

(async () => {
  const dir = path.join(home, '.terminalvibe', 'threads', 'thread-1');
  const [claude, codex, opencode] = await syncThread(meta, home);
  assert.deepStrictEqual(claude.items.map(i => i.role), ['user', 'assistant', 'tool']);
  assert.strictEqual(claude.items[0].text, 'Fix the build', 'context note is not shown as part of the message');
  assert.strictEqual(claude.items[2].summary, 'npm test');
  assert.strictEqual(claude.items[2].detail, 'npm test', 'tool detail keeps the full command');
  assert.strictEqual(claude.items[2].error, true);
  assert.deepStrictEqual(codex.items.map(i => i.role), ['user', 'tool', 'assistant'], 'codex skips <environment_context>');
  assert.strictEqual(codex.items[0].text, 'Now add docs', 'handoff pointer is not shown as part of the message');
  assert.strictEqual(codex.items[1].summary, 'ls -la');
  assert.strictEqual(codex.items[1].detail, 'ls -la');
  assert.strictEqual(codex.items[1].error, true);
  assert.strictEqual(codex.sessionId, 'codex-1', 'codex id found from cwd + start time');
  assert.strictEqual(opencode.unsupported, true);
  // Pasted images are saved in the thread folder and shown by path, not as base64.
  const [img] = claude.items[0].images;
  assert(img.startsWith(path.join(dir, 'images')) && fs.readFileSync(img).equals(Buffer.from(PNG, 'base64')), 'claude image saved');
  assert.deepStrictEqual(codex.items[0].images, [img], 'codex image saved once (same bytes)');

  const thread = JSON.parse(fs.readFileSync(path.join(dir, 'thread.json'), 'utf8'));
  assert.strictEqual(thread.title, 'Fix the build');
  assert.strictEqual(thread.segments[1].sessionId, 'codex-1');
  assert.strictEqual(thread.segments[1].handoff, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).segments[0].items.length, 3);

  // The agent's transcript is gone: the thread keeps its own copy.
  fs.rmSync(claudeFile);
  const shown = await threadHistory(meta, home);
  assert.strictEqual(shown[0].items.length, 3);
  assert.deepStrictEqual(shown[0].items[0].images, [img], 'image survives a deleted transcript');

  const md = fs.readFileSync(await writeHandoff({ ...meta, names: { claude: 'Claude Code' } }, home), 'utf8');
  for (const text of ['<terminalvibe_handoff project=', '<instructions>', '<session agent="Claude Code" model="opus">', `<message role="user">\nFix the build\n<image path="${img}"/>\n</message>`,
    'Docs added.', '<tool name="Bash" failed="true">npm test</tool>', '<session agent="opencode" transcript="unavailable">', '</terminalvibe_handoff>']) assert(md.includes(text), text);
  assert(!md.includes('handoff.xml'), 'the agent reading the handoff file is not part of the history');

  // Fork from the first Codex message: Claude's session whole, Codex's cut after that message.
  const forkSegs = await forkThread({ meta, seg: 1, item: 0, id: 'fork-1', title: 'Fork: Fix the build' }, home);
  assert.deepStrictEqual(forkSegs.map(s => [s.harness, s.frozen]), [['claude', true], ['codex', true]]);
  const forkMeta = { id: 'fork-1', title: 'Fork', cwd, segments: forkSegs };
  const forked = await threadHistory(forkMeta, home);
  assert.deepStrictEqual(forked.map(s => s.items.length), [3, 1], 'history ends at the fork point');
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

  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS: thread folders keep every agent session, survive deleted transcripts, hand off and delete');
})().catch(err => { console.error(err); fs.rmSync(home, { recursive: true, force: true }); process.exit(1); });
