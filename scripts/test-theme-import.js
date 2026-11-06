#!/usr/bin/env node
// Exercise the real import handler without launching terminals or touching user settings.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf("  document.getElementById('theme-import-input').addEventListener('change', async e => {");
const end = source.indexOf('  function refreshThemeDropdown()', start);
assert(start >= 0 && end > start);
let handler, applied, saved = {}, refreshes = 0;
const button = {}, status = { classList: { add() {}, remove() {} } };
const themes = { Graphite: { bg: '#000000' } };
const context = {
  document: { getElementById(id) {
    if (id === 'theme-import-input') return { addEventListener(type, callback) { handler = callback; } };
    return id === 'theme-gallery-import' ? button : status;
  } },
  THEMES: themes,
  getCustomThemes: async () => ({ ...saved }),
  saveCustomThemes: async value => { saved = value; Object.assign(themes, value); },
  applyTheme: name => { applied = name; }, saveState() {},
  refreshThemeDropdown: () => { refreshes++; },
};
vm.runInNewContext(source.slice(start, end), context);
const theme = { name: 'Ocean', bg: '#101820', fg: '#eef3ff', palette: Array(16).fill('#89b4fa'), ui: { accent: '#aabbcc' } };
const run = text => handler({ target: { files: [{ name: 'theme.json', text: async () => text }], value: 'theme.json' } });
(async () => {
  await run(JSON.stringify(theme));
  assert.equal(applied, 'Ocean');
  assert.equal(saved.Ocean.ui.accent, '#aabbcc');
  assert.equal(saved.Ocean.swatches.length, 3);
  assert.equal(refreshes, 1);
  await run(JSON.stringify(theme));
  assert.equal(applied, 'Ocean (2)');
  assert(saved.Ocean && saved['Ocean (2)']);
  await run(JSON.stringify({ ...theme, name: 'Graphite' }));
  assert.equal(applied, 'Graphite (2)');
  assert.equal(themes.Graphite.bg, '#000000');
  const selected = applied;
  await run('{broken');
  assert.match(status.textContent, /not valid JSON/);
  assert.equal(applied, selected);
  await run(JSON.stringify({ ...theme, palette: ['#000000'] }));
  assert.match(status.textContent, /16 palette colors/);
  assert.equal(applied, selected);
  await run(JSON.stringify({ ...theme, ui: { accent: 'not-a-color' } }));
  assert.match(status.textContent, /Invalid accent/);
  assert.equal(applied, selected);
  await run(JSON.stringify({ ...theme, name: '__proto__' }));
  assert.equal(applied, '__proto__ (2)');
  assert.equal(button.disabled, false);
  assert.equal(status.hidden, false);
  assert.equal(Object.getPrototypeOf(themes), Object.prototype);
  const carbon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes/carbon.json'), 'utf8'));
  await run(JSON.stringify(carbon));
  assert.equal(applied, 'Carbon');
  for (const key of ['sidebarBg', 'surfaceBg', 'hoverBg', 'activeBg']) {
    assert.equal(saved.Carbon.ui[key], carbon.ui[key], `Imported ${key} should retain the reference colors`);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(!html.includes('data-cat="theme-editor"'));
  assert(!html.includes('id="theme-gallery-create"'));
  console.log('PASS: direct theme import, persistence, selection, duplicate/built-in names, invalid JSON/colors, safe keys, and editor removal');
})().catch(error => { console.error(error); process.exitCode = 1; });
