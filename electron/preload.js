const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  listRunningServers: () => ipcRenderer.invoke('servers:list'),
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

  // Native PTY (node-pty runs in the main process)
  terminalCreate: (o) => ipcRenderer.invoke('terminal:create', o),
  terminalResize: (o) => ipcRenderer.send('terminal:resize', o),
  terminalWrite: (o) => ipcRenderer.send('terminal:write', o),
  terminalClose: (id) => ipcRenderer.send('terminal:close', id),
  terminalHasRunningProcess: (id) => ipcRenderer.invoke('terminal:hasRunningProcess', id),
  claudeSessions: (cwd) => ipcRenderer.invoke('history:claude-sessions', cwd),
  attachSessionContext: (id, sessionId) => ipcRenderer.invoke('terminal:session-context', id, sessionId),
  terminalDetach: (o) => ipcRenderer.invoke('terminal:detach', o),
  terminalAttached: (id) => ipcRenderer.send('terminal:attached', id),
  attachWindow: (o) => ipcRenderer.send('terminal:attach-window', o),
  onTerminalReattachLayout: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:reattach-layout', l);
    return () => ipcRenderer.removeListener('terminal:reattach-layout', l);
  },
  onTerminalDetachedClosed: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:detached-closed', l);
    return () => ipcRenderer.removeListener('terminal:detached-closed', l);
  },
  // Drag a detached window's tab back into the main window (re-attach)
  tabDragStart: (o) => ipcRenderer.send('tab-drag:start', o),
  tabDragEnd: (o) => ipcRenderer.send('tab-drag:end', o),
  tabDragDrop: (o) => ipcRenderer.send('tab-drag:drop', o),
  tabDragHover: (o) => ipcRenderer.send('tab-drag:hover', o),
  tabDragReady: (o) => ipcRenderer.send('tab-drag:ready', o),
  onTerminalReattach: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:reattach', l);
    return () => ipcRenderer.removeListener('terminal:reattach', l);
  },
  onTabDragOver: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('tab-drag:over', l);
    return () => ipcRenderer.removeListener('tab-drag:over', l);
  },
  onTabDragActive: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('tab-drag:active', l);
    return () => ipcRenderer.removeListener('tab-drag:active', l);
  },
  onTabDragComplete: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('tab-drag:complete', l);
    return () => ipcRenderer.removeListener('tab-drag:complete', l);
  },
  onTerminalData: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:data', l);
    return () => ipcRenderer.removeListener('terminal:data', l);
  },
  onTerminalExit: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:exit', l);
    return () => ipcRenderer.removeListener('terminal:exit', l);
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
  onBrowserKey: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('browser:key', l);
    return () => ipcRenderer.removeListener('browser:key', l);
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

  // Plugins (~/.terminalvibe/plugins/<id>/)
  configListPlugins: () => ipcRenderer.invoke('config:listPlugins'),
  configReadPluginFile: (id, relPath) => ipcRenderer.invoke('config:readPluginFile', id, relPath),
  configOpenPluginFolder: (id) => ipcRenderer.invoke('config:openPluginFolder', id),
  configOpenPluginsDir: () => ipcRenderer.invoke('config:openPluginsDir'),

  // Images stored as files in ~/.terminalvibe/images/ (backgrounds, icons)
  configWriteImages: (images) => ipcRenderer.invoke('config:writeImages', images),
  configReadImage: (id) => ipcRenderer.invoke('config:readImage', id),
});
