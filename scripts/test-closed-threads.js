const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const functions = source.slice(source.indexOf('  function openChatTab('), source.indexOf('  // A chat\'s tab is named after its first prompt.'));
const move = source.slice(source.indexOf('  function moveTabToWorkspace('), source.indexOf('   S I*DEBAR RENDERING')).split('  /*')[0];
const threadState = source.slice(source.indexOf('  function threadHasMessages('), source.indexOf("  // A thread's id"));
const remove = source.slice(source.indexOf('  function removeTerminal('), source.indexOf('  function applyTabColor('));
let saved, disposed = 0, next = 0;
const ws = { id: 'workspace', label: 'Project', cwd: '/tmp/project', layout: { id: 'group', terminals: [], activeTermId: 'original' }, activeTermId: 'original' };
const original = { id: 'original', label: 'My thread', cwd: ws.cwd, threadHistory: true,
  chat: { title: 'My thread', segments: [{ harness: 'claude', sessionId: 'session' }] }, term: { dispose() { disposed++; } } };
ws.layout.terminals.push(original);
const context = vm.createContext({
  closedThreads: [], workspaces: [ws], activeWsId: ws.id, _profileSwitching: false,
  _multiSelected: new Set(), _pendingMsgs: new Map(), _curChat: original, _preferChat: null,
  _chatFiles: [{ name: 'draft.png', preview: 'data:image/png;base64,large' }], thrInput: { value: 'unsent draft' },
  curChat: () => context._curChat,
  rememberThreadScroll: tab => { tab._scrollState = { top: 120, bottom: false }; },
  restoreThreadScroll() {}, autosizeThreadInput() {}, renderChatFiles() {}, renderThreadsSidebar() {},
  syncThreadPanel() { context._curChat = context._preferChat; },
  findWs: id => context.workspaces.find(w => w.id === id), activeWs: () => context.findWs(context.activeWsId),
  wsOf: tab => context.workspaces.find(w => w.layout.terminals.includes(tab)),
  findTermById: id => {
    const ws = context.workspaces.find(w => w.layout.terminals.some(t => t.id === id));
    return ws && { ws, term: ws.layout.terminals.find(t => t.id === id) };
  },
  getWorkspaceTerminals: w => w.layout.terminals,
  threadSegments: tab => tab.chat?.segments || [],
  findGroupContainingTerm: (layout, id) => layout.terminals.some(t => t.id === id) ? layout : null,
  countGroups: () => 1, removeEmptyGroups: layout => layout,
  sendControl() {}, afterTabClosePaint(callback) { callback(); }, disposeChatBottomTerminal() {}, _disposeTermRenderers() {}, renderSidebar() {},
  activateTerminal: (wsId, id) => { const w = context.findWs(wsId); w.activeTermId = w.layout.activeTermId = id; },
  activateWorkspace: id => { context.activeWsId = id; },
  findFirstGroup: layout => layout, renderPaneArea() {}, syncBrowserSlots() {},
  _removeWorkspace: () => { throw Error('Dropping a thread must preserve its source workspace'); },
  addTerminal: (wsId, groupId, opts) => {
    const tab = { id: 'reopened-' + ++next, label: opts.label, cwd: opts.cwd, threadHistory: opts.threadHistory, term: {} };
    context.findWs(wsId).layout.terminals.push(tab); return tab;
  },
  saveState: () => { saved = JSON.stringify(context.closedThreads.map(({ _files, _flowHtml, _open, ...record }) => record)); },
});
vm.runInContext(functions + remove + move + threadState, context);
vm.runInContext('this.chatThreads = chatThreads;', context);
// Exercise the actual close/dispose path, including workspace-teardown closes.
context.removeTerminal(ws.id, original.id, true, false, true, true);
assert.equal(disposed, 1);
assert.equal(ws.layout.terminals.length, 0);
assert.equal(context.closedThreads.length, 1, 'closing a tab must retain its sidebar record');
assert.equal(context.closedThreads[0].chat.storeId, 'original');
assert.equal(context.closedThreads[0]._draft, 'unsent draft');
assert.equal(context.findChatThread('original'), context.closedThreads[0]);
assert.equal(context.chatThreads()[0].id, 'original', 'closed threads must remain in the actual sidebar source');
context.saveState();
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
// A drop targets the given workspace even when another one is active.
const target = { id: 'target', layout: { terminals: [] } };
context.workspaces.push(target);
context.openChatTab(context.closedThreads[0], target);
const dropped = target.layout.terminals[0];
assert.equal(context.activeWsId, target.id);
assert.equal(dropped.chat.storeId, 'original');
assert.equal(dropped._draft, 'unsent draft');
assert.equal(context.closedThreads.length, 0);
context.openChatTab(dropped, ws);
assert.equal(context.activeWsId, ws.id);
assert.equal(ws.layout.terminals[0], dropped, 'moving an open thread must reuse its live tab');
assert.equal(target.layout.terminals.length, 0);
assert.equal(context.findWs(target.id), target);
console.log('PASS: closed chat tabs retain sidebar records, restart safely, reopen existing history and drafts, and avoid duplicates.');
