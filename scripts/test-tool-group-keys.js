const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
let groups;
const ctx = vm.createContext({ i: 0,
  toolsHtml: (tools, key) => { groups.push({ key, names: tools.map(x => x.name) }); return ''; },
  thoughtHtml: () => '', msgHtml: () => '', qaHtml: () => '',
});
const start = source.indexOf('      const stepsHtml =');
vm.runInContext(source.slice(start, source.indexOf('      // The files a turn changed', start)) + '\nthis.renderSteps = stepsHtml;', ctx);
const shell = j => ({ j, m: { role: 'tool', name: 'shell' } });
const render = list => { groups = []; ctx.renderSteps(list, '0:1'); return groups; };
const initial = render([shell(2)]);
assert.equal(render([shell(2), shell(3)])[0].key, initial[0].key, 'new commands must not change the open group key');
const later = render([shell(2), shell(3), { j: 4, m: { role: 'thinking' } }]);
assert.equal(later[0].key, initial[0].key, 'a subsequent thought must not close the previous group');
const final = render([shell(2), shell(3), { j: 4, m: { role: 'assistant' } }, shell(5)]);
assert.equal(final[0].key, initial[0].key);
assert.notEqual(final[1].key, initial[0].key, 'separate command groups need independent keys');
console.log('PASS: tool group keys remain stable as work steps arrive');
