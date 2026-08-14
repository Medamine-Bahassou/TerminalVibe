const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // External links
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // Clipboard
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read-text'),

  // Local file path resolution (replaces Tauri asset://)
  resolveLocalPath: (p) => ipcRenderer.invoke('file:resolve', p),

  // Native PTY (node-pty runs in the main process)
  terminalCreate: (o) => ipcRenderer.invoke('terminal:create', o),
  terminalResize: (o) => ipcRenderer.send('terminal:resize', o),
  terminalWrite: (o) => ipcRenderer.send('terminal:write', o),
  terminalClose: (id) => ipcRenderer.send('terminal:close', id),
  terminalDetach: (o) => ipcRenderer.invoke('terminal:detach', o),
  onTerminalDetachedClosed: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('terminal:detached-closed', l);
    return () => ipcRenderer.removeListener('terminal:detached-closed', l);
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
  browserResize: (id, rect) => ipcRenderer.send('browser:resize', id, rect),
  browserShow: (id) => ipcRenderer.send('browser:show', id),
  browserHide: (id) => ipcRenderer.send('browser:hide', id),
  browserNavigate: (id, url) => ipcRenderer.send('browser:navigate', id, url),
  browserBack: (id) => ipcRenderer.send('browser:back', id),
  browserForward: (id) => ipcRenderer.send('browser:forward', id),
  browserReload: (id) => ipcRenderer.send('browser:reload', id),
  browserZoom: (id, level) => ipcRenderer.send('browser:zoom', id, level),
  browserDestroy: (id) => ipcRenderer.send('browser:destroy', id),
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

  // Config directory (~/.terminalvibe/)
  configGetPath: () => ipcRenderer.invoke('config:getPath'),
  configReadState: () => ipcRenderer.invoke('config:readState'),
  configWriteState: (state) => ipcRenderer.invoke('config:writeState', state),
  configReadCustomThemes: () => ipcRenderer.invoke('config:readCustomThemes'),
  configWriteCustomThemes: (themes) => ipcRenderer.invoke('config:writeCustomThemes', themes),
  configReadThemeFile: (name) => ipcRenderer.invoke('config:readThemeFile', name),
  configWriteThemeFile: (name, theme) => ipcRenderer.invoke('config:writeThemeFile', name, theme),
  configDeleteThemeFile: (name) => ipcRenderer.invoke('config:deleteThemeFile', name),
  configListThemeFiles: () => ipcRenderer.invoke('config:listThemeFiles'),
});
