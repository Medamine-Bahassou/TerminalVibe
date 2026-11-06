// Paste routing regressions without reading or modifying the system clipboard.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const helper = source.slice(source.indexOf('  async function doPaste('), source.indexOf('  // A real text field'));
let processName = 'claude', data, text, imageReads, textReads;
let imagePath = '/tmp/clipboard.png';
const entry = { id: 'pane-one', term: { paste(value) { text.push(value); } } };
const api = {
  platform: 'linux',
  clipboardPasteImage: async () => { imageReads++; return imagePath; },
  clipboardRead: async () => { textReads++; return 'clipboard text'; },
};
const context = vm.createContext({ window: { electronAPI: api }, navigator: { clipboard: { readText: async () => 'web text' } },
  findTermById: id => id === entry.id ? { term: entry } : null,
  isDesktop: () => true, checkTerminalRunning: async () => processName, TextEncoder, Uint8Array,
  sendStdin: (id, bytes) => data.push({ id, bytes: [...bytes] }), shellQuote: p => `'${p}'`, console });
vm.runInContext(helper, context);
const paste = vm.runInContext('doPaste', context);
const reset = () => { data = []; text = []; imageReads = 0; textReads = 0; entry.locked = false; entry.dead = false; };
(async () => {
  reset(); await paste(entry);
  assert.deepEqual(data, [{ id: entry.id, bytes: [22] }], 'Claude receives native Ctrl+V, never a pasted control character');
  assert.equal(textReads, 0, 'Text accompanying image must not override image paste');
  assert.deepEqual(text, [], 'Image attachment must not also paste path or text');
  reset(); api.platform = 'win32'; await paste(entry);
  assert.deepEqual(data[0].bytes, [27, 118], 'Windows Claude uses Alt+V');
  api.platform = 'linux';
  reset(); processName = null; await paste(entry);
  assert.deepEqual(text, ["'/tmp/clipboard.png'"], 'Ordinary shells keep image path paste');
  assert.equal(data.length, 0);
  reset(); imagePath = null; await paste(entry);
  assert.deepEqual(text, ['clipboard text']);
  assert.equal(textReads, 1);
  reset(); const nativeRead = api.clipboardPasteImage;
  api.clipboardPasteImage = async () => { throw Error('Clipboard image unavailable'); };
  await paste(entry); assert.deepEqual(text, ['clipboard text'], 'Image failure must not block text');
  api.clipboardPasteImage = nativeRead;
  reset(); entry.locked = true; await paste(entry); assert.equal(imageReads, 0);
  reset(); imagePath = '/tmp/clipboard.png'; processName = 'claude';
  let finish; api.clipboardPasteImage = () => new Promise(resolve => { finish = resolve; });
  const pending = paste(entry); entry.locked = true; finish(imagePath); await pending;
  assert.equal(data.length, 0); assert.equal(text.length, 0, 'Do not paste after target becomes locked');
  api.clipboardPasteImage = nativeRead;
  reset(); await paste({ ...entry, type: 'browser' }); assert.equal(imageReads, 0);
  reset(); imagePath = null;
  await paste(entry, { getData: () => 'event text' });
  assert.deepEqual(text, ['event text'], 'Native events use their text payload');
  assert.equal(textReads, 0);
  // Exercise the backend snapshot writer with image bytes, using a fake clipboard.
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron/main.js'), 'utf8');
  const start = main.indexOf("ipcMain.handle('clipboard:paste-image'");
  const end = main.indexOf('// ── IPC: local files', start);
  let snapshot;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
  new Function('ipcMain', 'clipboard', 'path', 'fs', 'require', main.slice(start, end))(
    { handle: (_, fn) => { snapshot = fn; } }, { readImage: () => ({ isEmpty: () => false, toPNG: () => png }) }, path, fs, require);
  const file = snapshot();
  try { assert.deepEqual(fs.readFileSync(file), png); } finally { fs.unlinkSync(file); }
  console.log('PASS: image-first clipboard routing, Claude native shortcuts, shell paths, text/event fallback, locked targets, browser isolation and PNG snapshot');
})().catch(error => { console.error(error); process.exitCode = 1; });
