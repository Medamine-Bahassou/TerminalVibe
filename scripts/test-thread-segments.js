#!/usr/bin/env node
// Thread history segments: agent/model switches in one pane, prompts you send, CLI commands.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const slice = (from, to) => {
  const i = source.indexOf(from), j = source.indexOf(to, i);
  assert.ok(i >= 0 && j > i, `app.js section ${from}`);
  return source.slice(i, j);
};
const code = [
  slice('  function setThreadPane(', '  // Shell command that starts a harness'),
  slice('  function harnessCommand(h, resume)', '  function addBrowserTab('),
  slice('  async function runHarness(', '  /* ── Idle agents stop to save memory'),
  slice('  // Each prompt you send in a thread pane', '  const threadWorkspace = threadId =>'),
].join('\n');

let n = 0;
const commands = [], prompts = [];
const plain = v => JSON.parse(JSON.stringify(v)); // vm arrays are from another realm
const sandbox = {
  TextEncoder, TextDecoder, setTimeout, Date, console,
  threads: [],
  uuid: () => `id${++n}`,
  shellQuote: s => `'${s}'`,
  learnCodexIds: async () => {},
  createAgentTerminal: async () => true,
  getSlotDimensions: () => ({}),
  _sendStdinRaw: (_id, bytes) => commands.push(new TextDecoder().decode(bytes).trim()),
  sendPrompt: (_t, text) => prompts.push(text),
  saveState() {}, renderSidebar() {}, renderAgentPanel() {},
  threadWorkspace: () => null,
};
vm.createContext(sandbox);
vm.runInContext(code + '\nObject.assign(this, { runHarness, noteThreadInput, threadSegments, harnessCommand });', sandbox);

(async () => {
  const thread = { id: 't', title: '', cwd: '/proj', harnesses: {}, createdAt: 1 };
  sandbox.threads.push(thread);
  const pane = { id: 'p1', term: { reset() {} } };
  const segs = () => sandbox.threadSegments(thread);
  const type = text => sandbox.noteThreadInput(pane, text);

  await sandbox.runHarness(pane, thread, 'claude');
  const claudeKey = pane.harnessKey, sid = thread.harnesses[claudeKey].sessionId;
  assert.equal(commands.at(-1), `claude --session-id ${sid}`);
  assert.equal(segs().length, 1);

  type('build the login'); type(' page\r');
  type('y\r');           // a one-key menu answer
  type('\x1b[A'); type('\r'); // a recalled prompt: the line is unknown
  assert.deepEqual(plain(segs()[0].prompts), ['build the login page'], 'Typed prompts are recorded; menu answers and recalled lines are not');
  assert.equal(thread.title, 'build the login page', 'The first prompt titles the thread');

  // Claude on another model: same session, a note in the same segment.
  await sandbox.runHarness(pane, thread, 'claude', { model: 'opus' });
  assert.equal(pane.harnessKey, claudeKey);
  assert.equal(commands.at(-1), `claude --resume ${sid} --model 'opus' || claude --session-id ${sid} --model 'opus'`);
  assert.equal(segs().length, 1);
  assert.deepEqual(plain(segs()[0].notes.map(x => x.text)), ['Model default → opus, same session']);

  // Another agent: the Claude segment ends, a Codex one starts and gets the prompt once it is up.
  await sandbox.runHarness(pane, thread, 'codex', { model: null, prompt: 'Read /h.md' });
  const codexKey = pane.harnessKey;
  assert.equal(commands.at(-1), 'codex');
  assert.equal(segs().length, 2);
  assert.ok(segs()[0].end, 'The previous segment ends');
  assert.deepEqual(plain([segs()[1].agent, segs()[1].paneId]), ['codex', 'p1']);
  type('review auth\r');
  assert.deepEqual(plain(segs()[1].prompts), ['review auth']);
  await new Promise(r => setTimeout(r, 1800));
  assert.deepEqual(prompts, ['Read /h.md'], 'The handoff prompt is typed in once the CLI has started');

  // Codex on another model: a new session (and segment), not a resume.
  await sandbox.runHarness(pane, thread, 'codex', { model: 'gpt-5' });
  assert.notEqual(pane.harnessKey, codexKey);
  assert.equal(commands.at(-1), "codex --model 'gpt-5'");
  assert.equal(segs().length, 3);

  // Back to Claude: its own session resumes, on the model it had.
  await sandbox.runHarness(pane, thread, 'claude');
  assert.equal(pane.harnessKey, claudeKey);
  assert.match(commands.at(-1), new RegExp(`^claude --resume ${sid} --model 'opus'`));
  assert.deepEqual(plain(segs().map(x => x.agent)), ['claude', 'codex', 'codex', 'claude']);

  // A failed start leaves no segment and restores the model.
  sandbox.createAgentTerminal = async () => false;
  await assert.rejects(sandbox.runHarness(pane, thread, 'claude', { model: 'haiku' }));
  assert.equal(thread.harnesses[claudeKey].model, 'opus');
  assert.equal(segs().length, 4);

  // Threads from before segments get one per harness, oldest first.
  const old = { id: 'o', harnesses: { b: { agent: 'codex', since: 20 }, a: { agent: 'claude', since: 10, model: 'sonnet' } }, createdAt: 1 };
  assert.deepEqual(plain(sandbox.threadSegments(old).map(x => [x.key, x.agent, x.model])), [['a', 'claude', 'sonnet'], ['b', 'codex', null]]);

  assert.equal(sandbox.harnessCommand({ agent: 'gemini', model: 'gemini-2.5-pro' }, true), "gemini --resume latest --model 'gemini-2.5-pro'");
  assert.equal(sandbox.harnessCommand({ agent: 'opencode' }, false), 'opencode');
  console.log('Thread segments: model switch in session, agent switch, new session per model, resume, prompts recorded, handoff prompt, legacy threads passed');
})().catch(e => { console.error(e); process.exit(1); });
