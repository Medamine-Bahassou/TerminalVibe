const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const pty = require('node-pty');
const { terminalEnv } = require('../electron/terminal-env');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const resizes = [], writes = [], timers = new Map();
let sequence = 0, current, backend;
const entry = { id: 'test-pane', term: { cols: 80, rows: 24 }, el: { style: {}, offsetParent: {}, getBoundingClientRect: () => ({ width: 1120, height: 700 }) }, fit: { fit() {} } };
current = entry;
const context = vm.createContext({
  findTermById: id => current?.id === id ? { term: current } : null,
  sendControl: message => { resizes.push(message); backend?.resize(message.cols, message.rows); },
  setTimeout: fn => { timers.set(++sequence, fn); return sequence; }, clearTimeout: id => timers.delete(id),
  _multiSelected: new Set(), _sendStdinRaw: (id, data) => { writes.push({ id, data }); backend?.write(Buffer.from(data).toString()); },
});
vm.runInContext(source.slice(source.indexOf('  function syncTerminalSize('), source.indexOf('  // Auto-fit each terminal')), context);
vm.runInContext(source.slice(source.indexOf('  function sendStdin('), source.indexOf('  function connectNativePTY(')), context);
context.fitTerm(entry);
entry.term.cols = 140; entry.term.rows = 36;
const pending = [...timers.values()][0]; timers.clear(); pending();
assert.equal(resizes.at(-1).cols, 140, 'Deferred resize must read the current grid');
context.fitTerm(entry);
context.sendStdin(entry.id, new Uint8Array([13]));
assert.equal(timers.size, 0, 'Enter flushes the pending resize');
assert.equal(resizes.at(-1).rows, 36);
// Multi-select mirrors typing, never pane-local mouse/focus reports.
context._multiSelected.add(entry.id).add('other-pane');
const mirrored = () => writes.filter(w => w.id === 'other-pane').length;
context.sendStdin(entry.id, new TextEncoder().encode('\x1b[<59;76;14M'));
context.sendStdin(entry.id, new Uint8Array([27, 91, 77, 32, 40, 40]));
context.sendStdin(entry.id, new TextEncoder().encode('\x1b[I'));
assert.equal(mirrored(), 0, 'Mouse/focus reports must stay in their own pane');
context.sendStdin(entry.id, new TextEncoder().encode('ls'));
assert.equal(mirrored(), 1, 'Typed input is still mirrored');
context._multiSelected.clear(); writes.length = 0;
const count = resizes.length;
entry.el.offsetParent = null; context.fitTerm(entry, true);
assert.equal(resizes.length, count, 'Hidden panes must never be measured');
entry.el.offsetParent = {};
context.fitTerm(entry); current = null;
[...timers.values()][0](); timers.clear();
assert.equal(resizes.length, count, 'A closed/replaced pane must not get stale resize messages');
current = entry;
// Run the actual alternate-buffer callback, including its deferred fit.
let switchBuffer; const frames = [];
const term = { buffer: { onBufferChange(fn) { switchBuffer = fn; } } };
const hookStart = source.indexOf('    term.buffer.onBufferChange(');
const hookEnd = source.indexOf('\n\n', hookStart);
vm.runInNewContext(source.slice(hookStart, hookEnd), { term, entry, findTermById: context.findTermById, fitTerm: context.fitTerm, requestAnimationFrame: fn => frames.push(fn) });
switchBuffer({ type: 'alternate' });
assert.equal(frames.length, 1); frames.shift()();
assert.equal(resizes.length, count + 1, 'Entering a TUI must resync even without a pixel resize');
const env = terminalEnv({ ...process.env, COLUMNS: '80', LINES: '24' });
assert(!('COLUMNS' in env) && !('LINES' in env));
(async () => {
  // A real child TUI reads TIOCGWINSZ immediately after Enter. Reproduce a
  // stale 80x24 PTY paired with the larger frontend, then use the real input path.
  backend = pty.spawn('/bin/sh', ['-c', 'read start; exec python3 -c \'import os; print("TUI_SIZE:%dx%d" % tuple(os.get_terminal_size()))\''], { cols: 80, rows: 24, env });
  let output = '';
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { backend.kill(); reject(Error('TUI size test timed out')); }, 5000);
    backend.onData(data => { output += data; });
    backend.onExit(() => { clearTimeout(timer); resolve(); });
  });
  context.fitTerm(entry);
  context.sendStdin(entry.id, new Uint8Array([13]));
  await done;
  assert.match(output, /TUI_SIZE:140x36/, 'TUI must start with the current frontend dimensions');
  console.log('PASS: live PTY TUI launch size, pending resize flush, latest-grid timers, alternate-screen resync, hidden/closed panes and environment sizing');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Terminal links: web URLs open as a browser tab in the clicked terminal's
// group; Shift+click, non-web schemes and unknown panes use the system browser.
{
  const opened = [], external = [];
  const link = { findTermById: id => id === 'pane' ? { ws: { id: 'ws', layout: {} } } : null,
    findGroupContainingTerm: () => ({ id: 'group' }), addBrowserTab: (...args) => opened.push(args), openExternalUrl: url => external.push(url), URL, terminalLinkTarget: 'tab' };
  vm.runInNewContext(source.slice(source.indexOf('  function openTerminalLink('), source.indexOf('  function openExternalUrl(')), link);
  link.openTerminalLink('pane', 'http://127.0.0.1:7769/', {});
  link.openTerminalLink('pane', 'http://127.0.0.1:7769/', { shiftKey: true });
  link.openTerminalLink('pane', 'mailto:a@b.c', {});
  link.openTerminalLink('detached', 'https://example.com', {});
  assert.deepEqual(opened, [['ws', 'group', 'http://127.0.0.1:7769/']]);
  assert.deepEqual(external, ['http://127.0.0.1:7769/', 'mailto:a@b.c', 'https://example.com']);
  link.terminalLinkTarget = 'external'; opened.length = external.length = 0;
  link.openTerminalLink('pane', 'https://example.com/', {});
  link.openTerminalLink('pane', 'https://example.com/', { shiftKey: true });
  assert.deepEqual(external, ['https://example.com/'], 'System-browser setting opens externally');
  assert.deepEqual(opened, [['ws', 'group', 'https://example.com/']], 'Shift+click inverts the setting');
  console.log('PASS: terminal links follow the General setting (tab or system browser), Shift+click inverts, non-web/detached go external');
}
