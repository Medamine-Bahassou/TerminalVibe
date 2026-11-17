const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const start = source.indexOf('      const changesHtml =');
const end = source.indexOf('    });\n    flow.innerHTML = html + pendingHtml', start);
assert(start >= 0 && end > start);
const code = source.slice(start, end);
const firstAt = Date.parse('2026-11-17T12:00:00Z'), nextAt = firstAt + 2000;
const file = { path: '/repo/app.js', add: 1, del: 0, patch: '+fixed' };
const first = [
  { role: 'user', text: 'First request', ts: new Date(firstAt).toISOString() },
  { role: 'assistant', text: 'Done', ts: new Date(firstAt + 500).toISOString() },
];
const turn = { since: nextAt, awaitingPrompt: true };
const context = vm.createContext({
  ws: { id: 'chat', chat: {} }, seg: { cwd: '/repo' }, segs: [{}], i: 0,
  open: new Set(), _turns: new Map([['chat', turn]]),
  working: false, awaitingTurnPrompt: false, res: { items: first },
  turnGitFiles: (_ws, ts) => Date.parse(ts) === firstAt ? [file] : [],
  escHtml: String, linkFileIcon: () => 'ph-file', hlDiffLine: String, fmtSecs: n => n + 's',
  msgHtml: (message, key, actions, changes = '') => '<div>' + message.text + changes + '</div>',
  stepsHtml: () => '', html: '',
});
const render = () => { context.html = ''; vm.runInContext('{' + code + '}', context); return context.html; };
assert(render().includes('thr-changes'), 'completed turn shows its diff');
context.working = true; context.awaitingTurnPrompt = true;
assert(render().includes('thr-changes'), 'sending a query must not hide the previous diff while its prompt is pending');
turn.promptTs = new Date(nextAt).toISOString(); turn.awaitingPrompt = false;
context.awaitingTurnPrompt = false;
context.res = { items: [...first, { role: 'user', text: 'Next request', ts: turn.promptTs }] };
const next = render();
assert(next.includes('thr-changes') && next.indexOf('thr-changes') < next.indexOf('Next request'), 'rapid follow-ups must keep the old diff under its original response');
assert.equal((next.match(/class="thr-changes"/g) || []).length, 1, 'the running turn must not acquire the old diff');
// Snapshot lookup must never reassign an old prompt to a new snapshot in its future.
const snapshots = [{ at: firstAt - 100, cwd: '/repo', from: 'first', to: 'first-end' }];
const cached = new Map([['first..first-end', [file]]]);
const git = vm.createContext({ Date, _turnDiffs: cached, _turnEnding: new Set(),
  window: { electronAPI: { gitTurnDiff() { throw Error('completed diff should remain cached'); } } },
  chatWorking: () => true, curChat: () => null,
});
vm.runInContext(source.slice(source.indexOf('  function turnGitFiles('), source.indexOf('  async function deliverChatMessage(')), git);
const chat = { chat: { snaps: snapshots } };
assert.equal(git.turnGitFiles(chat, first[0].ts), cached.get('first..first-end'));
snapshots.push({ at: nextAt - 100, cwd: '/repo', from: 'second' });
assert.equal(git.turnGitFiles(chat, first[0].ts, turn.promptTs), cached.get('first..first-end'), 'a new snapshot within five seconds must not replace or hide the completed diff');
const matching = vm.createContext({ hist: [{ items: first }], Date });
const matchStart = source.indexOf('    const inTranscript =');
const matchEnd = source.indexOf('    // Stopped prompts', matchStart);
vm.runInContext(source.slice(matchStart, matchEnd) + '\nthis.matchesPrompt = inTranscript;', matching);
assert.equal(matching.matchesPrompt('First request', nextAt, firstAt), undefined, 'repeating a recent query must not match its previous transcript entry');
matching.hist[0].items = [...first, { role: 'user', text: 'First request', ts: new Date(nextAt).toISOString() }];
assert.equal(matching.matchesPrompt('First request', nextAt, firstAt).ts, new Date(nextAt).toISOString(), 'a new instance of the same query must match its own transcript entry');
console.log('PASS: completed diffs remain visible during pending queries, rapid follow-ups and snapshot updates');
