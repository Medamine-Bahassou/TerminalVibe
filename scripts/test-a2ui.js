// A2UI renderer logic (a2ui.js) without a DOM: message parsing, JSON Pointer bindings, functions and formatString.
const assert = require('assert');
global.window = {};
require('../a2ui.js');
const { parse, _test: { interp, fmtDate, getP, setP, call } } = window.A2UI;

const create = { version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: 'hi' }] } };
assert.strictEqual(parse(JSON.stringify([create])).length, 1);
assert.strictEqual(parse(JSON.stringify(create)).length, 1, 'a single message');
assert.strictEqual(parse(`${JSON.stringify(create)}\n${JSON.stringify({ version: '1.0', deleteSurface: { surfaceId: 's' } })}`).length, 2, 'JSON lines');
assert.strictEqual(parse('[{"foo":1}]'), null, 'not A2UI');
const slips = parse('[{"version":"1.0","createSurface":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"a\n\tb \\"q\\"",},]}}]');
assert.strictEqual(slips?.[0].createSurface.components[0].text, 'a\n\tb "q"', 'raw line breaks in strings and trailing commas');
assert.strictEqual(parse('[{"version":"1.0","createSurface":'), null, 'incomplete');

const s = { model: { user: { name: 'Ada' }, items: [{ n: 'a' }, { n: 'b' }], 'a/b': 1 }, opts: {} };
const c = { s, base: '/items/1', index: 1 };
assert.strictEqual(getP(s.model, '/user/name'), 'Ada');
assert.strictEqual(getP(s.model, '/a~1b'), 1, 'escaped pointer');
setP(s, '/form/tags/0', 'x');
assert.deepStrictEqual(s.model.form, { tags: ['x'] }, 'creates arrays for numeric segments');
setP(s, '/form', undefined);
assert.ok(!('form' in s.model), 'undefined removes');

assert.strictEqual(interp('Hi ${/user/name}, item ${n} \\${x}', c), 'Hi Ada, item b ${x}');
assert.strictEqual(interp("${pluralize(value:${/items/length}, one:'item', other:'items')}", { s, base: '' }), 'items', 'nested call with a path arg');
assert.strictEqual(interp("${pluralize(value:2, one:'item', other:'items')}", c), 'items');
assert.strictEqual(interp('#${@index(offset:1)}', c), '#2');
assert.strictEqual(call({ '@call': 'formatString', args: { value: 'Dear ${/user/name}' } }, c), 'Dear Ada');
assert.strictEqual(call({ '@call': 'required', args: { value: { '@path': '/user/name' } } }, c), true);
assert.strictEqual(call({ '@call': 'required', args: { value: '' } }, c), false);
assert.strictEqual(call({ '@call': 'email', args: { value: 'a@b.co' } }, c), true);
assert.strictEqual(call({ '@call': 'and', args: { values: [true, { '@call': 'not', args: { value: false } }] } }, c), true);
assert.strictEqual(call({ '@call': 'length', args: { value: 'abc', min: 4 } }, c), false);
assert.strictEqual(call({ '@call': 'nope', args: {} }, c), undefined, 'unknown function');
assert.strictEqual(fmtDate('2026-01-16T14:30:00', "yyyy-MM-dd HH:mm 'at' h a"), '2026-01-16 14:30 at 2 PM');
assert.strictEqual(fmtDate('2026-01-05', 'd/M/yy'), '5/1/26', 'date-only strings are local dates');
// A submitted form reads as its answers: labels, option labels, Yes/No; without the surface, the action's context.
const comps = new Map([
  ['what', { id: 'what', component: 'ChoicePicker', label: 'What to chart', value: { '@path': '/what' }, options: [{ label: 'Revenue by segment', value: 'revenue' }] }],
  ['range', { id: 'range', component: 'ChoicePicker', label: 'Time range', value: { '@path': '/range' }, options: [{ label: '1 month', value: '1M' }] }],
  ['git', { id: 'git', component: 'CheckBox', label: 'Use git', value: { '@path': '/git' } }],
  ['go', { id: 'go', component: 'Button', child: 't' }]]);
const state = { surfaces: new Map([['q1', { id: 'q1', comps, model: {}, opts: {} }]]) };
const sent = '{"version":"1.0","action":{"name":"make_chart","surfaceId":"q1","sourceComponentId":"go","timestamp":"t","context":{"what":["revenue"]}}}\n'
  + '{"version":"1.0","surfaces":{"q1":{"what":["revenue"],"range":["1M"],"git":true}}}';
assert.deepStrictEqual(window.A2UI.answer(state, sent).rows, [['What to chart', 'Revenue by segment'], ['Time range', '1 month'], ['Use git', 'Yes']]);
assert.deepStrictEqual(window.A2UI.answer(null, sent.split('\n')[0]).rows, [['what', 'revenue']], 'no surface: the context');
assert.strictEqual(window.A2UI.answer(null, 'not json'), null);
console.log('a2ui: ok');
