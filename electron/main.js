const { app, BrowserWindow, WebContentsView, ipcMain, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');

// ── Helpers ──

const isDev = !app.isPackaged;
const devPort = 7769; // dev-mode app server port

// ── Window ──
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'TerminalVibe',
    width: 1200,
    height: 684,
    minWidth: 600,
    minHeight: 400,
    resizable: true,
    fullscreenable: true,
    titleBarStyle: 'hidden', // native OS tweak buttons drawn by the OS via overlay
    titleBarOverlay: {
      color: '#00000000', // fully transparent so the app's own bg shows behind the buttons
      symbolColor: '#cdd6f4', // light icon color on dark bar
      height: 32,
    },
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true, // browser tabs render in native <webview>
    },
  });

  if (isDev) {
    mainWindow.loadURL(`http://127.0.0.1:${devPort}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // F12 / Ctrl+Shift+I → toggle DevTools (default menu is hidden by titleBarStyle)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' ||
        input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => { destroyAllBrowserViews(); mainWindow = null; });
}

// ── IPC: external links ──
ipcMain.handle('shell:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// ── IPC: clipboard (terminal text; navigator.clipboard also works) ──
ipcMain.handle('clipboard:write-text', (_e, text) => clipboard.writeText(String(text ?? '')));
ipcMain.handle('clipboard:read-text', () => clipboard.readText());

// ── IPC: local files (was asset:// in Tauri) ──
ipcMain.handle('file:resolve', (_e, p) => {
  try {
    const resolved = path.resolve(p);
    return fs.existsSync(resolved) ? resolved : null;
  } catch { return null; }
});

// ── IPC: native PTY (node-pty runs here in the main process) ──
const ptys = new Map();
const sendToRenderer = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

ipcMain.handle('terminal:create', (_e, { id, cols, rows, cwd }) => {
  try {
    if (ptys.has(id)) { try { ptys.get(id).kill(); } catch {} }
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');
    const t = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || undefined,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    ptys.set(id, t);
    t.onData((data) => sendToRenderer('terminal:data', { id, data }));
    t.onExit(({ exitCode }) => {
      ptys.delete(id);
      sendToRenderer('terminal:exit', { id, code: exitCode });
    });
    return true;
  } catch (err) {
    console.error('[pty] create failed:', err);
    return false;
  }
});
ipcMain.on('terminal:resize', (_e, { id, cols, rows }) => {
  const t = ptys.get(id);
  if (t) { try { t.resize(cols, rows); } catch {} }
});
ipcMain.on('terminal:write', (_e, { id, data }) => {
  const t = ptys.get(id);
  if (!t) return;
  try { t.write(Buffer.isBuffer(data) ? data : Buffer.from(data || [])); } catch {}
});
ipcMain.on('terminal:close', (_e, id) => {
  const t = ptys.get(id);
  if (t) { try { t.kill(); } catch {} ptys.delete(id); }
});
ipcMain.on('terminal:kill-all', () => {
  for (const t of ptys.values()) { try { t.kill(); } catch {} }
  ptys.clear();
});

// ── IPC: native browser tab views (WebContentsView) ──
// <webview> guests hard-lock at 150px height in this Electron build; a native
// WebContentsView is owned here in main, placed by renderer-reported bounds.
const bviews = new Map(); // id -> WebContentsView
const bviewOwner = new WeakMap(); // guest webContents -> id

function destroyAllBrowserViews() {
  for (const [id, view] of bviews) {
    try { mainWindow.contentView.removeChildView(view); } catch {}
    try { view.webContents.close(); } catch {}
    bviews.delete(id);
  }
}

ipcMain.on('browser:create', (_e, id, url) => {
  if (bviews.has(id)) return;
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  view.setBackgroundColor('#ffffff');
  bviews.set(id, view);
  bviewOwner.set(view.webContents, id);
  const gc = view.webContents;
  const sendEvent = (evt, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('browser:event', { id, evt, ...data });
  };
  gc.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\//i.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  gc.on('did-start-loading', () => sendEvent('did-start-loading'));
  gc.on('did-stop-loading', () => sendEvent('did-stop-loading'));
  gc.on('did-navigate', (_, u) => sendEvent('did-navigate', { url: u }));
  gc.on('did-navigate-in-page', (_, u) => sendEvent('did-navigate-in-page', { url: u }));
  gc.on('did-fail-load', (_e2, code, desc, u) => sendEvent('did-fail-load', { code, desc, url: u }));
  gc.on('page-title-updated', (_e2, title) => sendEvent('page-title-updated', { title }));
  if (url) gc.loadURL(url);
});
ipcMain.on('browser:resize', (_e, id, rect) => {
  const view = bviews.get(id);
  if (view && rect) view.setBounds({ x: rect.x || 0, y: rect.y || 0, width: rect.width || 0, height: rect.height || 0 });
});
ipcMain.on('browser:show', (_e, id) => {
  const view = bviews.get(id);
  if (view) { try { mainWindow.contentView.addChildView(view); } catch {} }
});
ipcMain.on('browser:hide', (_e, id) => {
  const view = bviews.get(id);
  if (view) { try { mainWindow.contentView.removeChildView(view); } catch {} }
});
ipcMain.on('browser:navigate', (_e, id, url) => {
  const view = bviews.get(id);
  if (view && url) view.webContents.loadURL(url);
});
ipcMain.on('browser:back', (_e, id) => { const v = bviews.get(id); if (v && v.webContents.canGoBack()) v.webContents.goBack(); });
ipcMain.on('browser:forward', (_e, id) => { const v = bviews.get(id); if (v && v.webContents.canGoForward()) v.webContents.goForward(); });
ipcMain.on('browser:reload', (_e, id) => { const v = bviews.get(id); if (v) v.webContents.reload(); });
ipcMain.on('browser:zoom', (_e, id, level) => { const v = bviews.get(id); if (v) v.webContents.setZoomLevel(level); });
ipcMain.on('browser:destroy', (_e, id) => {
  const view = bviews.get(id);
  if (view) {
    try { mainWindow.contentView.removeChildView(view); } catch {}
    try { view.webContents.close(); } catch {}
    bviews.delete(id);
  }
});

// ── App lifecycle ──
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  ipcMain.emit('terminal:kill-all');
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => ipcMain.emit('terminal:kill-all'));
process.on('exit', () => ipcMain.emit('terminal:kill-all'));
