const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
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
      color: '#1e1e2e', // match app theme bg
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

  mainWindow.on('closed', () => { mainWindow = null; });
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
