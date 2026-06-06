(function() {
  'use strict';

  // Configure Coloris — hex color picker
  Coloris({
    parent: '#settings-modal',
    themeMode: 'dark',
    theme: 'default',
    format: 'hex',
    alpha: true,
    wrap: true,
  });

  // Tauri Webview API (from window.__TAURI__ global, injected by Tauri runtime)
  function tauriWebview() { return window.__TAURI__ && window.__TAURI__.webview; }
  function tauriWindow() { return window.__TAURI__ && window.__TAURI__.window; }
  function loadTauriApi() { /* no-op: API available via window.__TAURI__ at runtime */ }


  /* ═══════════════════════════════════════════════════════════════
   K E*YBOARD SHORTCUTS
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
   T H*EMES — mirror Python THEMES dict exactly
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
    'monochrome': {
      label: 'Monochrome',
      bg: '#000000', fg: '#ffffff', cursor: '#ffffff', selection: '#333333',
      swatches: ['#000000','#ffffff','#888888'],
      palette: [
        '#000000','#808080','#a0a0a0','#c0c0c0',
        '#d0d0d0','#e0e0e0','#f0f0f0','#ffffff',
        '#404040','#606060','#909090','#b0b0b0',
        '#c8c8c8','#d8d8d8','#e8e8e8','#f8f8f8',
      ],
    },
  };

  /* ═══════════════════════════════════════════════════════════════
   C U S T O M   T H E M E S
   ═══════════════════════════════════════════════════════════════ */
  const CUSTOM_THEMES_KEY = 'ghostterm-custom-themes';
  const BUILTIN_THEME_KEYS = new Set(Object.keys(THEMES));

  function loadCustomThemes() {
    try {
      const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
      if (!raw) return;
      const customs = JSON.parse(raw);
      for (const [name, theme] of Object.entries(customs)) {
        if (!BUILTIN_THEME_KEYS.has(name)) THEMES[name] = theme;
      }
    } catch {}
  }

  function saveCustomThemes(customs) {
    try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customs)); } catch {}
    for (const [name, theme] of Object.entries(customs)) {
      if (!BUILTIN_THEME_KEYS.has(name)) THEMES[name] = theme;
    }
  }

  function getCustomThemes() {
    try {
      const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function deleteCustomTheme(name) {
    const customs = getCustomThemes();
    delete customs[name];
    saveCustomThemes(customs);
    delete THEMES[name];
    if (currentThemeName === name) {
      applyTheme('catppuccin-mocha');
    }
  }

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
   S T*ATE
   ═══════════════════════════════════════════════════════════════ */
  let currentThemeName = 'catppuccin-mocha';
  let currentTheme = THEMES[currentThemeName];
  let currentFontSize = 13;
  let currentFontFamily = "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace";
  let currentLineHeight = 1.4;
  let currentCursorStyle = 'block';
  let currentCursorBlink = true;
  let statusBarVisible = true;
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

  let _browserSyncRaf = null;
  const browserSlotRo = new ResizeObserver(() => {
    if (_browserSyncRaf) return;
    _browserSyncRaf = requestAnimationFrame(() => {
      _browserSyncRaf = null;
      syncBrowserSlots();
    });
  });

  function syncBrowserSlots() {
    const paneArea = document.getElementById('pane-area');
    if (!paneArea) return;

    // PHASE 1: Batch READ (Prevents Layout Thrashing)
    const paneRect = paneArea.getBoundingClientRect();
    const updates = [];

    // OPTIMIZATION: Only process the active workspace. Ignore hidden ones completely.
    const ws = activeWs();
    if (ws) {
      for (const t of getWorkspaceTerminals(ws)) {
        if (t.type === 'browser' && t.browserContainer) {
          if (!t.el || !t.el.isConnected || t.el.style.display === 'none' || t.el.offsetWidth === 0) {
            // OPTIMIZATION: Offscreen positioning instead of display:none prevents iframe reloads
            updates.push({ container: t.browserContainer, x: -9999, y: -9999, w: 0, h: 0 });
          } else {
            const slotRect = t.el.getBoundingClientRect();
            updates.push({
              container: t.browserContainer,
              x: slotRect.left - paneRect.left,
              y: slotRect.top - paneRect.top,
              w: slotRect.width,
              h: slotRect.height
            });
          }
        }
      }
    }

    // Hide all inactive workspaces' browser containers by pushing them offscreen
    for (const otherWs of workspaces) {
      if (otherWs.id === activeWsId) continue;
      for (const t of getWorkspaceTerminals(otherWs)) {
        if (t.type === 'browser' && t.browserContainer) {
          updates.push({ container: t.browserContainer, x: -9999, y: -9999, w: 0, h: 0 });
        }
      }
    }

    // PHASE 2: Batch WRITE (Hardware Accelerated)
    for (const u of updates) {
      const bc = u.container;
      if (bc.style.display !== 'flex') bc.style.display = 'flex'; // Always keep flex to avoid unload
      bc.style.visibility = u.w === 0 ? 'hidden' : 'visible';
      bc.style.transform = `translate3d(${u.x}px, ${u.y}px, 0)`;
      bc.style.width = `${u.w}px`;
      bc.style.height = `${u.h}px`;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   B R*OWSER TAB IFRAME (sandboxed, suspend/resume)
   ═══════════════════════════════════════════════════════════════ */

  // Background browser tabs are suspended after this much invisibility
  // to free memory (dev-server pages can hold hundreds of MB).
  const BROWSER_SUSPEND_MS = 30_000;

  const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)([?#].*)?$/i;
  const PDF_EXT_RE = /\.pdf([?#].*)?$/i;

  const SPLIT_MIN_PX = 200;
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 5;
  const ZOOM_STEP = 0.1;

  function isLocalUrl(url) {
    try {
      const u = new URL(url);
      const h = u.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0'
        || h === '[::1]' || h.endsWith('.localhost');
    } catch { return false; }
  }

  function suspendBrowserTab(entry) {
    // Disabled to persist iframe state while backgrounded
  }

  function resumeBrowserTab(entry) {
    // Disabled to persist iframe state while backgrounded
  }

  /* ═══════════════════════════════════════════════════════════════
   W E*BSOCKET
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
   T A*URI NATIVE PTY
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
   U U*ID helper
   ═══════════════════════════════════════════════════════════════ */
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   F I*ND & RECURSIVE TREE HELPERS
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
      const origLen = node.children.length;
      // Build list of (original index, cleaned child) for non-null children
      const pairs = [];
      node.children.forEach((c, i) => {
        const cleaned = removeEmptyGroups(c);
        if (cleaned) pairs.push({ i, c: cleaned });
      });
      // Filter out empty terminal groups
      const survivors = pairs.filter(p =>
        !(p.c.type === 'group' && p.c.terminals.length === 0)
      );
      node.children = survivors.map(p => p.c);

      // Keep sizes in sync with survivors
      if (survivors.length !== origLen) {
        node.sizes = survivors.map(p => node.sizes[p.i] ?? (100 / survivors.length));
        const total = node.sizes.reduce((a, b) => a + b, 0);
        if (total > 0) node.sizes = node.sizes.map(s => (s / total) * 100);
      }

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
   T H*EME APPLICATION
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
    const accent = (theme.ui && theme.ui.accent) || theme.palette[4] || theme.palette[12] || theme.fg;
    r.setProperty('--accent', accent);
    r.setProperty('--ws-active-strip', accent);
    r.setProperty('--accent-dim', hexToRgba(accent, 0.15));

    // UI overrides from custom theme
    const uiProps = ['border', 'tabActiveBg', 'tabHoverBg', 'dimText', 'mutedText'];
    const uiCss = { border: '--border', tabActiveBg: '--tab-active-bg', tabHoverBg: '--tab-hover-bg', dimText: '--dim-text', mutedText: '--muted-text' };
    if (theme.ui) {
      for (const prop of uiProps) {
        if (theme.ui[prop]) r.setProperty(uiCss[prop], theme.ui[prop]);
        else r.removeProperty(uiCss[prop]);
      }
    } else {
      for (const prop of uiProps) r.removeProperty(uiCss[prop]);
    }

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
   S T*ATE PERSISTENCE
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
      statusBarVisible,
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
      if (state.statusBarVisible !== undefined) statusBarVisible = state.statusBarVisible;
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
   W O*RKSPACE MANAGEMENT
   ═══════════════════════════════════════════════════════════════ */
  let wsCount = 0;

  function createWorkspace(label) {
    wsCount++;
    const id = uuid();
    const ws = { id, label: label || ('Workspace ' + (workspaces.length + 1)), layout: null, activeTermId: null };
    workspaces.push(ws);
    activateWorkspace(id);
    addTerminal(id);
    return ws;
  }

  function activateWorkspace(id, skipRender) {
    if (id === activeWsId) return;
    activeWsId = id;
    if (!skipRender) {
      // Update active class in-place to avoid flicker from full sidebar rebuild
      document.querySelectorAll('.ws-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.wsid === id);
      });
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
            groupDom.classList.add('maximized');
            container.appendChild(groupDom);
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
      syncBrowserSlots();
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
      if (workspaces.length) { activateWorkspace(workspaces[Math.max(0, idx-1)].id); renderSidebar(); }
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
   T E*RMINAL MANAGEMENT
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
        // Sync group color from active tab's color
        if (groupEl) {
          const act = groupEl.querySelector('.tg-tab.active');
          if (act && act.dataset.color) groupEl.style.setProperty('--group-tab-color', act.dataset.color);
          else groupEl.style.removeProperty('--group-tab-color');
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
            tab.innerHTML = `<span class="tg-tab-dot tg-tab-icon"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><ellipse cx="8" cy="8" rx="3" ry="6.5"/><line x1="1.5" y1="8" x2="14.5" y2="8"/></svg></span><span class="tg-tab-name">${escHtml(entry.label)}</span><span class="tg-tab-close" title="Close">✕</span>`;
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
          }
        }
        // Sync group color from active tab's color
        if (groupEl) {
          const act = groupEl.querySelector('.tg-tab.active');
          if (act && act.dataset.color) groupEl.style.setProperty('--group-tab-color', act.dataset.color);
          else groupEl.style.removeProperty('--group-tab-color');
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
          // Sync group color from active tab
          const activeTab = groupEl.querySelector('.tg-tab.active');
          if (activeTab && activeTab.dataset.color) {
            groupEl.style.setProperty('--group-tab-color', activeTab.dataset.color);
          } else {
            groupEl.style.removeProperty('--group-tab-color');
          }
          // Toggle slot visibility + suspend/resume browser tabs
          group.terminals.forEach(t => {
            const slot = document.getElementById('slot-' + t.id);
            if (!slot) return;
            const isActive = t.id === termId;
            const showAs = 'block'; // Placeholders can safely be block
            slot.style.display = isActive ? showAs : 'none';
            if (t.type === 'browser') {
              if (isActive) resumeBrowserTab(t);
              else suspendBrowserTab(t);
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
          // Don't auto-focus URL input on tab switch
        } else {
          setTimeout(() => { t.term.focus(); fitTerm(t); }, 20);
        }
      }
    }
    syncBrowserSlots();
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
      if (entry._suspendTimer) { clearTimeout(entry._suspendTimer); entry._suspendTimer = null; }
      if (entry.browserContainer) { entry.browserContainer.remove(); entry.browserContainer = null; }
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

    // Fallback: if the split was destroyed, pass focus to the next available terminal
    const remainingTerms = getWorkspaceTerminals(wsp);
    if (remainingTerms.length > 0 && !remainingTerms.some(t => t.id === wsp.activeTermId)) {
      wsp.activeTermId = remainingTerms[0].id;
      const fallbackGroup = findGroupContainingTerm(wsp.layout, wsp.activeTermId);
      if (fallbackGroup && !fallbackGroup.activeTermId) {
        fallbackGroup.activeTermId = wsp.activeTermId;
      }
    }

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
      const newActiveId = wsp.activeTermId || (group ? group.activeTermId : null);
      if (newActiveId) {
        const newEntry = getWorkspaceTerminals(wsp).find(x => x.id === newActiveId);
        if (newEntry && newEntry.el) {
          focusedSlotId = newEntry.el.id;
          updateFocusedGroup();
          newEntry.el.classList.add('focused');

          if (newEntry.type !== 'browser' && newEntry.term) {
            setTimeout(() => {
              newEntry.term.focus();
              fitTerm(newEntry);
            }, 60);
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
        // Sync group color if this is the active tab
        if (tabWrap.classList.contains('active')) {
          const group = tabWrap.closest('.term-group');
          if (group) {
            if (t.color) group.style.setProperty('--group-tab-color', t.color);
            else group.style.removeProperty('--group-tab-color');
          }
        }
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
      // Frontend fits instantly for snappy visual feedback
      entry.fit.fit();
      const dims = entry.term.rows && entry.term.cols
      ? { cols: entry.term.cols, rows: entry.term.rows }
      : { cols: 80, rows: 24 };

      // Debounce the backend PTY resize to prevent freezing the socket/app during continuous resizes
      if (entry._resizeTimeout) clearTimeout(entry._resizeTimeout);
      entry._resizeTimeout = setTimeout(() => {
        sendControl({ type: 'resize', id: entry.id, cols: dims.cols, rows: dims.rows });
      }, 80);

      updateStatusBar();
    } catch {}
  }

  /* ═══════════════════════════════════════════════════════════════
   S P*LIT MANAGEMENT (VS Code recursive logic)
═══════════════════════════════════════════════════════════════ */

  function splitGroupDirectly(wsId, groupId, direction) {
    const wsp = findWs(wsId);
    if (!wsp || !wsp.layout) return;

    // Prevent split if the workspace is maximized
    if (wsp._maximizedGroupId) {
      if (typeof zoomBadge === 'function') zoomBadge("Cannot split while maximized");
      return;
    }

    const targetGroup = findGroupById(wsp.layout, groupId);
    if (!targetGroup) return;

    // Prevent split if there isn't enough space
    const groupEl = document.getElementById('group-' + groupId);
    if (groupEl) {
      const currentSize = direction === 'row' ? groupEl.offsetWidth : groupEl.offsetHeight;
      const MIN_REQUIRED = SPLIT_MIN_PX * 2;
      if (currentSize < MIN_REQUIRED) {
        if (typeof zoomBadge === 'function') zoomBadge("Not enough space");
        return;
      }
    }

    // Create a new terminal for the new split pane
    const allTerms = getWorkspaceTerminals(wsp);
    const id = uuid();
    const label = `bash ${allTerms.length + 1}`;
    const newEntry = _createTermEntry(wsp, id, label);

    const newGroup = {
      type: 'group',
      id: 'group-' + uuid(),
      terminals: [newEntry],
      activeTermId: id
    };

    // Update layout tree: split the target group
    if (wsp.layout.id === groupId) {
      // Target is the root — replace root with a split node
      const isFirst = true;
      wsp.layout = {
        type: 'split',
        id: 'split-' + uuid(),
        direction,
        children: isFirst ? [newGroup, wsp.layout] : [wsp.layout, newGroup],
        sizes: [50, 50]
      };
    } else {
      splitGroupNodeInTree(wsp.layout, groupId, newGroup, direction, false);
    }

    wsp.activeTermId = id;
    renderPaneArea();
    activateTerminal(wsp.id, id);
    saveState();

    setTimeout(() => {
      const slot = getSlotDimensions(newEntry);
      sendControl({ type: 'create', id, cols: slot.cols, rows: slot.rows });
      requestAnimationFrame(() => fitTerm(newEntry));
    }, 80);
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
   M A*XIMIZE / RESTORE TAB
   ═══════════════════════════════════════════════════════════════ */
  function toggleMaximizeTerminal(wsId, termId) {
    const wsp = findWs(wsId);
    if (!wsp) return;

    const container = _wsDomCache[wsp.id];
    if (!container) {
      // No cached DOM — fallback to old render path (edge case)
      if (wsp._maximizedGroupId) {
        wsp._maximizedGroupId = null;
      } else {
        const group = findGroupContainingTerm(wsp.layout, termId);
        if (!group) return;
        wsp._maximizedGroupId = group.id;
      }
      renderPaneArea();
      return;
    }

    if (wsp._maximizedGroupId) {
      // Unmaximize: remove cached DOM and rebuild full layout
      wsp._maximizedGroupId = null;
      const oldContainer = _wsDomCache[wsp.id];
      if (oldContainer) { oldContainer.remove(); delete _wsDomCache[wsp.id]; }
      switchWorkspacePane();
    } else {
      const group = findGroupContainingTerm(wsp.layout, termId);
      if (!group) return;
      wsp._maximizedGroupId = group.id;

      const groupId = 'group-' + group.id;
      container.querySelectorAll('.term-group').forEach(el => {
        if (el.id === groupId) {
          el.style.position = 'absolute';
          el.style.inset = '0';
          el.style.zIndex = '10';
          el.classList.add('maximized');
        } else {
          el.style.display = 'none';
        }
      });
      container.querySelectorAll('.sash').forEach(el => {
        el.style.display = 'none';
      });
    }

    // Update focus
    document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
    focusedSlotId = null;
    const all = getWorkspaceTerminals(wsp);
    const active = all.find(x => x.id === wsp.activeTermId);
    if (active && active.el) {
      focusedSlotId = active.el.id;
      active.el.classList.add('focused');
      if (active.type !== 'browser') active.term.focus();
    }
    updateFocusedGroup();

    // Fit terminals after layout settles
    setTimeout(() => {
      all.forEach(t => fitTerm(t));
      syncBrowserSlots();
    }, 0);
  }

  /* ═══════════════════════════════════════════════════════════════
   P A*NE AREA RENDERING (Recursive execution tree)
═══════════════════════════════════════════════════════════════ */
  function getMinSizes(node) {
    if (!node) return { minW: 0, minH: 0 };
    if (node.type === 'group') return { minW: SPLIT_MIN_PX, minH: SPLIT_MIN_PX };
    if (node.type === 'split') {
      let minW = 0, minH = 0;
      node.children.forEach((c, idx) => {
        const s = getMinSizes(c);
        if (node.direction === 'row') {
          minW += s.minW;
          if (idx > 0) minW += 4;
          minH = Math.max(minH, s.minH);
        } else {
          minH += s.minH;
          if (idx > 0) minH += 4;
          minW = Math.max(minW, s.minW);
        }
      });
      return { minW, minH };
    }
    return { minW: 0, minH: 0 };
  }

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

      const mins = getMinSizes(node);
      container.style.minWidth = mins.minW + 'px';
      container.style.minHeight = mins.minH + 'px';

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
      groupEl.dataset.groupId = node.id;

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
        <span class="tg-tab-dot${t.type === 'browser' ? ' tg-tab-icon' : ''}">${t.type === 'browser' ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><ellipse cx="8" cy="8" rx="3" ry="6.5"/><line x1="1.5" y1="8" x2="14.5" y2="8"/></svg>' : ''}</span>
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

      // Sync group color from active tab
      const activeTabEl = tabsContainer.querySelector('.tg-tab.active');
      if (activeTabEl && activeTabEl.dataset.color) {
        groupEl.style.setProperty('--group-tab-color', activeTabEl.dataset.color);
      }

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

      // Collapsible buttons (hidden in compact mode via CSS)
      addBrowserBtn.classList.add('tg-btn-collapse');
      splitH.classList.add('tg-btn-collapse');
      splitV.classList.add('tg-btn-collapse');
      maxBtn.classList.add('tg-btn-collapse');
      actions.appendChild(addBrowserBtn);
      actions.appendChild(splitH);
      actions.appendChild(splitV);
      actions.appendChild(maxBtn);

      // Dropdown menu for compact mode
      const dropdownWrap = document.createElement('div');
      dropdownWrap.className = 'tg-dropdown-wrap';

      const dropdownBtn = document.createElement('div');
      dropdownBtn.className = 'tg-btn tg-dropdown-trigger';
      dropdownBtn.title = 'More actions';
      dropdownBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';

      const dropdown = document.createElement('div');
      dropdown.className = 'tg-dropdown';

      function makeDropdownItem(label, icon, onClick) {
        const item = document.createElement('div');
        item.className = 'tg-dropdown-item';
        item.innerHTML = `<span class="tg-dropdown-icon">${icon}</span><span>${label}</span>`;
        item.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.remove('open'); onClick(); });
        return item;
      }
      dropdown.appendChild(makeDropdownItem('Browser tab', addBrowserBtn.innerHTML, () => addBrowserTab(wsp.id, node.id)));
      dropdown.appendChild(makeDropdownItem('Split horizontal', splitH.innerHTML, () => splitGroupDirectly(wsp.id, node.id, 'row')));
      dropdown.appendChild(makeDropdownItem('Split vertical', splitV.innerHTML, () => splitGroupDirectly(wsp.id, node.id, 'column')));
      dropdown.appendChild(makeDropdownItem(isMax ? 'Restore' : 'Maximize', maxBtn.innerHTML, () => { if (node.activeTermId) toggleMaximizeTerminal(wsp.id, node.activeTermId); }));

      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = dropdown.classList.contains('open');
        document.querySelectorAll('.tg-dropdown.open').forEach(d => d.classList.remove('open'));
        if (!wasOpen) dropdown.classList.add('open');
      });
      document.addEventListener('click', () => dropdown.classList.remove('open'));

      dropdownWrap.appendChild(dropdownBtn);
      dropdownWrap.appendChild(dropdown);
      actions.appendChild(dropdownWrap);
      header.appendChild(actions);
      groupEl.appendChild(header);

      const body = document.createElement('div');
      body.className = 'term-group-body';

      const overlay = document.createElement('div');
      overlay.className = 'drag-indicator-overlay';
      body.appendChild(overlay);

      const dragShield = document.createElement('div');
      dragShield.className = 'drag-shield';
      body.appendChild(dragShield);

      node.terminals.forEach(t => {
        const isAct = t.id === node.activeTermId;
        const slot = getOrCreateSlot(t, wsp, body);
        const showAs = 'block';
        slot.style.display = isAct ? showAs : 'none';
        if (isAct && slot.id === focusedSlotId) slot.classList.add('focused');
        else slot.classList.remove('focused');
        body.appendChild(slot);
      });

      setupGroupDragAndDrop(body, node, wsp, overlay);

      // Click on group body focuses the active terminal
      body.addEventListener('mousedown', (e) => {
        // Don't steal focus when clicking inside an iframe
        if (e.target.tagName === 'IFRAME') return;
        document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
        const activeSlot = body.querySelector('.term-slot[style*="display: block"], .term-slot[style*="display: flex"]');
        if (activeSlot) {
          activeSlot.classList.add('focused');
          focusedSlotId = activeSlot.id;
        }
        updateFocusedGroup();
        const activeEntry = node.terminals.find(t => t.id === node.activeTermId);
        if (activeEntry) {
          wsp.activeTermId = activeEntry.id;
          if (activeEntry.type === 'browser') {
            // Don't auto-focus URL input — let iframe keep focus
          } else if (activeEntry.term) {
            setTimeout(() => activeEntry.term.focus(), 20);
          }
        }
      });

      groupEl.appendChild(body);

      // Hide split/browser/maximize buttons when group is too narrow
      new ResizeObserver(() => {
        header.classList.toggle('compact', groupEl.clientWidth < 300);
      }).observe(groupEl);

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
      slot.classList.add('browser-slot-placeholder');
      browserSlotRo.observe(slot);

      if (!entry.browserContainer) {
        const bc = document.createElement('div');
        bc.className = 'browser-slot';
        bc.style.position = 'absolute';
        bc.style.top = '0';
        bc.style.left = '0';
        bc.style.zIndex = '50';
        bc.style.display = 'none';
        bc.style.willChange = 'transform, width, height';
        bc.style.transformOrigin = 'top left';

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

        contentWrap.appendChild(loadingBar);

        const pageView = document.createElement('div');
        pageView.className = 'browser-page-view';
        contentWrap.appendChild(pageView);

        bc.appendChild(toolbar);
        bc.appendChild(contentWrap);

        document.getElementById('pane-area').appendChild(bc);
        entry.browserContainer = bc;
        entry._pageView = pageView;
        entry._browserZoom = 1;

        let loading = false;
        function showLoading(on) {
          loading = on;
          loadingBar.classList.toggle('active', on);
          btnReload.classList.toggle('spin', on);
        }

        function showError(url, msg) {
          contentWrap.style.background = '#fff';
          pageView.style.display = '';
          var friendlyMsg = msg;
          if (msg.includes('connect') || msg.includes('ECONNREFUSED') || msg.includes('timed out')) {
            friendlyMsg = 'Cannot connect to the site. The proxy server may be down or the site is unreachable.';
          } else if (msg.includes('CORS') || msg.includes('Access-Control')) {
            friendlyMsg = 'The site blocked the request due to CORS policy. Try reloading or opening in an external browser.';
          } else if (msg.includes('404')) {
            friendlyMsg = 'Page not found on the remote server.';
          }
          pageView.innerHTML = `
          <div class="browser-error-page">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke-width="2"/>
          </svg>
          <h2>Can't reach this page</h2>
          <p class="browser-error-url">${escHtml(url)}</p>
          <p class="browser-error-msg">${escHtml(friendlyMsg)}</p>
          <div class="browser-error-actions">
          <button class="browser-error-btn" id="err-retry">Try again</button>
          <button class="browser-error-btn browser-error-btn-ext" id="err-ext">Open in browser ↗</button>
          </div>
          </div>`;
          pageView.querySelector('#err-retry')?.addEventListener('click', () => loadUrl(entry.url));
          pageView.querySelector('#err-ext')?.addEventListener('click', () => openExternalUrl(entry.url));
        }

        function showStartPage() {
          contentWrap.style.background = '#fff';
          pageView.style.display = '';
          pageView.innerHTML = `
          <div class="browser-start-page">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
          <p>Enter a URL or search term above</p>
          <p class="browser-start-hint">${isTauri() ? 'Native webview — sites load directly without proxy.' : 'Proxied browser — sites load via local proxy to strip frame restrictions.'}</p>
          </div>`;
        }

        function showImageViewer(url) {
          pageView.style.display = 'none';
          let wrap = contentWrap.querySelector('.browser-img-wrap');
          if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'browser-img-wrap';
            contentWrap.appendChild(wrap);
          }
          wrap.innerHTML = '<img class="browser-img" alt="">';
          wrap.style.display = 'flex';
          const img = wrap.querySelector('img');
          img.src = proxyUrl(url);
          entry._imgEl = img;
          entry._browserZoom = 1;
        }

        function showPdfViewer(url) {
          pageView.style.display = 'none';
          const iframe = contentWrap.querySelector('iframe.browser-fallback');
          if (iframe) iframe.style.display = 'none';
          let wrap = contentWrap.querySelector('.browser-pdf-wrap');
          if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'browser-pdf-wrap';
            wrap.innerHTML = '<div></div>';
            contentWrap.appendChild(wrap);
          }
          wrap.style.display = 'block';
          entry._pdfWrap = wrap;
          const target = wrap.querySelector('div');
          target.innerHTML = '';
          const srcUrl = proxyUrl(url);
          console.log('[EmbedPDF] src:', srcUrl, '(original:', url, ')');
          if (!window.EmbedPDF) { wrap.style.display = 'none'; const fb = contentWrap.querySelector('iframe.browser-fallback'); if (fb) fb.style.display = ''; return; }
          try {
            window.EmbedPDF.init({ type: 'container', target, src: srcUrl, worker: false, tabBar: 'never' });
          } catch (err) { console.error('[EmbedPDF] init failed:', err); wrap.style.display = 'none'; const fb = contentWrap.querySelector('iframe.browser-fallback'); if (fb) fb.style.display = ''; }
        }

        function normalizeAssetUrl(url) {
          if (url && url.startsWith('asset:')) {
            try {
              const prefix = url.match(/^asset:\/\/[^\/]*\//)?.[0] || 'asset://localhost/';
              let pathDecoded = decodeURIComponent(url.substring(prefix.length));
              if (pathDecoded.startsWith('/')) pathDecoded = pathDecoded.substring(1);
              return prefix + pathDecoded;
            } catch (e) { return url; }
          }
          return url;
        }

        function normalizeUrl(raw) {
          if (!raw || raw === 'about:blank') return null;
          let url = raw.trim();

          const localMatch = url.match(/^(\/.+)|^([a-zA-Z]:[/\\].+)$/);
          if (localMatch) {
            const p = localMatch[1] || localMatch[2];
            if (isTauri() && window.__TAURI__ && window.__TAURI__.core) {
              return normalizeAssetUrl(window.__TAURI__.core.convertFileSrc(p));
            }
            return 'file://' + p.replace(/\\/g, '/');
          }

          if (url.startsWith('file://') && isTauri() && window.__TAURI__ && window.__TAURI__.core) {
            return normalizeAssetUrl(window.__TAURI__.core.convertFileSrc(url.slice(7)));
          }

          if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(url)) return url;
          if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url)) return 'http://' + url;
          if (!url.includes('.') || url.includes(' ')) return 'https://www.google.com/search?igu=1&q=' + encodeURIComponent(url);
          return 'https://' + url;
        }

        const PROXY_PORT = 7682;
        function proxyUrl(url) {
          if (!url) return url;
          if (url.startsWith('asset://')) {
            const filePath = decodeURIComponent(url.replace('asset://localhost/', '/'));
            return `http://127.0.0.1:${PROXY_PORT}/local/` + encodeURIComponent(filePath);
          }
          if (url.startsWith('file://')) {
            const filePath = url.slice(7);
            return `http://127.0.0.1:${PROXY_PORT}/local/` + encodeURIComponent(filePath);
          }
          const u2 = new URL(url);
          const origin = u2.origin;
          const path = url.substring(origin.length) || '/';
          const b64 = btoa(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          return `http://127.0.0.1:${PROXY_PORT}/p/${b64}${path}`;
        }

        async function loadUrl(rawUrl) {
          const url = normalizeUrl(rawUrl);
          if (!url) { showStartPage(); return; }

          if (entry._suspended) {
            entry._suspended = false;
            entry._suspendedUrl = null;
          }
          if (entry._suspendTimer) { clearTimeout(entry._suspendTimer); entry._suspendTimer = null; }

          showLoading(true);
          urlInput.value = url;
          entry.url = url;

          if (entry._history[entry._historyIdx] !== url) {
            entry._history = entry._history.slice(0, entry._historyIdx + 1);
            entry._history.push(url);
            entry._historyIdx = entry._history.length - 1;
          }
          updateNavButtons();
          entry.label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 28) || 'browser';
          renderSidebar();
          updateStatusBar();

          entry._browserZoom = 1;
          const prevImg = contentWrap.querySelector('.browser-img-wrap');
          if (prevImg) prevImg.style.display = 'none';
          entry._imgEl = null;
          const prevPdfWrap = contentWrap.querySelector('.browser-pdf-wrap');
          if (prevPdfWrap) prevPdfWrap.style.display = 'none';

          if (PDF_EXT_RE.test(url)) {
            showPdfViewer(url);
            showLoading(false);
            return;
          }

          if (IMAGE_EXT_RE.test(url)) {
            showImageViewer(url);
            showLoading(false);
            return;
          }

          try {
            let iframe = contentWrap.querySelector('iframe.browser-fallback');
            if (!iframe) {
              iframe = document.createElement('iframe');
              iframe.className = 'browser-fallback';
              iframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff;transform:translateZ(0);';
              iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';
              iframe.referrerPolicy = 'no-referrer';
              iframe.allow = 'clipboard-read; clipboard-write; fullscreen';
              var loadTimer = setTimeout(function() {
                if (loading) {
                  showLoading(false);
                  showError(url, 'Page load timed out. The proxy may not be able to reach this site, or the site may require authentication.');
                }
              }, 20000);
              iframe.onload = function() {
                clearTimeout(loadTimer);
                showLoading(false);
                resumeBrowserTab(entry);
              };
              contentWrap.insertBefore(iframe, pageView);
            }
            pageView.style.display = 'none';
            iframe.style.display = 'block';

            var _oldWrap = contentWrap.querySelector('.browser-zoom-wrap');
            if (_oldWrap) {
              if (_oldWrap.contains(iframe)) contentWrap.appendChild(iframe);
              _oldWrap.remove();
              iframe.style.position = '';
              iframe.style.left = '';
              iframe.style.top = '';
              iframe.style.transform = '';
            }
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            entry._iframe = iframe;
            if (url.startsWith('file://') || url.startsWith('asset:')) {
              iframe.removeAttribute('sandbox');
            } else {
              iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';
            }
            iframe.src = proxyUrl(url);
            if (url.startsWith('file://') || url.startsWith('asset:')) {
              showLoading(false);
            }
            entry.url = url;
          } catch (e) {
            showLoading(false);
            showError(url, 'Failed to load page: ' + e.message);
          }
        }

        entry._loadUrl = loadUrl;

        function syncUrl(url) {
          entry.url = url;
          urlInput.value = url;
          entry.label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 28) || 'browser';
          if (entry._history[entry._historyIdx] !== url) {
            entry._history = entry._history.slice(0, entry._historyIdx + 1);
            entry._history.push(url);
            entry._historyIdx = entry._history.length - 1;
          }
          updateNavButtons();
          renderSidebar();
          updateStatusBar();
        }
        entry._syncUrl = syncUrl;

        function updateNavButtons() {
          btnBack.disabled = entry._historyIdx <= 0;
          btnFwd.disabled = entry._historyIdx >= entry._history.length - 1;
          btnBack.style.opacity = btnBack.disabled ? '0.35' : '';
          btnFwd.style.opacity = btnFwd.disabled ? '0.35' : '';
        }

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
        btnReload.addEventListener('click', () => {
          if (loading && !entry._suspended) return;
          loadUrl(entry.url);
        });
        btnOpenExt.addEventListener('click', () => { if (entry.url && entry.url !== 'about:blank') openExternalUrl(entry.url); });

        bc.addEventListener('mousedown', () => {
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

        if (entry.url && entry.url !== 'about:blank') {
          loadUrl(entry.url);
        } else {
          showStartPage();
        }
      }

      entry.el = slot;
      entry.opened = true;
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

        const minPrev = parseInt(prevPane.style[isRow ? 'minWidth' : 'minHeight']) || SPLIT_MIN_PX;
        const minNext = parseInt(nextPane.style[isRow ? 'minWidth' : 'minHeight']) || SPLIT_MIN_PX;

        const totalSize = startSizes[prevIdx] + startSizes[nextIdx];
        const newPrev = Math.max(minPrev, Math.min(startSizes[prevIdx] + delta, totalSize - minNext));
        const newNext = totalSize - newPrev;

        prevPane.style.flex = 'none';
        nextPane.style.flex = 'none';
        prevPane.style[dim] = newPrev + 'px';
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
   D R*AG AND DROP HANDLERS
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

    // Prevent split on drag/drop if maximized or not enough space
    if (zone !== 'center') {
      if (wsp._maximizedGroupId) {
        if (typeof zoomBadge === 'function') zoomBadge("Cannot split while maximized");
        zone = 'center';
      } else {
        const groupEl = document.getElementById('group-' + targetGroupId);
        if (groupEl) {
          const dir = (zone === 'left' || zone === 'right') ? 'row' : 'column';
          const currentSize = dir === 'row' ? groupEl.offsetWidth : groupEl.offsetHeight;
          const MIN_REQUIRED = SPLIT_MIN_PX * 2;
          if (currentSize < MIN_REQUIRED) {
            if (typeof zoomBadge === 'function') zoomBadge("Not enough space");
            zone = 'center';
          }
        }
      }
    }

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
   S I*DEBAR RENDERING
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
      btn.draggable = true;
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
        if (window._wsDragged) { window._wsDragged = false; return; }
        activateWorkspace(wsp.id);
      });
      btn.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); _suppressPasteUntil = Date.now() + 200; removeWorkspace(wsp.id); } });
      btn.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'workspace', wsp.id); });

      // Drag & drop reorder
      btn.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', wsp.id);
        e.dataTransfer.effectAllowed = 'move';
        btn.classList.add('dragging');
        window.draggedWsId = wsp.id;
        startResizing();
      });
      btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        window.draggedWsId = null;
        sb.querySelectorAll('.ws-btn.drop-above, .ws-btn.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
        stopResizing();
      });
      btn.addEventListener('dragover', e => {
        if (!window.draggedWsId || window.draggedWsId === wsp.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = btn.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        sb.querySelectorAll('.ws-btn.drop-above, .ws-btn.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
        btn.classList.add(e.clientY < midY ? 'drop-above' : 'drop-below');
      });
      btn.addEventListener('dragleave', () => {
        btn.classList.remove('drop-above', 'drop-below');
      });
      btn.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = window.draggedWsId;
        if (!draggedId || draggedId === wsp.id) return;
        const rect = btn.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        const fromIdx = workspaces.findIndex(w => w.id === draggedId);
        const toIdx = workspaces.findIndex(w => w.id === wsp.id);
        if (fromIdx === -1 || toIdx === -1) return;

        const [moved] = workspaces.splice(fromIdx, 1);
        const targetIdx = workspaces.findIndex(w => w.id === wsp.id);
        workspaces.splice(insertBefore ? targetIdx : targetIdx + 1, 0, moved);

        sb.querySelectorAll('.ws-btn.drop-above, .ws-btn.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
        window.draggedWsId = null;
        window._wsDragged = true;
        setTimeout(() => { window._wsDragged = false; }, 0);
        renderSidebar();
        saveState();
      });

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
    // Drop on ws-add = move to end
    addBtn.addEventListener('dragover', e => {
      if (!window.draggedWsId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    addBtn.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = window.draggedWsId;
      if (!draggedId) return;
      const fromIdx = workspaces.findIndex(w => w.id === draggedId);
      if (fromIdx === -1 || fromIdx === workspaces.length - 1) { window.draggedWsId = null; return; }
      const [moved] = workspaces.splice(fromIdx, 1);
      workspaces.push(moved);
      window.draggedWsId = null;
      window._wsDragged = true;
      setTimeout(() => { window._wsDragged = false; }, 0);
      renderSidebar();
      saveState();
    });
    sb.insertBefore(addBtn, actionsEl);
  }

  /* ═══════════════════════════════════════════════════════════════
   S T*ATUS BAR
   ═══════════════════════════════════════════════════════════════ */
  function updateStatusBar() {
    const wsp = activeWs();
    document.getElementById('sb-ws').textContent = wsp ? wsp.label : '—';
    const t = activeTerminal();
    document.getElementById('sb-term').textContent = t ? t.label : '—';
    if (t?.term) {
      const cols = t.term.cols || 0;
      const rows = t.term.rows || 0;
      const fSize = t._customFontSize || currentFontSize;
      document.getElementById('sb-size').textContent = cols && rows ? `${cols}×${rows} · ${fSize}px` : '—';
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
   C O*NTEXT MENU
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
   P R*OMPT MODAL
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
   F O*NT SIZE (Ctrl+Scroll) + Browser zoom
═══════════════════════════════════════════════════════════════ */
  const FONT_MIN = 8;
  const FONT_MAX = 32;

  /* ── Zoom badge ── */
  const zoomBadge = (function() {
    const el = document.createElement('div');
    el.id = 'zoom-badge';
    document.body.appendChild(el);
    var timer = null;
    return function showZoomBadge(text) {
      el.textContent = text;
      el.classList.add('visible');
      clearTimeout(timer);
      timer = setTimeout(function() { el.classList.remove('visible'); }, 800);
    };
  })();

  document.getElementById('pane-area').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    const active = activeTerminal();

    // Browser image zoom (iframe use native zoom, not intercepted)
    if (active && active.type === 'browser' && active._imgEl) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      const cur = active._browserZoom || 1;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cur + delta * ZOOM_STEP));
      if (newZoom === cur) return;
      active._browserZoom = newZoom;
      active._imgEl.style.transform = 'scale(' + newZoom + ')';
      zoomBadge(Math.round(newZoom * 100) + '%');
      return;
    }

    // Terminal font size (not browser tabs — let iframe handle natively)
    if (!active || active.type === 'browser') return;

    // Stop the wheel scroll from bubbling and zooming the actual browser window
    e.preventDefault();
    e.stopPropagation();

    // Track zoom per terminal instance
    if (!active._customFontSize) active._customFontSize = currentFontSize;

    // Normalize trackpad/wheel deltas for predictable scrolling
    const delta = e.deltaY > 0 ? -1 : 1;
    const newSize = Math.max(FONT_MIN, Math.min(FONT_MAX, active._customFontSize + delta));

    if (newSize === active._customFontSize) return;
    active._customFontSize = newSize;

    // Use requestAnimationFrame for visual update to avoid layout thrashing
    if (active._zoomRaf) cancelAnimationFrame(active._zoomRaf);
    active._zoomRaf = requestAnimationFrame(() => {
      active.term.options.fontSize = active._customFontSize;
      zoomBadge(active._customFontSize + 'px');
      updateStatusBar();
    });

    // Debounce the heavy FitAddon grid recalculation and backend PTY resize communication
    // Prevents sending 60 resize payloads per second which freezes the app
    if (active._zoomFitTimeout) clearTimeout(active._zoomFitTimeout);
    active._zoomFitTimeout = setTimeout(() => {
      fitTerm(active);
    }, 150);

  }, { passive: false });

  /* ═══════════════════════════════════════════════════════════════
   S E*ARCH
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
       T O*OLBAR BUTTONS
       ═══════════════════════════════════════════════════════════════ */

      /* ═══════════════════════════════════════════════════════════════
       C U*STOM DROPDOWN
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
       T H E M E   E D I T O R
       ═══════════════════════════════════════════════════════════════ */
      const THEME_COLOR_GROUPS = {
        'Core': {
          bg: 'Background', fg: 'Foreground', cursor: 'Cursor', selection: 'Selection',
        },
        'UI Colors': {
          accent: 'Accent', border: 'Border',
          tabActiveBg: 'Tab Active BG', tabHoverBg: 'Tab Hover BG',
          dimText: 'Dim Text', mutedText: 'Muted Text',
        },
        'Terminal Palette': {
          p0: 'Black', p1: 'Red', p2: 'Green', p3: 'Yellow',
          p4: 'Blue', p5: 'Magenta', p6: 'Cyan', p7: 'White',
          p8: 'Bright Black', p9: 'Bright Red', p10: 'Bright Green', p11: 'Bright Yellow',
          p12: 'Bright Blue', p13: 'Bright Magenta', p14: 'Bright Cyan', p15: 'Bright White',
        },
      };

      const DEFAULT_PALETTE = ['#1e1e2e','#f38ba8','#a6e3a1','#f9e2af','#89b4fa','#f5c2e7','#94e2d5','#cdd6f4','#585b70','#eba0ac','#a6e3a1','#f9e2af','#89b4fa','#f5c2e7','#94e2d5','#bac2de'];

      let editingTheme = null;

      function initEditingTheme(name) {
        const src = THEMES[name];
        if (src) {
          editingTheme = {
            label: src.label || name,
            bg: src.bg, fg: src.fg, cursor: src.cursor, selection: src.selection,
            swatches: src.swatches ? [...src.swatches] : [src.bg, src.fg, src.palette ? src.palette[4] : src.fg],
            palette: src.palette ? [...src.palette] : [],
            ui: src.ui ? { ...src.ui } : {},
          };
        } else {
          editingTheme = {
            label: '', bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70',
            swatches: ['#1e1e2e', '#cdd6f4', '#89b4fa'],
            palette: [
              '#1e1e2e','#f38ba8','#a6e3a1','#f9e2af',
              '#89b4fa','#f5c2e7','#94e2d5','#cdd6f4',
              '#585b70','#eba0ac','#a6e3a1','#f9e2af',
              '#89b4fa','#f5c2e7','#94e2d5','#bac2de',
            ],
            ui: {},
          };
        }
      }

      const UI_DEFAULTS = {
        border: '#ffffff14',
        tabActiveBg: '#ffffff12',
        tabHoverBg: '#ffffff0a',
        dimText: '#ffffff4d',
        mutedText: '#ffffff80',
      };

      function getThemeColor(key) {
        if (!editingTheme) return '#000000';
        if (key === 'bg') return editingTheme.bg;
        if (key === 'fg') return editingTheme.fg;
        if (key === 'cursor') return editingTheme.cursor;
        if (key === 'selection') return editingTheme.selection;
        if (key === 'accent') return editingTheme.ui.accent || editingTheme.palette[4] || '#89b4fa';
        if (UI_DEFAULTS[key]) return editingTheme.ui[key] || UI_DEFAULTS[key];
        if (key.startsWith('p')) return editingTheme.palette[parseInt(key.slice(1))] || '#000000';
        return '#000000';
      }

function setThemeColor(key, val) {
         if (!editingTheme) return;
         if (key === 'bg') editingTheme.bg = val;
         else if (key === 'fg') editingTheme.fg = val;
         else if (key === 'cursor') editingTheme.cursor = val;
         else if (key === 'selection') editingTheme.selection = val;
         else if (key === 'accent') editingTheme.ui.accent = val;
         else if (key === 'border') editingTheme.ui.border = val || undefined;
         else if (key === 'tabActiveBg') editingTheme.ui.tabActiveBg = val || undefined;
         else if (key === 'tabHoverBg') editingTheme.ui.tabHoverBg = val || undefined;
         else if (key === 'dimText') editingTheme.ui.dimText = val || undefined;
         else if (key === 'mutedText') editingTheme.ui.mutedText = val || undefined;
         else if (key.startsWith('p')) editingTheme.palette[parseInt(key.slice(1))] = val;
         editingTheme.swatches = [editingTheme.bg, editingTheme.fg, editingTheme.ui.accent || editingTheme.palette[4] || '#89b4fa'];
}

       function openColorisForSwatch(swatchEl, currentColor, themeKey) {
         const tempInput = document.createElement('input');
         tempInput.type = 'text';
         tempInput.value = currentColor || '#000000';
         tempInput.style.position = 'fixed';
         tempInput.style.opacity = '0';
         tempInput.style.pointerEvents = 'none';
         tempInput.setAttribute('data-coloris', '');
         document.body.appendChild(tempInput);

         const onChange = (color) => {
           setThemeColor(themeKey, color);
           swatchEl.style.background = color;
           previewTheme();
         };

         const onClose = () => {
           document.body.removeChild(tempInput);
           Coloris.off('change', onChange);
           Coloris.off('close', onClose);
         };

         Coloris.on('change', onChange);
         Coloris.on('close', onClose);
         Coloris.open(false, tempInput);
         tempInput.focus();
       }

       function previewTheme() {
         if (!editingTheme) return;
         const r = document.documentElement.style;
         r.setProperty('--bg', editingTheme.bg);
         r.setProperty('--fg', editingTheme.fg);
         r.setProperty('--cursor', editingTheme.cursor);
         r.setProperty('--selection', editingTheme.selection);
         const accent = editingTheme.ui.accent || editingTheme.palette[4] || editingTheme.fg;
         r.setProperty('--accent', accent);
         r.setProperty('--ws-active-strip', accent);
         r.setProperty('--accent-dim', hexToRgba(accent, 0.15));
         const uiMap = { border:'--border', tabActiveBg:'--tab-active-bg', tabHoverBg:'--tab-hover-bg', dimText:'--dim-text', mutedText:'--muted-text' };
         for (const [prop, cssVar] of Object.entries(uiMap)) {
           r.setProperty(cssVar, editingTheme.ui[prop] || UI_DEFAULTS[prop]);
         }
       }

function renderThemeEditor() {
         const container = document.getElementById('theme-editor-groups');
         if (!container) return;
         container.innerHTML = '';

function buildColorItem(key, label) {
           const item = document.createElement('div');
           item.className = 'theme-color-item';
           const val = getThemeColor(key);

           const lbl = document.createElement('span');
           lbl.className = 'theme-color-label';
           lbl.textContent = label;

           const inp = document.createElement('input');
           inp.type = 'text';
           inp.className = 'theme-color-input';
           inp.setAttribute('data-coloris', '');
           inp.value = val;
           inp.spellcheck = false;

           const swatch = document.createElement('span');
           swatch.className = 'theme-color-swatch';
           swatch.style.background = val;
           swatch.title = label;

           inp.addEventListener('input', () => {
             let v = inp.value.trim();
             if (/^#?[0-9a-fA-F]{3,8}$/.test(v)) {
               if (!v.startsWith('#')) v = '#' + v;
               setThemeColor(key, v);
               swatch.style.background = v;
               previewTheme();
             }
           });

           item.appendChild(lbl);
           item.appendChild(inp);
           item.appendChild(swatch);
           return item;
         }

         // Colors title
         const colorsTitle = document.createElement('div');
         colorsTitle.className = 'text-[11px] font-bold uppercase tracking-[1.2px] text-[var(--dim-text)] mb-2.5 ml-1';
         colorsTitle.textContent = 'Colors';
         container.appendChild(colorsTitle);

         // Core + UI Colors in one card
         const colorsCard = document.createElement('div');
         colorsCard.className = 'bg-[color-mix(in_srgb,var(--bg)_70%,rgba(255,255,255,0.02))] border border-[var(--border)] rounded-xl mb-6 flex flex-col p-4';
         for (const [groupName, fields] of Object.entries(THEME_COLOR_GROUPS)) {
           if (groupName === 'Terminal Palette') continue;
           const title = document.createElement('div');
           title.className = 'text-[11px] font-bold uppercase tracking-[1.2px] text-[var(--dim-text)] mb-2.5 ml-1';
           title.textContent = groupName;
           colorsCard.appendChild(title);
           const grid = document.createElement('div');
           grid.className = 'theme-color-grid';
           for (const [key, label] of Object.entries(fields)) {
             grid.appendChild(buildColorItem(key, label));
           }
colorsCard.appendChild(grid);
          }
          container.appendChild(colorsCard);

          // Terminal Palette — its own card
          const paletteCard = document.createElement('div');
          paletteCard.className = 'bg-[color-mix(in_srgb,var(--bg)_70%,rgba(255,255,255,0.02))] border border-[var(--border)] rounded-xl mb-6 flex flex-col p-4';

          // Title row inside card (with toggle)
          const title = document.createElement('div');
          title.className = 'text-[11px] font-bold uppercase tracking-[1.2px] text-[var(--dim-text)] flex justify-between items-center mb-2 ml-1';
          const titleText = document.createElement('span');
          titleText.textContent = 'Terminal Palette';
          title.appendChild(titleText);

          const toggleLabel = document.createElement('label');
          toggleLabel.className = 'inline-flex items-center cursor-pointer shrink-0';
          const toggleInput = document.createElement('input');
          toggleInput.type = 'checkbox';
          toggleInput.className = 'sr-only peer';
          const toggleTrack = document.createElement('div');
          toggleTrack.className = 'relative w-9 h-5 bg-white/10 rounded-full peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[""] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--accent)]';
          toggleLabel.appendChild(toggleInput);
          toggleLabel.appendChild(toggleTrack);
          title.appendChild(toggleLabel);
          paletteCard.appendChild(title);

          const paletteGrid = document.createElement('div');
          paletteGrid.className = 'theme-color-grid';
          paletteGrid.style.display = 'none';

          for (const [key, label] of Object.entries(THEME_COLOR_GROUPS['Terminal Palette'])) {
            paletteGrid.appendChild(buildColorItem(key, label));
          }

          // Reset palette link
          const resetBtn = document.createElement('div');
          resetBtn.className = 'text-[11px] cursor-pointer text-[#e55] transition-colors duration-150 hover:text-[#f77] hover:underline text-right pt-2 border-t border-[var(--border)] mt-1';
          resetBtn.textContent = 'Reset palette';
          resetBtn.addEventListener('click', () => {
            DEFAULT_PALETTE.forEach((c, i) => { editingTheme.palette[i] = c; });
            editingTheme.swatches = [editingTheme.bg, editingTheme.fg, editingTheme.ui.accent || editingTheme.palette[4] || '#89b4fa'];
            paletteGrid.querySelectorAll('.theme-color-item').forEach((item, i) => {
              if (i < 16) {
                const v = editingTheme.palette[i];
                const s = item.querySelector('span:nth-child(2)');
                if (s) s.style.background = v;
              }
            });
            previewTheme();
          });
          paletteGrid.appendChild(resetBtn);
          paletteCard.appendChild(paletteGrid);

          // Toggle handler
          toggleInput.addEventListener('change', () => {
            const isOn = toggleInput.checked;
            paletteGrid.style.display = isOn ? '' : 'none';
            if (!isOn) {
              DEFAULT_PALETTE.forEach((c, i) => { editingTheme.palette[i] = c; });
              editingTheme.swatches = [editingTheme.bg, editingTheme.fg, editingTheme.ui.accent || editingTheme.palette[4] || '#89b4fa'];
              previewTheme();
            }
          });

          container.appendChild(paletteCard);
        }

      /* ═══════════════════════════════════════════════════════════════
       S E*TTINGS MODAL
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
        blinkToggle.checked = currentCursorBlink;

        // Status bar
        const sbToggle = document.getElementById('set-statusbar');
        sbToggle.checked = statusBarVisible;

        // Scrollback
        document.getElementById('set-scrollback').value = currentScrollback;
        document.getElementById('set-scrollback-val').textContent = currentScrollback.toLocaleString();

        // Shortcuts
        renderShortcutsList();

        // Activate first category
        switchSettingsCat('appearance');
        settingsOverlay.classList.add('open');
        document.activeElement?.blur();

        // Init theme editor in "New Theme" mode
        document.querySelectorAll('.theme-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'new'));
        document.querySelector('.theme-name-row')?.classList.remove('hidden');
        document.querySelector('.theme-name-row')?.classList.add('flex');
        document.querySelector('.theme-edit-row')?.classList.add('hidden');
        document.querySelector('.theme-edit-row')?.classList.remove('flex');
        initEditingTheme(currentThemeName);
        editingTheme.label = '';
        document.getElementById('set-theme-name').value = '';
        renderThemeEditor();
        refreshThemeCustomSelect();
        settingsOverlay.focus({ preventScroll: true });
      }

      function closeSettings() {
        applyTheme(currentThemeName);
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
        const prevCat = document.querySelector('.settings-cat-btn.active')?.dataset.cat;
        document.querySelectorAll('.settings-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
        document.querySelectorAll('.settings-section[data-cat]').forEach(s => s.classList.toggle('active', s.dataset.cat === cat));
        // Leaving theme editor → revert live preview to applied theme
        if (prevCat === 'theme-editor' && cat !== 'theme-editor') {
          applyTheme(currentThemeName);
        }
      }

      // Track theme editor mode so it persists across category switches
      let themeEditorMode = 'new';
      let themeEditorEditKey = '';

      function restoreThemeEditorState() {
        // Re-init editing theme (we reverted preview on exit)
        if (themeEditorMode === 'new') {
          initEditingTheme(currentThemeName);
        } else if (themeEditorEditKey) {
          initEditingTheme(themeEditorEditKey);
        } else {
          initEditingTheme(currentThemeName);
        }
        previewTheme();
        // Restore mode toggle
        document.querySelectorAll('.theme-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === themeEditorMode));
        const nameRow = document.querySelector('.theme-name-row');
        const editRow = document.querySelector('.theme-edit-row');
        if (themeEditorMode === 'new') {
          nameRow?.classList.remove('hidden'); nameRow?.classList.add('flex');
          editRow?.classList.add('hidden'); editRow?.classList.remove('flex');
        } else {
          nameRow?.classList.add('hidden'); nameRow?.classList.remove('flex');
          editRow?.classList.remove('hidden'); editRow?.classList.add('flex');
          refreshThemeCustomSelect();
          // Restore dropdown selection
          const sel = document.getElementById('set-theme-custom-select');
          if (sel && themeEditorEditKey) { sel.value = themeEditorEditKey; }
          const dd = document.querySelector('.custom-dropdown[data-for="set-theme-custom-select"]');
          if (dd) initCustomDropdown(dd);
        }
        // Restore name input
        document.getElementById('set-theme-name').value = editingTheme?.label || '';
        renderThemeEditor();
      }

      // Category button click handlers
      document.querySelectorAll('.settings-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          switchSettingsCat(btn.dataset.cat);
          if (btn.dataset.cat === 'theme-editor') restoreThemeEditorState();
        });
      });

      function applySettings() {
        const wsp = activeWs();
        if (!wsp) return;
        const terms = getWorkspaceTerminals(wsp);
        for (const t of terms) {
          if (t.type === 'browser') continue;
          t._customFontSize = currentFontSize; // Reset temporary zoom on global change
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
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && settingsOverlay.classList.contains('open')) { closeSettings(); e.stopPropagation(); }
        if (e.ctrlKey && e.key === ',' && !e.metaKey && !e.altKey) { e.preventDefault(); openSettings(); }
      });

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
      document.getElementById('set-cursorblink').addEventListener('change', () => {
        currentCursorBlink = document.getElementById('set-cursorblink').checked;
        applySettings();
      });

      // Status bar toggle
      document.getElementById('set-statusbar').addEventListener('change', () => {
        statusBarVisible = document.getElementById('set-statusbar').checked;
        document.getElementById('statusbar').style.display = statusBarVisible ? '' : 'none';
        saveState();
      });

      // Scrollback
      document.getElementById('set-scrollback').addEventListener('input', e => {
        currentScrollback = parseInt(e.target.value);
        document.getElementById('set-scrollback-val').textContent = currentScrollback.toLocaleString();
        applySettings();
      });

      // Theme editor — Save
      document.getElementById('theme-btn-save').addEventListener('click', () => {
        const nameInput = document.getElementById('set-theme-name');
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        if (BUILTIN_THEME_KEYS.has(name)) { alert('Cannot overwrite a built-in theme.'); return; }
        editingTheme.label = name;
        const customs = getCustomThemes();
        customs[name] = { ...editingTheme, _custom: true };
        saveCustomThemes(customs);
        applyTheme(name);
        saveState();
        refreshThemeDropdown();
      });

      // Theme editor — Delete
      document.getElementById('theme-btn-delete').addEventListener('click', () => {
        const nameInput = document.getElementById('set-theme-name');
        const name = nameInput.value.trim();
        if (!name || BUILTIN_THEME_KEYS.has(name)) return;
        if (!getCustomThemes()[name]) return;
        deleteCustomTheme(name);
        initEditingTheme(currentThemeName);
        nameInput.value = editingTheme.label || '';
        renderThemeEditor();
        saveState();
        refreshThemeDropdown();
      });

      // Theme editor — Reset
      document.getElementById('theme-btn-import').addEventListener('click', () => {
        document.getElementById('theme-import-input').click();
      });
      document.getElementById('theme-import-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            if (!data.bg || !data.fg || !data.palette || !Array.isArray(data.palette) || data.palette.length < 16) {
              alert('Invalid theme JSON: missing bg, fg, or palette[16].');
              return;
            }
            const name = data.name || file.name.replace(/\.json$/i, '') || 'Imported Theme';
            editingTheme = {
              label: name,
              bg: data.bg, fg: data.fg, cursor: data.cursor || data.fg, selection: data.selection || data.bg,
              swatches: data.swatches || [data.bg, data.fg, data.palette[4] || data.fg],
              palette: [...data.palette],
              ui: data.ui ? { ...data.ui } : {},
            };
            document.getElementById('set-theme-name').value = name;
            renderThemeEditor();
            previewTheme();
          } catch { alert('Failed to parse JSON.'); }
        };
        reader.readAsText(file);
        e.target.value = '';
      });

      // Theme editor — Export
      document.getElementById('theme-btn-export').addEventListener('click', () => {
        if (!editingTheme) return;
        const json = JSON.stringify({
          name: editingTheme.label || 'Custom Theme',
          bg: editingTheme.bg, fg: editingTheme.fg, cursor: editingTheme.cursor, selection: editingTheme.selection,
          palette: editingTheme.palette,
          ui: editingTheme.ui,
        }, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (editingTheme.label || 'custom-theme').replace(/[^a-z0-9_-]/gi, '_') + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
      });

      // Theme editor — name input sync
      document.getElementById('set-theme-name').addEventListener('input', e => {
        if (editingTheme) editingTheme.label = e.target.value.trim();
      });

      // Theme editor — Clone Current
      document.getElementById('theme-btn-clone').addEventListener('click', () => {
        initEditingTheme(currentThemeName);
        editingTheme.label = THEMES[currentThemeName]?.label + ' Copy' || 'Copy';
        document.getElementById('set-theme-name').value = editingTheme.label;
        renderThemeEditor();
        previewTheme();
      });

      // Theme editor — Load existing dropdown
      function refreshThemeCustomSelect() {
        const sel = document.getElementById('set-theme-custom-select');
        if (!sel) return;
        sel.innerHTML = '';
        for (const [key, t] of Object.entries(THEMES)) {
          if (BUILTIN_THEME_KEYS.has(key)) continue;
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = t.label || key;
          sel.appendChild(opt);
        }
        const dd = document.querySelector('.custom-dropdown[data-for="set-theme-custom-select"]');
        if (dd) initCustomDropdown(dd);
      }

      // Theme mode toggle (New / Edit Existing)
      document.querySelectorAll('.theme-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode;
          themeEditorMode = mode;
          document.querySelectorAll('.theme-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
          const nameRow = document.querySelector('.theme-name-row');
          const editRow = document.querySelector('.theme-edit-row');
          if (mode === 'new') {
            nameRow?.classList.remove('hidden');
            nameRow?.classList.add('flex');
            editRow?.classList.add('hidden');
            editRow?.classList.remove('flex');
            initEditingTheme(currentThemeName);
            document.getElementById('set-theme-name').value = '';
            renderThemeEditor();
            previewTheme();
          } else {
            nameRow?.classList.add('hidden');
            nameRow?.classList.remove('flex');
            editRow?.classList.remove('hidden');
            editRow?.classList.add('flex');
            refreshThemeCustomSelect();
            const sel = document.getElementById('set-theme-custom-select');
            if (sel && sel.value) {
              themeEditorEditKey = sel.value;
              initEditingTheme(sel.value);
              renderThemeEditor();
              previewTheme();
            }
          }
        });
      });
      document.getElementById('set-theme-custom-select')?.addEventListener('change', e => {
        themeEditorEditKey = e.target.value;
        initEditingTheme(e.target.value);
        document.getElementById('set-theme-name').value = editingTheme.label || '';
        renderThemeEditor();
        previewTheme();
      });

      function refreshThemeDropdown() {
        const themeSelect = document.getElementById('set-theme');
        themeSelect.innerHTML = '';
        for (const [key, t] of Object.entries(THEMES)) {
          const opt = document.createElement('option');
          opt.value = key; opt.textContent = t.label;
          opt.dataset.swatches = t.swatches.join(',');
          if (key === currentThemeName) opt.selected = true;
          themeSelect.appendChild(opt);
        }
        const themeDD = document.querySelector('.custom-dropdown[data-for="set-theme"]');
        if (themeDD) initCustomDropdown(themeDD);
        refreshThemeCustomSelect();
      }

      // Prevent sidebar and statusbar from stealing terminal focus
      document.getElementById('sidebar').addEventListener('mousedown', e => {
        if (e.target.closest('[draggable="true"]')) return;
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
         D I*RECTIONAL PANE NAVIGATION (Alt + H/J/K/L)
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
         K E*YBOARD SHORTCUTS
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
         R E*SIZE OBSERVER
         ═══════════════════════════════════════════════════════════════ */
        /* ── Resizing overlay controllers ── */
        function startResizing() {
          document.body.classList.add('resizing');
        }

        function stopResizing() {
          document.body.classList.remove('resizing');
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
        let _savedBrowserBg = null;
        window.addEventListener('resize', () => {
          _suppressResize = true;
          startResizing();
          if (_winResizeTimer) clearTimeout(_winResizeTimer);
          // Hide browser iframes & their white background to prevent flicker
          if (!_savedBrowserBg) {
            const bcs = document.querySelectorAll('.browser-content');
            _savedBrowserBg = [];
            bcs.forEach(el => {
              _savedBrowserBg.push(el.style.background);
              el.style.background = 'transparent';
            });
          }
          document.querySelectorAll('.browser-fallback').forEach(f => f.style.visibility = 'hidden');
          _winResizeTimer = setTimeout(() => {
            _winResizeTimer = null;
            _suppressResize = false;
            stopResizing();
            // Restore browser iframes
            document.querySelectorAll('.browser-fallback').forEach(f => f.style.visibility = '');
            if (_savedBrowserBg) {
              const bcs = document.querySelectorAll('.browser-content');
              bcs.forEach((el, i) => { el.style.background = _savedBrowserBg[i] || ''; });
              _savedBrowserBg = null;
            }
            // Trigger a single batched fit after the transition settles
            const wsp = activeWs();
            if (wsp) {
              syncSplitSizes(wsp.layout);
              for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
              updateStatusBar();
            }
          }, 150);
        });

        /* ═══════════════════════════════════════════════════════════════
         U T*IL
         ═══════════════════════════════════════════════════════════════ */
        function escHtml(s) {
          return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        /* ═══════════════════════════════════════════════════════════════
         B O*OT
         ═══════════════════════════════════════════════════════════════ */
        loadCustomThemes();
        const restored = restoreState();
        applyTheme(currentThemeName);

        // Apply initial status bar visibility
        document.getElementById('statusbar').style.display = statusBarVisible ? '' : 'none';

        if (restored) {
          renderSidebar();
          renderPaneArea();
          updateStatusBar();
        }

        // In Tauri, use native PTY via Rust backend; otherwise WebSocket
        if (isTauri()) {
          loadTauriApi();
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

        // Listen for navigation and focus messages from browser tab iframes
        window.addEventListener('message', function(e) {
          // Handle iframe focus/click
          if (e.data && e.data.terminalVibeFocus) {
            const iframes = document.querySelectorAll('iframe.browser-fallback');
            for (let i = 0; i < iframes.length; i++) {
              if (iframes[i].contentWindow === e.source) {
                const slot = iframes[i].closest('.term-slot');
                if (slot && !slot.classList.contains('focused')) {
                  slot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                }
                break;
              }
            }
          }
          // Handle navigation URL sync
          if (e.data && e.data.terminalVibeNav) {
            const active = activeTerminal();
            if (active && active.type === 'browser' && active._syncUrl) {
              var navUrl = e.data.terminalVibeNav;
              try {
                var u = new URL(navUrl);
                var proxyHost = location.hostname;
                var proxyPort = String(PROXY_PORT);
                if (u.hostname === proxyHost || u.port === proxyPort) {
                  var lastOrigin = new URL(active.url || 'about:blank').origin;
                  navUrl = lastOrigin + u.pathname + u.search + u.hash;
                }
              } catch(_) {}
              if (navUrl !== active.url) active._syncUrl(navUrl);
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

        // Robust Cross-Origin & Local Asset Iframe Focus Tracker
        let _lastActiveIframe = null;
        setInterval(() => {
          if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
            const activeIframe = document.activeElement;
            if (activeIframe !== _lastActiveIframe) {
              _lastActiveIframe = activeIframe;
              const bc = activeIframe.closest('.browser-slot');
              if (bc) bc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            }
          } else {
            _lastActiveIframe = null;
          }
        }, 100);

        // Keep blur for instant reaction and Tauri native child webviews
        window.addEventListener('blur', () => {
          setTimeout(() => {
            if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
               const bc = document.activeElement.closest('.browser-slot');
               if (bc) bc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            } else {
               const active = activeTerminal();
               if (active && active.type === 'browser' && active.browserContainer) {
                   active.browserContainer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
               }
            }
          }, 50);
        });

})();
