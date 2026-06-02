(function() {
'use strict';

// Tauri Webview API (from window.__TAURI__ global, injected by Tauri runtime)
function tauriWebview() { return window.__TAURI__ && window.__TAURI__.webview; }
function tauriWindow() { return window.__TAURI__ && window.__TAURI__.window; }
function loadTauriApi() { /* no-op: API available via window.__TAURI__ at runtime */ }

/* ═══════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════════════════════════ */
const DEFAULT_SHORTCUTS = {
  newTerminal:    { ctrl: true, shift: true, key: 'T', label: 'Ctrl+Shift+T' },
  closeTerminal:  { ctrl: true, shift: true, key: 'W', label: 'Ctrl+Shift+W' },
  splitH:         { ctrl: true, shift: true, key: 'D', label: 'Ctrl+Shift+D' },
  splitV:         { ctrl: true, shift: true, key: 'E', label: 'Ctrl+Shift+E' },
  search:         { ctrl: true, shift: true, key: 'F', label: 'Ctrl+Shift+F' },
  browserTab:     { ctrl: true, shift: true, key: 'B', label: 'Ctrl+Shift+B' },
  copy:           { ctrl: true, shift: true, key: 'C', label: 'Ctrl+Shift+C' },
  paste:          { ctrl: true, shift: true, key: 'V', label: 'Ctrl+Shift+V' },
  nextTab:        { ctrl: true, shift: false, key: 'PageDown', label: 'Ctrl+PageDown' },
  prevTab:        { ctrl: true, shift: false, key: 'PageUp', label: 'Ctrl+PageUp' },
  focusLeft:      { alt: true, key: 'h', label: 'Alt+H' },
  focusDown:      { alt: true, key: 'j', label: 'Alt+J' },
  focusUp:        { alt: true, key: 'k', label: 'Alt+K' },
  focusRight:     { alt: true, key: 'l', label: 'Alt+L' },
  nextWorkspace:  { ctrl: true, shift: true, key: 'PageDown', label: 'Ctrl+Shift+PageDown' },
  prevWorkspace:  { ctrl: true, shift: true, key: 'PageUp', label: 'Ctrl+Shift+PageUp' },
};

const SHORTCUT_LABELS = {
  newTerminal: 'New terminal', closeTerminal: 'Close terminal',
  splitH: 'Split horizontal', splitV: 'Split vertical',
  search: 'Search', browserTab: 'New browser tab',
  copy: 'Copy selection', paste: 'Paste',
  nextTab: 'Next tab', prevTab: 'Previous tab',
  focusLeft: 'Focus left pane', focusDown: 'Focus down pane',
  focusUp: 'Focus up pane', focusRight: 'Focus right pane',
  nextWorkspace: 'Next workspace', prevWorkspace: 'Previous workspace',
};

let customShortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));

function matchShortcut(e, action) {
  const s = customShortcuts[action];
  if (!s) return false;
  const keyMatch = s.key.length === 1
    ? e.key.toLowerCase() === s.key.toLowerCase()
    : e.key === s.key || e.code === s.key;
  return keyMatch
    && !!e.ctrlKey === !!s.ctrl
    && !!e.shiftKey === !!s.shift
    && !!e.altKey === !!s.alt
    && !!e.metaKey === !!s.meta;
}

function formatKeyCombo(s) {
  const parts = [];
  if (s.ctrl) parts.push('Ctrl');
  if (s.alt) parts.push('Alt');
  if (s.shift) parts.push('Shift');
  if (s.meta) parts.push('Meta');
  const k = s.key;
  if (k === 'PageDown') parts.push('PageDown');
  else if (k === 'PageUp') parts.push('PageUp');
  else if (k === 'ArrowLeft') parts.push('Left');
  else if (k === 'ArrowRight') parts.push('Right');
  else if (k === 'ArrowUp') parts.push('Up');
  else if (k === 'ArrowDown') parts.push('Down');
  else parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join('+');
}

/* ═══════════════════════════════════════════════════════════════
   THEMES — mirror Python THEMES dict exactly
═══════════════════════════════════════════════════════════════ */
const THEMES = {
  'catppuccin-mocha': {
    label: 'Catppuccin Mocha',
    bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70',
    swatches: ['#1e1e2e','#cdd6f4','#f5e0dc'],
    palette: [
      '#1e1e2e','#f38ba8','#a6e3a1','#f9e2af',
      '#89b4fa','#f5c2e7','#94e2d5','#cdd6f4',
      '#585b70','#eba0ac','#a6e3a1','#f9e2af',
      '#89b4fa','#f5c2e7','#94e2d5','#bac2de',
    ],
  },
  'catppuccin-latte': {
    label: 'Catppuccin Latte',
    bg: '#eff1f5', fg: '#4c4f69', cursor: '#dc8a78', selection: '#bcc0cc',
    swatches: ['#eff1f5','#4c4f69','#dc8a78'],
    palette: [
      '#eff1f5','#d20f39','#40a02b','#df8e1d',
      '#1e66f5','#ea76cb','#179299','#acb0be',
      '#5c5f77','#d20f39','#40a02b','#df8e1d',
      '#1e66f5','#ea76cb','#179299','#6c6f85',
    ],
  },
  'dracula': {
    label: 'Dracula',
    bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
    swatches: ['#282a36','#f8f8f2','#bd93f9'],
    palette: [
      '#21222c','#ff5555','#50fa7b','#f1fa8c',
      '#bd93f9','#ff79c6','#8be9fd','#f8f8f2',
      '#6272a4','#ff6e6e','#69ff94','#ffffa5',
      '#d6acff','#ff92df','#a4ffff','#ffffff',
    ],
  },
  'gruvbox': {
    label: 'Gruvbox',
    bg: '#282828', fg: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945',
    swatches: ['#282828','#ebdbb2','#d79921'],
    palette: [
      '#282828','#cc241d','#98971a','#d79921',
      '#458588','#b16286','#689d6a','#a89984',
      '#928374','#fb4934','#b8bb26','#fabd2f',
      '#83a598','#d3869b','#8ec07c','#ebdbb2',
    ],
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    bg: '#1a1b26', fg: '#c0caf5', cursor: '#c0caf5', selection: '#33467c',
    swatches: ['#1a1b26','#c0caf5','#7aa2f7'],
    palette: [
      '#15161e','#f7768e','#9ece6a','#e0af68',
      '#7aa2f7','#bb9af7','#7dcfff','#a9b1d6',
      '#414868','#f7768e','#9ece6a','#e0af68',
      '#7aa2f7','#bb9af7','#7dcfff','#c0caf5',
    ],
  },
  'nord': {
    label: 'Nord',
    bg: '#2e3440', fg: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e',
    swatches: ['#2e3440','#d8dee9','#81a1c1'],
    palette: [
      '#3b4252','#bf616a','#a3be8c','#ebcb8b',
      '#81a1c1','#b48ead','#88c0d0','#e5e9f0',
      '#4c566a','#bf616a','#a3be8c','#ebcb8b',
      '#81a1c1','#b48ead','#8fbcbb','#eceff4',
    ],
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    bg: '#002b36', fg: '#839496', cursor: '#839496', selection: '#073642',
    swatches: ['#002b36','#839496','#268bd2'],
    palette: [
      '#073642','#dc322f','#859900','#b58900',
      '#268bd2','#d33682','#2aa198','#eee8d5',
      '#586e75','#cb4b16','#586e75','#657b83',
      '#839496','#6c71c4','#93a1a1','#fdf6e3',
    ],
  },
};

const WS_PORT = 7681;
const PROXY_PORT = 7682;

function isTauri() {
  return !!window.__TAURI_INTERNALS__ ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost';
}

function openExternalUrl(url) {
  if (isTauri() && window.__TAURI_INTERNALS__) {
    window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url });
  } else {
    window.open(url, '_blank');
  }
}

function doPaste(entry) {
  if (!entry || !entry.term) return;
  if (isTauri() && window.__TAURI_INTERNALS__) {
    window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|read_text').then(text => {
      if (text) sendStdin(entry.id, new TextEncoder().encode(text));
    }).catch(err => console.warn('Paste failed:', err));
  } else {
    navigator.clipboard.readText().then(text => {
      if (text) sendStdin(entry.id, new TextEncoder().encode(text));
    }).catch(() => {});
  }
}

// Fallback paste handler for native Ctrl+V (non-Tauri)
document.addEventListener('paste', e => {
  if (Date.now() < _suppressPasteUntil) { e.preventDefault(); e.stopPropagation(); return; }
  const t = activeTerminal();
  if (!t || t.type === 'browser') return;
  const text = e.clipboardData?.getData('text/plain');
  if (text) {
    e.preventDefault();
    t.term.paste(text);
  }
}, true);

/* ═══════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════ */
let currentThemeName = 'catppuccin-mocha';
let currentTheme = THEMES[currentThemeName];
let currentFontSize = 13;
let currentFontFamily = "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace";
let currentLineHeight = 1.4;
let currentCursorStyle = 'block';
let currentCursorBlink = true;
let currentScrollback = 10000;

let workspaces = [];       // [{id, label, activeTermId, layout: (Node)}]
let activeWsId = null;
let _wsDomCache = {};      // wsId -> DOM element wrapping that workspace's layout
let focusedSlotId = null;  // DOM id of focused .term-slot
function updateFocusedGroup() {
  document.querySelectorAll('.term-group.focused-group').forEach(g => g.classList.remove('focused-group'));
  if (!focusedSlotId) return;
  const slot = document.getElementById(focusedSlotId);
  if (slot) { const g = slot.closest('.term-group'); if (g) g.classList.add('focused-group'); }
}

let ws = null;             // WebSocket
let wsReady = false;
let tauriPtyReady = false; // Tauri native PTY backend ready
let _ptyListeners = {};    // termId -> unlisten function for Tauri PTY events

/* ═══════════════════════════════════════════════════════════════
   WEBSOCKET
═══════════════════════════════════════════════════════════════ */
const ID_LEN = 36;

function connectWS() {
  updateConnStatus(false, true);
  const wsHost = isTauri() ? '127.0.0.1' : (window.location.hostname || '127.0.0.1');
  ws = new WebSocket(`ws://${wsHost}:${WS_PORT}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    wsReady = true;
    updateConnStatus(true);

    if (workspaces.length) {
      for (const ws of workspaces) {
        const terms = getWorkspaceTerminals(ws);
        for (const t of terms) {
          if (t.pending) {
            const slot = getSlotDimensions(t);
            sendControl({ type: 'create', id: t.id, cols: slot.cols, rows: slot.rows });
            t.pending = false;
          }
        }
      }
    } else {
      try { createWorkspace('Main'); } catch (e) { console.error('createWorkspace failed:', e); }
    }
  };

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      const arr = new Uint8Array(e.data);
      const sidBytes = arr.slice(0, ID_LEN);
      const data = arr.slice(ID_LEN);
      const sid = new TextDecoder().decode(sidBytes).trimEnd();
      const result = findTermById(sid);
      if (result) result.term.term.write(data);
    } else {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'exit') handleExit(msg.id, msg.code);
        else if (msg.type === 'error') handleError(msg.id, msg.msg);
        else if (msg.type === 'pong') {}
      } catch {}
    }
  };

  ws.onclose = () => {
    wsReady = false;
    updateConnStatus(false);
    setTimeout(connectWS, 2000);
  };

  ws.onerror = () => { ws.close(); };
}

function sendControl(obj) {
  if (isTauri() && tauriPtyReady) {
    if (obj.type === 'create') {
      window.__TAURI_INTERNALS__.invoke('create_terminal', { id: obj.id, cols: obj.cols, rows: obj.rows }).catch(() => {});
    } else if (obj.type === 'resize') {
      window.__TAURI_INTERNALS__.invoke('resize_terminal', { id: obj.id, cols: obj.cols, rows: obj.rows }).catch(() => {});
    } else if (obj.type === 'close') {
      window.__TAURI_INTERNALS__.invoke('close_terminal', { id: obj.id }).catch(() => {});
    }
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj));
}

function sendStdin(sid, data) {
  if (isTauri() && tauriPtyReady) {
    window.__TAURI_INTERNALS__.invoke('write_terminal', { id: sid, data: Array.from(data) }).catch(() => {});
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const enc = new TextEncoder();
  const sidBytes = new Uint8Array(ID_LEN).fill(32);
  const sidEnc = enc.encode(sid.substring(0, ID_LEN));
  sidBytes.set(sidEnc);
  const buf = new Uint8Array(ID_LEN + data.length);
  buf.set(sidBytes);
  buf.set(data, ID_LEN);
  ws.send(buf.buffer);
}

function updateConnStatus(connected, connecting) {
  const dot = document.getElementById('sb-conn-dot');
  const txt = document.getElementById('sb-conn-text');
  if (connecting) {
    dot.style.background = currentTheme.palette[3];
    txt.textContent = 'Connecting…';
  } else {
    dot.style.background = connected ? currentTheme.palette[2] : currentTheme.palette[1];
    txt.textContent = connected ? 'Connected' : 'Disconnected';
  }
}

/* ═══════════════════════════════════════════════════════════════
   TAURI NATIVE PTY
═══════════════════════════════════════════════════════════════ */
function connectTauriPTY() {
  updateConnStatus(true);
  wsReady = true;
  tauriPtyReady = true;

  // Listen for PTY events using __TAURI_INTERNALS__ (always available)
  function tauriListen(eventName, handler) {
    try {
      // Try high-level API first
      if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
        window.__TAURI__.event.listen(eventName, handler);
        return;
      }
    } catch {}
    // Fallback: use internal callback mechanism
    try {
      const cbId = window.__TAURI_INTERNALS__.transformCallback(handler, false);
      window.__TAURI_INTERNALS__.invoke('plugin:event|listen', { event: eventName, target: { kind: 'Any' }, handler: cbId });
    } catch (e) { console.error('tauriListen failed for', eventName, e); }
  }

  tauriListen('pty://output', (e) => {
    const { id, data } = e.payload;
    const result = findTermById(id);
    if (result) result.term.term.write(new Uint8Array(data));
  });

  tauriListen('pty://exit', (e) => {
    const { id, code } = e.payload;
    handleExit(id, code);
  });

  // Create initial workspace or restore pending terminals
  if (workspaces.length) {
    for (const wsp of workspaces) {
      const terms = getWorkspaceTerminals(wsp);
      for (const t of terms) {
        if (t.pending) {
          const slot = getSlotDimensions(t);
          sendControl({ type: 'create', id: t.id, cols: slot.cols, rows: slot.rows });
          t.pending = false;
        }
      }
    }
  } else {
    try { createWorkspace('Main'); } catch (e) { console.error('createWorkspace failed:', e); }
  }
}

/* ═══════════════════════════════════════════════════════════════
   UUID helper
═══════════════════════════════════════════════════════════════ */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ═══════════════════════════════════════════════════════════════
   FIND & RECURSIVE TREE HELPERS
═══════════════════════════════════════════════════════════════ */
function findWs(id) { return workspaces.find(w => w.id === id); }
function activeWs() { return findWs(activeWsId); }

function getWorkspaceTerminals(wsp) {
  if (!wsp || !wsp.layout) return [];
  const terms = [];
  function recurse(node) {
    if (!node) return;
    if (node.type === 'group') {
      terms.push(...node.terminals);
    } else if (node.type === 'split') {
      node.children.forEach(recurse);
    }
  }
  recurse(wsp.layout);
  return terms;
}

function findTermById(id) {
  for (const ws of workspaces) {
    const terms = getWorkspaceTerminals(ws);
    const t = terms.find(x => x.id === id);
    if (t) return { ws, term: t };
  }
  return null;
}

function activeTerminal() {
  const ws = activeWs();
  if (!ws || !ws.layout) return null;
  const all = getWorkspaceTerminals(ws);
  return all.find(t => t.id === ws.activeTermId) || all[0] || null;
}

function findFirstGroup(node) {
  if (!node) return null;
  if (node.type === 'group') return node;
  if (node.type === 'split') {
    for (const child of node.children) {
      const g = findFirstGroup(child);
      if (g) return g;
    }
  }
  return null;
}

function findGroupById(node, id) {
  if (!node) return null;
  if (node.type === 'group' && node.id === id) return node;
  if (node.type === 'split') {
    for (const child of node.children) {
      const g = findGroupById(child, id);
      if (g) return g;
    }
  }
  return null;
}

function findGroupContainingTerm(node, termId) {
  if (!node) return null;
  if (node.type === 'group') {
    if (node.terminals.some(t => t.id === termId)) return node;
  } else if (node.type === 'split') {
    for (const child of node.children) {
      const g = findGroupContainingTerm(child, termId);
      if (g) return g;
    }
  }
  return null;
}

function countGroups(node) {
  if (!node) return 0;
  if (node.type === 'group') return 1;
  return node.children.reduce((s, c) => s + countGroups(c), 0);
}

function removeEmptyGroups(node) {
  if (!node) return null;
  if (node.type === 'split') {
    node.children = node.children.map(c => removeEmptyGroups(c)).filter(Boolean);
    node.children = node.children.filter(c => {
      if (c.type === 'group' && c.terminals.length === 0) return false;
      return true;
    });

    if (node.children.length === 0) return null;
    if (node.children.length === 1) return node.children[0];
  }
  return node;
}

function refitNodeTerminals(node) {
  if (!node) return;
  if (node.type === 'group') {
    node.terminals.forEach(t => fitTerm(t));
  } else if (node.type === 'split') {
    node.children.forEach(refitNodeTerminals);
  }
}

/* ═══════════════════════════════════════════════════════════════
   THEME APPLICATION
═══════════════════════════════════════════════════════════════ */
function applyTheme(name) {
  const theme = THEMES[name];
  if (!theme) return;
  currentThemeName = name;
  currentTheme = theme;

  const r = document.documentElement.style;
  r.setProperty('--bg', theme.bg);
  r.setProperty('--fg', theme.fg);
  r.setProperty('--cursor', theme.cursor);
  r.setProperty('--selection', theme.selection);
  const accent = theme.palette[4] || theme.palette[12] || theme.fg;
  r.setProperty('--accent', accent);
  r.setProperty('--ws-active-strip', accent);
  r.setProperty('--accent-dim', hexToRgba(accent, 0.15));

  for (const wsp of workspaces) {
    const terms = getWorkspaceTerminals(wsp);
    for (const t of terms) {
      if (t.type !== 'browser') t.term.options.theme = makeXtermTheme(theme);
    }
  }

  updateStatusBar();
  renderSidebar();
  renderPaneArea();
}

function makeXtermTheme(theme) {
  const p = theme.palette;
  return {
    background: theme.bg,
    foreground: theme.fg,
    cursor: theme.cursor,
    cursorAccent: theme.bg,
    selectionBackground: theme.selection,
    black:        p[0],  red:         p[1],  green:   p[2],  yellow:  p[3],
    blue:         p[4],  magenta:     p[5],  cyan:    p[6],  white:   p[7],
    brightBlack:  p[8],  brightRed:   p[9],  brightGreen: p[10], brightYellow: p[11],
    brightBlue:   p[12], brightMagenta: p[13], brightCyan: p[14], brightWhite: p[15],
  };
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ═══════════════════════════════════════════════════════════════
   STATE PERSISTENCE
═══════════════════════════════════════════════════════════════ */
const STATE_KEY = 'ghostterm-state-v2';

function serializeLayout(node) {
  if (!node) return null;
  if (node.type === 'split') {
    return {
      type: 'split',
      id: node.id,
      direction: node.direction,
      sizes: node.sizes,
      children: node.children.map(serializeLayout)
    };
  }
  if (node.type === 'group') {
    return {
      type: 'group',
      id: node.id,
      activeTermId: node.activeTermId,
      history: node._history || [],
      terminals: node.terminals.map(t => {
        const o = { id: t.id, label: t.label };
        if (t.color) o.color = t.color;
        if (t.type === 'browser') { o.type = 'browser'; o.url = t.url; }
        return o;
      })
    };
  }
}

function deserializeLayout(data, ws) {
  if (!data) return null;
  if (data.type === 'split') {
    return {
      type: 'split',
      id: data.id,
      direction: data.direction,
      sizes: data.sizes,
      children: data.children.map(c => deserializeLayout(c, ws))
    };
  }
  if (data.type === 'group') {
    const group = {
      type: 'group',
      id: data.id,
      activeTermId: data.activeTermId,
      _history: data.history || [],
      terminals: []
    };
    for (const tData of data.terminals) {
      let entry;
      if (tData.type === 'browser') {
        entry = { id: tData.id, label: tData.label, type: 'browser', url: tData.url || 'about:blank', iframe: null, el: null, opened: false };
      } else {
        entry = _createTermEntry(ws, tData.id, tData.label);
        entry.pending = true;
      }
      if (tData.color) entry.color = tData.color;
      group.terminals.push(entry);
    }
    return group;
  }
}

function saveState() {
  const state = {
    theme: currentThemeName,
    fontSize: currentFontSize,
    fontFamily: currentFontFamily,
    lineHeight: currentLineHeight,
    cursorStyle: currentCursorStyle,
    cursorBlink: currentCursorBlink,
    scrollback: currentScrollback,
    sidebarExpanded: document.getElementById('sidebar').classList.contains('expanded'),
    sidebarWidth: document.getElementById('sidebar').offsetWidth || null,
    shortcuts: customShortcuts,
    activeWsId,
    workspaces: workspaces.map(ws => {
      const o = { id: ws.id, label: ws.label, activeTermId: ws.activeTermId, layout: serializeLayout(ws.layout) };
      if (ws.color) o.color = ws.color;
      return o;
    }),
  };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (!state.workspaces?.length) return false;

    if (state.theme && THEMES[state.theme]) {
      currentThemeName = state.theme;
      currentTheme = THEMES[currentThemeName];
    }

    if (state.fontSize) currentFontSize = state.fontSize;
    if (state.fontFamily) currentFontFamily = state.fontFamily;
    if (state.lineHeight) currentLineHeight = state.lineHeight;
    if (state.cursorStyle) currentCursorStyle = state.cursorStyle;
    if (state.cursorBlink !== undefined) currentCursorBlink = state.cursorBlink;
    if (state.scrollback) currentScrollback = state.scrollback;
    if (state.shortcuts) {
      for (const [k, v] of Object.entries(state.shortcuts)) {
        if (customShortcuts[k]) customShortcuts[k] = v;
      }
    }
    if (state.sidebarExpanded) document.getElementById('sidebar').classList.add('expanded');
    if (state.sidebarWidth) {
      savedSidebarWidth = Math.max(state.sidebarWidth, SB_EXPANDED_MIN);
      if (state.sidebarExpanded && sidebarSplit) {
        const containerW = document.getElementById('app').offsetWidth;
        const pct = Math.max(5, (savedSidebarWidth / containerW) * 100);
        sidebarSplit.setSizes([pct, 100 - pct]);
      }
    }

    for (const wsData of state.workspaces) {
      const ws = {
        id: wsData.id,
        label: wsData.label,
        activeTermId: wsData.activeTermId,
        layout: null
      };
      if (wsData.color) ws.color = wsData.color;

      ws.layout = deserializeLayout(wsData.layout, ws);
      workspaces.push(ws);
      wsCount++;
    }

    activeWsId = state.activeWsId || workspaces[0]?.id;
    return true;
  } catch { return false; }
}

/* ═══════════════════════════════════════════════════════════════
   WORKSPACE MANAGEMENT
═══════════════════════════════════════════════════════════════ */
let wsCount = 0;

function createWorkspace(label) {
  wsCount++;
  const id = uuid();
  const ws = { id, label: label || 'Workspace', layout: null, activeTermId: null };
  workspaces.push(ws);
  activateWorkspace(id);
  addTerminal(id);
  return ws;
}

function activateWorkspace(id, skipRender) {
  activeWsId = id;
  if (!skipRender) {
    renderSidebar();
    switchWorkspacePane();
    updateStatusBar();
  }
  saveState();
}

function switchWorkspacePane() {
  const area = document.getElementById('pane-area');
  const empty = document.getElementById('empty-state');
  const wsp = activeWs();

  // Hide all cached workspace containers
  Object.values(_wsDomCache).forEach(el => { el.style.display = 'none'; });

  if (!wsp || !wsp.layout) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  let container = _wsDomCache[wsp.id];
  if (!container) {
    container = document.createElement('div');
    container.className = 'ws-pane-container';
    container.dataset.wsId = wsp.id;
    container.style.position = 'absolute';
    container.style.inset = '0';
    _wsDomCache[wsp.id] = container;

    if (wsp._maximizedGroupId) {
      const group = findGroupById(wsp.layout, wsp._maximizedGroupId);
      if (group) {
        const groupDom = buildNodeDom(group, wsp);
        if (groupDom) {
          groupDom.style.position = 'absolute';
          groupDom.style.inset = '0';
          container.appendChild(groupDom);
          const groupEl = document.getElementById('group-' + group.id);
          if (groupEl) groupEl.classList.add('maximized');
        }
      } else {
        wsp._maximizedGroupId = null;
        const rootDom = buildNodeDom(wsp.layout, wsp);
        if (rootDom) container.appendChild(rootDom);
      }
    } else {
      const rootDom = buildNodeDom(wsp.layout, wsp);
      if (rootDom) container.appendChild(rootDom);
    }
    area.appendChild(container);
  }

  container.style.display = 'block';

  setTimeout(() => {
    const all = getWorkspaceTerminals(wsp);
    all.forEach(fitTerm);
    document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
    const active = all.find(x => x.id === wsp.activeTermId);
    if (active && active.el) {
      focusedSlotId = active.el.id;
      active.el.classList.add('focused');
      if (active.type !== 'browser') active.term.focus();
    }
    updateFocusedGroup();
    updateStatusBar();
  }, 30);
}

function nextWorkspace() {
  if (workspaces.length <= 1) return;
  const idx = workspaces.findIndex(w => w.id === activeWsId);
  activateWorkspace(workspaces[(idx + 1) % workspaces.length].id);
}

function prevWorkspace() {
  if (workspaces.length <= 1) return;
  const idx = workspaces.findIndex(w => w.id === activeWsId);
  activateWorkspace(workspaces[(idx - 1 + workspaces.length) % workspaces.length].id);
}

function removeWorkspace(id) {
  const ws = findWs(id);
  if (!ws) return;
  const termCount = getWorkspaceTerminals(ws).length;
  const msg = termCount > 0
    ? `Close "${ws.label}" with ${termCount} terminal${termCount > 1 ? 's' : ''}?`
    : `Close "${ws.label}"?`;
  showConfirm(msg, () => _removeWorkspace(id));
}

function _removeWorkspace(id) {
  const ws = findWs(id);
  if (!ws) return;
  const terms = getWorkspaceTerminals(ws);
  terms.forEach(t => removeTerminal(ws.id, t.id, true));

  // Clean up cached DOM
  if (_wsDomCache[id]) { _wsDomCache[id].remove(); delete _wsDomCache[id]; }

  const idx = workspaces.findIndex(w => w.id === id);
  workspaces.splice(idx, 1);
  if (activeWsId === id) {
    if (workspaces.length) activateWorkspace(workspaces[Math.max(0, idx-1)].id);
    else { activeWsId = null; renderSidebar(); renderPaneArea(); updateStatusBar(); }
  } else {
    renderSidebar();
  }
  saveState();
}

function renameWorkspace(id) {
  const ws = findWs(id);
  if (!ws) return;

  showPrompt('Edit workspace', ws.label, { color: ws.color || '' }, (value, color) => {
    ws.label = value.trim() || ws.label;
    ws.color = color || undefined;
    renderSidebar();
    updateStatusBar();
    saveState();
  });
}

/* ═══════════════════════════════════════════════════════════════
   TERMINAL MANAGEMENT
═══════════════════════════════════════════════════════════════ */
function _createTermEntry(wsp, id, label) {
  const term = new Terminal({
    theme: makeXtermTheme(currentTheme),
    fontFamily: currentFontFamily,
    fontSize: currentFontSize,
    lineHeight: currentLineHeight,
    cursorBlink: currentCursorBlink,
    cursorStyle: currentCursorStyle,
    scrollback: currentScrollback,
    allowTransparency: true,
    allowProposedApi: true,
    macOptionIsMeta: true,
    drawBoldTextInBrightColors: true,
    minimumContrastRatio: 1,
    drawWideChars: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  const searchAddon = new SearchAddon.SearchAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon((e, uri) => openExternalUrl(uri));
  try { const u11 = new Unicode11Addon.Unicode11Addon(); term.loadAddon(u11); term.unicode.activeVersion = '11'; } catch {}
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(webLinksAddon);
  try { term._webglAddon = new WebglAddon.WebglAddon(); term.loadAddon(term._webglAddon); } catch (e) { /* canvas fallback */ }

  term.onData(data => { if (wsReady) sendStdin(id, new TextEncoder().encode(data)); });
  term.onBinary(data => {
    if (wsReady) {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      sendStdin(id, bytes);
    }
  });
  term.onTitleChange(title => {
    const terms = getWorkspaceTerminals(wsp);
    const t = terms.find(x => x.id === id);
    if (t) {
      t.label = title || t.label;
      // Lightweight update: just change the tab label in the DOM
      const tabEl = document.querySelector(`.tg-tab[data-termid="${id}"] .tg-tab-name`);
      if (tabEl) tabEl.textContent = t.label;
      const tabWrap = document.querySelector(`.tg-tab[data-termid="${id}"]`);
      if (tabWrap) tabWrap.title = t.label;
      renderSidebar();
    }
  });

  const entry = { id, label, term, fit: fitAddon, search: searchAddon, el: null, opened: false };
  return entry;
}

function addTerminal(wsId, targetGroupId) {
  const wsp = findWs(wsId || activeWsId);
  if (!wsp) return;

  const id = uuid();
  const allTerms = getWorkspaceTerminals(wsp);
  const label = `bash ${allTerms.length + 1}`;
  const entry = _createTermEntry(wsp, id, label);

  if (!wsp.layout) {
    wsp.layout = {
      type: 'group',
      id: 'group-' + uuid(),
      terminals: [entry],
      activeTermId: id
    };
    renderPaneArea();
    activateTerminal(wsp.id, id);
  } else {
    let targetGroup = null;
    if (targetGroupId) targetGroup = findGroupById(wsp.layout, targetGroupId);
    if (!targetGroup) {
      const active = activeTerminal();
      if (active) targetGroup = findGroupContainingTerm(wsp.layout, active.id);
    }
    if (!targetGroup) targetGroup = findFirstGroup(wsp.layout);

    if (targetGroup) {
      targetGroup.terminals.push(entry);
      // Push old active to history before switching
      if (!targetGroup._history) targetGroup._history = [];
      if (targetGroup.activeTermId) targetGroup._history.push(targetGroup.activeTermId);
      targetGroup.activeTermId = id;
      wsp.activeTermId = id;
      // Incremental DOM update: add tab + slot without rebuilding everything
      const groupEl = document.getElementById('group-' + targetGroup.id);
      if (groupEl) {
        const tabsContainer = groupEl.querySelector('.term-group-tabs');
        const body = groupEl.querySelector('.term-group-body');
        if (tabsContainer && body) {
          // Remove active from other tabs
          tabsContainer.querySelectorAll('.tg-tab').forEach(t => t.classList.remove('active'));
          // Create and add the new tab element (reuse renderPaneArea's tab builder logic)
          const tab = document.createElement('div');
          tab.className = 'tg-tab active';
          tab.dataset.termid = entry.id;
          tab.innerHTML = `<span class="tg-tab-dot"></span><span class="tg-tab-name">${escHtml(entry.label)}</span><span class="tg-tab-close" title="Close">✕</span>`;
          tab.title = entry.label;
          applyTabColor(tab, entry.color);
          tab.draggable = true;
          tab.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); removeTerminal(wsp.id, entry.id); } });
          tab.addEventListener('click', e => {
            if (e.target.classList.contains('tg-tab-close')) { removeTerminal(wsp.id, entry.id); return; }
            const now = Date.now();
            if (now - _lastTabClickTime < 350 && _lastTabClickTermId === entry.id) {
              _lastTabClickTime = 0; _lastTabClickTermId = null;
              toggleMaximizeTerminal(wsp.id, entry.id);
            } else {
              _lastTabClickTime = now; _lastTabClickTermId = entry.id;
              activateTerminal(wsp.id, entry.id);
            }
          });
          tab.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'terminal', { wsId: wsp.id, termId: entry.id }); });
          // Drag & drop
          tab.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(); });
          tab.addEventListener('dragend', () => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); });
          tab.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-left' : 'drop-right'); });
          tab.addEventListener('dragleave', () => { tab.classList.remove('drop-left', 'drop-right'); });
          tab.addEventListener('drop', e => { e.preventDefault(); const draggedId = window.draggedTermId || e.dataTransfer.getData('text/plain'); if (draggedId && draggedId !== entry.id) { const fromIdx = targetGroup.terminals.findIndex(x => x.id === draggedId); let toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); if (fromIdx !== -1 && toIdx !== -1) { const [moved] = targetGroup.terminals.splice(fromIdx, 1); toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); const insertIdx = e.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2 ? toIdx : toIdx + 1; targetGroup.terminals.splice(insertIdx, 0, moved); targetGroup.activeTermId = draggedId; } renderPaneArea(); activateTerminal(wsp.id, draggedId); } tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); });
          tabsContainer.appendChild(tab);
          // Create and add the slot
          const slot = getOrCreateSlot(entry, wsp, body);
          document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
          body.querySelectorAll('.term-slot').forEach(s => { s.style.display = 'none'; });
          slot.style.display = 'block';
          slot.classList.add('focused');
          body.appendChild(slot);
          focusedSlotId = slot.id; updateFocusedGroup();
          // Double RAF ensures DOM has rendered and canvas is ready
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              fitTerm(entry);
              entry.term.focus();
            });
          });
        }
      }
    } else {
      renderPaneArea();
      activateTerminal(wsp.id, id);
    }
  }

  renderSidebar();

  setTimeout(() => {
    const slot = getSlotDimensions(entry);
    sendControl({ type: 'create', id, cols: slot.cols, rows: slot.rows });
    // Fit again after PTY is connected
    requestAnimationFrame(() => fitTerm(entry));
  }, 80);

  saveState();
  return entry;
}

function addBrowserTab(wsId, targetGroupId, url) {
  const wsp = findWs(wsId || activeWsId);
  if (!wsp) return;

  const id = uuid();
  const allTerms = getWorkspaceTerminals(wsp);
  const label = `browser ${allTerms.length + 1}`;
  const entry = { id, label, type: 'browser', url: url || 'about:blank', iframe: null, el: null, opened: false };

  if (!wsp.layout) {
    wsp.layout = {
      type: 'group',
      id: 'group-' + uuid(),
      terminals: [entry],
      activeTermId: id
    };
    renderPaneArea();
    activateTerminal(wsp.id, id);
  } else {
    let targetGroup = null;
    if (targetGroupId) targetGroup = findGroupById(wsp.layout, targetGroupId);
    if (!targetGroup) {
      const active = activeTerminal();
      if (active) targetGroup = findGroupContainingTerm(wsp.layout, active.id);
    }
    if (!targetGroup) targetGroup = findFirstGroup(wsp.layout);

    if (targetGroup) {
      targetGroup.terminals.push(entry);
      if (!targetGroup._history) targetGroup._history = [];
      if (targetGroup.activeTermId) targetGroup._history.push(targetGroup.activeTermId);
      targetGroup.activeTermId = id;
      wsp.activeTermId = id;
      // Incremental DOM update
      const groupEl = document.getElementById('group-' + targetGroup.id);
      if (groupEl) {
        const tabsContainer = groupEl.querySelector('.term-group-tabs');
        const body = groupEl.querySelector('.term-group-body');
        if (tabsContainer && body) {
          tabsContainer.querySelectorAll('.tg-tab').forEach(t => t.classList.remove('active'));
          const tab = document.createElement('div');
          tab.className = 'tg-tab active';
          tab.dataset.termid = entry.id;
          tab.innerHTML = `<span class="tg-tab-dot"></span><span class="tg-tab-name">${escHtml(entry.label)}</span><span class="tg-tab-close" title="Close">✕</span>`;
          tab.title = entry.label;
          applyTabColor(tab, entry.color);
          tab.draggable = true;
          tab.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); removeTerminal(wsp.id, entry.id); } });
          tab.addEventListener('click', e => {
            if (e.target.classList.contains('tg-tab-close')) { removeTerminal(wsp.id, entry.id); return; }
            const now = Date.now();
            if (now - _lastTabClickTime < 350 && _lastTabClickTermId === entry.id) {
              _lastTabClickTime = 0; _lastTabClickTermId = null;
              toggleMaximizeTerminal(wsp.id, entry.id);
            } else {
              _lastTabClickTime = now; _lastTabClickTermId = entry.id;
              activateTerminal(wsp.id, entry.id);
            }
          });
          tab.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'terminal', { wsId: wsp.id, termId: entry.id }); });
          tab.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(); });
          tab.addEventListener('dragend', () => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); });
          tab.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-left' : 'drop-right'); });
          tab.addEventListener('dragleave', () => { tab.classList.remove('drop-left', 'drop-right'); });
          tab.addEventListener('drop', e => { e.preventDefault(); const draggedId = window.draggedTermId || e.dataTransfer.getData('text/plain'); if (draggedId && draggedId !== entry.id) { const fromIdx = targetGroup.terminals.findIndex(x => x.id === draggedId); let toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); if (fromIdx !== -1 && toIdx !== -1) { const [moved] = targetGroup.terminals.splice(fromIdx, 1); toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); const insertIdx = e.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2 ? toIdx : toIdx + 1; targetGroup.terminals.splice(insertIdx, 0, moved); targetGroup.activeTermId = draggedId; } renderPaneArea(); activateTerminal(wsp.id, draggedId); } tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); });
          tabsContainer.appendChild(tab);
          // Create slot
          const slot = getOrCreateSlot(entry, wsp, body);
          document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
          body.querySelectorAll('.term-slot').forEach(s => { s.style.display = 'none'; });
          slot.style.display = 'flex';
          slot.classList.add('focused');
          body.appendChild(slot);
          focusedSlotId = slot.id; updateFocusedGroup();
          // Focus URL input
          setTimeout(() => { const urlInput = slot.querySelector('.browser-url'); if (urlInput) urlInput.focus(); }, 20);
        }
      }
    } else {
      renderPaneArea();
      activateTerminal(wsp.id, id);
    }
  }

  renderSidebar();
  saveState();
  return entry;
}

function getSlotDimensions(entry) {
  if (entry.el) {
    const w = entry.el.offsetWidth - 16;
    const h = entry.el.offsetHeight - 12;
    const cw = 8; const ch = 17;
    return { cols: Math.max(1, Math.floor(w/cw)), rows: Math.max(1, Math.floor(h/ch)) };
  }
  return { cols: 80, rows: 24 };
}

function activateTerminal(wsId, termId) {
  const wsp = findWs(wsId);
  if (!wsp) return;
  wsp.activeTermId = termId;

  const group = findGroupContainingTerm(wsp.layout, termId);
  if (group) {
    // Track activation history (stack) for LIFO tab switching
    if (!group._history) group._history = [];
    group._history = group._history.filter(id => id !== termId);
    if (group.activeTermId && group.activeTermId !== termId) group._history.push(group.activeTermId);
    group.activeTermId = termId;
  }

  if (activeWsId === wsId) {
    // Lightweight update: toggle visibility without rebuilding the DOM
    // (preserves browser tab state, iframe content, etc.)
    // Clear focus from ALL slots across all groups
    document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));

    if (group) {
      const groupEl = document.getElementById('group-' + group.id);
      if (groupEl) {
        // Update tab active state
        groupEl.querySelectorAll('.tg-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.termid === termId);
        });
        // Toggle slot visibility
        group.terminals.forEach(t => {
          const slot = document.getElementById('slot-' + t.id);
          if (!slot) return;
          const isActive = t.id === termId;
          const showAs = t.type === 'browser' ? 'flex' : 'block';
          slot.style.display = isActive ? showAs : 'none';
          // Show/hide native webview
          if (t._webview) {
            try { isActive ? t._webview.show() : t._webview.hide(); } catch {}
          }
        });
      }
    }
    updateStatusBar();
    const terms = getWorkspaceTerminals(wsp);
    const t = terms.find(x => x.id === termId);
    if (t && t.el) {
      focusedSlotId = t.el.id; updateFocusedGroup();
      t.el.classList.add('focused');
      if (t.type === 'browser') {
        setTimeout(() => {
          const urlInput = t.el.querySelector('.browser-url');
          if (urlInput) urlInput.focus();
        }, 20);
      } else {
        setTimeout(() => { t.term.focus(); fitTerm(t); }, 20);
      }
    }
  }
  clearTimeout(activateTerminal._saveTimer);
  activateTerminal._saveTimer = setTimeout(saveState, 500);
}

function removeTerminal(wsId, termId, skipRender) {
  const wsp = findWs(wsId);
  if (!wsp || !wsp.layout) return;

  // Last tab in workspace — remove the workspace with confirmation
  if (!skipRender && getWorkspaceTerminals(wsp).length <= 1) {
    const label = wsp.label;
    showConfirm(`Close "${label}"?`, () => _removeWorkspace(wsId));
    return;
  }

  const group = findGroupContainingTerm(wsp.layout, termId);
  if (!group) return;

  // If maximized and removing the last terminal in the maximized group, unmaximize first
  if (wsp._maximizedGroupId === group.id && group.terminals.length <= 1) {
    wsp._maximizedGroupId = null;
  }

  const idx = group.terminals.findIndex(t => t.id === termId);
  if (idx === -1) return;

  const entry = group.terminals[idx];
  if (entry.type !== 'browser') {
    if (isTauri() && tauriPtyReady) {
      window.__TAURI_INTERNALS__.invoke('close_terminal', { id: termId }).catch(() => {});
    } else {
      sendControl({ type: 'close', id: termId });
    }
    if (_ptyListeners[termId]) { _ptyListeners[termId](); delete _ptyListeners[termId]; }
    entry.term.dispose();
  } else {
    if (entry._msgCleanup) entry._msgCleanup();
    if (entry._resizeObs) { entry._resizeObs.disconnect(); entry._resizeObs = null; }
    if (entry._webview) { try { entry._webview.close(); } catch {} entry._webview = null; }
  }
  if (entry.el) entry.el.remove();

  group.terminals.splice(idx, 1);

  if (group.activeTermId === termId) {
    // Use history stack to find last active tab, preferring terminals
    let nextId = null;
    if (group._history) {
      while (group._history.length) {
        const candidate = group._history.pop();
        if (candidate !== termId && group.terminals.some(t => t.id === candidate)) {
          nextId = candidate;
          break;
        }
      }
    }
    if (!nextId) {
      const nextTerm = group.terminals.slice(idx).concat(group.terminals.slice(0, idx)).find(t => t.type !== 'browser');
      nextId = nextTerm ? nextTerm.id : (group.terminals.length ? group.terminals[Math.min(idx, group.terminals.length - 1)].id : null);
    }
    group.activeTermId = nextId;
  }

  if (wsp.activeTermId === termId) {
    wsp.activeTermId = group.activeTermId || null;
  }

  const groupCountBefore = countGroups(wsp.layout);
  wsp.layout = removeEmptyGroups(wsp.layout);
  const structureChanged = countGroups(wsp.layout) !== groupCountBefore;

  if (!skipRender && activeWsId === wsId) {
    if (structureChanged) {
      // Layout structure changed (split collapsed) — full rebuild needed
      renderPaneArea();
    } else {
      // Just update the affected group's tabs + slot visibility
      const groupEl = document.getElementById('group-' + group.id);
      if (groupEl) {
        // Remove the closed tab's DOM elements
        const oldTab = groupEl.querySelector(`.tg-tab[data-termid="${termId}"]`);
        if (oldTab) oldTab.remove();
        // Update active state on remaining tabs
        groupEl.querySelectorAll('.tg-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.termid === group.activeTermId);
        });
        // Show/hide slots
        const body = groupEl.querySelector('.term-group-body');
        if (body) {
          document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
          group.terminals.forEach(t => {
            const slot = document.getElementById('slot-' + t.id);
            if (!slot) return;
            const isActive = t.id === group.activeTermId;
            slot.style.display = isActive ? (t.type === 'browser' ? 'flex' : 'block') : 'none';
            if (isActive) slot.classList.add('focused');
          });
        }
      }
    }
    // Focus the new active tab
    const newActiveId = wsp.activeTermId || group.activeTermId;
    if (newActiveId) {
      const newEntry = getWorkspaceTerminals(wsp).find(x => x.id === newActiveId);
      if (newEntry && newEntry.el) {
        focusedSlotId = newEntry.el.id; updateFocusedGroup();
        newEntry.el.classList.add('focused');
        if (newEntry.type === 'browser') {
          setTimeout(() => { const inp = newEntry.el.querySelector('.browser-url'); if (inp) inp.focus(); }, 20);
        } else if (newEntry.term) {
          getWorkspaceTerminals(wsp).forEach(t => { if (t._webview) { try { t._webview.hide(); } catch {} } });
          setTimeout(() => { newEntry.term.focus(); fitTerm(newEntry); }, 20);
        }
      }
    }
    updateStatusBar();
  }
  renderSidebar();
  saveState();
}

function applyTabColor(tabEl, color) {
  if (color) {
    tabEl.dataset.color = color;
    tabEl.style.setProperty('--tab-color', color);
  } else {
    delete tabEl.dataset.color;
    tabEl.style.removeProperty('--tab-color');
  }
}

function renameTerminal(wsId, termId) {
  renameTerminalInGroup(wsId, termId);
}

function renameTerminalInGroup(wsId, termId) {
  const wsp = findWs(wsId);
  if (!wsp) return;
  const terms = getWorkspaceTerminals(wsp);
  const t = terms.find(x => x.id === termId);
  if (!t) return;

  showPrompt('Edit tab', t.label, { color: t.color || '' }, (value, color) => {
    t.label = value.trim() || t.label;
    t.color = color || undefined;
    const tabEl = document.querySelector(`.tg-tab[data-termid="${termId}"] .tg-tab-name`);
    if (tabEl) tabEl.textContent = t.label;
    const tabWrap = document.querySelector(`.tg-tab[data-termid="${termId}"]`);
    if (tabWrap) {
      tabWrap.title = t.label;
      applyTabColor(tabWrap, t.color);
    }
    renderSidebar();
    updateStatusBar();
    saveState();
  });
}

function handleExit(id, code) {
  const result = findTermById(id);
  if (!result) return;
  const { ws, term: t } = result;
  if (!isTauri()) sendControl({ type: 'close', id });
  removeTerminal(ws.id, id);
}

function handleError(id, msg) {
  const result = findTermById(id);
  if (result) {
    result.term.term.write(`\r\n\x1b[31m[Error: ${msg}]\x1b[0m\r\n`);
    result.term.term.options.disableStdin = true;
    result.term.dead = true;
  }
}

function fitTerm(entry) {
  if (!entry || !entry.el || entry.type === 'browser') return;
  try {
    entry.fit.fit();
    const dims = entry.term.rows && entry.term.cols
      ? { cols: entry.term.cols, rows: entry.term.rows }
      : { cols: 80, rows: 24 };
    sendControl({ type: 'resize', id: entry.id, cols: dims.cols, rows: dims.rows });
    updateStatusBar();
  } catch {}
}

/* ═══════════════════════════════════════════════════════════════
   SPLIT MANAGEMENT (VS Code recursive logic)
═══════════════════════════════════════════════════════════════ */
function splitGroupDirectly(wsId, groupId, direction) {
  const wsp = findWs(wsId);
  if (!wsp) return;

  const group = findGroupById(wsp.layout, groupId);
  if (!group) return;

  const newId = uuid();
  const termsCount = getWorkspaceTerminals(wsp).length;
  const entry = _createTermEntry(wsp, newId, `bash ${termsCount + 1}`);

  const newGroup = {
    type: 'group',
    id: 'group-' + uuid(),
    terminals: [entry],
    activeTermId: newId
  };

  wsp.layout = splitGroupNodeInTree(wsp.layout, groupId, newGroup, direction, false);

  activateTerminal(wsp.id, newId);
  renderPaneArea();

  setTimeout(() => {
    const slot = getSlotDimensions(entry);
    sendControl({ type: 'create', id: newId, cols: slot.cols, rows: slot.rows });
    requestAnimationFrame(() => fitTerm(entry));
  }, 80);
  saveState();
}

function splitGroupNodeInTree(root, destGroupId, newGroup, direction, isFirst) {
  if (root.id === destGroupId) {
    return {
      type: 'split',
      id: 'split-' + uuid(),
      direction,
      children: isFirst ? [newGroup, root] : [root, newGroup],
      sizes: [50, 50]
    };
  }

  function recurse(node) {
    if (node.type === 'split') {
      const idx = node.children.findIndex(c => c.id === destGroupId);
      if (idx !== -1) {
        const destNode = node.children[idx];
        if (node.direction === direction) {
          node.children.splice(isFirst ? idx : idx + 1, 0, newGroup);
          const originalSize = node.sizes[idx] || 50;
          node.sizes[idx] = originalSize / 2;
          node.sizes.splice(isFirst ? idx : idx + 1, 0, originalSize / 2);
        } else {
          node.children[idx] = {
            type: 'split',
            id: 'split-' + uuid(),
            direction,
            children: isFirst ? [newGroup, destNode] : [destNode, newGroup],
            sizes: [50, 50]
          };
        }
        return true;
      }
      for (const child of node.children) {
        if (recurse(child)) return true;
      }
    }
    return false;
  }

  recurse(root);
  return root;
}

/* ═══════════════════════════════════════════════════════════════
   MAXIMIZE / RESTORE TAB
═══════════════════════════════════════════════════════════════ */
function toggleMaximizeTerminal(wsId, termId) {
  const wsp = findWs(wsId);
  if (!wsp) return;

  if (wsp._maximizedGroupId) {
    // Unmaximize
    wsp._maximizedGroupId = null;
  } else {
    const group = findGroupContainingTerm(wsp.layout, termId);
    if (!group) return;
    wsp._maximizedGroupId = group.id;
  }

  renderPaneArea();
}

/* ═══════════════════════════════════════════════════════════════
   PANE AREA RENDERING (Recursive execution tree)
═══════════════════════════════════════════════════════════════ */
function renderPaneArea() {
  const wsp = activeWs();
  // Invalidate cache for current workspace so switchWorkspacePane rebuilds it
  if (wsp && _wsDomCache[wsp.id]) {
    _wsDomCache[wsp.id].remove();
    delete _wsDomCache[wsp.id];
  }
  switchWorkspacePane();
}

function buildNodeDom(node, wsp) {
  if (!node) return null;

  if (node.type === 'split') {
    const container = document.createElement('div');
    container.className = `split-container ${node.direction}`;
    container.id = 'split-' + node.id;

    node.children.forEach((child, idx) => {
      if (idx > 0) {
        const sash = document.createElement('div');
        sash.className = `sash ${node.direction}`;
        makeSashDraggableTree(sash, container, node, idx);
        container.appendChild(sash);
      }

      const childDom = buildNodeDom(child, wsp);
      if (childDom) {
        const size = node.sizes[idx] !== undefined ? node.sizes[idx] : (100 / node.children.length);
        childDom.style.flex = `${size} 1 0%`;
        container.appendChild(childDom);
      }
    });

    return container;
  }

  if (node.type === 'group') {
    const groupEl = document.createElement('div');
    groupEl.className = 'term-group';
    groupEl.id = 'group-' + node.id;

    const header = document.createElement('div');
    header.className = 'term-group-header';
    header.addEventListener('mousedown', e => { if (!e.target.closest('[draggable]')) e.preventDefault(); });

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'term-group-tabs';

    node.terminals.forEach(t => {
      const tab = document.createElement('div');
      const isActive = t.id === node.activeTermId;
      tab.className = 'tg-tab' + (isActive ? ' active' : '') + (t.dead ? ' dead' : '');
      tab.dataset.termid = t.id;
      tab.draggable = true;

      tab.innerHTML = `
        <span class="tg-tab-dot"></span>
        <span class="tg-tab-name">${escHtml(t.label)}</span>
        <span class="tg-tab-close" title="Close">✕</span>
      `;
      tab.title = t.label;
      applyTabColor(tab, t.color);

      tab.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); removeTerminal(wsp.id, t.id); } });
      tab.addEventListener('click', e => {
        if (e.target.classList.contains('tg-tab-close')) {
          removeTerminal(wsp.id, t.id);
          return;
        }
        const now = Date.now();
        if (now - _lastTabClickTime < 350 && _lastTabClickTermId === t.id) {
          _lastTabClickTime = 0; _lastTabClickTermId = null;
          toggleMaximizeTerminal(wsp.id, t.id);
        } else {
          _lastTabClickTime = now; _lastTabClickTermId = t.id;
          activateTerminal(wsp.id, t.id);
        }
      });
      tab.addEventListener('contextmenu', e => {
        e.preventDefault();
        showCtxMenu(e, 'terminal', { wsId: wsp.id, termId: t.id });
      });

      tab.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        window.draggedTermId = t.id;
        window.dragSourceGroupId = node.id;
        tab.classList.add('dragging');
        startResizing();
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
          el.classList.remove('drop-left', 'drop-right');
        });
        stopResizing();
      });

      tab.addEventListener('dragover', e => {
        if (!window.draggedTermId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = tab.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
          el.classList.remove('drop-left', 'drop-right');
        });
        if (e.clientX < midX) {
          tab.classList.add('drop-left');
        } else {
          tab.classList.add('drop-right');
        }
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('drop-left', 'drop-right');
      });
      tab.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = window.draggedTermId;
        if (!draggedId || draggedId === t.id) return;
        const rect = tab.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const insertBefore = e.clientX < midX;

        if (window.dragSourceGroupId === node.id) {
          const fromIdx = node.terminals.findIndex(x => x.id === draggedId);
          let toIdx = node.terminals.findIndex(x => x.id === t.id);
          if (fromIdx === -1 || toIdx === -1) return;
          const [moved] = node.terminals.splice(fromIdx, 1);
          toIdx = node.terminals.findIndex(x => x.id === t.id);
          const insertIdx = insertBefore ? toIdx : toIdx + 1;
          node.terminals.splice(insertIdx, 0, moved);
          node.activeTermId = draggedId;
          renderPaneArea();
          saveState();
        } else {
          handleTerminalDrop(draggedId, node.id, 'center', wsp);
        }
        tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
          el.classList.remove('drop-left', 'drop-right');
        });
        window.draggedTermId = null;
        window.dragSourceGroupId = null;
      });

      tabsContainer.appendChild(tab);
    });

    // Double-click empty area of tab bar to add a new terminal
    tabsContainer.addEventListener('dblclick', e => {
      if (e.target.closest('.tg-tab')) return;
      addTerminal(wsp.id, node.id);
    });

    header.appendChild(tabsContainer);

    const actions = document.createElement('div');
    actions.className = 'term-group-actions';
    actions.addEventListener('mousedown', e => e.preventDefault());

    const addTabBtn = document.createElement('div');
    addTabBtn.className = 'tg-btn';
    addTabBtn.title = 'New terminal in this group';
    addTabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    addTabBtn.addEventListener('click', () => addTerminal(wsp.id, node.id));

    const splitH = document.createElement('div');
    splitH.className = 'tg-btn';
    splitH.title = 'Split Horizontal';
    splitH.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="20" rx="2"/><line x1="12" y1="2" x2="12" y2="22"/>
      </svg>
    `;
    splitH.onclick = () => splitGroupDirectly(wsp.id, node.id, 'row');

    const splitV = document.createElement('div');
    splitV.className = 'tg-btn';
    splitV.title = 'Split Vertical';
    splitV.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="20" rx="2"/><line x1="2" y1="12" x2="22" y2="12"/>
      </svg>
    `;
    splitV.onclick = () => splitGroupDirectly(wsp.id, node.id, 'column');

    const addBrowserBtn = document.createElement('div');
    addBrowserBtn.className = 'tg-btn';
    addBrowserBtn.title = 'New browser tab';
    addBrowserBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';
    addBrowserBtn.onclick = () => addBrowserTab(wsp.id, node.id);

    const isMax = wsp._maximizedGroupId === node.id;
    const maxBtn = document.createElement('div');
    maxBtn.className = 'tg-btn';
    maxBtn.title = isMax ? 'Restore' : 'Maximize';
    maxBtn.innerHTML = isMax
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    maxBtn.onclick = () => { if (node.activeTermId) toggleMaximizeTerminal(wsp.id, node.activeTermId); };

    actions.appendChild(addTabBtn);
    actions.appendChild(addBrowserBtn);
    actions.appendChild(splitH);
    actions.appendChild(splitV);
    actions.appendChild(maxBtn);
    header.appendChild(actions);
    groupEl.appendChild(header);

    const body = document.createElement('div');
    body.className = 'term-group-body';

    const overlay = document.createElement('div');
    overlay.className = 'drag-indicator-overlay';
    body.appendChild(overlay);

    node.terminals.forEach(t => {
      const isAct = t.id === node.activeTermId;
      const slot = getOrCreateSlot(t, wsp, body);
      const showAs = t.type === 'browser' ? 'flex' : 'block';
      slot.style.display = isAct ? showAs : 'none';
      if (isAct && slot.id === focusedSlotId) slot.classList.add('focused');
      else slot.classList.remove('focused');
      // Show/hide native webview
      if (t._webview) { try { isAct ? t._webview.show() : t._webview.hide(); } catch {} }
      body.appendChild(slot);
    });

    setupGroupDragAndDrop(body, node, wsp, overlay);

    groupEl.appendChild(body);
    return groupEl;
  }
}

function getOrCreateSlot(entry, wsp, parentEl) {
  if (entry.opened && entry.el) {
    if (entry.el.parentNode) entry.el.remove();
    return entry.el;
  }

  const slot = document.createElement('div');
  slot.className = 'term-slot';
  slot.id = 'slot-' + entry.id;

  if (entry.type === 'browser') {
    slot.classList.add('browser-slot');

    // ── History stack for back/forward ──
    if (!entry._history) { entry._history = []; entry._historyIdx = -1; }

    // ── Toolbar ──
    const toolbar = document.createElement('div');
    toolbar.className = 'browser-toolbar';

    const btnBack = document.createElement('button');
    btnBack.className = 'browser-btn';
    btnBack.title = 'Back';
    btnBack.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';

    const btnFwd = document.createElement('button');
    btnFwd.className = 'browser-btn';
    btnFwd.title = 'Forward';
    btnFwd.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';

    const btnReload = document.createElement('button');
    btnReload.className = 'browser-btn';
    btnReload.title = 'Reload';
    btnReload.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>';

    const btnOpenExt = document.createElement('button');
    btnOpenExt.className = 'browser-btn';
    btnOpenExt.title = 'Open in new tab';
    btnOpenExt.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

    const urlInput = document.createElement('input');
    urlInput.className = 'browser-url';
    urlInput.type = 'text';
    urlInput.value = entry.url && entry.url !== 'about:blank' ? entry.url : '';
    urlInput.spellcheck = false;
    urlInput.autocomplete = 'off';
    urlInput.placeholder = 'Search or enter URL…';

    const loadingBar = document.createElement('div');
    loadingBar.className = 'browser-loading-bar';

    toolbar.appendChild(btnBack);
    toolbar.appendChild(btnFwd);
    toolbar.appendChild(btnReload);
    toolbar.appendChild(urlInput);
    toolbar.appendChild(btnOpenExt);

    // ── Content area ──
    const contentWrap = document.createElement('div');
    contentWrap.className = 'browser-content';

    // Loading bar sits above the content
    contentWrap.appendChild(loadingBar);

    // Scrollable div for start/error pages
    const pageView = document.createElement('div');
    pageView.className = 'browser-page-view';
    contentWrap.appendChild(pageView);

    slot.appendChild(toolbar);
    slot.appendChild(contentWrap);
    entry.el = slot;
    entry._pageView = pageView;
    entry.opened = true;

    // ── Tauri native webview (lazy-created) ──
    let wvNative = null;
    let wvCurrentUrl = null;
    let resizeObs = null;
    let _wvPosRaf = null;
    let _wvLastRect = { x: -1, y: -1, w: -1, h: -1 };

    function positionWebview() {
      if (_wvPosRaf) return;
      _wvPosRaf = requestAnimationFrame(() => {
        _wvPosRaf = null;
        if (_suppressResize || !wvNative || !contentWrap.isConnected) return;
        const r = contentWrap.getBoundingClientRect();
        const x = Math.round(r.left), y = Math.round(r.top);
        const w = Math.round(r.width), h = Math.round(r.height);
        if (x === _wvLastRect.x && y === _wvLastRect.y && w === _wvLastRect.w && h === _wvLastRect.h) return;
        const dpi = window.__TAURI__ && window.__TAURI__.dpi;
        if (!dpi) return;
        const posChanged = x !== _wvLastRect.x || y !== _wvLastRect.y;
        _wvLastRect = { x, y, w, h };
        if (posChanged) wvNative.setPosition(new dpi.LogicalPosition(x, y));
        wvNative.setSize(new dpi.LogicalSize(w, h));
      });
    }

    async function destroyWebview() {
      if (wvNative) {
        try { await wvNative.close(); } catch {}
        wvNative = null;
        wvCurrentUrl = null;
        entry._webview = null;
      }
    }

    async function ensureWebview(url) {
      const wvApi = tauriWebview();
      const winApi = tauriWindow();
      if (!wvApi || !winApi) return false;

      // If webview exists with same URL, just show it
      if (wvNative && wvCurrentUrl === url) {
        wvNative.show();
        _wvLastRect = { x: -1, y: -1, w: -1, h: -1 };
        positionWebview();
        return true;
      }

      // Destroy existing webview if URL changed
      await destroyWebview();

      try {
        const appWindow = winApi.getCurrentWindow();
        const label = 'browser-' + entry.id + '-' + Date.now();
        wvNative = new wvApi.Webview(appWindow, label, {
          url: url,
          x: 0, y: 0, width: 800, height: 600
        });
        await new Promise((res, rej) => {
          wvNative.once('tauri://created', res);
          wvNative.once('tauri://error', e => rej(e));
        });
        wvCurrentUrl = url;
        _wvLastRect = { x: -1, y: -1, w: -1, h: -1 };
        positionWebview();
        wvNative.setAutoResize(false);
        if (!resizeObs) {
          resizeObs = new ResizeObserver(() => { if (!_suppressResize) positionWebview(); });
          resizeObs.observe(contentWrap);
          entry._resizeObs = resizeObs;
        }
        entry._webview = wvNative;
        return true;
      } catch (e) {
        console.error('Failed to create webview:', e);
        wvNative = null;
        wvCurrentUrl = null;
        return false;
      }
    }

    let loading = false;

    function showLoading(on) {
      loading = on;
      loadingBar.classList.toggle('active', on);
      btnReload.classList.toggle('spin', on);
    }

    function showError(url, msg) {
      if (wvNative) { try { wvNative.hide(); } catch {} }
      pageView.style.display = '';
      pageView.innerHTML = `
        <div class="browser-error-page">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke-width="2"/>
          </svg>
          <h2>Can't reach this page</h2>
          <p class="browser-error-url">${escHtml(url)}</p>
          <p class="browser-error-msg">${escHtml(msg)}</p>
          <div class="browser-error-actions">
            <button class="browser-error-btn" id="err-retry">Try again</button>
            <button class="browser-error-btn browser-error-btn-ext" id="err-ext">Open in browser ↗</button>
          </div>
        </div>`;
      pageView.querySelector('#err-retry')?.addEventListener('click', () => loadUrl(entry.url));
      pageView.querySelector('#err-ext')?.addEventListener('click', () => openExternalUrl(entry.url));
    }

    function showStartPage() {
      if (wvNative) { try { wvNative.hide(); } catch {} }
      pageView.style.display = '';
      pageView.innerHTML = `
        <div class="browser-start-page">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
          <p>Enter a URL or search term above</p>
          <p class="browser-start-hint">Native webview — all sites load directly.</p>
        </div>`;
    }

    function normalizeUrl(raw) {
      if (!raw || raw === 'about:blank') return null;
      let url = raw.trim();
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(url)) return url;
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url)) return 'http://' + url;
      if (!url.includes('.') || url.includes(' ')) return 'https://www.google.com/search?q=' + encodeURIComponent(url);
      return 'https://' + url;
    }

    async function loadUrl(rawUrl) {
      const url = normalizeUrl(rawUrl);
      if (!url) { showStartPage(); return; }

      showLoading(true);
      urlInput.value = url;
      entry.url = url;

      // Push history
      if (entry._history[entry._historyIdx] !== url) {
        entry._history = entry._history.slice(0, entry._historyIdx + 1);
        entry._history.push(url);
        entry._historyIdx = entry._history.length - 1;
      }
      updateNavButtons();
      entry.label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 28) || 'browser';
      renderSidebar();
      updateStatusBar();

      // In Tauri: use native webview (no proxy needed)
      if (isTauri() && tauriWebview() && tauriWindow()) {
        pageView.style.display = 'none';
        const ok = await ensureWebview(url);
        if (!ok) {
          showError(url, 'Failed to create native webview');
        }
        showLoading(false);
        return;
      }

      // Non-Tauri fallback: proxy fetch + iframe
      const proxyHost = window.location.hostname || '127.0.0.1';
      const proxyUrlFn = u => `http://${proxyHost}:${PROXY_PORT}/proxy?url=${encodeURIComponent(u)}`;
      let html = null;
      let lastErr = '';
      try {
        const res = await fetch(proxyUrlFn(url));
        if (res.ok) { html = await res.text(); }
        else { lastErr = `Proxy returned HTTP ${res.status}`; }
      } catch (err) {
        lastErr = 'Could not reach proxy server: ' + err.message;
      }
      showLoading(false);
      if (!html) { showError(url, lastErr); return; }
      try {
        html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '');
        const proxyBase = 'http://' + proxyHost + ':' + PROXY_PORT + '/proxy?url=';
        const navBridge = '<script>(' + (function(pxBase, pageUrl){
          document.addEventListener('click', function(e){
            var a = e.target.closest && e.target.closest('a[href]');
            if (!a) return;
            var href = a.getAttribute('href');
            if (!href || href.indexOf('javascript:') === 0 || href.charAt(0) === '#') return;
            e.preventDefault();
            try { var u = new URL(href, pageUrl); var i = u.searchParams.get('url'); if (i) href = decodeURIComponent(i); } catch(x){}
            try { window.parent.postMessage({terminusNav: href}, '*'); } catch(x){}
          }, true);
          var origFetch = window.fetch;
          window.fetch = function(input, init){
            try {
              var url = typeof input === 'string' ? input : (input && input.url);
              if (url && /^(https?:\/\/|\/)/.test(url)) {
                var abs = new URL(url, pageUrl).href;
                return origFetch.call(this, pxBase + encodeURIComponent(abs), init);
              }
            } catch(x){}
            return origFetch.call(this, input, init);
          };
          var origOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest){
            try {
              if (url && /^(https?:\/\/|\/)/.test(url)) {
                url = new URL(url, pageUrl).href;
                url = pxBase + encodeURIComponent(url);
              }
            } catch(x){}
            return origOpen.call(this, method, url, ...rest);
          };
          var origCreateElement = document.createElement;
          document.createElement = function(tagName, options) {
            var el = origCreateElement.call(document, tagName, options);
            var tag = tagName.toLowerCase();
            if (tag === 'script') {
              var descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
              Object.defineProperty(el, 'src', {
                get: function() { return descriptor.get.call(el); },
                set: function(val) {
                  if (val && !val.startsWith(pxBase) && !val.startsWith('data:')) {
                    var abs = new URL(val, pageUrl).href;
                    descriptor.set.call(el, pxBase + encodeURIComponent(abs));
                  } else { descriptor.set.call(el, val); }
                }, configurable: true
              });
            } else if (tag === 'link') {
              var descriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
              Object.defineProperty(el, 'href', {
                get: function() { return descriptor.get.call(el); },
                set: function(val) {
                  if (val && !val.startsWith(pxBase) && !val.startsWith('data:')) {
                    var abs = new URL(val, pageUrl).href;
                    descriptor.set.call(el, pxBase + encodeURIComponent(abs));
                  } else { descriptor.set.call(el, val); }
                }, configurable: true
              });
            }
            return el;
          };
        }).toString() + ')(' + JSON.stringify(proxyBase) + ',' + JSON.stringify(url) + ')<\/script>';
        const baseStyles = '<style>body{margin:0;font-family:sans-serif;font-size:14px;line-height:1.5;color:#222}a{color:#1a73e8}</style>';
        // Create or reuse iframe for fallback
        let iframe = contentWrap.querySelector('iframe.browser-fallback');
        if (!iframe) {
          iframe = document.createElement('iframe');
          iframe.className = 'browser-fallback';
          iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff;display:none;';
          iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups';
          contentWrap.insertBefore(iframe, pageView);
        }
        pageView.style.display = 'none';
        iframe.style.display = 'block';
        iframe.removeAttribute('src');
        iframe.srcdoc = baseStyles + navBridge + html;
      } catch (e) {
        showError(url, 'Failed to render page: ' + e.message);
      }
    }

    entry._loadUrl = loadUrl;

    function updateNavButtons() {
      btnBack.disabled = entry._historyIdx <= 0;
      btnFwd.disabled = entry._historyIdx >= entry._history.length - 1;
      btnBack.style.opacity = btnBack.disabled ? '0.35' : '';
      btnFwd.style.opacity = btnFwd.disabled ? '0.35' : '';
    }

    // ── Navigation ──
    const navigate = () => {
      const raw = urlInput.value.trim();
      if (raw) loadUrl(raw);
    };

    urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); navigate(); }
      e.stopPropagation();
    });
    urlInput.addEventListener('focus', () => urlInput.select());

    btnBack.addEventListener('click', () => {
      if (entry._historyIdx > 0) {
        entry._historyIdx--;
        const url = entry._history[entry._historyIdx];
        urlInput.value = url;
        loadUrl(url);
      }
    });
    btnFwd.addEventListener('click', () => {
      if (entry._historyIdx < entry._history.length - 1) {
        entry._historyIdx++;
        const url = entry._history[entry._historyIdx];
        urlInput.value = url;
        loadUrl(url);
      }
    });
    btnReload.addEventListener('click', () => { if (!loading) loadUrl(entry.url); });
    btnOpenExt.addEventListener('click', () => { if (entry.url && entry.url !== 'about:blank') openExternalUrl(entry.url); });

    slot.addEventListener('mousedown', () => {
      document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
      slot.classList.add('focused');
      focusedSlotId = slot.id;
      updateFocusedGroup();
      wsp.activeTermId = entry.id;
      const group = findGroupContainingTerm(wsp.layout, entry.id);
      if (group) group.activeTermId = entry.id;
      updateStatusBar();
    });

    updateNavButtons();

    // Initial load
    if (entry.url && entry.url !== 'about:blank') {
      loadUrl(entry.url);
    } else {
      showStartPage();
    }

    return slot;
  }

  const wrap = document.createElement('div');
  wrap.className = 'term-wrap';
  slot.appendChild(wrap);

  entry.el = slot;
  entry.term.open(wrap);
  entry.opened = true;

  slot.addEventListener('mousedown', () => {
    document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
    slot.classList.add('focused');
    focusedSlotId = slot.id;
    updateFocusedGroup();
    wsp.activeTermId = entry.id;

    const group = findGroupContainingTerm(wsp.layout, entry.id);
    if (group) group.activeTermId = entry.id;

    updateStatusBar();
    entry.term.focus();
  });

  return slot;
}

/* ── Sash Dragging Logic inside layout Tree ── */
function makeSashDraggableTree(sash, container, node, childIdx) {
  let startPos = 0;
  let startSizes = [];

  sash.addEventListener('mousedown', e => {
    e.preventDefault();
    sash.classList.add('dragging');
    const isRow = node.direction === 'row';
    startPos = isRow ? e.clientX : e.clientY;

    const panes = [...container.children].filter(c => !c.classList.contains('sash'));
    startSizes = panes.map(p => isRow ? p.offsetWidth : p.offsetHeight);
    const dim = isRow ? 'width' : 'height';
    for (const p of panes) p.style.willChange = dim;
    _suppressResize = true;
    startResizing();

    const onMove = (ev) => {
      const pos = isRow ? ev.clientX : ev.clientY;
      const delta = pos - startPos;
      const prevIdx = childIdx - 1;
      const nextIdx = childIdx;
      const prevPane = panes[prevIdx];
      const nextPane = panes[nextIdx];
      if (!prevPane || !nextPane) return;

      const totalSize = startSizes[prevIdx] + startSizes[nextIdx];
      const newPrev = Math.max(80, startSizes[prevIdx] + delta);
      const newNext = Math.max(80, totalSize - newPrev);
      const actualPrev = totalSize - newNext;

      prevPane.style.flex = 'none';
      nextPane.style.flex = 'none';
      prevPane.style[dim] = actualPrev + 'px';
      nextPane.style[dim] = newNext + 'px';
    };

    const onUp = () => {
      sash.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      for (const p of panes) p.style.willChange = '';
      _suppressResize = false;

      const panes2 = [...container.children].filter(c => !c.classList.contains('sash'));
      const currentSizes = panes2.map(p => isRow ? p.offsetWidth : p.offsetHeight);
      const total = currentSizes.reduce((a, b) => a + b, 0);
      if (total > 0) {
        node.sizes = currentSizes.map(s => (s / total) * 100);
      }
      // Restore flex percentages and clear inline pixel sizes so window resize scales properly
      panes2.forEach((p, i) => {
        const pct = node.sizes[i] !== undefined ? node.sizes[i] : (100 / panes2.length);
        p.style.flex = `${pct} 1 0%`;
        if (isRow) p.style.width = '';
        else p.style.height = '';
      });
      const wsp = activeWs();
      if (wsp) {
        for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
      }
      saveState();
      stopResizing();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ═══════════════════════════════════════════════════════════════
   DRAG AND DROP HANDLERS
═══════════════════════════════════════════════════════════════ */
function setupGroupDragAndDrop(bodyEl, groupNode, wsp, overlay) {
  let dragDepth = 0;

  bodyEl.addEventListener('dragenter', e => {
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('active');
  });

  bodyEl.addEventListener('dragover', e => {
    e.preventDefault();
    const draggedId = window.draggedTermId || e.dataTransfer.getData('text/plain');
    if (!draggedId) return;

    const rect = bodyEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    let zone = 'center';
    if (x < w * 0.25) zone = 'left';
    else if (x > w * 0.75) zone = 'right';
    else if (y < h * 0.25) zone = 'top';
    else if (y > h * 0.75) zone = 'bottom';

    if (zone === 'left') {
      overlay.style.left = '0'; overlay.style.top = '0';
      overlay.style.width = '50%'; overlay.style.height = '100%';
    } else if (zone === 'right') {
      overlay.style.left = '50%'; overlay.style.top = '0';
      overlay.style.width = '50%'; overlay.style.height = '100%';
    } else if (zone === 'top') {
      overlay.style.left = '0'; overlay.style.top = '0';
      overlay.style.width = '100%'; overlay.style.height = '50%';
    } else if (zone === 'bottom') {
      overlay.style.left = '0'; overlay.style.top = '50%';
      overlay.style.width = '100%'; overlay.style.height = '50%';
    } else {
      overlay.style.left = '0'; overlay.style.top = '0';
      overlay.style.width = '100%'; overlay.style.height = '100%';
    }
  });

  bodyEl.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      overlay.classList.remove('active');
    }
  });

  bodyEl.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('active');

    const draggedId = window.draggedTermId || e.dataTransfer.getData('text/plain');
    if (!draggedId) return;

    const rect = bodyEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    let zone = 'center';
    if (x < w * 0.25) zone = 'left';
    else if (x > w * 0.75) zone = 'right';
    else if (y < h * 0.25) zone = 'top';
    else if (y > h * 0.75) zone = 'bottom';

    handleTerminalDrop(draggedId, groupNode.id, zone, wsp);
  });
}

function handleTerminalDrop(draggedId, targetGroupId, zone, wsp) {
  const srcGroup = findGroupContainingTerm(wsp.layout, draggedId);
  if (!srcGroup) return;

  const termIdx = srcGroup.terminals.findIndex(t => t.id === draggedId);
  if (termIdx === -1) return;

  const draggedTerm = srcGroup.terminals[termIdx];

  if (srcGroup.id === targetGroupId && zone === 'center') return;

  srcGroup.terminals.splice(termIdx, 1);
  if (srcGroup.activeTermId === draggedId) {
    srcGroup.activeTermId = srcGroup.terminals.length ? srcGroup.terminals[0].id : null;
  }

  const targetGroup = findGroupById(wsp.layout, targetGroupId);
  if (!targetGroup) return;

  if (zone === 'center') {
    targetGroup.terminals.push(draggedTerm);
    targetGroup.activeTermId = draggedId;
  } else {
    const newGroup = {
      type: 'group',
      id: 'group-' + uuid(),
      terminals: [draggedTerm],
      activeTermId: draggedId
    };
    const direction = (zone === 'left' || zone === 'right') ? 'row' : 'column';
    const isFirst = (zone === 'left' || zone === 'top');

    wsp.layout = splitGroupNodeInTree(wsp.layout, targetGroupId, newGroup, direction, isFirst);
  }

  wsp.layout = removeEmptyGroups(wsp.layout);

  const all = getWorkspaceTerminals(wsp);
  if (all.length > 0) {
    if (!all.some(t => t.id === wsp.activeTermId)) {
      wsp.activeTermId = draggedId;
    }
  } else {
    wsp.activeTermId = null;
  }

  activateTerminal(wsp.id, draggedId);
  renderPaneArea();
  saveState();
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR RENDERING
═══════════════════════════════════════════════════════════════ */
function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const actionsEl = sb.querySelector('.sidebar-actions');
  const expanded = sb.classList.contains('expanded');
  sb.querySelectorAll('.ws-btn, .ws-add').forEach(e => e.remove());

  for (const wsp of workspaces) {
    const btn = document.createElement('div');
    const isActive = wsp.id === activeWsId;
    btn.className = 'ws-btn' + (isActive ? ' active' : '');
    btn.dataset.wsid = wsp.id;
    const abbr = wsp.label.substring(0,3).toUpperCase();
    const tabCount = getWorkspaceTerminals(wsp).length;
    btn.innerHTML = `<span class="ws-strip"></span><span class="ws-label">${abbr}</span><span class="ws-name">${escHtml(wsp.label)}</span><span class="ws-actions"><span class="ws-action ws-rename" title="Rename">✎</span><span class="ws-action ws-remove" title="Close">✕</span></span><span class="ws-count">${tabCount}</span>`;
    btn.title = wsp.label;
    if (wsp.color) {
      btn.dataset.color = wsp.color;
      btn.style.setProperty('--ws-color', wsp.color);
    }
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.ws-action')) return;
      activateWorkspace(wsp.id);
    });
    btn.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); _suppressPasteUntil = Date.now() + 200; removeWorkspace(wsp.id); } });
    btn.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'workspace', wsp.id); });
    btn.querySelector('.ws-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      renameWorkspace(wsp.id);
    });
    btn.querySelector('.ws-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeWorkspace(wsp.id);
    });
    sb.insertBefore(btn, actionsEl);
  }

  const addBtn = document.createElement('div');
  addBtn.className = 'ws-add';
  addBtn.title = 'New workspace';
  addBtn.innerHTML = '+<span class="ws-add-text">New workspace</span>';
  addBtn.addEventListener('click', () => createWorkspace());
  sb.insertBefore(addBtn, actionsEl);
}

/* ═══════════════════════════════════════════════════════════════
   STATUS BAR
═══════════════════════════════════════════════════════════════ */
function updateStatusBar() {
  const wsp = activeWs();
  document.getElementById('sb-ws').textContent = wsp ? wsp.label : '—';
  const t = activeTerminal();
  document.getElementById('sb-term').textContent = t ? t.label : '—';
  if (t?.term) {
    const cols = t.term.cols || 0;
    const rows = t.term.rows || 0;
    document.getElementById('sb-size').textContent = cols && rows ? `${cols}×${rows} · ${currentFontSize}px` : '—';
  }
}

function tickClock() {
  const now = new Date();
  document.getElementById('sb-time').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000);
tickClock();

/* ═══════════════════════════════════════════════════════════════
   CONTEXT MENU
═══════════════════════════════════════════════════════════════ */
const ctxEl = document.getElementById('ctx');

function showCtxMenu(e, type, data) {
  ctxEl.innerHTML = '';

  const item = (icon, label, key, fn, danger) => {
    const el = document.createElement('div');
    el.className = 'ctx-item' + (danger ? ' danger' : '');
    el.innerHTML = `<span>${icon}</span><span>${label}</span>${key ? `<span class="ci-key">${key}</span>` : ''}`;
    el.addEventListener('click', () => { hideCtxMenu(); fn(); });
    ctxEl.appendChild(el);
  };
  const sep = () => { const el = document.createElement('div'); el.className = 'ctx-sep'; ctxEl.appendChild(el); };

  if (type === 'workspace') {
    const wsId = data;
    item('⊞', 'New terminal', 'Ctrl+Shift+T', () => { activateWorkspace(wsId); addTerminal(wsId); });
    sep();
    item('✎', 'Edit workspace', '', () => renameWorkspace(wsId));
    sep();
    item('✕', 'Close workspace', '', () => removeWorkspace(wsId), true);
  } else if (type === 'terminal') {
    const { wsId, termId } = data;
    const wsp = findWs(wsId);
    const isMaximized = wsp && wsp._maximizedGroupId && findGroupContainingTerm(wsp.layout, termId)?.id === wsp._maximizedGroupId;
    item(isMaximized ? '⧉' : '⛶', isMaximized ? 'Restore tab' : 'Maximize tab', '', () => toggleMaximizeTerminal(wsId, termId));
    item('⊞', 'New terminal', 'Ctrl+Shift+T', () => addTerminal(wsId));
    item('✎', 'Edit tab', '', () => renameTerminal(wsId, termId));
    sep();
    item('✕', 'Close terminal', 'Ctrl+Shift+W', () => removeTerminal(wsId, termId), true);
  }

  ctxEl.classList.add('open');
  const menuW = ctxEl.offsetWidth;
  const menuH = ctxEl.offsetHeight;
  let x = e.pageX;
  let y = e.pageY;
  if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4;
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;
  ctxEl.style.left = Math.max(0, x) + 'px';
  ctxEl.style.top = Math.max(0, y) + 'px';
}

function hideCtxMenu() { ctxEl.classList.remove('open'); }
document.addEventListener('click', e => { if (!e.target.closest('#ctx')) hideCtxMenu(); });

/* ═══════════════════════════════════════════════════════════════
   PROMPT MODAL
═══════════════════════════════════════════════════════════════ */
const promptOverlay = document.getElementById('prompt-overlay');
const promptInput = document.getElementById('prompt-input');
const promptLabel = document.getElementById('prompt-label');
const promptOk = document.getElementById('prompt-ok');
const promptCancel = document.getElementById('prompt-cancel');
const promptColors = document.getElementById('prompt-colors');
const promptSwatches = promptColors.querySelectorAll('.prompt-swatch');

function showPrompt(label, value, opts, callback) {
  if (typeof opts === 'function') { callback = opts; opts = {}; }
  promptLabel.textContent = label;
  promptInput.value = value;

  // Color swatches
  let selectedColor = '';
  if (opts.color !== undefined) {
    promptColors.style.display = 'block';
    selectedColor = opts.color || '';
    promptSwatches.forEach(s => {
      s.classList.toggle('active', s.dataset.color === selectedColor);
      s.onclick = () => {
        selectedColor = s.dataset.color;
        promptSwatches.forEach(x => x.classList.remove('active'));
        s.classList.add('active');
      };
    });
  } else {
    promptColors.style.display = 'none';
  }

  promptOverlay.classList.add('open');
  promptInput.focus();
  promptInput.select();

  const close = () => {
    promptOverlay.classList.remove('open');
    promptOk.onclick = null;
    promptCancel.onclick = null;
    promptInput.onkeydown = null;
    promptOverlay.onclick = null;
    promptSwatches.forEach(s => { s.onclick = null; });
  };

  const submit = () => {
    const val = promptInput.value;
    close();
    callback(val, selectedColor);
  };

  promptOk.onclick = submit;
  promptCancel.onclick = close;
  promptInput.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  };
  promptOverlay.onclick = e => { if (e.target === promptOverlay) close(); };
}

function showConfirm(message, callback) {
  promptLabel.textContent = message;
  promptInput.style.display = 'none';
  promptColors.style.display = 'none';

  promptOverlay.classList.add('open');
  promptOk.focus();

  let onKey;
  const close = () => {
    promptOverlay.classList.remove('open');
    promptInput.style.display = '';
    promptOk.onclick = null;
    promptCancel.onclick = null;
    promptOverlay.onclick = null;
    document.removeEventListener('keydown', onKey, true);
  };

  const submit = () => { close(); callback(); };

  onKey = e => {
    e.stopPropagation();
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  };

  promptOk.onclick = submit;
  promptCancel.onclick = close;
  promptOverlay.onclick = e => { if (e.target === promptOverlay) close(); };
  document.addEventListener('keydown', onKey, true);
}

/* ═══════════════════════════════════════════════════════════════
   FONT SIZE (Ctrl+Scroll)
═══════════════════════════════════════════════════════════════ */
const FONT_MIN = 8;
const FONT_MAX = 32;

document.getElementById('pane-area').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1;
  const newSize = Math.max(FONT_MIN, Math.min(FONT_MAX, currentFontSize + delta));
  if (newSize === currentFontSize) return;
  currentFontSize = newSize;
  const wsp = activeWs();
  if (!wsp) return;
  const terms = getWorkspaceTerminals(wsp);
  for (const t of terms) {
    if (t.type !== 'browser') t.term.options.fontSize = currentFontSize;
    fitTerm(t);
  }
  updateStatusBar();
}, { passive: false });

/* ═══════════════════════════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════════════════════════ */
const searchbar = document.getElementById('searchbar');
const searchInput = document.getElementById('search-input');

function openSearch() {
  searchbar.classList.add('open');
  searchInput.focus();
}
function closeSearch() {
  searchbar.classList.remove('open');
  const t = activeTerminal();
  if (t && t.type !== 'browser') t.term.focus();
}

searchInput.addEventListener('input', () => {
  const t = activeTerminal();
  if (t && t.search && searchInput.value) t.search.findNext(searchInput.value, { incremental: true });
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearch();
  if (e.key === 'Enter') {
    const t = activeTerminal();
    if (t && t.search) {
      if (e.shiftKey) t.search.findPrevious(searchInput.value);
      else t.search.findNext(searchInput.value);
    }
    e.preventDefault();
  }
});
document.getElementById('search-prev').addEventListener('click', () => {
  const t = activeTerminal();
  if (t && searchInput.value) t.search.findPrevious(searchInput.value);
});
document.getElementById('search-next').addEventListener('click', () => {
  const t = activeTerminal();
  if (t && searchInput.value) t.search.findNext(searchInput.value);
});
document.getElementById('search-close').addEventListener('click', closeSearch);

/* ═══════════════════════════════════════════════════════════════
   TOOLBAR BUTTONS
═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   CUSTOM DROPDOWN
═══════════════════════════════════════════════════════════════ */
function initCustomDropdown(dd) {
  const selectId = dd.dataset.for;
  const select = document.getElementById(selectId);
  if (!select) return;

  dd.innerHTML = '';
  const btn = document.createElement('div');
  btn.className = 'custom-dropdown-btn';
  btn.innerHTML = `<span class="custom-dropdown-label"></span><span class="dropdown-arrow">▼</span>`;
  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';
  dd.appendChild(btn);
  dd.appendChild(menu);

  function buildOptions() {
    menu.innerHTML = '';
    [...select.options].forEach(opt => {
      const el = document.createElement('div');
      el.className = 'custom-dropdown-option' + (opt.selected ? ' selected' : '');
      el.dataset.value = opt.value;
      // Support theme swatches via data-swatches attribute
      if (opt.dataset.swatches) {
        const swatches = opt.dataset.swatches.split(',');
        el.innerHTML = `<span class="theme-swatch">${swatches.map(c => `<span style="background:${c}"></span>`).join('')}</span><span>${opt.textContent}</span>`;
      } else {
        el.textContent = opt.textContent;
      }
      el.addEventListener('click', () => {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
        close();
      });
      menu.appendChild(el);
    });
  }

  function refresh() {
    const sel = select.options[select.selectedIndex];
    btn.querySelector('.custom-dropdown-label').textContent = sel ? sel.textContent : '';
    menu.querySelectorAll('.custom-dropdown-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.value === select.value);
    });
  }

  function close() {
    btn.classList.remove('open');
    menu.classList.remove('open');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('open');
    // Close all other dropdowns
    document.querySelectorAll('.custom-dropdown-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.custom-dropdown-btn.open').forEach(b => b.classList.remove('open'));
    if (!isOpen) {
      buildOptions();
      btn.classList.add('open');
      menu.classList.add('open');
    }
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!dd.contains(e.target)) close();
  });

  // Sync when select changes externally
  select.addEventListener('change', refresh);

  // Initial build
  buildOptions();
  refresh();
}

// Init all custom dropdowns
document.querySelectorAll('.custom-dropdown').forEach(initCustomDropdown);

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════════ */
const settingsOverlay = document.getElementById('settings-overlay');

function openSettings() {
  // Populate theme select
  const themeSelect = document.getElementById('set-theme');
  themeSelect.innerHTML = '';
  for (const [key, t] of Object.entries(THEMES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = t.label;
    opt.dataset.swatches = t.swatches.join(',');
    if (key === currentThemeName) opt.selected = true;
    themeSelect.appendChild(opt);
  }
  // Rebuild custom dropdown for theme
  const themeDD = document.querySelector('.custom-dropdown[data-for="set-theme"]');
  if (themeDD) initCustomDropdown(themeDD);

  // Font size
  document.getElementById('set-fontsize').value = currentFontSize;
  document.getElementById('set-fontsize-val').textContent = currentFontSize + 'px';

  // Font family
  document.getElementById('set-fontfamily').value = currentFontFamily;

  // Line height
  document.getElementById('set-lineheight').value = currentLineHeight;
  document.getElementById('set-lineheight-val').textContent = currentLineHeight.toFixed(1);

  // Cursor style
  document.getElementById('set-cursor').value = currentCursorStyle;

  // Cursor blink
  const blinkToggle = document.getElementById('set-cursorblink');
  blinkToggle.classList.toggle('on', currentCursorBlink);

  // Scrollback
  document.getElementById('set-scrollback').value = currentScrollback;
  document.getElementById('set-scrollback-val').textContent = currentScrollback.toLocaleString();

  // Shortcuts
  renderShortcutsList();

  // Activate first category
  switchSettingsCat('appearance');
  settingsOverlay.classList.add('open');
}

function closeSettings() {
  settingsOverlay.classList.remove('open');
}

function renderShortcutsList() {
  const list = document.getElementById('shortcuts-list');
  if (!list) return;
  list.innerHTML = '';
  for (const [action, sc] of Object.entries(customShortcuts)) {
    const item = document.createElement('div');
    item.className = 'shortcut-item';
    const label = document.createElement('span');
    label.textContent = SHORTCUT_LABELS[action] || action;
    const key = document.createElement('span');
    key.className = 'shortcut-key';
    key.textContent = formatKeyCombo(sc);
    key.addEventListener('click', () => startRecording(item, key, action));
    item.appendChild(label);
    item.appendChild(key);
    list.appendChild(item);
  }
}

function startRecording(item, keyEl, action) {
  // Cancel any existing recording
  document.querySelectorAll('.shortcut-key.recording').forEach(el => el.classList.remove('recording'));
  keyEl.classList.add('recording');
  keyEl.textContent = 'Press a key...';

  let pressed = {};      // track held keys by code
  let mainKey = null;     // the non-modifier key
  let modState = { ctrl: false, shift: false, alt: false, meta: false };
  let cancelled = false;

  function cleanup() {
    document.removeEventListener('keydown', onDown, true);
    document.removeEventListener('keyup', onUp, true);
  }

  function apply(combo) {
    cleanup();
    keyEl.classList.remove('recording');

    // Need at least one modifier
    if (!combo.ctrl && !combo.alt && !combo.meta) {
      keyEl.textContent = formatKeyCombo(customShortcuts[action]);
      return;
    }

    // Check for conflicts — swap if needed
    for (const [otherAction, otherSc] of Object.entries(customShortcuts)) {
      if (otherAction === action) continue;
      if (otherSc.key === combo.key && !!otherSc.ctrl === !!combo.ctrl
        && !!otherSc.shift === !!combo.shift && !!otherSc.alt === !!combo.alt
        && !!otherSc.meta === !!combo.meta) {
        customShortcuts[otherAction] = customShortcuts[action];
        break;
      }
    }

    combo.label = formatKeyCombo(combo);
    customShortcuts[action] = combo;
    saveState();
    renderShortcutsList();
  }

  function onDown(e) {
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels
    if (e.code === 'Escape') {
      cancelled = true;
      cleanup();
      keyEl.classList.remove('recording');
      keyEl.textContent = formatKeyCombo(customShortcuts[action]);
      return;
    }

    pressed[e.code] = true;

    // Track modifier state from keydown (reliable)
    modState.ctrl = e.ctrlKey;
    modState.shift = e.shiftKey;
    modState.alt = e.altKey;
    modState.meta = e.metaKey;

    // Track non-modifier key (use e.key for correct layout mapping, e.g. AZERTY)
    const isMod = e.code.startsWith('Control') || e.code.startsWith('Shift')
      || e.code.startsWith('Alt') || e.code.startsWith('Meta');
    if (!isMod) mainKey = e.key;

    // Show live preview
    if (mainKey) keyEl.textContent = formatKeyCombo({ ...modState, key: mainKey });
  }

  function onUp(e) {
    e.preventDefault();
    e.stopPropagation();

    delete pressed[e.code];

    // If cancelled or no main key yet, keep waiting
    if (cancelled) return;

    // All keys released — finalize
    if (Object.keys(pressed).length === 0 && mainKey) {
      apply({ ...modState, key: mainKey });
    } else if (Object.keys(pressed).length === 0 && !mainKey) {
      // Only modifiers released without a main key — reset display
      keyEl.textContent = 'Press a key...';
      modState = { ctrl: false, shift: false, alt: false, meta: false };
    }
  }

  document.addEventListener('keydown', onDown, true);
  document.addEventListener('keyup', onUp, true);
}

// Reset shortcuts to defaults
document.addEventListener('click', e => {
  if (e.target.id === 'shortcuts-reset') {
    customShortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
    saveState();
    renderShortcutsList();
  }
});

function switchSettingsCat(cat) {
  document.querySelectorAll('.settings-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  document.querySelectorAll('.settings-section[data-cat]').forEach(s => s.classList.toggle('active', s.dataset.cat === cat));
}

// Category button click handlers
document.querySelectorAll('.settings-cat-btn').forEach(btn => {
  btn.addEventListener('click', () => switchSettingsCat(btn.dataset.cat));
});

function applySettings() {
  const wsp = activeWs();
  if (!wsp) return;
  const terms = getWorkspaceTerminals(wsp);
  for (const t of terms) {
    if (t.type === 'browser') continue;
    t.term.options.fontSize = currentFontSize;
    t.term.options.fontFamily = currentFontFamily;
    t.term.options.lineHeight = currentLineHeight;
    t.term.options.cursorStyle = currentCursorStyle;
    t.term.options.cursorBlink = currentCursorBlink;
    t.term.options.scrollback = currentScrollback;
    fitTerm(t);
  }
  updateStatusBar();
  saveState();
}

// Open/close
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });

// Theme change
document.getElementById('set-theme').addEventListener('change', e => {
  applyTheme(e.target.value);
  saveState();
});

// Font size
document.getElementById('set-fontsize').addEventListener('input', e => {
  currentFontSize = parseInt(e.target.value);
  document.getElementById('set-fontsize-val').textContent = currentFontSize + 'px';
  applySettings();
});

// Font family
document.getElementById('set-fontfamily').addEventListener('change', e => {
  currentFontFamily = e.target.value;
  applySettings();
});

// Line height
document.getElementById('set-lineheight').addEventListener('input', e => {
  currentLineHeight = parseFloat(e.target.value);
  document.getElementById('set-lineheight-val').textContent = currentLineHeight.toFixed(1);
  applySettings();
});

// Cursor style
document.getElementById('set-cursor').addEventListener('change', e => {
  currentCursorStyle = e.target.value;
  applySettings();
});

// Cursor blink toggle
document.getElementById('set-cursorblink').addEventListener('click', () => {
  currentCursorBlink = !currentCursorBlink;
  document.getElementById('set-cursorblink').classList.toggle('on', currentCursorBlink);
  applySettings();
});

// Scrollback
document.getElementById('set-scrollback').addEventListener('input', e => {
  currentScrollback = parseInt(e.target.value);
  document.getElementById('set-scrollback-val').textContent = currentScrollback.toLocaleString();
  applySettings();
});

// Prevent sidebar and statusbar from stealing terminal focus
document.getElementById('sidebar').addEventListener('mousedown', e => {
  if (!e.target.closest('input, textarea, select, [contenteditable]')) e.preventDefault();
});
document.getElementById('statusbar').addEventListener('mousedown', e => e.preventDefault());

// Sidebar Split.js
let sidebarSplit = null;
let savedSidebarWidth = null;
const SB_EXPANDED_MIN = 200;
const SB_MAX = 400;
const SB_SPLIT_OPTS = {
  gutterSize: 4,
  snapOffset: 0,
  maxSize: [SB_MAX, Infinity],
  elementStyle(dimension, size, gutterSize) {
    return { 'flex-basis': `calc(${size}% - ${gutterSize}px)` };
  },
  gutterStyle(dimension, gutterSize) {
    return { 'flex-basis': gutterSize + 'px' };
  },
};

function initSidebarSplit() {
  const sb = document.getElementById('sidebar');
  const main = document.getElementById('main');
  const expanded = sb.classList.contains('expanded');
  const savedPx = savedSidebarWidth || (expanded ? SB_EXPANDED_MIN : null);
  const containerW = document.getElementById('app').offsetWidth;
  const initialPct = savedPx ? Math.max(5, (savedPx / containerW) * 100) : (expanded ? 15 : 0);

  sidebarSplit = Split([sb, main], {
    ...SB_SPLIT_OPTS,
    sizes: [initialPct, 100 - initialPct],
    minSize: expanded ? [SB_EXPANDED_MIN, 200] : [0, 200],
    onDragStart() {
      _suppressResize = true;
      sb.style.willChange = 'flex-basis';
      main.style.willChange = 'flex-basis';
      sb.style.overflowY = 'hidden';
      startResizing();
    },
    onDragEnd(sizes) {
      _suppressResize = false;
      sb.style.willChange = '';
      main.style.willChange = '';
      sb.style.overflowY = '';
      // Enforce 300px minimum when expanded
      if (sb.classList.contains('expanded')) {
        const containerW = document.getElementById('app').offsetWidth;
        const sidebarPx = containerW * sizes[0] / 100;
        if (sidebarPx < SB_EXPANDED_MIN) {
          const pct = (SB_EXPANDED_MIN / containerW) * 100;
          sidebarSplit.setSizes([pct, 100 - pct]);
        }
      }
      const wsp = activeWs();
      if (wsp) {
        for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
      }
      stopResizing();
    },
  });
}

initSidebarSplit();

// Sidebar toggle
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const main = document.getElementById('main');
  _suppressResize = true;
  main.style.overflow = 'hidden';
  startResizing();
  const onDragEnd = (sizes) => {
    _suppressResize = false;
    main.style.overflow = '';
    if (sb.classList.contains('expanded')) {
      const containerW = document.getElementById('app').offsetWidth;
      const sidebarPx = containerW * sizes[0] / 100;
      if (sidebarPx < SB_EXPANDED_MIN) {
        const pct = (SB_EXPANDED_MIN / containerW) * 100;
        sidebarSplit.setSizes([pct, 100 - pct]);
      }
    }
    requestAnimationFrame(() => {
      const wsp = activeWs();
      if (wsp) {
        for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
      }
    });
    stopResizing();
  };
  if (sb.classList.contains('expanded')) {
    savedSidebarWidth = sb.offsetWidth;
    sb.classList.remove('expanded');
    sidebarSplit.destroy(false, false);
    sidebarSplit = Split([sb, main], {
      ...SB_SPLIT_OPTS,
      sizes: [0, 100],
      minSize: [0, 200],
      onDragStart() { _suppressResize = true; main.style.overflow = 'hidden'; startResizing(); },
      onDragEnd,
    });
  } else {
    sb.classList.add('expanded');
    sidebarSplit.destroy(false, false);
    const w = Math.max(savedSidebarWidth || SB_EXPANDED_MIN, SB_EXPANDED_MIN);
    const containerW = document.getElementById('app').offsetWidth;
    const pct = Math.max(5, (w / containerW) * 100);
    sidebarSplit = Split([sb, main], {
      ...SB_SPLIT_OPTS,
      sizes: [pct, 100 - pct],
      minSize: [SB_EXPANDED_MIN, 200],
      onDragStart() { _suppressResize = true; main.style.overflow = 'hidden'; startResizing(); },
      onDragEnd,
    });
  }
  renderSidebar();
  requestAnimationFrame(() => {
    main.style.overflow = '';
    _suppressResize = false;
    const wsp = activeWs();
    if (wsp) {
      for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
    }
    stopResizing();
  });
}

// Titlebar sidebar toggle
document.getElementById('titlebar-sidebar-toggle').addEventListener('mousedown', e => e.preventDefault());
document.getElementById('titlebar-sidebar-toggle').addEventListener('click', toggleSidebar);

/* ═══════════════════════════════════════════════════════════════
   DIRECTIONAL PANE NAVIGATION (Alt + H/J/K/L)
═══════════════════════════════════════════════════════════════ */
let _paneNavCooldown = false;
function focusAdjacentGroup(direction) {
  if (_paneNavCooldown) return;
  _paneNavCooldown = true;
  setTimeout(() => { _paneNavCooldown = false; }, 50);
  const wsp = activeWs();
  if (!wsp || !wsp.layout) return;
  const active = activeTerminal();
  if (!active) return;
  const currentGroup = findGroupContainingTerm(wsp.layout, active.id);
  if (!currentGroup) return;

  const groupEls = document.querySelectorAll('.term-group-body');
  const groups = [];
  for (const el of groupEls) {
    const gid = el.closest('.term-group')?.dataset?.groupId;
    if (!gid) continue;
    const rect = el.getBoundingClientRect();
    groups.push({ id: gid, rect, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
  }

  const curEl = document.querySelector(`.term-group[data-group-id="${currentGroup.id}"] .term-group-body`);
  if (!curEl) return;
  const curRect = curEl.getBoundingClientRect();
  const curCx = curRect.left + curRect.width / 2;
  const curCy = curRect.top + curRect.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (const g of groups) {
    if (g.id === currentGroup.id) continue;
    const dx = g.cx - curCx;
    const dy = g.cy - curCy;

    let primary = 0, secondary = 0, valid = false;
    switch (direction) {
      case 'left':  valid = dx < -10; primary = -dx; secondary = Math.abs(dy); break;
      case 'right': valid = dx > 10;  primary = dx;  secondary = Math.abs(dy); break;
      case 'up':    valid = dy < -10; primary = -dy; secondary = Math.abs(dx); break;
      case 'down':  valid = dy > 10;  primary = dy;  secondary = Math.abs(dx); break;
    }
    if (!valid) continue;

    const score = primary + secondary * 3;
    if (score < bestScore) {
      bestScore = score;
      best = g;
    }
  }

  if (!best) return;

  const targetGroup = findGroupById(wsp.layout, best.id);
  if (!targetGroup || !targetGroup.terminals.length) return;
  activateTerminal(wsp.id, targetGroup.activeTermId || targetGroup.terminals[0].id);
}

/* ═══════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════════════════════════ */
// Capture-phase — intercepts before xterm.js
document.addEventListener('keydown', e => {
  // Focus adjacent pane
  for (const dir of ['Left', 'Down', 'Up', 'Right']) {
    const action = 'focus' + dir.charAt(0).toUpperCase() + dir.slice(1).toLowerCase();
    if (matchShortcut(e, action)) {
      e.preventDefault(); e.stopPropagation();
      focusAdjacentGroup(dir.toLowerCase());
      return;
    }
  }
  // Tab switching
  if (matchShortcut(e, 'prevTab')) { e.preventDefault(); e.stopPropagation(); prevTab(); return; }
  if (matchShortcut(e, 'nextTab')) { e.preventDefault(); e.stopPropagation(); nextTab(); return; }
  // Close terminal
  if (matchShortcut(e, 'closeTerminal')) {
    e.preventDefault(); e.stopPropagation();
    const wsp = activeWs();
    if (wsp && wsp.activeTermId) removeTerminal(wsp.id, wsp.activeTermId);
    return;
  }
  // Copy
  if (matchShortcut(e, 'copy')) {
    const t = activeTerminal();
    if (t && t.type !== 'browser' && t.term.hasSelection()) {
      e.preventDefault(); e.stopPropagation();
      const text = t.term.getSelection();
      if (isTauri() && window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|write_text', { text });
      } else {
        navigator.clipboard.writeText(text);
      }
    }
    return;
  }
  // Paste
  if (matchShortcut(e, 'paste')) {
    const t = activeTerminal();
    if (t && t.type !== 'browser') {
      e.preventDefault(); e.stopPropagation();
      if (isTauri() && window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|read_text')
          .then(text => { if (text) t.term.paste(text); }).catch(() => {});
      } else {
        navigator.clipboard.readText()
          .then(text => { if (text) t.term.paste(text); }).catch(() => {});
      }
    }
    return;
  }
  // Ctrl+V paste (non-shift variant)
  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v') {
    const t = activeTerminal();
    if (t && t.type !== 'browser') {
      e.preventDefault(); e.stopPropagation();
      if (isTauri() && window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|read_text')
          .then(text => { if (text) t.term.paste(text); }).catch(() => {});
      } else {
        navigator.clipboard.readText()
          .then(text => { if (text) t.term.paste(text); }).catch(() => {});
      }
    }
    return;
  }
  // Workspace switching
  if (matchShortcut(e, 'nextWorkspace')) { e.preventDefault(); e.stopPropagation(); nextWorkspace(); return; }
  if (matchShortcut(e, 'prevWorkspace')) { e.preventDefault(); e.stopPropagation(); prevWorkspace(); return; }
  // Ctrl+Tab / Ctrl+Shift+Tab
  if (e.ctrlKey && e.code === 'Tab') {
    e.preventDefault(); e.stopPropagation();
    e.shiftKey ? prevTab() : nextTab();
    return;
  }
}, true);

// Bubble-phase shortcuts
document.addEventListener('keydown', e => {
  if (matchShortcut(e, 'newTerminal')) { e.preventDefault(); addTerminal(); return; }
  if (matchShortcut(e, 'splitH')) {
    e.preventDefault();
    const wsp = activeWs();
    const active = activeTerminal();
    if (wsp && active) {
      const activeGroup = findGroupContainingTerm(wsp.layout, active.id);
      if (activeGroup) splitGroupDirectly(wsp.id, activeGroup.id, 'row');
    }
    return;
  }
  if (matchShortcut(e, 'splitV')) {
    e.preventDefault();
    const wsp = activeWs();
    const active = activeTerminal();
    if (wsp && active) {
      const activeGroup = findGroupContainingTerm(wsp.layout, active.id);
      if (activeGroup) splitGroupDirectly(wsp.id, activeGroup.id, 'column');
    }
    return;
  }
  if (matchShortcut(e, 'search')) { e.preventDefault(); openSearch(); return; }
  if (matchShortcut(e, 'browserTab')) {
    e.preventDefault();
    const wsp = activeWs();
    const active = activeTerminal();
    if (wsp) {
      const activeGroup = active ? findGroupContainingTerm(wsp.layout, active.id) : findFirstGroup(wsp.layout);
      if (activeGroup) addBrowserTab(wsp.id, activeGroup.id);
    }
    return;
  }
  // Arrow key tab switching (legacy)
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    if (e.code === 'ArrowLeft') { e.preventDefault(); prevTab(); return; }
    if (e.code === 'ArrowRight') { e.preventDefault(); nextTab(); return; }
  }
});

function prevTab() {
  const wsp = activeWs();
  if (!wsp) return;
  const active = activeTerminal();
  if (!active) return;
  const group = findGroupContainingTerm(wsp.layout, active.id);
  if (!group || group.terminals.length <= 1) return;

  const idx = group.terminals.findIndex(t => t.id === active.id);
  const prev = group.terminals[(idx - 1 + group.terminals.length) % group.terminals.length];
  activateTerminal(wsp.id, prev.id);
}

function nextTab() {
  const wsp = activeWs();
  if (!wsp) return;
  const active = activeTerminal();
  if (!active) return;
  const group = findGroupContainingTerm(wsp.layout, active.id);
  if (!group || group.terminals.length <= 1) return;

  const idx = group.terminals.findIndex(t => t.id === active.id);
  const next = group.terminals[(idx + 1) % group.terminals.length];
  activateTerminal(wsp.id, next.id);
}

// Block middle-click paste on tabs (prevents xterm.js from seeing it)
function _handleTabMiddleClick(e) {
  const tab = e.target.closest('.tg-tab');
  if (tab) {
    e.preventDefault();
    e.stopPropagation();
    _suppressPasteUntil = Date.now() + 200;
    const tabId = tab.dataset.termid;
    const wsp = activeWs();
    if (tabId && wsp) removeTerminal(wsp.id, tabId);
  }
}
// Block middle-click paste on workspace buttons
function _handleWsMiddleClick(e) {
  const btn = e.target.closest('.ws-btn');
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    _suppressPasteUntil = Date.now() + 200;
    const wsId = btn.dataset.wsid;
    if (wsId) removeWorkspace(wsId);
  }
}
document.addEventListener('mousedown', e => {
  if (e.button === 1) { _handleTabMiddleClick(e); _handleWsMiddleClick(e); }
}, true);
document.addEventListener('auxclick', e => {
  if (e.button === 1) { _handleTabMiddleClick(e); _handleWsMiddleClick(e); }
}, true);

// Horizontal scroll on tab bar with mouse wheel
document.addEventListener('wheel', e => {
  const tabs = e.target.closest('.term-group-tabs');
  if (!tabs) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    tabs.scrollLeft += e.deltaY;
  }
}, { passive: false });

/* ═══════════════════════════════════════════════════════════════
   RESIZE OBSERVER
═══════════════════════════════════════════════════════════════ */
/* ── Webview resizing overlay controllers ── */
function startResizing() {
  document.body.classList.add('resizing');
  for (const wsp of workspaces) {
    const terms = getWorkspaceTerminals(wsp);
    for (const t of terms) {
      if (t._webview) {
        try { t._webview.hide(); } catch {}
      }
    }
  }
}

function stopResizing() {
  document.body.classList.remove('resizing');
  const wsp = activeWs();
  if (wsp) {
    // Collect active terminal IDs from all groups (not just workspace-level)
    const activeIds = new Set();
    function collectActiveIds(node) {
      if (!node) return;
      if (node.type === 'group') { if (node.activeTermId) activeIds.add(node.activeTermId); }
      else if (node.type === 'split') { node.children.forEach(collectActiveIds); }
    }
    collectActiveIds(wsp.layout);

    const terms = getWorkspaceTerminals(wsp);
    for (const t of terms) {
      if (t._webview && activeIds.has(t.id)) {
        try {
          t._webview.show();
          if (typeof t._positionWebview === 'function') {
            t._positionWebview();
          }
        } catch {}
      }
    }
  }
}

let resizeRaf = null;
let _suppressResize = false;
let _suppressPasteUntil = 0;
let _lastTabClickTime = 0;
let _lastTabClickTermId = null;
function syncSplitSizes(node) {
  if (!node) return;
  if (node.type === 'split') {
    const container = document.getElementById('split-' + node.id);
    if (container) {
      const panes = [...container.children].filter(c => !c.classList.contains('sash'));
      const sizes = panes.map(p => node.direction === 'row' ? p.offsetWidth : p.offsetHeight);
      const total = sizes.reduce((a, b) => a + b, 0);
      if (total > 0) node.sizes = sizes.map(s => (s / total) * 100);
    }
    node.children.forEach(syncSplitSizes);
  }
}

const ro = new ResizeObserver(() => {
  if (_suppressResize) return;
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    const wsp = activeWs();
    if (!wsp) return;
    syncSplitSizes(wsp.layout);
    const terms = getWorkspaceTerminals(wsp);
    for (const t of terms) fitTerm(t);
    updateStatusBar();
  });
});
ro.observe(document.getElementById('pane-area'));

// Suppress ResizeObserver during window maximize/minimize animation
let _winResizeTimer = null;
window.addEventListener('resize', () => {
  _suppressResize = true;
  if (_winResizeTimer) clearTimeout(_winResizeTimer);
  _winResizeTimer = setTimeout(() => {
    _winResizeTimer = null;
    _suppressResize = false;
    // Trigger a single batched fit after the transition settles
    const wsp = activeWs();
    if (wsp) {
      syncSplitSizes(wsp.layout);
      for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
      updateStatusBar();
    }
    // Reposition Tauri webviews
    if (wsp) {
      for (const t of getWorkspaceTerminals(wsp)) {
        if (t._webview && typeof t._positionWebview === 'function') {
          try { t._positionWebview(); } catch {}
        }
      }
    }
  }, 150);
});

/* ═══════════════════════════════════════════════════════════════
   UTIL
═══════════════════════════════════════════════════════════════ */
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════ */
const restored = restoreState();
applyTheme(currentThemeName);

if (restored) {
  renderSidebar();
  renderPaneArea();
  updateStatusBar();
}

// In Tauri, use native PTY via Rust backend; otherwise WebSocket
if (isTauri()) {
  loadTauriApi(); // preload webview + window API for browser tabs
  setTimeout(() => { try { connectTauriPTY(); } catch (e) { console.error('connectTauriPTY failed:', e); } }, 100);
} else {
  try { connectWS(); } catch (e) { console.error('connectWS failed:', e); }
}

// ── Tauri: activate custom titlebar + window controls ──
if (isTauri()) {
  const tb = document.getElementById('titlebar');
  if (tb) tb.classList.add('tauri-active');

  // Tauri 2 window plugin invoke
  document.getElementById('titlebar-minimize')?.addEventListener('click', () => {
    window.__TAURI_INTERNALS__.invoke('plugin:window|minimize');
  });
  document.getElementById('titlebar-maximize')?.addEventListener('click', () => {
    window.__TAURI_INTERNALS__.invoke('plugin:window|toggle_maximize');
  });
  document.getElementById('titlebar-close')?.addEventListener('click', () => {
    window.__TAURI_INTERNALS__.invoke('plugin:window|close');
  });
}

// Listen for navigation messages from browser tab iframes
window.addEventListener('message', function(e) {
  if (e.data && e.data.terminusNav) {
    const active = activeTerminal();
    if (active && active.type === 'browser' && active._loadUrl) {
      active._loadUrl(e.data.terminusNav);
    }
  }
});

// Auto-save every 30 seconds
setInterval(saveState, 30000);

// Save on close (browser) or Tauri destroy event
window.addEventListener('beforeunload', (e) => {
  saveState();
  if (!isTauri()) {
    const hasTerms = workspaces.some(ws => getWorkspaceTerminals(ws).length > 0);
    if (hasTerms) { e.preventDefault(); e.returnValue = ''; }
  }
});

// Tauri: save on window destroy
if (isTauri()) {
  try {
    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
      window.__TAURI__.event.listen('tauri://close-requested', () => saveState());
    } else {
      const cbId = window.__TAURI_INTERNALS__.transformCallback(() => saveState(), false);
      window.__TAURI_INTERNALS__.invoke('plugin:event|listen', { event: 'tauri://close-requested', target: { kind: 'Any' }, handler: cbId });
    }
  } catch {}
}

// Highlight and focus the browser container when clicking inside fallback iframes or Tauri native child webviews
window.addEventListener('blur', () => {
  setTimeout(() => {
    // 1. Handle non-Tauri browser fallback iframes
    if (document.activeElement && document.activeElement.classList.contains('browser-fallback')) {
      const slot = document.activeElement.closest('.term-slot');
      if (slot) {
        slot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    }

    // 2. Handle Tauri child webviews (parent window blurs when child OS webview gets focused)
    const active = activeTerminal();
    if (active && active.type === 'browser' && active.el) {
      active.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  }, 50);
});

})();
