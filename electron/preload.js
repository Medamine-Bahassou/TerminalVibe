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
});
