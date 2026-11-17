const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const tab = { chat: {} }, other = { chat: {} };
let current = tab, saved = 0;
const input = {
  value: '', selectionStart: 0, selectionEnd: 0, focus() {},
  setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.selectionStart = this.selectionEnd = start + text.length; },
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
};
const context = vm.createContext({
  curChat: () => current, _chatFiles: [], thrInput: input,
  threadPart: () => null, thrPage: {},
  localPathForFile: async () => '/tmp/paste-' + ++saved + '.png',
  FileReader: class { readAsDataURL(file) { Promise.resolve().then(() => { this.result = file.preview; this.onload(); }); } },
  renderChatFiles() {}, autosizeThreadInput() {}, saveState() {}, zoomBadge: message => { throw Error(message); },
  window: { electronAPI: { readImageFile: async () => ({ data: 'YWJj' }) } },
});
vm.runInContext(source.slice(source.indexOf('  function insertChatMention('), source.indexOf('  const THREAD_DRAG =')), context);
vm.runInContext(source.slice(source.indexOf('  const _chatFileAdds ='), source.indexOf("  thrFiles?.addEventListener('click'")), context);
const file = { name: 'image.png', type: 'image/png', size: 3, preview: 'data:image/png;base64,YWJj' };
(async () => {
  await Promise.all([context.addChatFiles([file]), context.addChatFiles([file]), context.addChatFiles([file])]);
  assert.equal(context._chatFiles.length, 1, 'rapid repeated pastes produce one attachment');
  assert.equal((input.value.match(/\[Image /g) || []).length, 1, 'existing link is not repeated');
  input.value = ''; input.setSelectionRange(0, 0);
  await context.addChatFiles([file]);
  assert.equal(context._chatFiles.length, 1, 'repaste after deleting the inline link reuses its preview');
  assert(input.value.includes(context._chatFiles[0].mention), 'missing inline link is restored');
  await context.addChatFiles([{ ...file, preview: 'data:image/png;base64,ZGVm' }]);
  assert.equal(context._chatFiles.length, 2, 'different image bytes with the same filename remain distinct');
  context._chatFiles = [{ image: true, path: '/restored.png', name: 'image.png', mention: '[Image 1]' }];
  input.value = '[Image 1]'; input.setSelectionRange(9, 9);
  await context.addChatFiles([file]);
  assert.equal(context._chatFiles.length, 1, 'restored attachments deduplicate before thumbnail hydration');
  context._chatFiles = []; input.value = ''; input.setSelectionRange(0, 0);
  await context.addChatFiles([file]);
  assert.equal(context._chatFiles.length, 1, 'removing the preview permits a fresh attachment');
  current = other; context._chatFiles = []; input.value = ''; input.setSelectionRange(0, 0);
  await context.addChatFiles([file]);
  assert.equal(context._chatFiles.length, 1, 'deduplication stays local to each draft');
  context._chatFiles = []; input.value = ''; input.setSelectionRange(0, 0);
  context.localPathForFile = async () => '/tmp/report.pdf';
  await context.addChatFiles([{ name: 'report.pdf', type: 'application/pdf', size: 42 }]);
  assert.equal(context._chatFiles[0].mention, '[File 1]', 'Picked documents must insert an inline file mention');
  assert(input.value.includes('[File 1]'));
  await context.addChatFiles([{ name: 'report.pdf', type: 'application/pdf', size: 42 }]);
  assert.equal(context._chatFiles.length, 1, 'Repeated document paths must not duplicate attachments');
  console.log('Chat image deduplication checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
