// Pull requests page: search tokens, filters, repo pick and sort over the loaded PRs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({ Date, document: { getElementById: () => null } });
vm.runInContext(source.slice(source.indexOf('  const PR_SORTS ='), source.indexOf('  function renderPullsPage(')), context);
const pr = (number, extra) => ({ number, title: `PR ${number}`, repo: 'o/a', author: { login: 'me' }, headRefName: 'b', labels: [], isDraft: false,
  createdAt: '2026-01-0' + number + 'T00:00:00Z', updatedAt: '2026-02-0' + (9 - number) + 'T00:00:00Z', reviewRequests: [], ...extra });
vm.runInContext('_pulls.data = data', Object.assign(context, { data: { me: 'me', repos: ['o/a', 'o/b'], pulls: [
  pr(1), pr(2, { isDraft: true, labels: [{ name: 'bug' }] }), pr(3, { repo: 'o/b', author: { login: 'ann' }, reviewRequests: [{ login: 'me' }] }),
] } }));
const shown = (state = {}) => { Object.assign(vm.runInContext('_pulls', context), { q: '', sort: 'updated', filter: 'all', repo: '' }, state);
  return context.visiblePulls().map(p => p.number).join(','); };
assert.equal(shown(), '1,2,3', 'recently updated first');
assert.equal(shown({ sort: 'newest' }), '3,2,1');
assert.equal(shown({ sort: 'oldest' }), '1,2,3');
assert.equal(shown({ filter: 'mine' }), '1,2');
assert.equal(shown({ filter: 'review' }), '3');
assert.equal(shown({ filter: 'drafts' }), '2');
assert.equal(shown({ filter: 'ready' }), '1,3');
assert.equal(shown({ repo: 'o/b' }), '3');
assert.equal(shown({ q: 'label:bug' }), '2');
assert.equal(shown({ q: 'author:ann' }), '3');
assert.equal(shown({ q: 'is:draft' }), '2');
assert.equal(shown({ q: 'repo:o/a pr 1' }), '1', 'tokens and words combine');
assert.equal(shown({ q: '#3' }), '3');
let onClick, closed = 0;
const trigger = {}, menuItem = {}, outside = {};
Object.assign(context, {
  document: { addEventListener: (_type, handler) => { onClick = handler; } },
  ctxEl: { contains: target => target === menuItem, _owner: { contains: target => target === trigger } },
  hideCtxMenu: () => { closed++; },
});
const outsideClick = source.match(/^  document\.addEventListener\('click', e => .*hideCtxMenu\(\).*$/m);
assert.ok(outsideClick, 'Context menu handles outside clicks');
vm.runInContext(outsideClick[0], context);
onClick({ target: trigger });
onClick({ target: menuItem });
assert.equal(closed, 0, 'Opening or interacting with the dropdown must keep it available');
onClick({ target: outside });
assert.equal(closed, 1, 'Clicking outside dismisses the dropdown');
console.log('Pull requests page filter checks passed');
