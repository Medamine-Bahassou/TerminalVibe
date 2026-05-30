'use strict';

/* ═══════════════════════════════════════════════════════════════
   THEMES — mirror Python THEMES dict exactly
═══════════════════════════════════════════════════════════════ */
const THEMES = {
  'catppuccin-mocha': {
    label: 'Catppuccin Mocha',
    bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70',
    swatches: ['#f38ba8','#a6e3a1','#89b4fa'],
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
    swatches: ['#d20f39','#40a02b','#1e66f5'],
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
    swatches: ['#ff5555','#50fa7b','#bd93f9'],
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
    swatches: ['#cc241d','#98971a','#458588'],
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
    swatches: ['#f7768e','#9ece6a','#7aa2f7'],
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
    swatches: ['#bf616a','#a3be8c','#81a1c1'],
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
    swatches: ['#dc322f','#859900','#268bd2'],
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
let focusedSlotId = null;  // DOM id of focused .term-slot

let ws = null;             // WebSocket
let wsReady = false;

/* ═══════════════════════════════════════════════════════════════
   WEBSOCKET
═══════════════════════════════════════════════════════════════ */
const ID_LEN = 36;

function connectWS() {
  updateConnStatus(false, true);
  const wsHost = window.location.hostname || '127.0.0.1';
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
      createWorkspace('Main');
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
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj));
}

function sendStdin(sid, data) {
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
      terminals: node.terminals.map(t => {
        const o = { id: t.id, label: t.label };
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
    sidebarWidth: savedSidebarWidth || parseInt(document.getElementById('sidebar').style.width) || null,
    activeWsId,
    workspaces: workspaces.map(ws => ({
      id: ws.id,
      label: ws.label,
      activeTermId: ws.activeTermId,
      layout: serializeLayout(ws.layout)
    })),
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
    if (state.sidebarExpanded) document.getElementById('sidebar').classList.add('expanded');
    if (state.sidebarWidth) {
      savedSidebarWidth = state.sidebarWidth;
      const sb = document.getElementById('sidebar');
      if (sb.classList.contains('expanded')) {
        sb.style.width = state.sidebarWidth + 'px';
        sb.style.minWidth = state.sidebarWidth + 'px';
      }
    }

    for (const wsData of state.workspaces) {
      const ws = {
        id: wsData.id,
        label: wsData.label,
        activeTermId: wsData.activeTermId,
        layout: null
      };

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
  const ws = { id, label: label || `WS ${wsCount}`, layout: null, activeTermId: null };
  workspaces.push(ws);
  activateWorkspace(id);
  addTerminal(id);
  return ws;
}

function activateWorkspace(id, skipRender) {
  activeWsId = id;
  if (!skipRender) {
    renderSidebar();
    renderPaneArea();
    updateStatusBar();
  }
}

function removeWorkspace(id) {
  const ws = findWs(id);
  if (!ws) return;
  const terms = getWorkspaceTerminals(ws);
  terms.forEach(t => removeTerminal(ws.id, t.id, true));

  const idx = workspaces.findIndex(w => w.id === id);
  workspaces.splice(idx, 1);
  if (activeWsId === id) {
    if (workspaces.length) activateWorkspace(workspaces[Math.max(0, idx-1)].id);
    else { activeWsId = null; renderSidebar(); renderPaneArea(); updateStatusBar(); }
  } else {
    renderSidebar();
  }
}

function renameWorkspace(id) {
  const ws = findWs(id);
  if (!ws) return;
  const btn = document.querySelector(`[data-wsid="${id}"]`);
  if (!btn) return;
  const el = btn.querySelector('.ws-label');
  const nameEl = btn.querySelector('.ws-name');
  if (!el) return;
  const old = ws.label;
  const inp = document.createElement('input');
  inp.style.cssText = 'background:transparent;border:none;outline:1px solid var(--accent);border-radius:2px;color:var(--fg);font:inherit;font-size:10px;width:80px;text-align:left;padding:0 2px;';
  inp.value = old;
  if (nameEl) nameEl.style.display = 'none';
  el.replaceWith(inp);
  inp.focus(); inp.select();
  const done = () => {
    if (nameEl) nameEl.style.display = '';
    ws.label = inp.value.trim() || old;
    renderSidebar();
    updateStatusBar();
  };
  inp.onblur = done;
  inp.onkeydown = e => { if (e.key==='Enter') inp.blur(); if (e.key==='Escape') { inp.value=old; inp.blur(); } e.stopPropagation(); };
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
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  try { const u11 = new Unicode11Addon.Unicode11Addon(); term.loadAddon(u11); term.unicode.activeVersion = '11'; } catch {}
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(webLinksAddon);

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
  } else {
    let targetGroup = null;
    if (targetGroupId) {
      targetGroup = findGroupById(wsp.layout, targetGroupId);
    }
    if (!targetGroup) {
      const active = activeTerminal();
      if (active) targetGroup = findGroupContainingTerm(wsp.layout, active.id);
    }
    if (!targetGroup) {
      targetGroup = findFirstGroup(wsp.layout);
    }

    if (targetGroup) {
      targetGroup.terminals.push(entry);
      targetGroup.activeTermId = id;
    }
  }

  renderPaneArea();
  activateTerminal(wsp.id, id);
  renderSidebar();

  setTimeout(() => {
    const slot = getSlotDimensions(entry);
    sendControl({ type: 'create', id, cols: slot.cols, rows: slot.rows });
  }, 50);

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
      targetGroup.activeTermId = id;
    }
  }

  renderPaneArea();
  activateTerminal(wsp.id, id);
  renderSidebar();
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
  if (group) group.activeTermId = termId;

  if (activeWsId === wsId) {
    // Lightweight update: toggle visibility without rebuilding the DOM
    // (preserves browser tab state, iframe content, etc.)
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
          slot.classList.toggle('focused', isActive);
        });
      }
    }
    updateStatusBar();
    const terms = getWorkspaceTerminals(wsp);
    const t = terms.find(x => x.id === termId);
    if (t && t.el) {
      focusedSlotId = t.el.id;
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
}

function removeTerminal(wsId, termId, skipRender) {
  const wsp = findWs(wsId);
  if (!wsp || !wsp.layout) return;

  const group = findGroupContainingTerm(wsp.layout, termId);
  if (!group) return;

  const idx = group.terminals.findIndex(t => t.id === termId);
  if (idx === -1) return;

  const entry = group.terminals[idx];
  if (entry.type !== 'browser') {
    sendControl({ type: 'close', id: termId });
    entry.term.dispose();
  } else {
    if (entry._msgCleanup) entry._msgCleanup();
  }
  if (entry.el) entry.el.remove();

  group.terminals.splice(idx, 1);

  if (group.activeTermId === termId) {
    const next = group.terminals[Math.min(idx, group.terminals.length - 1)];
    group.activeTermId = next ? next.id : null;
  }

  if (wsp.activeTermId === termId) {
    const all = getWorkspaceTerminals(wsp);
    wsp.activeTermId = all.length ? all[0].id : null;
  }

  wsp.layout = removeEmptyGroups(wsp.layout);

  if (!skipRender && activeWsId === wsId) {
    renderPaneArea();
    updateStatusBar();
  }
  renderSidebar();
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

  const tab = document.querySelector(`.tg-tab[data-termid="${termId}"]`);
  if (!tab) return;
  const nameEl = tab.querySelector('.tg-tab-name');
  const inp = document.createElement('input');
  inp.value = t.label;
  nameEl.replaceWith(inp);
  inp.focus(); inp.select();
  const done = () => {
    t.label = inp.value.trim() || t.label;
    // Replace input with a span showing the new name
    const span = document.createElement('span');
    span.className = 'tg-tab-name';
    span.textContent = t.label;
    inp.replaceWith(span);
    renderSidebar();
    updateStatusBar();
  };
  inp.onblur = done;
  inp.onkeydown = e => { if (e.key==='Enter') inp.blur(); if (e.key==='Escape'){ inp.value=t.label; inp.blur(); } e.stopPropagation(); };
}

function handleExit(id, code) {
  const result = findTermById(id);
  if (!result) return;
  const { ws, term: t } = result;
  sendControl({ type: 'close', id });
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
  }, 50);
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
   PANE AREA RENDERING (Recursive execution tree)
═══════════════════════════════════════════════════════════════ */
function renderPaneArea() {
  const area = document.getElementById('pane-area');
  const empty = document.getElementById('empty-state');

  [...area.children].forEach(el => {
    if (el.id !== 'empty-state' && el.id !== 'searchbar') el.remove();
  });

  const wsp = activeWs();
  if (!wsp || !wsp.layout) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  const rootDom = buildNodeDom(wsp.layout, wsp);
  if (rootDom) {
    rootDom.style.position = 'absolute';
    rootDom.style.inset = '0';
    area.appendChild(rootDom);
  }

  setTimeout(() => {
    const all = getWorkspaceTerminals(wsp);
    all.forEach(fitTerm);
    const active = all.find(x => x.id === wsp.activeTermId);
    if (active && active.type !== 'browser') active.term.focus();
    updateStatusBar();
  }, 30);
}

function buildNodeDom(node, wsp) {
  if (!node) return null;

  if (node.type === 'split') {
    const container = document.createElement('div');
    container.className = `split-container ${node.direction}`;

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

      tab.addEventListener('dblclick', () => renameTerminalInGroup(wsp.id, t.id));
      tab.addEventListener('click', e => {
        if (e.target.classList.contains('tg-tab-close')) {
          removeTerminal(wsp.id, t.id);
        } else {
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
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
          el.classList.remove('drop-left', 'drop-right');
        });
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

    const addTabBtn = document.createElement('div');
    addTabBtn.className = 'tg-tab-add';
    addTabBtn.title = 'New terminal in this group';
    addTabBtn.textContent = '+';
    addTabBtn.addEventListener('click', () => addTerminal(wsp.id, node.id));
    tabsContainer.appendChild(addTabBtn);

    header.appendChild(tabsContainer);

    const actions = document.createElement('div');
    actions.className = 'term-group-actions';

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

    const closeGrp = document.createElement('div');
    closeGrp.className = 'tg-btn';
    closeGrp.title = 'Close Group';
    closeGrp.innerHTML = '✕';
    closeGrp.onclick = () => {
      [...node.terminals].forEach(t => removeTerminal(wsp.id, t.id));
    };

    const addBrowserBtn = document.createElement('div');
    addBrowserBtn.className = 'tg-btn';
    addBrowserBtn.title = 'New browser tab';
    addBrowserBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';
    addBrowserBtn.onclick = () => addBrowserTab(wsp.id, node.id);

    actions.appendChild(splitH);
    actions.appendChild(splitV);
    actions.appendChild(addBrowserBtn);
    actions.appendChild(closeGrp);
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
      if (isAct) slot.classList.add('focused');
      else slot.classList.remove('focused');
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

    // ── Content area with iframe for style isolation ──
    const contentWrap = document.createElement('div');
    contentWrap.className = 'browser-content';

    // Loading bar sits above the content
    contentWrap.appendChild(loadingBar);

    // iframe for proxied pages (provides CSS isolation)
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff;display:none;';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups';
    contentWrap.appendChild(iframe);

    // Scrollable div for start/error pages
    const pageView = document.createElement('div');
    pageView.className = 'browser-page-view';
    contentWrap.appendChild(pageView);

    slot.appendChild(toolbar);
    slot.appendChild(contentWrap);
    entry.el = slot;
    entry._pageView = pageView;
    entry.opened = true;

    // ── Local proxy (port 7682 on same host as WebSocket server) ──
    const proxyHost = window.location.hostname || '127.0.0.1';
    const proxyUrl = u => `http://${proxyHost}:${PROXY_PORT}/proxy?url=${encodeURIComponent(u)}`;

    let loading = false;
    let abortCtrl = null;

    function showLoading(on) {
      loading = on;
      loadingBar.classList.toggle('active', on);
      btnReload.classList.toggle('spin', on);
    }

    function showError(url, msg) {
      iframe.style.display = 'none';
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
      pageView.querySelector('#err-ext')?.addEventListener('click', () => window.open(entry.url, '_blank'));
    }

    function showStartPage() {
      iframe.style.display = 'none';
      pageView.style.display = '';
      pageView.innerHTML = `
        <div class="browser-start-page">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
          <p>Enter a URL or search term above</p>
          <p class="browser-start-hint">Pages load through your local proxy — most sites work.</p>
        </div>`;
    }

    function isLocalhostUrl(u) {
      try { return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(new URL(u).hostname); } catch {}
      return false;
    }

    async function loadUrl(rawUrl) {
      if (!rawUrl || rawUrl === 'about:blank') { showStartPage(); return; }
      let url = rawUrl.trim();
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(url)) {
        // Already has a scheme (http, https, file, ftp, etc.) — use as-is
      } else if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url)) {
        // Localhost dev server — use http
        url = 'http://' + url;
      } else if (!url.includes('.') || url.includes(' ')) {
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      } else {
        url = 'https://' + url;
      }

      if (abortCtrl) abortCtrl.abort();
      abortCtrl = new AbortController();
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

      // ── Localhost / dev-server bypass: load directly in iframe ──
      // ES modules (Vite, React, etc.) break when proxied through srcdoc
      // because import statements can't be rewritten. Load via iframe.src
      // so the browser handles everything natively.
      if (isLocalhostUrl(url)) {
        showLoading(false);
        pageView.style.display = 'none';
        iframe.style.display = 'block';
        iframe.removeAttribute('srcdoc');
        iframe.src = url;
        return;
      }

      let html = null;
      let lastErr = '';
      try {
        const res = await fetch(proxyUrl(url), { signal: abortCtrl.signal });
        if (res.ok) {
          html = await res.text();
        } else {
          lastErr = `Proxy returned HTTP ${res.status}`;
        }
      } catch (err) {
        if (err.name === 'AbortError') { showLoading(false); return; }
        lastErr = 'Could not reach proxy server (is terminal_server.py running?): ' + err.message;
      }

      showLoading(false);

      if (!html) {
        showError(url, lastErr);
        return;
      }

      try {
        // Strip CSP meta tags so the navBridge and page scripts can run
        html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, '');

        // Inject navigation + fetch/XHR interceptor for SPA support
        const proxyBase = 'http://' + (window.location.hostname || '127.0.0.1') + ':' + PROXY_PORT + '/proxy?url=';
        const navBridge = '<script>(' + (function(pxBase, pageUrl){
          // Link click interceptor
          document.addEventListener('click', function(e){
            var a = e.target.closest && e.target.closest('a[href]');
            if (!a) return;
            var href = a.getAttribute('href');
            if (!href || href.indexOf('javascript:') === 0 || href.charAt(0) === '#') return;
            e.preventDefault();
            try { var u = new URL(href, pageUrl); var i = u.searchParams.get('url'); if (i) href = decodeURIComponent(i); } catch(x){}
            try { window.parent.postMessage({terminusNav: href}, '*'); } catch(x){}
          }, true);

          // Fetch interceptor — routes JS fetch() through the proxy safely using original URL base
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

          // XHR interceptor — routes XMLHttpRequest.open() through the proxy safely
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

          // Dynamic DOM elements interceptor (captures lazy-loaded chunks injected by React/Webpack/Vite)
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
                  } else {
                    descriptor.set.call(el, val);
                  }
                },
                configurable: true
              });
            } else if (tag === 'link') {
              var descriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
              Object.defineProperty(el, 'href', {
                get: function() { return descriptor.get.call(el); },
                set: function(val) {
                  if (val && !val.startsWith(pxBase) && !val.startsWith('data:')) {
                    var abs = new URL(val, pageUrl).href;
                    descriptor.set.call(el, pxBase + encodeURIComponent(abs));
                  } else {
                    descriptor.set.call(el, val);
                  }
                },
                configurable: true
              });
            }
            return el;
          };
        }).toString() + ')(' + JSON.stringify(proxyBase) + ',' + JSON.stringify(url) + ')<\/script>';
        const baseStyles = '<style>body{margin:0;font-family:sans-serif;font-size:14px;line-height:1.5;color:#222}a{color:#1a73e8}</style>';

        // Render in the pre-created iframe (CSS isolation)
        pageView.style.display = 'none';
        iframe.style.display = 'block';
        // Remove src before setting srcdoc
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
    btnOpenExt.addEventListener('click', () => { if (entry.url && entry.url !== 'about:blank') window.open(entry.url, '_blank'); });

    slot.addEventListener('mousedown', () => {
      document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
      slot.classList.add('focused');
      focusedSlotId = slot.id;
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
      prevPane.style[isRow ? 'width' : 'height'] = actualPrev + 'px';
      nextPane.style[isRow ? 'width' : 'height'] = newNext + 'px';

      refitNodeTerminals(node.children[prevIdx]);
      refitNodeTerminals(node.children[nextIdx]);
    };

    const onUp = () => {
      sash.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const panes = [...container.children].filter(c => !c.classList.contains('sash'));
      const currentSizes = panes.map(p => isRow ? p.offsetWidth : p.offsetHeight);
      const total = currentSizes.reduce((a, b) => a + b, 0);
      if (total > 0) {
        node.sizes = currentSizes.map(s => (s / total) * 100);
      }
      renderPaneArea();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ═══════════════════════════════════════════════════════════════
   DRAG AND DROP HANDLERS
═══════════════════════════════════════════════════════════════ */
function setupGroupDragAndDrop(bodyEl, groupNode, wsp, overlay) {
  bodyEl.addEventListener('dragenter', e => {
    e.preventDefault();
  });

  bodyEl.addEventListener('dragover', e => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain') || window.draggedTermId;
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

    overlay.classList.add('active');
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
    overlay.classList.remove('active');
  });

  bodyEl.addEventListener('drop', e => {
    e.preventDefault();
    overlay.classList.remove('active');

    const draggedId = e.dataTransfer.getData('text/plain') || window.draggedTermId;
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
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR RENDERING
═══════════════════════════════════════════════════════════════ */
function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const actionsEl = sb.querySelector('.sidebar-actions');
  const expanded = sb.classList.contains('expanded');
  sb.querySelectorAll('.ws-btn, .ws-add, .sidebar-sep:not(:first-of-type)').forEach(e => e.remove());

  const sep = document.createElement('div');
  sep.className = 'sidebar-sep';
  sb.insertBefore(sep, actionsEl);

  for (const wsp of workspaces) {
    const btn = document.createElement('div');
    const isActive = wsp.id === activeWsId;
    btn.className = 'ws-btn' + (isActive ? ' active' : '');
    btn.dataset.wsid = wsp.id;
    const abbr = wsp.label.substring(0,3).toUpperCase();
    const tabCount = getWorkspaceTerminals(wsp).length;
    btn.innerHTML = `<span class="ws-strip"></span><span class="ws-label">${abbr}</span><span class="ws-name">${escHtml(wsp.label)}</span><span class="ws-actions"><span class="ws-action ws-rename" title="Rename">✎</span><span class="ws-action ws-remove" title="Close">✕</span></span><span class="ws-count">${tabCount}</span>`;
    btn.title = wsp.label;
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.ws-action')) return;
      activateWorkspace(wsp.id);
    });
    btn.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'workspace', wsp.id); });
    if (!expanded) {
      btn.addEventListener('mouseenter', () => showTooltip(btn, wsp.label));
      btn.addEventListener('mouseleave', hideTooltip);
    }
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
    item('✎', 'Rename workspace', '', () => renameWorkspace(wsId));
    sep();
    item('✕', 'Close workspace', '', () => removeWorkspace(wsId), true);
  } else if (type === 'terminal') {
    const { wsId, termId } = data;
    item('⊞', 'New terminal', 'Ctrl+Shift+T', () => addTerminal(wsId));
    item('✎', 'Rename tab', '', () => renameTerminal(wsId, termId));
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
document.addEventListener('click', e => { if (!e.target.closest('#theme-menu')) hideThemeMenu(); });

/* ═══════════════════════════════════════════════════════════════
   THEME MENU
═══════════════════════════════════════════════════════════════ */
const themeMenu = document.getElementById('theme-menu');

function showThemeMenu() {
  themeMenu.innerHTML = '';
  for (const [key, t] of Object.entries(THEMES)) {
    const el = document.createElement('div');
    el.className = 'theme-item' + (key === currentThemeName ? ' active' : '');
    const swatchHtml = t.swatches.map(c => `<span style="background:${c}"></span>`).join('');
    el.innerHTML = `<span class="theme-swatch">${swatchHtml}</span><span>${t.label}</span>`;
    el.addEventListener('click', () => { applyTheme(key); hideThemeMenu(); });
    themeMenu.appendChild(el);
  }
  const btn = document.getElementById('btn-theme');
  const rect = btn.getBoundingClientRect();
  themeMenu.style.left = (rect.right + 4) + 'px';
  themeMenu.style.right = 'auto';
  themeMenu.classList.add('open');
  const menuH = themeMenu.offsetHeight;
  const spaceBelow = window.innerHeight - rect.top;
  if (menuH > spaceBelow) {
    themeMenu.style.top = Math.max(4, rect.bottom - menuH) + 'px';
  } else {
    themeMenu.style.top = rect.top + 'px';
  }
}

function hideThemeMenu() { themeMenu.classList.remove('open'); }

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
document.getElementById('btn-search').addEventListener('click', () => {
  searchbar.classList.contains('open') ? closeSearch() : openSearch();
});
document.getElementById('btn-theme').addEventListener('click', e => { e.stopPropagation(); showThemeMenu(); });

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
    if (key === currentThemeName) opt.selected = true;
    themeSelect.appendChild(opt);
  }

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

  settingsOverlay.classList.add('open');
}

function closeSettings() {
  settingsOverlay.classList.remove('open');
}

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

// Sidebar toggle
let savedSidebarWidth = null;
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const sb = document.getElementById('sidebar');
  if (sb.classList.contains('expanded')) {
    savedSidebarWidth = sb.offsetWidth;
    sb.style.width = '';
    sb.style.minWidth = '';
    sb.classList.remove('expanded');
  } else {
    sb.classList.add('expanded');
    if (savedSidebarWidth) {
      const w = Math.max(56, Math.min(400, savedSidebarWidth));
      sb.style.width = w + 'px';
      sb.style.minWidth = w + 'px';
    }
  }
  renderSidebar();
  setTimeout(() => {
    const wsp = activeWs();
    if (wsp) {
      const terms = getWorkspaceTerminals(wsp);
      for (const t of terms) fitTerm(t);
    }
  }, 220);
});

// Sidebar resize sash
(function() {
  const sash = document.getElementById('sidebar-sash');
  const sidebar = document.getElementById('sidebar');
  const MIN_W = 56;
  const MAX_W = 400;
  let dragging = false;
  let startX = 0;
  let startW = 0;

  sash.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    sash.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newW = Math.max(MIN_W, Math.min(MAX_W, startW + delta));
    sidebar.style.width = newW + 'px';
    sidebar.style.minWidth = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    sash.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const wsp = activeWs();
    if (wsp) {
      const terms = getWorkspaceTerminals(wsp);
      for (const t of terms) fitTerm(t);
    }
  });
})();

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
// Capture-phase Alt+H/J/K/L — intercepts before xterm.js
document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
    const dirMap = { KeyH: 'left', KeyJ: 'down', KeyK: 'up', KeyL: 'right' };
    if (dirMap[e.code]) {
      e.preventDefault();
      e.stopPropagation();
      focusAdjacentGroup(dirMap[e.code]);
      return;
    }
  }
}, true);

document.addEventListener('keydown', e => {
  const cs = e.ctrlKey && e.shiftKey;

  if (cs) {
    if (e.code === 'KeyT') { e.preventDefault(); addTerminal(); return; }
    if (e.code === 'KeyW') {
      e.preventDefault();
      const wsp = activeWs();
      if (wsp && wsp.activeTermId) removeTerminal(wsp.id, wsp.activeTermId);
      return;
    }
    if (e.code === 'KeyD') {
      e.preventDefault();
      const wsp = activeWs();
      const active = activeTerminal();
      if (wsp && active) {
        const activeGroup = findGroupContainingTerm(wsp.layout, active.id);
        if (activeGroup) splitGroupDirectly(wsp.id, activeGroup.id, 'row');
      }
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      const wsp = activeWs();
      const active = activeTerminal();
      if (wsp && active) {
        const activeGroup = findGroupContainingTerm(wsp.layout, active.id);
        if (activeGroup) splitGroupDirectly(wsp.id, activeGroup.id, 'column');
      }
      return;
    }
    if (e.code === 'KeyF') { e.preventDefault(); openSearch(); return; }
    if (e.code === 'KeyB') {
      e.preventDefault();
      const wsp = activeWs();
      const active = activeTerminal();
      if (wsp) {
        const activeGroup = active ? findGroupContainingTerm(wsp.layout, active.id) : findFirstGroup(wsp.layout);
        if (activeGroup) addBrowserTab(wsp.id, activeGroup.id);
      }
      return;
    }
    if (e.code === 'ArrowLeft') { e.preventDefault(); prevTab(); return; }
    if (e.code === 'ArrowRight') { e.preventDefault(); nextTab(); return; }
  }
  if (e.ctrlKey && e.code === 'Tab') {
    e.preventDefault();
    e.shiftKey ? prevTab() : nextTab();
    return;
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

/* ═══════════════════════════════════════════════════════════════
   RESIZE OBSERVER
═══════════════════════════════════════════════════════════════ */
let resizeRaf = null;
const ro = new ResizeObserver(() => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    const wsp = activeWs();
    if (!wsp) return;
    const terms = getWorkspaceTerminals(wsp);
    for (const t of terms) fitTerm(t);
    updateStatusBar();
  });
});
ro.observe(document.getElementById('pane-area'));

/* ═══════════════════════════════════════════════════════════════
   TOOLTIP
═══════════════════════════════════════════════════════════════ */
const tooltipEl = document.getElementById('tooltip');
function showTooltip(anchor, text) {
  tooltipEl.textContent = text;
  const r = anchor.getBoundingClientRect();
  tooltipEl.style.top = (r.top + r.height/2 - 10) + 'px';
  tooltipEl.style.left = (r.right + 10) + 'px';
  tooltipEl.style.display = 'block';
}
function hideTooltip() { tooltipEl.style.display = 'none'; }

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

connectWS();

// Listen for navigation messages from browser tab iframes
window.addEventListener('message', function(e) {
  if (e.data && e.data.terminusNav) {
    const active = activeTerminal();
    if (active && active.type === 'browser' && active._loadUrl) {
      active._loadUrl(e.data.terminusNav);
    }
  }
});

window.addEventListener('beforeunload', (e) => {
  saveState();
  const hasTerms = workspaces.some(ws => getWorkspaceTerminals(ws).length > 0);
  if (hasTerms) {
    e.preventDefault();
    e.returnValue = '';
  }
});
