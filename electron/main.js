const { app, BrowserWindow, WebContentsView, ipcMain, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');

// ── Helpers ──

const isDev = !app.isPackaged;
const devPort = 7769; // dev-mode app server port

// ── Config directory (~/.terminalvibe/) ──
const CONFIG_DIR = path.join(require('os').homedir(), '.terminalvibe');
const CONFIG_THEMES_DIR = path.join(CONFIG_DIR, 'themes');
const CONFIG_STATE_FILE = path.join(CONFIG_DIR, 'state.json');
const CONFIG_CUSTOM_THEMES_FILE = path.join(CONFIG_DIR, 'custom-themes.json');

function ensureConfigDir() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_THEMES_DIR)) fs.mkdirSync(CONFIG_THEMES_DIR, { recursive: true });
  } catch (err) {
    console.error('[config] failed to create config dir:', err);
  }
}

function readConfigFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

function writeConfigFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[config] write failed:', filePath, err);
    return false;
  }
}

// ── Window ──
let mainWindow = null;
let settingsWindow = null;

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

  // Strip X-Frame-Options and CSP frame-ancestors so <webview> guests can
  // load sites like YouTube that block embedding by default.
  const { session } = require('electron');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders;
    if (headers['x-frame-options']) delete headers['x-frame-options'];
    if (headers['X-Frame-Options']) delete headers['X-Frame-Options'];
    if (headers['content-security-policy']) {
      headers['content-security-policy'] = headers['content-security-policy']
        .map(v => v.replace(/frame-ancestors[^;]*;?\s*/gi, ''))
        .filter(v => v.trim());
      if (!headers['content-security-policy'].length) delete headers['content-security-policy'];
    }
    callback({ responseHeaders: headers });
  });

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

// ── Settings window ──
// Native WebContentsViews always paint above the window's DOM, so the settings
// page can never cover them in the same window. It lives in its own child
// BrowserWindow, which the OS composites above the parent (and its webviews).
let _settingsBoundsSync = null;

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }

  const bounds = mainWindow.getContentBounds();
  settingsWindow = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    alwaysOnTop: true,
    frame: false, // frameless → fully covers the parent (no OS titlebar eating space)
    title: 'Settings',
    width: Math.max(bounds.width, 500),
    height: Math.max(bounds.height, 400),
    minWidth: 500,
    minHeight: 400,
    resizable: true,
    show: false,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    settingsWindow.loadURL(`http://127.0.0.1:${devPort}/?mode=settings`);
  } else {
    settingsWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { mode: 'settings' } });
  }

  settingsWindow.once('ready-to-show', () => {
    try { settingsWindow.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    settingsWindow.setBounds(mainWindow.getContentBounds());
    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.moveTop();
    // Belt-and-suspenders: tell the main window to detach its native views so
    // they can never paint above the settings window on any compositor.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:window', { open: true });
  });

  // Keep the settings window covering the main window as it moves / resizes
  const syncBounds = () => {
    if (!settingsWindow || settingsWindow.isDestroyed()) return;
    settingsWindow.setBounds(mainWindow.getContentBounds());
  };
  _settingsBoundsSync = syncBounds;
  mainWindow.on('resize', syncBounds);
  mainWindow.on('move', syncBounds);

  settingsWindow.on('closed', () => {
    if (_settingsBoundsSync) {
      mainWindow.removeListener('resize', _settingsBoundsSync);
      mainWindow.removeListener('move', _settingsBoundsSync);
      _settingsBoundsSync = null;
    }
    settingsWindow = null;
    // Re-show the detached native views.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:window', { open: false });
  });
}

// ── IPC: settings window ──
ipcMain.on('settings:open', () => createSettingsWindow());
ipcMain.on('settings:close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});
ipcMain.on('settings:changed', () => {
  // The settings window never writes workspaces/terminals state; it only
  // merges settings fields into localStorage. Tell the main window to re-apply.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed');
});

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

// ── IPC: config directory (~/.terminalvibe/) ──
ipcMain.handle('config:getPath', () => CONFIG_DIR);

ipcMain.handle('config:readState', () => readConfigFile(CONFIG_STATE_FILE));

ipcMain.handle('config:writeState', (_e, state) => writeConfigFile(CONFIG_STATE_FILE, state));

ipcMain.handle('config:readCustomThemes', () => readConfigFile(CONFIG_CUSTOM_THEMES_FILE));

ipcMain.handle('config:writeCustomThemes', (_e, themes) => writeConfigFile(CONFIG_CUSTOM_THEMES_FILE, themes));

ipcMain.handle('config:readThemeFile', (_e, name) => {
  const filePath = path.join(CONFIG_THEMES_DIR, `${name}.json`);
  return readConfigFile(filePath);
});

ipcMain.handle('config:writeThemeFile', (_e, name, theme) => {
  const filePath = path.join(CONFIG_THEMES_DIR, `${name}.json`);
  return writeConfigFile(filePath, theme);
});

ipcMain.handle('config:deleteThemeFile', (_e, name) => {
  const filePath = path.join(CONFIG_THEMES_DIR, `${name}.json`);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch { return false; }
});

ipcMain.handle('config:listThemeFiles', () => {
  try {
    if (!fs.existsSync(CONFIG_THEMES_DIR)) return [];
    return fs.readdirSync(CONFIG_THEMES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch { return []; }
});

// ── IPC: native PTY (node-pty runs here in the main process) ──
const ptys = new Map();
const detachedWindows = new Map(); // termId -> BrowserWindow
const sendToRenderer = (channel, payload) => {
  // If this terminal is detached, route to the detached window instead
  if (channel === 'terminal:data' || channel === 'terminal:exit') {
    const dw = detachedWindows.get(payload.id);
    if (dw && !dw.isDestroyed()) {
      dw.webContents.send(channel, payload);
      return;
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

ipcMain.handle('terminal:create', (_e, { id, cols, rows, cwd }) => {
  try {
    if (ptys.has(id)) {
      // Replace old PTY — remove exit listener first to avoid sending
      // terminal:exit to the detached window that's about to reuse this id
      const old = ptys.get(id);
      try { old.kill(); } catch {}
      ptys.delete(id);
    }
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
      if (ptys.get(id) !== t) return;
      ptys.delete(id);
      sendToRenderer('terminal:exit', { id, code: exitCode });
    });

    if (_e.sender) {
      for (const [termId, dw] of detachedWindows) {
        if (dw.webContents.id === _e.sender.id) {
          detachedWindows.set(id, dw);
          break;
        }
      }
    }

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
  for (const [id, dw] of detachedWindows) { try { if (!dw.isDestroyed()) dw.close(); } catch {} }
  detachedWindows.clear();
});

// ── IPC: detach terminal into a new window ──
ipcMain.handle('terminal:detach', (_e, { id, cols, rows, cwd }) => {
  if (detachedWindows.has(id)) return false;

  const dw = new BrowserWindow({
    title: 'TerminalVibe — Detached',
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#1e1e2e',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#cdd6f4',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  detachedWindows.set(id, dw);

  const params = new URLSearchParams({ mode: 'detached', termId: id, cols: String(cols || 80), rows: String(rows || 24) });
  if (cwd) params.set('cwd', cwd);
  if (isDev) {
    dw.loadURL(`http://127.0.0.1:${devPort}/?${params}`);
  } else {
    dw.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: Object.fromEntries(params) });
  }

  dw.on('closed', () => {
    let dwId = null;
    try { if (!dw.webContents.isDestroyed()) dwId = dw.webContents.id; } catch {}
    const toDelete = [];
    for (const [termId, other] of detachedWindows) {
      try {
        if (other.webContents.id === dwId || other.webContents.isDestroyed()) toDelete.push(termId);
      } catch { toDelete.push(termId); }
    }
    for (const termId of toDelete) {
      detachedWindows.delete(termId);
      const t = ptys.get(termId);
      if (t) { try { t.kill(); } catch {} ptys.delete(termId); }
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:detached-closed', { id });
  });

  return true;
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
  ensureConfigDir();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Suppress ERR_ABORTED (-3) from webview guest navigations / redirects.
  // Electron throws this as an unhandled rejection in the main process;
  // it's benign — the new navigation already took over.
  app.on('web-contents-created', (_e, wc) => {
    wc.on('did-fail-load', (_e2, code) => {
      if (code === -3) _e2.preventDefault();
    });
  });
});

app.on('window-all-closed', () => {
  ipcMain.emit('terminal:kill-all');
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => ipcMain.emit('terminal:kill-all'));
process.on('exit', () => ipcMain.emit('terminal:kill-all'));
