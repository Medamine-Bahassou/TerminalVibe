const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { parseClaude, parseCodex, parseAcp, toolOutput } = require('../electron/threads');
const result = parseClaude([
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'cmd1', name: 'Bash', input: { command: 'npm test' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'cmd1', content: [{ type: 'text', text: 'tests passed' }] }] } },
]);
assert.equal(result[0].output, 'tests passed');
const codex = parseCodex([
  { type: 'response_item', payload: { type: 'function_call', call_id: 'cmd1', name: 'exec_command', arguments: '{"cmd":"npm test"}' } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'cmd1', output: '{"output":"tests failed","metadata":{"exit_code":1}}' } },
]).items[0];
assert.equal(codex.output, 'tests failed'); assert.equal(codex.error, true);
const event = parseCodex([{ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: ['echo', 'hi'], aggregated_output: 'hi\n', exit_code: 0 } } }]).items[0];
assert.equal(event.output, 'hi\n');
assert.equal(parseAcp([{ role: 'tool', name: 'terminal', output: 'done' }])[0].output, 'done');
assert.equal(toolOutput({ stdout: 'hello', stderr: 'warning' }), 'hello\nwarning');
assert.equal(toolOutput([{ type: 'content', content: { type: 'text', text: 'ACP output' } }]), 'ACP output');
assert(toolOutput('x'.repeat(65000)).endsWith('… output truncated'));
if (!process.versions.electron) {
  const r = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  process.exit(r.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..');
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false }); await win.loadURL('about:blank');
  for (const file of ['style.css', 'workspace.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(root, file), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const helper = source.slice(source.indexOf('  function toolDetailsHtml('), source.indexOf('  async function refreshThreadFlow('));
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const escHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const hlCode = escHtml, toolImageHtml = () => '';
    ${helper}
    document.body.innerHTML = '<div id="sbr-thread"><details open><summary>Shell</summary>' + toolDetailsHtml({ name: 'shell', detail: 'echo hi', output: '<script>bad</script>\\n' + 'output\\n'.repeat(100) }) + '</details></div>';
    const output = document.querySelector('.thr-tool-output'), command = document.querySelector('.thr-tool-detail');
    check(output && command.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING, 'Output must follow the command');
    check(output.clientHeight === 180 && output.scrollHeight > output.clientHeight, 'Output must have a fixed height and scroll');
    check(getComputedStyle(output).overflowY === 'auto', 'Output must scroll vertically');
    check(getComputedStyle(command).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(output).backgroundColor === 'rgba(0, 0, 0, 0)', 'Expanded content must have no background fill');
    check(!document.querySelector('script') && output.textContent.includes('<script>'), 'Output must render as escaped text');
    check(toolDetailsHtml({ name: 'Bash', detail: 'true', output: '' }).includes('No output'), 'Empty completed results must be explicit');
    check(!toolDetailsHtml({ name: 'shell', detail: 'sleep 5' }).includes('thr-tool-output'), 'Pending calls must not invent a result');
    return 'PASS: command results retained, escaped, placed below commands, fixed-height scrolling and transparent expanded content';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
