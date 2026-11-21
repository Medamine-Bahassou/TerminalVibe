// Harness identity appears before the first transcript response.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const pending = new Map();
const options = { harness: 'codex', model: 'gpt-6.1-sol', effort: 'low' };
const context = vm.createContext({
  _pendingMsgs: pending, chatOpts: () => options,
  harnessOf: id => ({ name: id === 'codex' ? 'Codex' : 'Claude', bin: id }),
  escHtml: String, procIconHtml: () => '', clockTime: () => '09:35',
  userTextHtml: text => ({ html: text, paths: [] }), threadImagesHtml: () => '', mergePrNumber: () => null,
});
vm.runInContext(source.slice(source.indexOf('  const pendingMessages ='), source.indexOf('  const _thrImgCache =')) + '\nthis.renderPending = pendingHtml;', context);
const tab = { id: 'chat' };
assert.equal(context.renderPending(tab), '');
pending.set(tab.id, [{ text: 'test', at: Date.now(), options: { ...options } }]);
let html = context.renderPending(tab);
assert(html.indexOf('thr-seg-name') < html.indexOf('thr-bubble'), 'header precedes the first optimistic message');
assert(html.includes('Codex') && html.includes('gpt-6.1-sol · low'));
assert(!context.renderPending(tab, 'Codex|gpt-6.1-sol · low').includes('thr-seg-name'), 'matching transcript header is not duplicated');
assert(context.renderPending(tab, 'Claude|').includes('thr-seg-name'), 'harness switch gets a header');
options.harness = 'claude';
assert(context.renderPending(tab).includes('Codex'), 'pending identity retains the settings used when sent');
pending.delete(tab.id);
assert.equal(context.renderPending(tab), '', 'failed or reconciled sends leave no pending header');
console.log('Pending harness header checks passed');
