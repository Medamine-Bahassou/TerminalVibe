const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

let spellingTarget;
function chatSpellingAt(x, y, keyboard) {
  spellingTarget = undefined;
  const editor = document.getElementById('sbr-thread-input-links');
  const selection = window.getSelection();
  const caret = keyboard ? (selection.rangeCount ? selection.getRangeAt(0) : null) : document.caretRangeFromPoint(x, y);
  const node = caret?.startContainer;
  if (!editor?.isContentEditable || !node || node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return null;
  if (node.parentElement.closest('[contenteditable="false"], .md-code, .md-code-block, .md-url, .md-mark')) return null;
  for (const match of node.data.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
    const word = match[0], end = match.index + word.length;
    if (caret.startOffset < match.index || caret.startOffset > end || !webFrame.isWordMisspelled(word)) continue;
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, end);
    if (!keyboard && ![...range.getClientRects()].some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) continue;
    spellingTarget = { editor, range, word };
    return { word, suggestions: webFrame.getWordSuggestions(word) };
  }
  return null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  chatSpellingAt,
  replaceChatSpelling: replacement => {
    const target = spellingTarget;
    spellingTarget = undefined;
    if (!target?.editor.isContentEditable || !target.editor.contains(target.range.startContainer)
        || target.range.toString() !== target.word) return false;
    target.editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(target.range);
    return document.execCommand('insertText', false, replacement);
  },
  listSkills: () => ipcRenderer.invoke('skills:list'),
  setSkillEnabled: (id, enabled) => ipcRenderer.invoke('skills:set-enabled', id, enabled),
  listRunningServers: () => ipcRenderer.invoke('servers:list'),
  chatBgProcs: (id) => ipcRenderer.invoke('chat:bg-procs', id),
  chatBgStop: (id, pid) => ipcRenderer.invoke('chat:bg-stop', id, pid),
  killRunningServer: (pid, port) => ipcRenderer.invoke('servers:kill', { pid, port }),
  onAgentRequest: (cb) => {
    const listener = async (_event, request) => {
      try { ipcRenderer.send('agent:result', { id: request.id, result: await cb(request) }); }
      catch (err) { ipcRenderer.send('agent:result', { id: request.id, error: err.message }); }
    };
    ipcRenderer.on('agent:request', listener);
    return () => ipcRenderer.removeListener('agent:request', listener);
  },

  // External links
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  showInFolder: (file) => ipcRenderer.invoke('shell:show-in-folder', file),
  openInVSCode: (target) => ipcRenderer.invoke('shell:open-in-vscode', target),
  agentSettings: (id, harness) => ipcRenderer.invoke('terminal:agent-settings', id, harness),
  chatFiles: (cwd) => ipcRenderer.invoke('chat:files', cwd),
  chatCommands: (harness, cwd) => ipcRenderer.invoke('chat:commands', harness, cwd),

  // Clipboard
  popupContextMenu: (template) => ipcRenderer.invoke('context-menu:popup', template),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read-text'),
  clipboardPasteImage: () => ipcRenderer.invoke('clipboard:paste-image'),

  // Drag & drop: real disk path of a dropped File ('' when it has none,
  // e.g. an image dragged out of a web page), else save its bytes to temp.
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  saveTempFile: (name, bytes) => ipcRenderer.invoke('file:save-temp', name, bytes),

  // Local file path resolution
  resolveLocalPath: (p) => ipcRenderer.invoke('file:resolve', p),
  selectDirectory: (defaultPath) => ipcRenderer.invoke('dialog:openDirectory', defaultPath),
  listShells: () => ipcRenderer.invoke('shell:list'),
  setDefaultShell: (id) => ipcRenderer.send('shell:set-default', id),

  // Native PTY (node-pty runs in the main process)
  terminalCreate: (o) => ipcRenderer.invoke('terminal:create', o),
  terminalResize: (o) => ipcRenderer.send('terminal:resize', o),
  terminalWrite: (o) => ipcRenderer.send('terminal:write', o),
  terminalClose: (id) => ipcRenderer.send('terminal:close', id),
  terminalHasRunningProcess: (id, fresh) => ipcRenderer.invoke('terminal:hasRunningProcess', id, fresh),
  processAlive: (pid) => ipcRenderer.invoke('process:alive', pid),
  releaseAgentSession: (sessionId, tabId) => ipcRenderer.invoke('agent:release-session', sessionId, tabId),
  claudeImage: (query) => ipcRenderer.invoke('history:claude-image', query),
  claudePaste: (query) => ipcRenderer.invoke('history:claude-paste', query),
  readAttachmentPreview: file => ipcRenderer.invoke('fs:attachment-preview', file),
  readImageFile: (file, opts) => ipcRenderer.invoke('fs:read-image', file, opts),
  attachmentInfo: (file) => ipcRenderer.invoke('fs:attachment-info', file),
  codexImage: (query) => ipcRenderer.invoke('history:codex-image', query),
  threadAgents: (names) => ipcRenderer.invoke('threads:agents', names),
  usageLimits: (fresh) => ipcRenderer.invoke('usage:limits', !!fresh),
  providersStatus: (names) => ipcRenderer.invoke('providers:status', names),
  providersSave: (config) => ipcRenderer.invoke('providers:save', config),
  chatModels: () => ipcRenderer.invoke('chat:models'),
  saveThreadAttachment: (id, name, bytes) => ipcRenderer.invoke('threads:save-attachment', id, name, bytes),
  threadHistory: (query) => ipcRenderer.invoke('threads:history', query),
  threadHistoryPreview: (query) => ipcRenderer.invoke('threads:history-preview', query),
  threadHandoff: (query) => ipcRenderer.invoke('threads:handoff', query),
  threadFork: (query) => ipcRenderer.invoke('threads:fork', query),
  threadDelete: (id, scratchDir) => ipcRenderer.invoke('threads:delete', id, scratchDir),
  threadScratch: () => ipcRenderer.invoke('threads:scratch'),
  gitBranch: (cwd) => ipcRenderer.invoke('git:branch', cwd),
  faviconGet: (origin) => ipcRenderer.invoke('favicon:get', origin),
  projectIcon: (cwd) => ipcRenderer.invoke('project:icon', cwd),
  chatTitle: (harness, text, model) => ipcRenderer.invoke('chat:title', harness, text, model),
  gitBranches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
  gitPullRequests: (cwd) => ipcRenderer.invoke('git:pull-requests', cwd),
  githubAllPullRequests: (cwds, kind) => ipcRenderer.invoke('github:all-pull-requests', cwds, kind),
  githubLoginStart: () => ipcRenderer.invoke('github:login-start'),
  githubLoginWait: () => ipcRenderer.invoke('github:login-wait'),
  githubLoginCancel: () => ipcRenderer.invoke('github:login-cancel'),
  githubLoginOpen: () => ipcRenderer.invoke('github:login-open'),
  gitSnapshot: (cwd) => ipcRenderer.invoke('git:snapshot', cwd),
  gitTurnDiff: (cwd, from, to) => ipcRenderer.invoke('git:turn-diff', cwd, from, to),
  gitCheckout: (cwd, branch) => ipcRenderer.invoke('git:checkout', cwd, branch),
  attachSessionContext: (id, sessionId) => ipcRenderer.invoke('terminal:session-context', id, sessionId),
  attachWorkspaceContext: (id, context) => ipcRenderer.invoke('terminal:workspace-context', id, context),
  terminalAck: (id, n) => ipcRenderer.send('terminal:ack', { id, n }),
  onTerminalData: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:data', l);
    return () => ipcRenderer.removeListener('terminal:data', l);
  },
  // Chat tabs' structured agent sessions (electron/chat-sdk.js): Claude Code stream-json, Codex app-server.
  chatSdkStart: (key, opts) => ipcRenderer.invoke('chat-sdk:start', key, opts),
  chatSdkSend: (key, text, opts) => ipcRenderer.invoke('chat-sdk:send', key, text, opts),
  chatSdkInterrupt: (key) => ipcRenderer.invoke('chat-sdk:interrupt', key),
  chatSdkRespond: (key, id, answer) => ipcRenderer.invoke('chat-sdk:respond', key, id, answer),
  chatSdkSetAccess: (key, access) => ipcRenderer.invoke('chat-sdk:set-access', key, access),
  chatSdkStop: (key) => ipcRenderer.invoke('chat-sdk:stop', key),
  chatSdkModels: (harness, bin, cwd) => ipcRenderer.invoke('chat-sdk:models', harness, bin, cwd),
  chatSdkSkills: (harness, key, bin, cwd) => ipcRenderer.invoke('chat-sdk:skills', harness, key, bin, cwd),
  onChatSdkEvent: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('chat-sdk:event', l);
    return () => ipcRenderer.removeListener('chat-sdk:event', l);
  },
  // A command or an agent (Claude Code / Codex) response finished in a terminal.
  onTerminalFinished: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:finished', l);
    return () => ipcRenderer.removeListener('terminal:finished', l);
  },
  focusWindow: () => ipcRenderer.send('window:focus'),
  onTerminalExit: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:exit', l);
    return () => ipcRenderer.removeListener('terminal:exit', l);
  },
  // An agent CLI exited and its PTY was replaced by a shell under the same id.
  onTerminalAgentExit: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:agent-exit', l);
    return () => ipcRenderer.removeListener('terminal:agent-exit', l);
  },

  // Native WebContentsView browser tabs (owned in the main process)
  browserCreate: (id, url) => ipcRenderer.send('browser:create', id, url),
  browserRead: (id, options) => ipcRenderer.invoke('browser:read', id, options),
  browserResize: (id, rect) => ipcRenderer.send('browser:resize', id, rect),
  browserShow: (id) => ipcRenderer.send('browser:show', id),
  browserHide: (id) => ipcRenderer.send('browser:hide', id),
  browserNavigate: (id, url) => ipcRenderer.send('browser:navigate', id, url),
  browserBack: (id) => ipcRenderer.send('browser:back', id),
  browserForward: (id) => ipcRenderer.send('browser:forward', id),
  browserReload: (id) => ipcRenderer.send('browser:reload', id),
  browserZoom: (id, level) => ipcRenderer.send('browser:zoom', id, level),
  browserDestroy: (id) => ipcRenderer.send('browser:destroy', id),
  browserSetShortcuts: (list) => ipcRenderer.send('browser:shortcuts', list),
  browserDevTools: (pageId, open) => ipcRenderer.invoke('browser:devtools', pageId, open),
  browserDevToolsBounds: (pageId, rect) => ipcRenderer.send('browser:devtools-bounds', pageId, rect),
  onBrowserDevToolsToggle: (cb) => {
    const l = (_e, id) => cb(id);
    ipcRenderer.on('browser:devtools-toggle', l);
    return () => ipcRenderer.removeListener('browser:devtools-toggle', l);
  },
  onBrowserKey: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('browser:key', l);
    return () => ipcRenderer.removeListener('browser:key', l);
  },
  // A browser tab's page asked for its find bar (Ctrl+F or the right-click menu): the page's webContents id.
  onBrowserFind: (cb) => {
    const l = (_e, id) => cb(id);
    ipcRenderer.on('browser:find', l);
    return () => ipcRenderer.removeListener('browser:find', l);
  },
  // "Open link/image in new tab" from a page's right-click menu: { id (the page's webContents id), url }.
  onBrowserOpenTab: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('browser:open-tab', l);
    return () => ipcRenderer.removeListener('browser:open-tab', l);
  },
  onBrowserEvent: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('browser:event', l);
    return () => ipcRenderer.removeListener('browser:event', l);
  },

  // Settings window (separate BrowserWindow)
  settingsOpen: () => ipcRenderer.send('settings:open'),
  settingsClose: () => ipcRenderer.send('settings:close'),
  settingsChanged: () => ipcRenderer.send('settings:changed'),
  onSettingsChanged: (cb) => {
    const l = () => cb();
    ipcRenderer.on('settings:changed', l);
    return () => ipcRenderer.removeListener('settings:changed', l);
  },
  onSettingsWindowState: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('settings:window', l);
    return () => ipcRenderer.removeListener('settings:window', l);
  },

  // Quit confirmation (OS close button → renderer modal)
  onAppCloseRequest: (cb) => {
    const l = () => cb();
    ipcRenderer.on('app:confirm-close', l);
    return () => ipcRenderer.removeListener('app:confirm-close', l);
  },
  appCloseConfirmed: () => ipcRenderer.send('app:close-confirmed'),

  // Config directory (~/.terminalvibe/)
  configGetPath: () => ipcRenderer.invoke('config:getPath'),

  // Profiles
  profilesList: () => ipcRenderer.invoke('profiles:list'),
  profilesCreate: (o) => ipcRenderer.invoke('profiles:create', o),
  profilesUpdate: (o) => ipcRenderer.invoke('profiles:update', o),
  profilesDelete: (id) => ipcRenderer.invoke('profiles:delete', id),
  profilesSetDefault: (id) => ipcRenderer.invoke('profiles:setDefault', id),
  profilesSwitch: (id) => ipcRenderer.invoke('profiles:switch', id),
  profilesSwitchInPlace: (id) => ipcRenderer.invoke('profiles:switchInPlace', id),
  configReadState: () => ipcRenderer.invoke('config:readState'),
  configWriteState: (state) => ipcRenderer.invoke('config:writeState', state),
  configReadCustomThemes: () => ipcRenderer.invoke('config:readCustomThemes'),
  configWriteCustomThemes: (themes) => ipcRenderer.invoke('config:writeCustomThemes', themes),
  configReadThemeFile: (name) => ipcRenderer.invoke('config:readThemeFile', name),
  configWriteThemeFile: (name, theme) => ipcRenderer.invoke('config:writeThemeFile', name, theme),
  configDeleteThemeFile: (name) => ipcRenderer.invoke('config:deleteThemeFile', name),
  configListThemeFiles: () => ipcRenderer.invoke('config:listThemeFiles'),

  // Images stored as files in ~/.terminalvibe/images/ (backgrounds, icons)
  configWriteImages: (images) => ipcRenderer.invoke('config:writeImages', images),
  configReadImage: (id) => ipcRenderer.invoke('config:readImage', id),
});
