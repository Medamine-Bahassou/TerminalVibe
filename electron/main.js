const { app, BrowserWindow, WebContentsView, ipcMain, shell, clipboard, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');
const { hasRunningProcess, runningProcessInfo } = require('./proc');

// ── Helpers ──

const isDev = !app.isPackaged;
const devPort = 7769; // dev-mode app server port

// ── Config directory (~/.terminalvibe/) ──
const CONFIG_DIR = path.join(require('os').homedir(), '.terminalvibe');
const CONFIG_THEMES_DIR = path.join(CONFIG_DIR, 'themes');
const CONFIG_IMAGES_DIR = path.join(CONFIG_DIR, 'images');
const CONFIG_PLUGINS_DIR = path.join(CONFIG_DIR, 'plugins');
const CONFIG_STATE_FILE = path.join(CONFIG_DIR, 'state.json');
const CONFIG_CUSTOM_THEMES_FILE = path.join(CONFIG_DIR, 'custom-themes.json');

function ensureConfigDir() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_THEMES_DIR)) fs.mkdirSync(CONFIG_THEMES_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_IMAGES_DIR)) fs.mkdirSync(CONFIG_IMAGES_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_PLUGINS_DIR)) fs.mkdirSync(CONFIG_PLUGINS_DIR, { recursive: true });
  } catch (err) {
    console.error('[config] failed to create config dir:', err);
  }
}

// Decode a data: URL into its raw bytes (base64 or percent-encoded payload).
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf-8');
  } catch { return null; }
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
// Set once the user confirms quitting from the OS close button, so the
// close event can proceed instead of re-showing the confirmation modal.
let allowWindowClose = false;

function getIconPath() {
  const iconPath = path.join(__dirname, 'icon.png');
  if (fs.existsSync(iconPath)) return iconPath;
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'TerminalVibe',
    icon: getIconPath(),
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
      mainWindow.toggleDevTools();
    }
    // The hidden default menu still fires its Quit accelerator (Ctrl+Q on
    // Linux), bypassing the renderer's confirmation. Swallow it so only
    // Ctrl+Shift+Q — which asks first — can quit.
    if (input.type === 'keyDown' && input.control && !input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => { destroyAllBrowserViews(); mainWindow = null; allowWindowClose = false; });

  // Intercept the OS "X" close button so the renderer's quit-confirmation
  // modal runs first (same flow as the Ctrl+Shift+Q shortcut). We hold the
  // window open until the renderer confirms, then close for real.
  mainWindow.on('close', (e) => {
    if (allowWindowClose) return;
    e.preventDefault();
    const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
    if (!wc || wc.isDestroyed() || wc.isLoading()) {
      // Renderer not ready (splash/boot) — can't show the modal, just close.
      allowWindowClose = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      return;
    }
    wc.send('app:confirm-close');
  });
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
     icon: getIconPath(),
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

// Renderer confirmed quitting (OS close button / quit shortcut). Allow the
// close to proceed now.
ipcMain.on('app:close-confirmed', () => {
  allowWindowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// ── IPC: external links ──
ipcMain.handle('shell:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// ── IPC: clipboard (terminal text; navigator.clipboard also works) ──
ipcMain.handle('clipboard:write-text', (_e, text) => clipboard.writeText(String(text ?? '')));
ipcMain.handle('clipboard:read-text', () => clipboard.readText());

// Pasting an image in a terminal: write it to the OS temp dir and
// type the file path (the terminal can't render images inline).
ipcMain.handle('clipboard:paste-image', () => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const fp = path.join(require('os').tmpdir(), `terminalvibe-${Date.now()}.png`);
    fs.writeFileSync(fp, img.toPNG());
    return fp;
  } catch (err) { console.error('[clipboard] paste-image failed:', err); return null; }
});

// ── IPC: local files ──
ipcMain.handle('file:resolve', (_e, p) => {
  try {
    const resolved = path.resolve(p);
    return fs.existsSync(resolved) ? resolved : null;
  } catch { return null; }
});

// ── IPC: config directory (~/.terminalvibe/) ──
ipcMain.handle('config:getPath', () => CONFIG_DIR);

ipcMain.handle('config:readState', () => readConfigFile(CONFIG_STATE_FILE));

// Backgrounds and workspace icons are stored as files in ~/.terminalvibe/images/
// instead of base64 data URLs crammed into state.json. Each image id is a
// content-hashed filename, so identical images dedupe and re-saves are no-ops.
// Sending { id } without a dataUrl (already written this session) keeps the
// IPC payload small. After writing, the dir is reconciled to the referenced
// set unioned with the refs already in state.json — orphan cleanup.
ipcMain.handle('config:writeImages', (_e, images) => {
  if (!Array.isArray(images)) return [];
  try { if (!fs.existsSync(CONFIG_IMAGES_DIR)) fs.mkdirSync(CONFIG_IMAGES_DIR, { recursive: true }); } catch {}
  const referenced = new Set();
  const written = [];
  for (const img of images) {
    if (!img || typeof img.id !== 'string') continue;
    const id = img.id.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!id || id !== img.id) continue;
    referenced.add(id);
    const fp = path.join(CONFIG_IMAGES_DIR, id);
    if (fs.existsSync(fp)) { written.push(id); continue; }
    if (typeof img.dataUrl !== 'string') continue; // bare id for an existing file
    try {
      const buf = decodeDataUrl(img.dataUrl);
      if (!buf) continue;
      fs.writeFileSync(fp, buf);
      written.push(id);
    } catch (err) { console.error('[config] image write failed:', id, err); }
  }
  // Remove files no longer referenced by this save or by the state on disk.
  const keep = new Set(referenced);
  try {
    const diskState = readConfigFile(CONFIG_STATE_FILE);
    const collectRefs = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (typeof obj.image === 'string' && Object.keys(obj).length === 1) { keep.add(obj.image); return; }
      for (const v of Object.values(obj)) collectRefs(v);
    };
    if (diskState) collectRefs(diskState);
  } catch {}
  try {
    for (const f of fs.readdirSync(CONFIG_IMAGES_DIR)) {
      if (!keep.has(f)) { try { fs.unlinkSync(path.join(CONFIG_IMAGES_DIR, f)); } catch {} }
    }
  } catch {}
  return written;
});

ipcMain.handle('config:readImage', (_e, id) => {
  if (typeof id !== 'string') return null;
  const safe = id.replace(/[^a-zA-Z0-9_.-]/g, '');
  if (safe !== id) return null;
  const fp = path.join(CONFIG_IMAGES_DIR, id);
  try {
    if (!fs.existsSync(fp)) return null;
    const buf = fs.readFileSync(fp);
    const ext = path.extname(id).slice(1).toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'svg' ? 'image/svg+xml'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
});

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

// ── IPC: plugins (~/.terminalvibe/plugins/<id>/) ──
// Each plugin is a directory containing plugin.json + a JS entry. The renderer
// reads manifests + entry sources over IPC and evaluates them in a sandboxed
// (contextIsolation) page, so only these read handlers are exposed — never a
// generic write. Enable/disable state is persisted in state.json by the renderer.

const PLUGIN_MANIFEST = 'plugin.json';

function pluginDir(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safe || safe !== id) return null;
  return path.join(CONFIG_PLUGINS_DIR, safe);
}

// Scan ~/.terminalvibe/plugins/ for plugin manifests.
ipcMain.handle('config:listPlugins', () => {
  try {
    if (!fs.existsSync(CONFIG_PLUGINS_DIR)) return [];
    const out = [];
    for (const id of fs.readdirSync(CONFIG_PLUGINS_DIR)) {
      const dir = pluginDir(id);
      if (!dir) continue;
      const manifestPath = path.join(dir, PLUGIN_MANIFEST);
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = readConfigFile(manifestPath);
      if (!manifest || typeof manifest !== 'object') continue;
      out.push({ ...manifest, id });
    }
    return out;
  } catch (err) {
    console.error('[plugins] list failed:', err);
    return [];
  }
});

// Reveal a plugin's folder in the OS file manager ("access" a plugin).
ipcMain.handle('config:openPluginFolder', (_e, id) => {
  const dir = pluginDir(id);
  if (!dir) return false;
  try { shell.openPath(dir); return true; } catch (err) {
    console.error('[plugins] open folder failed:', id, err);
    return false;
  }
});

// Reveal the plugins directory itself in the OS file manager.
ipcMain.handle('config:openPluginsDir', () => {
  try { shell.openPath(CONFIG_PLUGINS_DIR); return true; } catch (err) {
    console.error('[plugins] open dir failed:', err);
    return false;
  }
});

// Read a plugin file (entry JS, CSS, manifest, assets). Path is resolved
// against the plugin dir and must stay inside it.
ipcMain.handle('config:readPluginFile', (_e, id, relPath) => {
  const dir = pluginDir(id);
  if (!dir) return null;
  const rel = String(relPath || '').replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return null;
  const fp = path.join(dir, rel);
  if (!fp.startsWith(dir + path.sep) && fp !== path.join(dir, PLUGIN_MANIFEST)) return null;
  try {
    if (!fs.existsSync(fp)) return null;
    return fs.readFileSync(fp, 'utf-8');
  } catch (err) {
    console.error('[plugins] read failed:', id, rel, err);
    return null;
  }
});

// ── IPC: native PTY (node-pty runs here in the main process) ──
const ptys = new Map();
const detachedWindows = new Map(); // termId -> BrowserWindow
// While a detached window is booting its renderer, PTY output for its terminal
// is buffered here so nothing is lost; flushed on 'terminal:attached'.
const detachedPending = new Map(); // termId -> [{ channel, payload }]
// termIds whose detached window is closing because the tab was dragged back
// into the main window — the PTY must survive the window close.
const reattachingIds = new Set();
const sendToRenderer = (channel, payload) => {
  // Buffer output for a freshly-detached terminal until its renderer is up.
  if ((channel === 'terminal:data' || channel === 'terminal:exit') && detachedPending.has(payload.id)) {
    detachedPending.get(payload.id).push({ channel, payload });
    return;
  }
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
// The detached window's renderer is up and has replayed the captured buffer;
// flush any output that was buffered while it was booting.
ipcMain.on('terminal:attached', (_e, id) => {
  const pending = detachedPending.get(id);
  if (!pending) return;
  detachedPending.delete(id);
  // Flush to whichever window attached — the detached window on first boot,
  // or the main window when the tab is dragged back in.
  if (_e.sender && !_e.sender.isDestroyed()) {
    for (const { channel, payload } of pending) _e.sender.send(channel, payload);
  }
});

ipcMain.on('terminal:close', (_e, id) => {
  const t = ptys.get(id);
  if (t) { try { t.kill(); } catch {} ptys.delete(id); }
});
ipcMain.handle('terminal:hasRunningProcess', (_e, id) => {
  const t = ptys.get(id);
  return t ? runningProcessInfo(t.pid) : { running: false, name: null };
});
ipcMain.on('terminal:kill-all', () => {
  for (const t of ptys.values()) { try { t.kill(); } catch {} }
  ptys.clear();
  for (const [id, dw] of detachedWindows) { try { if (!dw.isDestroyed()) dw.close(); } catch {} }
  detachedWindows.clear();
  detachedPending.clear();
});

// ── IPC: detach terminal into a new window ──
ipcMain.handle('terminal:detach', (_e, { id, cols, rows, cwd }) => {
  if (detachedWindows.has(id)) return false;

  // Unique id for this detached window so its state never collides with
  // other detached windows (each one saves under its own localStorage key).
  const winId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  const dw = new BrowserWindow({
     title: 'TerminalVibe — Detached',
     icon: getIconPath(),
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
  // Buffer the terminal's output while the detached window boots so no session
  // content is lost between detach and the renderer attaching.
  detachedPending.set(id, []);

  const params = new URLSearchParams({ mode: 'detached', termId: id, winId, cols: String(cols || 80), rows: String(rows || 24) });
  if (cwd) params.set('cwd', cwd);
  if (isDev) {
    dw.loadURL(`http://127.0.0.1:${devPort}/?${params}`);
  } else {
    dw.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: Object.fromEntries(params) });
  }

  // Same Ctrl+Q guard as the main window (hidden default menu Quit role)
  dw.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && !input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
    }
  });

  dw.on('closed', () => {
    let dwId = null;
    try { if (!dw.webContents.isDestroyed()) dwId = dw.webContents.id; } catch {}
    const toDelete = [];
    const reattachedThisClose = reattachingIds.size > 0;
    for (const [termId, other] of detachedWindows) {
      try {
        if (other.webContents.id === dwId || other.webContents.isDestroyed()) toDelete.push(termId);
      } catch { toDelete.push(termId); }
    }
    for (const termId of toDelete) {
      detachedWindows.delete(termId);
      detachedPending.delete(termId);
      if (reattachingIds.has(termId)) {
        // Tab was dragged back into the main window — keep the PTY alive.
        reattachingIds.delete(termId);
        continue;
      }
      const t = ptys.get(termId);
      if (t) { try { t.kill(); } catch {} ptys.delete(termId); }
    }
    if (mainWindow && !mainWindow.isDestroyed() && !reattachedThisClose) {
      mainWindow.webContents.send('terminal:detached-closed', { id });
    }
  });

  return true;
});

// ── IPC: cross-window tab drag (detach / re-attach / move between windows) ──
// HTML5 drag data written by one window's renderer is not reliably readable
// in another window's renderer, so the dragged terminal's id travels through
// the main process: the source window announces the drag ('tab-drag:start'),
// every other window receives 'tab-drag:active' {id}, and a drop is reported
// by whichever window accepted it ('tab-drag:drop'). The source window of a
// move is asked to snapshot + remove the tab ('tab-drag:complete') and the
// target window is told to re-create it ('terminal:reattach'). A detached
// window whose last tab was moved away is closed with its PTY preserved.
let tabDragState = null; // { termId, overMain, timer }

function pointInRect(pt, r) {
  return !!r && pt.x >= r.x && pt.x <= r.x + r.width && pt.y >= r.y && pt.y <= r.y + r.height;
}

function eachDragWindow(fn) {
  if (mainWindow && !mainWindow.isDestroyed()) fn(mainWindow.webContents);
  const seen = new Set();
  for (const dw of detachedWindows.values()) {
    if (!dw || dw.isDestroyed()) continue;
    try {
      if (seen.has(dw.webContents.id)) continue;
      seen.add(dw.webContents.id);
      fn(dw.webContents);
    } catch {}
  }
}

function broadcastDragActive(id, exceptWc) {
  eachDragWindow(wc => {
    if (exceptWc && wc.id === exceptWc.id) return;
    try { wc.send('tab-drag:active', { id }); } catch {}
  });
}

function stopTabDrag() {
  if (tabDragState) {
    clearInterval(tabDragState.timer);
    tabDragState = null;
  }
  broadcastDragActive(null, null);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-drag:over', { over: false });
  }
}

ipcMain.on('tab-drag:start', (e, { id } = {}) => {
  stopTabDrag();
  if (!id || (!ptys.has(id) && !detachedWindows.has(id))) return;
  // Tell every OTHER window which terminal is being dragged.
  broadcastDragActive(id, e.sender);
  if (!detachedWindows.has(id)) return; // main-window drag: no re-attach polling
  // Best-effort live highlight: poll the cursor only where the platform
  // reports real positions (on Wayland it returns 0,0 → skip).
  const poll = () => {
    if (!tabDragState) return;
    let pt = null;
    try { pt = screen.getCursorScreenPoint(); } catch {}
    if (!pt || (pt.x === 0 && pt.y === 0)) return;
    const over = pointInRect(pt, mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()
      ? mainWindow.getBounds() : null);
    if (over !== tabDragState.overMain) {
      tabDragState.overMain = over;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tab-drag:over', { id, over });
      }
    }
  };
  tabDragState = { termId: id, overMain: false, timer: setInterval(poll, 60) };
});

const tabDragFinishers = new Map(); // termId -> { finish, timer, cols, rows, cwd, remaining }

ipcMain.on('tab-drag:ready', (_e, { id, cols, rows, cwd, remaining } = {}) => {
  const f = id && tabDragFinishers.get(id);
  if (!f) return;
  if (cols) f.cols = cols;
  if (rows) f.rows = rows;
  if (cwd) f.cwd = cwd;
  if (Number.isFinite(remaining)) f.remaining = remaining;
  clearTimeout(f.timer);
  tabDragFinishers.delete(id);
  f.finish();
});

// Move a terminal from its current window into the window identified by
// `targetWcId` (the webContents that reported the drop). The PTY never dies:
// output is buffered while the source removes the tab and the target
// re-creates it. `placement` ({ targetGroupId, zone, beforeTabId }) tells the
// target where in its layout the tab should land.
function startTabMove(p, placement, targetWcId) {
  const id = p && p.id;
  if (!id || !ptys.has(id) || tabDragFinishers.has(id)) return;

  let targetWc = null;
  let targetDw = null;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === targetWcId) {
    targetWc = mainWindow.webContents;
  } else {
    for (const dw of detachedWindows.values()) {
      if (dw && !dw.isDestroyed() && dw.webContents.id === targetWcId) { targetDw = dw; targetWc = dw.webContents; break; }
    }
  }
  if (!targetWc || targetWc.isDestroyed()) return;

  const srcDw = detachedWindows.get(id) || null;
  if (srcDw && srcDw === targetDw) return;              // same detached window: renderer-local
  if (!srcDw && targetWc === (mainWindow && mainWindow.webContents)) return; // main→main: renderer-local
  console.log('[tab-drag] move:', id, '→', targetDw ? `detached#${targetWc.id}` : 'main',
    placement ? `zone=${placement.zone} group=${placement.targetGroupId}` : 'fallback');

  reattachingIds.add(id);
  detachedWindows.delete(id);   // stop routing output to the source window
  detachedPending.set(id, []);  // buffer PTY output until the target attaches
  const f = {
    cols: p.cols, rows: p.rows, cwd: p.cwd,
    remaining: 1, // keep the source window open unless it reports it's empty
    timer: null,
    finish: () => {
      if (tabDragFinishers.get(id)?.finish === f.finish) tabDragFinishers.delete(id);
      reattachingIds.delete(id);
      // Close the source window iff the moved tab was its last one.
      if (srcDw && !srcDw.isDestroyed() && f.remaining === 0) { try { srcDw.close(); } catch {} }
      // Route further output to the target window and have it create the tab.
      if (targetDw && !targetDw.isDestroyed()) detachedWindows.set(id, targetDw);
      if (targetWc && !targetWc.isDestroyed()) {
        targetWc.send('terminal:reattach', { id, cols: f.cols, rows: f.rows, cwd: f.cwd, placement: placement || null });
      }
    },
  };
  const srcWc = srcDw && !srcDw.isDestroyed() ? srcDw.webContents
    : (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null);
  try { if (srcWc && !srcWc.isDestroyed()) srcWc.send('tab-drag:complete', { id }); } catch {}
  f.timer = setTimeout(f.finish, 350);
  tabDragFinishers.set(id, f);
}

ipcMain.on('tab-drag:end', (_e, p) => {
  stopTabDrag();
  if (!p || !p.id || p.cancelled) return;
  if (tabDragFinishers.has(p.id)) return; // a drop already started the move
  const dw = detachedWindows.get(p.id);
  if (!dw || dw.isDestroyed() || !ptys.has(p.id)) return;

  // If some window ACCEPTED the drop (a tab bar or pane overlay), that
  // window's drop handler owns the follow-up — its 'tab-drag:drop' IPC races
  // this message across processes, so acting here would conflict with it.
  // dragend is only the fallback for drags no target accepted.
  if (!p.unhandled && !p.outside) return;
  // The pointer was still over the detached window at release
  // (dragenter/dragleave state) — that's a local drop, never a re-attach.
  if (p.insideAtEnd) return;
  // Fallback: attach into the main window's active group.
  if (mainWindow && !mainWindow.isDestroyed()) {
    startTabMove(p, null, mainWindow.webContents.id);
  }
});

// A window accepted the drop on a specific target (tab bar / pane zone).
// The target window is the sender of this message.
ipcMain.on('tab-drag:drop', (e, p) => {
  stopTabDrag();
  if (!p || !p.id || !p.targetGroupId) return;
  startTabMove({ id: p.id }, { targetGroupId: p.targetGroupId, zone: p.zone || 'center', beforeTabId: p.beforeTabId || null }, e.sender.id);
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
