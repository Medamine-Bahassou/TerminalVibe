const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const start = source.indexOf('      if (got && pend.options) {');
const record = source.slice(start, source.indexOf('      // A steer keeps', start));
const ws = { chat: {} }, got = { ts: '2026-11-17T15:00:00Z' }, pend = { options: { harness: 'codex', model: 'gpt-6.1-sol', effort: 'medium' } };
vm.runInNewContext(record, { ws, got, pend, saveState() {} });
const restored = JSON.parse(JSON.stringify(ws));
const renderStart = source.indexOf('        const options = ws.chat?.turnOptions?.[prompt.m.ts];');
const render = source.slice(renderStart, source.indexOf('        html += msgHtml(prompt.m', renderStart));
const context = { ws: restored, prompt: { m: { ts: got.ts } }, seg: { harness: 'codex' }, name: 'Codex', lastHead: 'Codex|gpt-6.1-sol · low', html: '', harnessOf: () => ({ name: 'Codex', bin: 'codex' }), procIconHtml: () => '', escHtml: s => s, clockTime: () => '' };
vm.runInNewContext('{'+render+'}', context);
assert(context.html.includes('medium'));
context.html = ''; vm.runInNewContext('{'+render+'}', context); assert.equal(context.html, '', 'same settings must not duplicate headers');
assert.equal(restored.chat.turnOptions[got.ts].effort, 'medium');
console.log('PASS: per-message effort survives history persistence and renders a stable change header');

