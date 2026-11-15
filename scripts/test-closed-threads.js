const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const functions = source.slice(source.indexOf('  function openChatTab('), source.indexOf('  // The titlebar chat button:'));
const remove = source.slice(source.indexOf('  function removeTerminal('), source.indexOf('  function applyTabColor('));
let saved, disposed = 0, next = 0;
const ws = { id: 'workspace', label: 'Project', cwd: '/tmp/project', layout: { id: 'group', terminals: [], activeTermId: 'original' }, activeTermId: 'original' };
const original = { id: 'original', label: 'My thread', cwd: ws.cwd, threadHistory: true,
  chat: { title: 'My thread', segments: [{ harness: 'claude', sessionId: 'session' }] }, term: { dispose() { disposed++; } } };
ws.layout.terminals.push(original);
const context = vm.createContext({
  closedThreads: [], workspaces: [ws], activeWsId: ws.id, _profileSwitching: false,
  _multiSelected: new Set(), _curChat: original, _preferChat: null,
  _chatFiles: [{ name: 'draft.png', preview: 'data:image/png;base64,large' }], thrInput: { value: 'unsent draft' },
  curChat: () => context._curChat,
  rememberThreadScroll: tab => { tab._scrollState = { top: 120, bottom: false }; },
  restoreThreadScroll() {}, autosizeThreadInput() {}, renderChatFiles() {}, renderThreadsSidebar() {},
  syncThreadPanel() { context._curChat = context._preferChat; },
  findWs: id => context.workspaces.find(w => w.id === id), activeWs: () => context.workspaces[0],
  wsOf: tab => context.workspaces.find(w => w.layout.terminals.includes(tab)),
  findTermById: id => { const term = ws.layout.terminals.find(t => t.id === id); return term && { ws, term }; },
  getWorkspaceTerminals: w => w.layout.terminals,
  threadSegments: tab => tab.chat?.segments || [],
  findGroupContainingTerm: (layout, id) => layout.terminals.some(t => t.id === id) ? layout : null,
  countGroups: () => 1, removeEmptyGroups: layout => layout,
  sendControl() {}, _disposeTermRenderers() {}, renderSidebar() {}, pluginEmit() {},
  activateTerminal: (_, id) => { ws.activeTermId = ws.layout.activeTermId = id; },
  activateWorkspace: () => { throw Error('Unexpected workspace switch'); },
  addTerminal: (wsId, groupId, opts) => {
    const tab = { id: 'reopened-' + ++next, label: opts.label, cwd: opts.cwd, threadHistory: opts.threadHistory, term: {} };
    ws.layout.terminals.push(tab); return tab;
  },
  saveState: () => { saved = JSON.stringify(context.closedThreads.map(({ _files, _flowHtml, _open, ...record }) => record)); },
});
vm.runInContext(functions + remove, context);
vm.runInContext(source.split('\n').find(line => line.trim().startsWith('const chatThreads =')) + '\nthis.chatThreads = chatThreads;', context);
// Exercise the actual close/dispose path, including workspace-teardown closes.
context.removeTerminal(ws.id, original.id, true, false, true, true);
assert.equal(disposed, 1);
assert.equal(ws.layout.terminals.length, 0);
assert.equal(context.closedThreads.length, 1, 'closing a tab must retain its sidebar record');
assert.equal(context.closedThreads[0].chat.storeId, 'original');
assert.equal(context.closedThreads[0]._draft, 'unsent draft');
assert.equal(context.findChatThread('original'), context.closedThreads[0]);
assert.equal(context.chatThreads()[0].id, 'original', 'closed threads must remain in the actual sidebar source');
assert(!saved.includes('data:image'), 'persist metadata, not attachment preview bytes');
// Use the real restore expression to simulate a fresh app instance.
context.state = { closedThreads: JSON.parse(saved) };
const restore = source.split('\n').find(line => line.trim().startsWith('closedThreads = Array.isArray(state.closedThreads)'));
vm.runInContext(restore, context);
context._curChat = null;
context.openChatTab(context.findChatThread('original'));
assert.equal(context.closedThreads.length, 0, 'reopening should not duplicate the sidebar thread');
const reopened = ws.layout.terminals[0];
assert.equal(reopened.chat.storeId, 'original', 'reopened tabs use the existing history folder');
assert.equal(reopened.chat.segments[0].sessionId, 'session');
assert.equal(context.thrInput.value, 'unsent draft');
assert.equal(reopened._scrollState.top, 120);
assert.equal(context.chatThreads().length, 1, 'sidebar must contain one reopened thread');
// Repeated close/reopen cycles retain one record with a stable history identity.
context.removeTerminal(ws.id, reopened.id, true, false, true, true);
assert.equal(context.closedThreads.length, 1);
assert.equal(context.closedThreads[0].chat.storeId, 'original');
// Profile switches and detached terminals must not archive chats into another profile/window.
context._profileSwitching = true;
context.rememberClosedThread({ ...original, id: 'other', chat: {} }, ws);
assert.equal(context.closedThreads.length, 1);
console.log('PASS: closed chat tabs retain sidebar records, restart safely, reopen existing history and drafts, and avoid duplicates.');
