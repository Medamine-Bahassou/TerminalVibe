// Exercise the actual IPC handler with a child process that waits for stdin EOF, like the CLIs.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFile } = require('child_process');
const source = fs.readFileSync(path.join(__dirname, '..', 'electron/main.js'), 'utf8');
const start = source.indexOf("ipcMain.handle('chat:title'");
const end = source.indexOf('// Warm the transcript image indexes', start);
let handler, launched = [];
const context = vm.createContext({
  ipcMain: { handle: (_channel, fn) => { handler = fn; } },
  terminalEnv: () => process.env,
  fs: { readFileSync: () => { throw Error('No model cache'); } }, path,
  require: name => {
    if (name === './threads') return { detectAgents: names => Object.fromEntries(names.map(name => [name, name])) };
    if (name === 'os') return os;
    if (name === 'child_process') return { execFile: (bin, args, options, callback) => {
      launched.push({ bin, args });
      // Return a real piped child: it cannot print its title until the parent ends stdin.
      return execFile(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => console.log('Fix Thread Title Generation'));"],
        { ...options, timeout: 2000 }, callback);
    } };
    throw Error('Unexpected require: ' + name);
  },
});
vm.runInContext(source.slice(start, end), context);
(async () => {
  for (const harness of ['claude', 'codex']) {
    assert.equal(await handler(null, harness, 'Fix title regeneration in chat'), 'Fix Thread Title Generation', harness + ' waits for stdin EOF');
    const launch = launched.at(-1);
    assert.equal(launch.bin, harness);
    assert(launch.args.at(-1).includes('Fix title regeneration in chat'));
    if (harness === 'claude') assert.equal(launch.args[launch.args.indexOf('--output-format') + 1], 'text');
  }
  assert.equal(await handler(null, 'codex', ''), null);
  assert.equal(launched.length, 2, 'Empty input launched the CLI');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const titleStart = appSource.indexOf('  function autoTitleChat(');
  const titleEnd = appSource.indexOf("  // ── A turn's changed files", titleStart);
  const tab = { chat: { title: 'Old title' } }, calls = [];
  let saved = 0;
  const renderer = vm.createContext({
    window: { electronAPI: {
      threadHistory: async () => [{ items: [{ role: 'assistant', text: 'Reply' }, { role: 'user', text: 'Original prompt' }] }],
      chatTitle: async (harness, text) => { calls.push({ harness, text }); return 'Generated Title'; },
    } },
    threadSettings: { titles: 'off' }, chatOpts: () => ({ harness: 'codex' }),
    threadMeta: () => ({}), renderThreadsSidebar: () => {},
    setChatTabLabel: t => { t.label = t.chat.title; }, saveState: () => { saved++; },
    zoomBadge: message => { throw Error(message); },
  });
  vm.runInContext(appSource.slice(titleStart, titleEnd), renderer);
  await renderer.regenerateChatTitle(tab);
  assert.equal(tab.chat.title, 'Generated Title', 'Regenerated title did not reach the thread');
  assert.equal(tab.label, 'Generated Title', 'Tab label did not refresh');
  assert.equal(calls[0].text, 'Original prompt', 'Regenerate did not read the original prompt');
  assert.equal(calls[0].harness, 'codex');
  assert.equal(tab._titling, false, 'Loading state remained active');
  assert.equal(saved, 1, 'Regenerated title was not persisted');
  console.log('PASS: title CLI stdin EOF, plain text output, regeneration with auto-titles off, history, label, persistence and loading state');
})().catch(error => { console.error(error); process.exit(1); });
