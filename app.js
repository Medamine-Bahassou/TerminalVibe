(function () {
  'use strict';

  // Liveness flag for the index.html boot watchdog: if app.js fails to even
  // parse/execute (e.g. a missing vendor <script> in a packaged build), this
  // never gets set and the watchdog releases the splash screen with an error
  // instead of leaving the app stuck forever.
  window.__tvAppJsRan = true;

  setupAppTooltips();

  // Permanently remove native tooltip sources before any settings/detached boot.
  function setupAppTooltips() {
    const DELAY = 700, SKIP_DELAY = 100, SKIP_WINDOW = 300;
    const tip = document.createElement('div');
    tip.className = 'ui-tooltip'; tip.id = 'app-ui-tooltip'; tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
    let target = null, timer = null, warmUntil = 0, dismissed = false;
    const close = () => {
      clearTimeout(timer);
      if (tip.classList.contains('show')) warmUntil = Date.now() + SKIP_WINDOW;
      tip.classList.remove('show');
      target?.removeAttribute('aria-describedby');
    };
    const release = () => { close(); target = null; dismissed = false; };
    const show = () => {
      if (!target?.isConnected || dismissed || !target.dataset.tip) return;
      const processes = target.dataset.tipProcesses ? JSON.parse(target.dataset.tipProcesses) : null;
      tip.classList.toggle('ws-process-tooltip', !!processes);
      const sessionRow = target.closest('.session-row');
      tip.classList.toggle('session-tooltip', !!sessionRow);
      tip.textContent = target.dataset.tip;
      if (processes) {
        const heading = document.createElement('div');
        heading.className = 'ws-process-tooltip-heading'; heading.textContent = target.dataset.tip;
        tip.replaceChildren(heading);
        for (const process of processes) {
          const row = document.createElement('div'); row.className = 'ws-process-tooltip-row';
          row.innerHTML = procIconHtml(process.name);
          const name = document.createElement('span'); name.textContent = process.name; row.append(name);
          tip.append(row);
        }
      }
      const workspaceButton = target.closest('.ws-btn');
      const sideTarget = workspaceButton || sessionRow;
      const r = (sideTarget || target).getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let top = sideTarget ? r.top : r.bottom + 6;
      if (top + h > innerHeight - 4) top = sideTarget ? innerHeight - h - 4 : r.top - h - 6;
      const preferredLeft = sideTarget ? r.right + 6 : r.left + r.width / 2 - w / 2;
      const left = Math.max(4, Math.min(preferredLeft, innerWidth - w - 4));
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, top))}px)`;
      tip.classList.add('show');
      target.setAttribute('aria-describedby', tip.id);
    };
    const convertTitle = el => {
      if (!el.hasAttribute('title')) return;
      const text = el.getAttribute('title');
      el.dataset.tip = text;
      if (text && !el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', text);
      el.removeAttribute('title');
      if (el === target) { if (!text) release(); else if (tip.classList.contains('show')) show(); }
    };
    const normalize = root => {
      if (!(root instanceof Element)) return;
      convertTitle(root);
      root.querySelectorAll('[title]').forEach(convertTitle);
      // SVG <title> is another native-tooltip source; preserve its accessible name.
      const svgTitles = [...root.querySelectorAll('svg title')];
      if (root.matches('svg title')) svgTitles.push(root);
      for (const node of svgTitles) {
        const owner = node.parentElement;
        if (!owner.hasAttribute('data-tip')) owner.dataset.tip = node.textContent;
        if (!owner.hasAttribute('aria-label')) owner.setAttribute('aria-label', node.textContent);
        node.remove();
      }
    };
    normalize(document.documentElement);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.attributeName === 'title') convertTitle(record.target);
          else if (record.target === target) {
            if (!target.dataset.tip) release();
            else if (tip.classList.contains('show')) show();
          }
        }
        else for (const node of record.addedNodes) normalize(node);
      }
      if (target && !target.isConnected) release();
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'data-tip', 'data-tip-processes'] });
    const schedule = () => { clearTimeout(timer); timer = setTimeout(show, Date.now() < warmUntil ? SKIP_DELAY : DELAY); };
    const take = el => {
      if (el === target) return false;
      release();
      if (!el?.dataset.tip) return false;
      target = el; return true;
    };
    const closestTip = el => {
      // Also sanitize synchronously on entry if another event handler just set a title.
      for (let node = el instanceof Element ? el : null; node; node = node.parentElement) convertTitle(node);
      return el.closest?.('[data-tip]');
    };
    document.addEventListener('mouseover', e => { if (take(closestTip(e.target))) schedule(); });
    document.addEventListener('mouseout', e => {
      if (target && (!e.relatedTarget || !target.contains(e.relatedTarget))) release();
    });
    document.addEventListener('mousemove', () => { if (target && !dismissed && !tip.classList.contains('show')) schedule(); }, { passive: true });
    document.addEventListener('mousedown', () => { if (target) { close(); dismissed = true; } }, true);
    document.addEventListener('focusin', e => { if (e.target.matches?.(':focus-visible') && take(closestTip(e.target))) schedule(); });
    document.addEventListener('focusout', e => {
      if (target?.contains(e.target) && !target.contains(e.relatedTarget)) release();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && tip.classList.contains('show')) { close(); dismissed = true; } }, true);
    document.addEventListener('wheel', () => { if (target) { close(); dismissed = true; } }, { capture: true, passive: true });
    document.documentElement.addEventListener('mouseleave', release);
    window.addEventListener('blur', release);
  }


  window.addEventListener('error', e => console.error('[UNCAUGHT]', e.error || e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', e => console.error('[UNHANDLED-REJECTION]', e.reason));

  // The settings UI can live in a separate Electron window (index.html?mode=settings)
  // so it renders above native browser views. In that window only the settings
  // page boots — the whole terminal/browser/sidebar layer is skipped.
  const SETTINGS_ONLY = new URLSearchParams(window.location.search).get('mode') === 'settings';
  const DETACHED_ONLY = new URLSearchParams(window.location.search).get('mode') === 'detached';
  const DETACHED_PARAMS = DETACHED_ONLY ? new URLSearchParams(window.location.search) : null;

  // App version — single source of truth, shared across the whole app
  const APP_VERSION = '0.5.10';

  // Configure Coloris — hex color picker.
  // Keep the picker parented to <body> (the default): style.css lifts it
  // above the settings (z-10000) and prompt (z-10001) overlays.
  // Guarded: if the vendor asset failed to load (e.g. broken packaged
  // build), this must never throw — a top-level throw kills this whole IIFE,
  // boot never runs, and the app sits on the splash screen forever.
  try {
    if (typeof Coloris !== 'undefined') {
      Coloris({
        themeMode: 'dark',
        theme: 'default',
        format: 'hex',
        alpha: true,
        wrap: true,
      });
    } else {
      console.error('[BOOT] Coloris vendor script missing — color picker disabled');
    }
  } catch (colorisErr) {
    console.error('[BOOT] Coloris init failed:', colorisErr);
  }

  // Desktop bridge (Electron preload, exposed as window.electronAPI)
  function electronBridge() { return window.electronAPI || null; }
  function isDesktop() { return !!window.electronAPI; }


  /* ═══════════════════════════════════════════════════════════════
   K E*YBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════════════ */
  const DEFAULT_SHORTCUTS = {
    newTerminal: { ctrl: true, shift: true, key: 'T', label: 'Ctrl+Shift+T' },
    closeTerminal: { ctrl: true, shift: true, key: 'W', label: 'Ctrl+Shift+W' },
    splitH: { ctrl: true, shift: true, key: 'D', label: 'Ctrl+Shift+D' },
    splitV: { ctrl: true, shift: true, key: 'E', label: 'Ctrl+Shift+E' },
    search: { ctrl: true, shift: true, key: 'F', label: 'Ctrl+Shift+F' },
    tabSearch: { ctrl: true, shift: true, key: 'O', label: 'Ctrl+Shift+O' },
    commandPalette: { ctrl: true, shift: true, key: 'K', label: 'Ctrl+Shift+K' },
    snippets: { ctrl: true, shift: true, key: 'Y', label: 'Ctrl+Shift+Y' },
    browserTab: { ctrl: true, shift: true, key: 'B', label: 'Ctrl+Shift+B' },
    copy: { ctrl: true, shift: true, key: 'C', label: 'Ctrl+Shift+C' },
    paste: { ctrl: true, shift: true, key: 'V', label: 'Ctrl+Shift+V' },
    nextTab: { ctrl: true, shift: false, key: 'PageDown', label: 'Ctrl+PageDown' },
    prevTab: { ctrl: true, shift: false, key: 'PageUp', label: 'Ctrl+PageUp' },
    focusLeft: { alt: true, key: 'h', label: 'Alt+H' },
    focusDown: { alt: true, key: 'j', label: 'Alt+J' },
    focusUp: { alt: true, key: 'k', label: 'Alt+K' },
    focusRight: { alt: true, key: 'l', label: 'Alt+L' },
    nextWorkspace: { ctrl: true, shift: true, key: 'PageDown', label: 'Ctrl+Shift+PageDown' },
    prevWorkspace: { ctrl: true, shift: true, key: 'PageUp', label: 'Ctrl+Shift+PageUp' },
    multiSelect: { ctrl: true, alt: true, key: 'Click', label: 'Ctrl+Alt+Click' },
    maximizeTab: { ctrl: true, shift: true, key: 'M', label: 'Ctrl+Shift+M' },
    profiles: { ctrl: true, shift: true, key: 'P', label: 'Ctrl+Shift+P' },
    toggleSidebar: { ctrl: true, shift: true, key: 'S', label: 'Ctrl+Shift+S' },
    quitApp: { ctrl: true, shift: true, key: 'Q', label: 'Ctrl+Shift+Q' },
  };

  const SHORTCUT_LABELS = {
    newTerminal: 'New terminal', closeTerminal: 'Close terminal',
    splitH: 'Split horizontal', splitV: 'Split vertical',
    search: 'Search', tabSearch: 'Search tabs', commandPalette: 'Command palette', snippets: 'Snippets', browserTab: 'New browser tab',
    copy: 'Copy selection', paste: 'Paste',
    nextTab: 'Next tab', prevTab: 'Previous tab',
    focusLeft: 'Focus left pane', focusDown: 'Focus down pane',
    focusUp: 'Focus up pane', focusRight: 'Focus right pane',
    nextWorkspace: 'Next workspace', prevWorkspace: 'Previous workspace',
    maximizeTab: 'Maximize / restore tab', profiles: 'Profiles', toggleSidebar: 'Toggle sidebar', quitApp: 'Quit application (press twice to quit)',
  };

  // Alt+N → jump to the workspace at sidebar position N (top-to-bottom order,
  // matching the collapsed-sidebar number). Each is individually rebindable in
  // Settings → Keyboard Shortcuts.
  for (let i = 1; i <= 9; i++) {
    DEFAULT_SHORTCUTS['switchWs' + i] = { alt: true, key: String(i), label: 'Alt+' + i };
    SHORTCUT_LABELS['switchWs' + i] = 'Switch to workspace ' + i;
  }

  let customShortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));

  function matchShortcut(e, action) {
    const s = customShortcuts[action];
    if (!s || !s.key) return false;
    const keyMatch = s.key.length === 1
      ? e.key.toLowerCase() === s.key.toLowerCase()
      : e.key === s.key || e.code === s.key;
    return keyMatch
      && !!e.ctrlKey === !!s.ctrl
      && !!e.shiftKey === !!s.shift
      && !!e.altKey === !!s.alt
      && !!e.metaKey === !!s.meta;
  }

  // Push shortcuts to main so they still fire while a native browser view has
  // focus (plus the hardcoded Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+, combos).
  function syncBrowserShortcuts() {
    window.electronAPI?.browserSetShortcuts?.([
      ...Object.values(customShortcuts),
      { ctrl: true, key: 'Tab' }, { ctrl: true, shift: true, key: 'Tab' }, { ctrl: true, key: ',' },
    ]);
  }

  function matchShortcutMouse(e, action) {
    const s = customShortcuts[action];
    if (!s || !s.key) return false;
    return s.key === 'Click' && e.button === 0
      && !!e.ctrlKey === !!s.ctrl
      && !!e.shiftKey === !!s.shift
      && !!e.altKey === !!s.alt
      && !!e.metaKey === !!s.meta;
  }

  function formatKeyCombo(s) {
    if (!s || !s.key) return 'Not set';
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
    'carbon': {
      label: 'Carbon',
      bg: '#050505', fg: '#eeeeee', cursor: '#eeeeee', selection: '#303030',
      swatches: ['#050505', '#eeeeee', '#70a9ed'],
      palette: [
        '#161616', '#e76975', '#72bc98', '#d5b477',
        '#70a9ed', '#b59adb', '#79b9c1', '#c9c9c9',
        '#707070', '#f08c95', '#92d1ad', '#e4ca96',
        '#96c1f5', '#ccb5eb', '#9dd0d5', '#f5f5f5',
      ],
      ui: {
        accent: '#70a9ed', border: '#2b2b2b',
        tabActiveBg: '#161616', tabHoverBg: '#222222',
        dimText: '#909090', mutedText: '#b0b0b0',
        sidebarBg: '#0c0c0c', surfaceBg: '#161616',
        hoverBg: '#222222', activeBg: '#262626',
      },
    },
    'graphite': {
      label: 'Graphite',
      bg: '#0d1017', fg: '#e8ecf4', cursor: '#a5b2ff', selection: '#273249',
      swatches: ['#0d1017', '#e8ecf4', '#8b9dff'],
      palette: [
        '#20262c', '#ed8993', '#8ddbb8', '#e6c788',
        '#8bb9e8', '#c1a6d9', '#89cdd3', '#dce3e6',
        '#65727c', '#f3a2aa', '#abe8cc', '#f0d7a4',
        '#accff0', '#d5bfe7', '#a8dfe3', '#f2f5f6',
      ],
      ui: {
        accent: '#8b9dff', border: '#2a3240',
        tabActiveBg: '#191e29', tabHoverBg: '#222937',
        dimText: '#707b90', mutedText: '#a0a9bb',
      },
    },
    'catppuccin-mocha': {
      label: 'Catppuccin Mocha',
      bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70',
      swatches: ['#1e1e2e', '#cdd6f4', '#f5e0dc'],
      palette: [
        '#1e1e2e', '#f38ba8', '#a6e3a1', '#f9e2af',
        '#89b4fa', '#f5c2e7', '#94e2d5', '#cdd6f4',
        '#585b70', '#eba0ac', '#a6e3a1', '#f9e2af',
        '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      ],
    },
    'dracula': {
      label: 'Dracula',
      bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
      swatches: ['#282a36', '#f8f8f2', '#bd93f9'],
      palette: [
        '#21222c', '#ff5555', '#50fa7b', '#f1fa8c',
        '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
        '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5',
        '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
      ],
    },
    'gruvbox': {
      label: 'Gruvbox',
      bg: '#282828', fg: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945',
      swatches: ['#282828', '#ebdbb2', '#d79921'],
      palette: [
        '#282828', '#cc241d', '#98971a', '#d79921',
        '#458588', '#b16286', '#689d6a', '#a89984',
        '#928374', '#fb4934', '#b8bb26', '#fabd2f',
        '#83a598', '#d3869b', '#8ec07c', '#ebdbb2',
      ],
    },
    'tokyo-night': {
      label: 'Tokyo Night',
      bg: '#1a1b26', fg: '#c0caf5', cursor: '#c0caf5', selection: '#33467c',
      swatches: ['#1a1b26', '#c0caf5', '#7aa2f7'],
      palette: [
        '#15161e', '#f7768e', '#9ece6a', '#e0af68',
        '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
        '#414868', '#f7768e', '#9ece6a', '#e0af68',
        '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
      ],
    },
    'nord': {
      label: 'Nord',
      bg: '#2e3440', fg: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e',
      swatches: ['#2e3440', '#d8dee9', '#81a1c1'],
      palette: [
        '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b',
        '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
        '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b',
        '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4',
      ],
    },
    'solarized-dark': {
      label: 'Solarized Dark',
      bg: '#002b36', fg: '#839496', cursor: '#839496', selection: '#073642',
      swatches: ['#002b36', '#839496', '#268bd2'],
      palette: [
        '#073642', '#dc322f', '#859900', '#b58900',
        '#268bd2', '#d33682', '#2aa198', '#eee8d5',
        '#586e75', '#cb4b16', '#586e75', '#657b83',
        '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
      ],
    },
    'monochrome': {
      label: 'Monochrome',
      bg: '#000000', fg: '#ffffff', cursor: '#ffffff', selection: '#333333',
      swatches: ['#000000', '#ffffff', '#888888'],
      palette: [
        '#000000', '#808080', '#a0a0a0', '#c0c0c0',
        '#d0d0d0', '#e0e0e0', '#f0f0f0', '#ffffff',
        '#404040', '#606060', '#909090', '#b0b0b0',
        '#c8c8c8', '#d8d8d8', '#e8e8e8', '#f8f8f8',
      ],
    },
  };

  /* ═══════════════════════════════════════════════════════════════
   C U S T O M   T H E M E S
   ═══════════════════════════════════════════════════════════════ */
  const CUSTOM_THEMES_KEY = 'ghostterm-custom-themes';
  const BUILTIN_THEME_KEYS = new Set(Object.keys(THEMES));

  function configApi() { return window.electronAPI || null; }

  async function loadCustomThemes() {
    try {
      const api = configApi();
      let customs = null;
      if (api && api.configReadCustomThemes) {
        customs = await api.configReadCustomThemes();
      }
      if (!customs) {
        const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
        if (raw) customs = JSON.parse(raw);
      }
      if (customs) {
        for (const [name, theme] of Object.entries(customs)) {
          if (!BUILTIN_THEME_KEYS.has(name)) THEMES[name] = theme;
        }
      }
    } catch { }
  }

  async function saveCustomThemes(customs) {
    try {
      const api = configApi();
      if (api && api.configWriteCustomThemes) {
        await api.configWriteCustomThemes(customs);
      }
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customs));
    } catch { }
    for (const [name, theme] of Object.entries(customs)) {
      if (!BUILTIN_THEME_KEYS.has(name)) THEMES[name] = theme;
    }
  }

  async function getCustomThemes() {
    try {
      const api = configApi();
      if (api && api.configReadCustomThemes) {
        const themes = await api.configReadCustomThemes();
        if (themes) return themes;
      }
      const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  async function deleteCustomTheme(name) {
    const customs = await getCustomThemes();
    delete customs[name];
    await saveCustomThemes(customs);
    delete THEMES[name];
    const api = configApi();
    if (api && api.configDeleteThemeFile) {
      await api.configDeleteThemeFile(name);
    }
    if (currentThemeName === name) {
      applyTheme('catppuccin-mocha');
    }
  }

  let WS_PORT = 7681;

  // Terminal links follow Settings → General: a browser tab beside the
  // terminal they were clicked in, or the system browser. Shift+click picks
  // the other one. Non-web URLs and detached panes always go external.
  function openTerminalLink(termId, uri, event) {
    let url = null;
    try { url = new URL(uri); } catch { }
    const found = findTermById(termId);
    const inTab = (terminalLinkTarget !== 'external') !== !!event?.shiftKey;
    if (!url || !['http:', 'https:'].includes(url.protocol) || !inTab || !found?.ws) { openExternalUrl(uri); return; }
    addBrowserTab(found.ws.id, findGroupContainingTerm(found.ws.layout, termId)?.id, url.href);
  }

  function openExternalUrl(url) {
    if (isDesktop() && window.electronAPI) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  // Quote a path for pasting into a shell (POSIX '…'\''…', PowerShell '…''…').
  function shellQuote(p) {
    if (/^[\w@%+=:,./~-]+$/.test(p)) return p;
    return (window.electronAPI?.platform || terminalBackendPlatform) === 'win32'
      ? `'${p.replace(/'/g, "''")}'`
      : `'${p.replace(/'/g, "'\\''")}'`;
  }

  // Dropped files (e.g. an image from the file manager or a web page) →
  // paste their quoted paths into the terminal, like other terminals do.
  // Files without a disk path (dragged out of a browser) are saved to temp.
  const isFileDrag = e => !!e.dataTransfer?.types?.includes('Files');
  async function saveBrowserDroppedFile(entry, file) {
    if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN) throw new Error('Terminal backend is disconnected');
    if (!fileDropReady) throw new Error('Restart the TerminalVibe backend and reload to enable file drops');
    if (file.size > 64 * 1024 * 1024) throw new Error('Dropped files must be at most 64 MiB each');
    const data = await new Promise((resolve,reject) => {
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1] || '');
      reader.onerror=()=>reject(new Error('Could not read '+file.name));
      reader.onabort=()=>reject(new Error('File transfer was cancelled'));
      reader.readAsDataURL(file);
    });
    if (!wsReady || ws.readyState !== WebSocket.OPEN) throw new Error('Terminal backend disconnected while reading the file');
    return new Promise((resolve,reject) => {
      const requestId=uuid();
      const timer=setTimeout(()=>{fileDropRequests.delete(requestId);reject(new Error('File transfer timed out'));},30000);
      fileDropRequests.set(requestId,{resolve,reject,timer});
      try { ws.send(JSON.stringify({type:'file:save-temp',requestId,id:entry.id,name:file.name,data})); }
      catch(error) { clearTimeout(timer);fileDropRequests.delete(requestId);reject(error); }
    });
  }

  async function dropFilesIntoTerminal(entry, files) {
    if (!entry?.term || entry.type === 'browser' || entry.locked || entry.dead || !files.length) return;
    const target=entry.term;
    const available=()=>!entry.locked && !entry.dead && entry.term===target && findTermById(entry.id)?.term===entry;
    const notice=document.createElement('div');notice.className='session-drop-feedback is-pending';
    notice.setAttribute('role','status');notice.textContent='Adding files…';entry.el?.append(notice);
    try {
      const api=window.electronAPI, paths=[];
      for (const file of files) {
        if (!available()) throw new Error('The target terminal changed while adding files');
        let path;
        if (api?.getPathForFile) {
          path=api.getPathForFile(file);
          if (!path) path=await api.saveTempFile(file.name,new Uint8Array(await file.arrayBuffer()));
        } else path=await saveBrowserDroppedFile(entry,file);
        if (!path) throw new Error('Could not transfer '+file.name);
        paths.push(shellQuote(path));
      }
      if (!available()) throw new Error('The target terminal changed while adding files');
      // xterm emits one bracketed paste into this pane's editable draft. No Enter.
      target.paste(paths.join(' ')+' ');
      target.focus();
      notice.className='session-drop-feedback is-success';
      notice.textContent=files.length===1?'File added to draft':files.length+' files added to draft';
    } catch(error) {
      notice.className='session-drop-feedback is-error';notice.textContent=error.message;
      console.error('[drop] failed:',error);
    }
    setTimeout(()=>notice.remove(),4000);
  }

  // Never let a file dropped outside a pane navigate the window to it.
  document.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
  document.addEventListener('drop', e => { if (isFileDrag(e)) e.preventDefault(); });

  function setupWorkspaceDragIsolation() {
    for (const type of ['dragenter', 'dragover', 'drop']) {
      document.addEventListener(type, e => {
        const types = e.dataTransfer?.types || [];
        const sidebarDrag = window.draggedWsId || window.draggedFolderId ||
          types.includes('application/x-terminalvibe-workspace') || types.includes('application/x-terminalvibe-folder');
        if (!sidebarDrag || e.target.closest?.('#sidebar')) return;
        // Workspace context drops are handled by the pane's capture listener.
        if (!window.draggedFolderId && !types.includes('application/x-terminalvibe-folder') &&
            types.includes('application/x-terminalvibe-workspace') && e.target.closest?.('.term-group-body')) return;
        // Workspace/folder reordering belongs to the sidebar. Never let these
        // payloads reach terminal split, reattach, browser or native paste paths.
        e.stopPropagation();
        if (type === 'drop') e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        document.querySelectorAll('.drag-indicator-overlay.active').forEach(overlay => overlay.classList.remove('active'));
      }, true);
    }
  }
  setupWorkspaceDragIsolation();

  // Clipboard images take priority over accompanying alt text/URLs. Claude
  // handles its own image shortcut so attachments become native image chips.
  async function doPaste(entry, clipboardData = null) {
    if (!entry?.term || entry.type === 'browser' || entry.locked || entry.dead) return;
    const target = entry.term;
    const available = () => !entry.locked && !entry.dead && entry.term === target && findTermById(entry.id)?.term === entry;
    const pasteText = text => { if (text && available()) target.paste(text); };
    const pasteImage = async path => {
      if (!available()) return;
      let process = null;
      try { process = await checkTerminalRunning(entry.id); } catch { }
      if (!available()) return;
      if (/^claude(?:[-.\s]|$)/i.test(process || '')) {
        // Send the key, not a bracketed-paste string. Claude reads the local
        // clipboard itself; do not also insert a filename or submit the draft.
        const shortcut = window.electronAPI?.platform === 'win32' ? '\x1bv' : '\x16';
        sendStdin(entry.id, new TextEncoder().encode(shortcut));
      } else {
        pasteText(shellQuote(path));
      }
    };
    try {
      const api = window.electronAPI;
      if (isDesktop() && api?.clipboardPasteImage) {
        // Do not let an image-read failure swallow a normal text paste.
        let path = null;
        try { path = await api.clipboardPasteImage(); } catch { }
        if (path) { await pasteImage(path); return; }
        pasteText(clipboardData?.getData('text/plain') || await api.clipboardRead());
        return;
      }
      // Native paste events can supply image bytes even when clipboard.readText
      // is denied. Persist them using the existing file bridge when available.
      const image = [...(clipboardData?.files || [])].find(file => file.type.startsWith('image/'));
      if (image && api?.saveTempFile) {
        const path = await api.saveTempFile(image.name || 'clipboard.png', new Uint8Array(await image.arrayBuffer()));
        if (path) { await pasteImage(path); return; }
      }
      pasteText(clipboardData?.getData('text/plain') || await navigator.clipboard.readText());
    } catch (error) {
      console.warn('[clipboard] Paste failed:', error);
    }
  }

  // A real text field (prompts, search boxes, panel editors) owns its paste;
  // xterm's hidden helper textarea does not — that one routes to the terminal.
  function isTextField(el) {
    return el instanceof Element
      && el.matches('input, textarea, [contenteditable=""], [contenteditable="true"]')
      && !el.classList.contains('xterm-helper-textarea');
  }

  // Fallback paste handler for native paste (middle-click, OS context menu)
  document.addEventListener('paste', e => {
    if (Date.now() < _suppressPasteUntil) { e.preventDefault(); e.stopPropagation(); return; }
    if (isTextField(e.target)) return;
    const t = activeTerminal();
    if (!t || t.type === 'browser') return;
    e.preventDefault();
    e.stopPropagation();
    void doPaste(t, e.clipboardData);
  }, true);

  /* ═══════════════════════════════════════════════════════════════
   P L U G I N   S Y S T E M  (Obsidian-style: JS + CSS, TS via build)
   ─────────────────────────────────────────────────────────────
   Plugins live in ~/.terminalvibe/plugins/<id>/ with a manifest
   (`manifest.json`, Obsidian-style, or legacy `plugin.json`) + a JS entry
   + an optional stylesheet. The Electron main process reads manifests and
   files over IPC; entries are evaluated in this renderer against a small
   `TerminalVibe` namespace and activated with an `api` object (commands,
   events, menus, themes, terminal I/O, settings, UI widgets).
   Layout (Obsidian parity):
     <id>/manifest.json  (or plugin.json) — name/version/description/...
     <id>/main.js        (or "main" field, or legacy plugin.js; TS source
                          in src/main.ts compiles to main.js via esbuild)
     <id>/styles.css     (auto-injected; legacy style.css also picked up)
   Supported entry shapes:
     1. TerminalVibe.register({ id, activate(api), deactivate() })
     2. module.exports = class extends TerminalVibe.Plugin { onload/onunload }
     3. module.exports = { activate, deactivate } (or onload/onunload)
   Enable/disable state persists in state.json (pluginStates).
   ═══════════════════════════════════════════════════════════════ */
  const _pluginRegistry = new Map();   // id -> { activate, deactivate }
  const _pluginStates = new Map();     // id -> true/false (from state.json)
  const _pluginManifests = new Map();  // id -> manifest (for config resolution)
  const _pluginConfigs = new Map();    // id -> { key: value } persisted config
  const _pluginConfigCbs = new Map();  // id -> Set<cb> config onChange handlers
  const _pluginConfigLast = new Map(); // id -> JSON snapshot of last delivered config
  const _pluginCommands = new Map();   // id -> { pluginId, label, combo, handler }
  const _pluginMenuItems = { terminal: [], workspace: [], folder: [] };
  const _pluginThemes = new Map();     // themeName -> { pluginId, theme }
  const _pluginWidgets = [];           // { pluginId, id, position, el }
  const _pluginBus = new Map();        // event -> Set<{ pluginId, cb }>
  const _pluginErrors = new Map();     // id -> error message (failed evaluate/activate)
  let _pluginsView = { mode: 'list' }; // { mode: 'list' } | { mode: 'detail', id }

  function pluginEmit(event, data) {
    const set = _pluginBus.get(event);
    if (!set) return;
    for (const h of [...set]) { try { h.cb(data); } catch (e) { console.error('[plugin] handler for', event, 'failed:', e); } }
  }

  function _pluginComboMatches(combo, e) {
    if (!combo || !combo.key) return false;
    const keyMatch = combo.key.length === 1
      ? e.key.toLowerCase() === combo.key.toLowerCase()
      : (e.key === combo.key || e.code === combo.key);
    return keyMatch
      && !!e.ctrlKey === !!combo.ctrl
      && !!e.shiftKey === !!combo.shift
      && !!e.altKey === !!combo.alt
      && !!e.metaKey === !!combo.meta;
  }

  // Obsidian-style hotkey ({ modifiers: ['Ctrl','Shift'], key: 'H' }) → ours.
  function _obsidianHotkeysToCombo(hk) {
    if (!hk) return null;
    if (typeof hk === 'string') return { key: hk };
    const mods = new Set((hk.modifiers || []).map(m => String(m).toLowerCase()));
    const key = hk.key;
    if (!key) return null;
    return {
      ctrl: mods.has('ctrl') || mods.has('control'),
      shift: mods.has('shift'),
      alt: mods.has('alt'),
      meta: mods.has('meta') || mods.has('cmd') || mods.has('command') || mods.has('mod'),
      key: String(key),
    };
  }

  // Obsidian-style base class: `module.exports = class extends
  // TerminalVibe.Plugin { onload() {...} onunload() {...} }`.
  // Thin sugar over the same per-plugin `api` object the legacy
  // TerminalVibe.register({ activate }) style receives.
  class TerminalVibePlugin {
    constructor(api) {
      this.api = api || null;
      this.app = this.api;
      this.manifest = api ? { id: api.id, name: api.name, version: api.version } : {};
      this.pluginId = api ? api.id : '';
    }
    get name() { return this.api ? this.api.name : ''; }
    log(...args) { if (this.api) this.api.log(...args); else console.log('[plugin]', ...args); }
    async onload() { }
    onunload() { }
    // { id, name, callback } (+ optional combo: ours, or hotkeys: Obsidian's)
    addCommand(def) {
      if (!this.api || !def) return null;
      const base = def.id || def.name || 'cmd';
      const id = (base.includes(':') || (this.pluginId && base.startsWith(this.pluginId)))
        ? base : (this.pluginId ? this.pluginId + ':' + base : base);
      let combo = def.combo || null;
      if (!combo && def.hotkeys) {
        const first = Array.isArray(def.hotkeys) ? def.hotkeys[0] : def.hotkeys;
        combo = _obsidianHotkeysToCombo(first);
      }
      const label = def.name || def.label || id;
      const handler = typeof def.callback === 'function' ? def.callback
        : (typeof def.checkCallback === 'function' ? () => def.checkCallback(false)
        : (typeof def.handler === 'function' ? def.handler : null));
      if (!handler) return null;
      this.api.commands.register({ id, label, combo, handler });
      return id;
    }
    // Obsidian returns an element the plugin fills; we mount it in the
    // status bar strip (visible once a plugin adds the first widget).
    addStatusBarItem() {
      const el = document.createElement('span');
      el.className = 'tv-plugin-statusbar-item';
      if (this.api) this.api.ui.addWidget({ id: 'statusbar-' + Math.random().toString(36).slice(2), position: 'statusbar', el });
      return el;
    }
    // Obsidian's left ribbon → our sidebar (appended at the bottom).
    addRibbonIcon(icon, title, cb) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tv-plugin-ribbon-icon';
      btn.title = title || '';
      if (icon) btn.innerHTML = icon;
      if (typeof cb === 'function') btn.addEventListener('click', cb);
      if (this.api) this.api.ui.addWidget({ id: 'ribbon-' + Math.random().toString(36).slice(2), position: 'sidebar', el: btn });
      return btn;
    }
    // Auto-cleaned on unload (deactivatePlugin drops the whole bus by id).
    registerEvent(ev, cb) {
      if (this.api && typeof cb === 'function') this.api.events.on(ev, cb);
      return { ev, cb };
    }
    off(ev, cb) { if (this.api) this.api.events.off(ev, cb); }
    // Obsidian's data.json blob ↔ our per-key persisted config.
    async loadData() { return this.api ? this.api.config.all() : {}; }
    async saveData(obj) {
      if (!this.api || !obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) this.api.config.set(k, v);
    }
  }

  // The global plugin entries evaluate against. Exposes both the legacy
  // register() and the Obsidian-style Plugin base class.
  function ensureTerminalVibeGlobal() {
    if (!window.TerminalVibe || typeof window.TerminalVibe.register !== 'function') {
      window.TerminalVibe = { register: registerPlugin, Plugin: TerminalVibePlugin };
    } else if (!window.TerminalVibe.Plugin) {
      window.TerminalVibe.Plugin = TerminalVibePlugin;
    }
    return window.TerminalVibe;
  }

  // Evaluate an entry with a CommonJS shim so esbuild/tsc-bundled output
  // (module.exports = ...) works alongside legacy TerminalVibe.register
  // entries. Returns module.exports (or null when the entry used register).
  function _evaluatePluginEntry(code, ns) {
    const module = { exports: {} };
    const exports = module.exports;
    (new Function('TerminalVibe', 'module', 'exports', code))(ns, module, exports);
    return module.exports;
  }

  function _unwrapDefault(exp) {
    return (exp && exp.__esModule && exp.default !== undefined) ? exp.default : exp;
  }

  // Normalize module.exports → { activate, deactivate }.
  // Handles: Plugin subclass, { onload, onunload }, { activate, deactivate }.
  function _normalizePluginExport(exp, manifest) {
    const unwrapped = _unwrapDefault(exp);
    if (!unwrapped) return null;
    if (typeof unwrapped === 'function'
      && unwrapped.prototype
      && (typeof unwrapped.prototype.onload === 'function' || typeof unwrapped.prototype.onunload === 'function')) {
      return { _PluginClass: unwrapped };
    }
    if ((typeof unwrapped === 'object' || typeof unwrapped === 'function')) {
      if (typeof unwrapped.onload === 'function' || typeof unwrapped.onunload === 'function') {
        const inst = unwrapped;
        return {
          id: manifest.id,
          activate: (api) => inst.onload ? inst.onload.call(inst, api) : undefined,
          deactivate: () => { if (typeof inst.onunload === 'function') inst.onunload.call(inst); },
          _instance: inst,
        };
      }
      if (typeof unwrapped.activate === 'function') return unwrapped;
    }
    return null;
  }

  // Read the first readable file from a candidate list (entry / styles).
  async function _readFirstPluginFile(cfgApi, id, candidates) {
    for (const rel of candidates) {
      try {
        const content = await cfgApi.configReadPluginFile(id, rel);
        if (typeof content === 'string' && content.length) return { rel, content };
      } catch { }
    }
    return null;
  }

  function _pluginEntryCandidates(manifest) {
    if (typeof manifest.main === 'string' && manifest.main) return [manifest.main];
    return ['main.js', 'plugin.js']; // Obsidian default, then legacy
  }

  function _pluginStyleCandidates(manifest) {
    if (typeof manifest.styles === 'string' && manifest.styles) return [manifest.styles];
    if (typeof manifest.css === 'string' && manifest.css) return [manifest.css]; // legacy reserved field
    return ['styles.css', 'style.css']; // Obsidian default, then legacy
  }

  // Obsidian parity: stylesheets are auto-injected and namespaced per plugin
  // so deactivate can remove exactly what the plugin added.
  function _injectPluginStyles(id, css) {
    try {
      document.querySelectorAll('style[data-plugin-styles="' + CSS.escape(id) + '"]').forEach(el => el.remove());
      const el = document.createElement('style');
      el.dataset.pluginStyles = id;
      el.textContent = css;
      document.head.appendChild(el);
    } catch (e) { console.error('[plugin] style inject failed for', id, ':', e); }
  }

  function _removePluginStyles(id) {
    try {
      document.querySelectorAll('style[data-plugin-styles="' + CSS.escape(id) + '"]').forEach(el => el.remove());
    } catch { }
  }

  function _makePluginApi(manifest) {
    const api = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      log: (...args) => console.log(`[plugin:${manifest.id}]`, ...args),
      events: {
        on: (ev, cb) => {
          if (typeof cb !== 'function') return;
          if (!_pluginBus.has(ev)) _pluginBus.set(ev, new Set());
          _pluginBus.get(ev).add({ pluginId: manifest.id, cb });
        },
        off: (ev, cb) => {
          const set = _pluginBus.get(ev);
          if (!set) return;
          for (const h of [...set]) { if (h.cb === cb) set.delete(h); }
        },
      },
      commands: {
        register: (def) => {
          if (!def || typeof def.id !== 'string' || typeof def.handler !== 'function') return;
          _pluginCommands.set(def.id, { pluginId: manifest.id, id: def.id, label: def.label || def.id, combo: def.combo || null, handler: def.handler });
        },
        unregister: (id) => { _pluginCommands.delete(id); },
        run: (id) => {
          const c = _pluginCommands.get(id);
          if (c) { try { c.handler(); } catch (e) { console.error('[plugin] command', id, 'failed:', e); } }
        },
      },
      menus: {
        add: (type, item) => {
          if (!['terminal', 'workspace', 'folder'].includes(type)) return;
          if (!item || typeof item.handler !== 'function') return;
          _pluginMenuItems[type].push({ pluginId: manifest.id, label: item.label, icon: item.icon || '', handler: item.handler, when: item.when || null });
        },
        remove: (type, label) => {
          const arr = _pluginMenuItems[type];
          if (!arr) return;
          const i = arr.findIndex(x => x.pluginId === manifest.id && x.label === label);
          if (i !== -1) arr.splice(i, 1);
        },
      },
      themes: {
        register: (name, theme) => {
          if (!name || !theme || BUILTIN_THEME_KEYS.has(name)) return;
          THEMES[name] = theme;
          _pluginThemes.set(name, { pluginId: manifest.id, theme });
        },
        unregister: (name) => {
          const rec = _pluginThemes.get(name);
          if (rec && rec.pluginId === manifest.id) { delete THEMES[name]; _pluginThemes.delete(name); }
        },
      },
      terminal: {
        // Write directly to a terminal's screen buffer (xterm display).
        // Display-only: never fed to the shell, so special characters can't
        // trigger glob errors or command execution. For real input/keystrokes
        // use window.electronAPI.terminalWrite({ id, data }) instead.
        write: (id, data) => {
          try {
            const result = findTermById(id);
            if (!result || !result.term || result.term.type === 'browser' || !result.term.term) return false;
            result.term.term.write(data);
            return true;
          } catch (e) {
            console.error('[plugin] terminal.write failed for', id, ':', e);
            return false;
          }
        },
        // Open a new terminal tab in the active pane: { cwd, cmd, label }.
        // `cmd` is typed into the fresh shell. Returns the new terminal id.
        open: (opts = {}) => {
          const entry = addTerminal(null, null, {
            cwd: typeof opts.cwd === 'string' ? opts.cwd : null,
            cmd: typeof opts.cmd === 'string' ? opts.cmd : null,
            label: typeof opts.label === 'string' ? opts.label : null,
          });
          return entry ? entry.id : null;
        },
      },
      // Read-only file access (Electron only; resolves null elsewhere or on error).
      fs: {
        list: (dir) => window.electronAPI?.pluginFsList ? window.electronAPI.pluginFsList(dir) : Promise.resolve(null),
        read: (file, opts) => window.electronAPI?.pluginFsRead ? window.electronAPI.pluginFsRead(file, opts || {}) : Promise.resolve(null),
      },
      ui: {
        addWidget: (w) => {
          if (!w || !w.el) return;
          _pluginWidgets.push({ pluginId: manifest.id, id: w.id || ('w' + Math.random().toString(36).slice(2)), position: w.position || 'statusbar', el: w.el });
          renderPluginWidgets();
        },
        removeWidget: (id) => {
          const i = _pluginWidgets.findIndex(x => x.pluginId === manifest.id && x.id === id);
          if (i !== -1) { const [w] = _pluginWidgets.splice(i, 1); _removeWidgetDom(w); renderPluginWidgets(); }
        },
        // A page in the right panel, opened by a button on its main page:
        // { id, label, icon: 'ph-…' (phosphor), el, onShow() }.
        addPanel: (p) => {
          const side = document.getElementById('sidebar-right');
          const home = document.getElementById('sbr-main');
          const bar = home && home.querySelector('.sbr-body');
          if (!p || !p.el || !side || !bar) return;
          const label = p.label || p.id || 'Panel';
          const page = document.createElement('div');
          page.className = 'sbr-page';
          page.style.display = 'none';
          page.innerHTML = '<div class="sbr-header"><button class="sbr-btn" title="Back"><i class="ph ph-arrow-left"></i></button><span class="sbr-title"></span></div>';
          page.querySelector('.sbr-title').textContent = label;
          page.appendChild(p.el);
          const btn = document.createElement('button');
          btn.className = 'sbr-big-btn';
          btn.title = label;
          const icon = document.createElement('i');
          icon.className = 'ph ' + (p.icon || 'ph-puzzle-piece');
          const text = document.createElement('span');
          text.textContent = label;
          btn.append(icon, text);
          btn.addEventListener('click', () => {
            side.querySelectorAll('.sbr-page').forEach(el => { el.style.display = 'none'; });
            page.style.display = 'flex';
            if (typeof p.onShow === 'function') { try { p.onShow(); } catch (e) { console.error('[plugin] panel onShow failed:', e); } }
          });
          page.querySelector('.sbr-btn').addEventListener('click', () => {
            page.style.display = 'none';
            home.style.display = 'flex';
          });
          side.appendChild(page);
          bar.appendChild(btn);
          _pluginWidgets.push({ pluginId: manifest.id, id: p.id || ('p' + Math.random().toString(36).slice(2)), position: 'panel', el: page, btn });
        },
      },

      // Plugin-declared settings (manifest.settings). Values are persisted in
      // state.json (pluginConfigs) and edited from Settings → Plugins.
      config: {
        get: (key, fallback) => {
          const stored = (_pluginConfigs.get(manifest.id) || {})[key];
          if (stored !== undefined) return stored;
          const schema = (manifest.settings || []).find(s => s.key === key);
          if (schema && schema.default !== undefined) return schema.default;
          return fallback;
        },
        set: (key, value) => {
          const cfg = Object.assign({}, _pluginConfigs.get(manifest.id) || {});
          cfg[key] = value;
          _pluginConfigs.set(manifest.id, cfg);
          _pluginConfigLast.delete(manifest.id); // force re-delivery
          saveState();
          deliverPluginConfig(manifest.id, [key]);
        },
        all: () => {
          const out = {};
          for (const s of (manifest.settings || [])) out[s.key] = api.config.get(s.key, s.default);
          return out;
        },
        onChange: (cb) => {
          if (typeof cb !== 'function') return;
          if (!_pluginConfigCbs.has(manifest.id)) _pluginConfigCbs.set(manifest.id, new Set());
          _pluginConfigCbs.get(manifest.id).add(cb);
          deliverPluginConfig(manifest.id, null);
        },
      },
      state: {
        getActiveTerminal: () => {
          const t = activeTerminal();
          if (!t) return null;
          return { id: t.id, label: t.label, type: t.type, url: t.url || null, wsId: activeWsId };
        },
        getActiveWorkspace: () => {
          const w = activeWs();
          return w ? { id: w.id, label: w.label } : null;
        },
        getWorkspaces: () => workspaces.map(w => ({ id: w.id, label: w.label })),
      },
    };
    return api;
  }

  // Deliver the plugin's persisted config to its onChange handlers (deduped
  // by snapshot, so a delivery only fires when values actually changed).
  function deliverPluginConfig(id, changedKeys) {
    const manifest = _pluginManifests.get(id);
    const cbs = _pluginConfigCbs.get(id);
    if (!manifest || !cbs || !cbs.size) return;
    const snapshot = JSON.stringify(_pluginConfigs.get(id) || {});
    if (snapshot === _pluginConfigLast.get(id) && changedKeys === null) return;
    _pluginConfigLast.set(id, snapshot);
    for (const cb of [...cbs]) {
      try { cb({ id, config: Object.assign({}, _pluginConfigs.get(id) || {}), changed: changedKeys }); }
      catch (e) { console.error('[plugin] config onChange failed for', id, ':', e); }
    }
  }

  // Persist a plugin config value (used by the Settings → Plugins page).
  function setPluginConfigValue(id, key, value) {
    const cfg = Object.assign({}, _pluginConfigs.get(id) || {});
    cfg[key] = value;
    _pluginConfigs.set(id, cfg);
    _pluginConfigLast.delete(id);
    saveState();
    deliverPluginConfig(id, [key]);
  }

  // Panel widgets also own a button on the right panel's main page; if the
  // panel was open, fall back to the main page.
  function _removeWidgetDom(w) {
    if (w.btn) {
      w.btn.remove();
      const home = document.getElementById('sbr-main');
      if (home && w.el.style.display !== 'none') home.style.display = 'flex';
    }
    w.el.remove();
  }

  function renderPluginWidgets() {
    const dock = document.getElementById('statusbar');
    if (!dock) return;
    dock.querySelectorAll('[data-plugin-widget]').forEach(el => el.remove());
    const sbWidgets = _pluginWidgets.filter(w => w.position === 'statusbar');
    dock.classList.toggle('active', sbWidgets.length > 0);
    const sbRight = dock.querySelector('#statusbar-right') || dock;
    for (const w of sbWidgets) { w.el.dataset.pluginWidget = '1'; sbRight.appendChild(w.el); }
    const sidebarInner = document.getElementById('sidebar-inner');
    if (sidebarInner) {
      sidebarInner.querySelectorAll('[data-plugin-widget]').forEach(el => el.remove());
      // Banner widgets live above the WORKSPACES header (prepended in order).
      const tops = _pluginWidgets.filter(x => x.position === 'sidebar-top');
      for (let i = tops.length - 1; i >= 0; i--) {
        const w = tops[i];
        w.el.dataset.pluginWidget = '1';
        w.el.dataset.widgetPosition = 'sidebar-top';
        sidebarInner.insertBefore(w.el, sidebarInner.firstChild);
      }
      for (const w of _pluginWidgets.filter(x => x.position === 'sidebar')) {
        w.el.dataset.pluginWidget = '1';
        w.el.dataset.widgetPosition = 'sidebar';
        sidebarInner.appendChild(w.el);
      }
    }
  }

  // Render the Settings → Plugins page: one row per installed plugin with a
  // status, an activate/deactivate toggle, and an "open folder" access button.
  // Newly added folders are activated here, so imports apply without restart.
  async function renderPluginsSettings() {
    const list = document.getElementById('plugins-list');
    if (!list) return;
    const api = configApi();
    let manifests = [];
    if (api && api.configListPlugins) {
      try { manifests = await api.configListPlugins(); } catch { manifests = []; }
    }
    try { await autoSyncPlugins(manifests); } catch { }
    list.innerHTML = '';
    updatePluginsSectionTitle(manifests);
    if (!Array.isArray(manifests) || !manifests.length) {
      const empty = document.createElement('div');
      empty.className = 'plugin-empty';
      empty.textContent = 'No plugins installed. Drop a folder into ~/.terminalvibe/plugins/, then reopen this page.';
      list.appendChild(empty);
      return;
    }
    // Detail view: options for a single plugin, with a back button at top.
    if (_pluginsView.mode === 'detail') {
      const manifest = manifests.find(m => m.id === _pluginsView.id);
      if (manifest) { renderPluginDetailPage(list, manifest); return; }
      _pluginsView = { mode: 'list' };
      updatePluginsSectionTitle(manifests);
    }
    for (const manifest of manifests) {
      const enabled = _pluginStates.get(manifest.id) !== false;
      const row = document.createElement('div');
      row.className = 'plugin-row';
      const meta = document.createElement('div');
      meta.className = 'plugin-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'plugin-name';
      nameEl.textContent = manifest.name || manifest.id;
      const pluginErr = _pluginErrors.get(manifest.id);
      // Quiet text state, like Skills; only a real failure gets an icon + color.
      const status = document.createElement('span');
      status.className = 'plugin-state' + (enabled && pluginErr ? ' error' : '');
      if (enabled && pluginErr) status.innerHTML = '<i class="ph ph-warning-circle" aria-hidden="true"></i>';
      status.append(!enabled ? 'Inactive' : pluginErr ? 'Error' : 'Active');
      nameEl.append(' ', status);
      meta.appendChild(nameEl);
      if (manifest.description) {
        const desc = document.createElement('div');
        desc.className = 'plugin-desc';
        desc.textContent = manifest.description;
        desc.title = manifest.description;
        meta.appendChild(desc);
      }
      const idEl = document.createElement('div');
      idEl.className = 'plugin-meta';
      idEl.textContent = [manifest.id, manifest.version && 'v' + manifest.version, manifest.author].filter(Boolean).join(' · ');
      meta.appendChild(idEl);
      if (pluginErr) {
        const errEl = document.createElement('div');
        errEl.className = 'plugin-error';
        errEl.textContent = pluginErr;
        meta.appendChild(errEl);
      }
      row.appendChild(meta);

      const controls = document.createElement('div');
      controls.className = 'plugin-controls';
      const schema = Array.isArray(manifest.settings) ? manifest.settings : [];
      if (schema.length) {
        const cfgBtn = document.createElement('button');
        cfgBtn.type = 'button';
        cfgBtn.className = 'plugin-icon-btn';
        cfgBtn.title = 'Configure ' + (manifest.name || manifest.id);
        cfgBtn.innerHTML = '<i class="ph ph-sliders-horizontal"></i>';
        cfgBtn.addEventListener('click', () => {
          _pluginsView = { mode: 'detail', id: manifest.id };
          renderPluginsSettings();
        });
        controls.appendChild(cfgBtn);
      }
      const folderBtn = document.createElement('button');
      folderBtn.type = 'button';
      folderBtn.className = 'plugin-icon-btn';
      folderBtn.title = 'Open plugin folder';
      folderBtn.innerHTML = '<i class="ph ph-folder-open"></i>';
      folderBtn.addEventListener('click', () => {
        if (api && api.configOpenPluginFolder) api.configOpenPluginFolder(manifest.id);
      });
      controls.appendChild(folderBtn);

      const label = document.createElement('label');
      label.className = 'inline-flex items-center cursor-pointer';
      label.title = enabled ? 'Deactivate plugin' : 'Activate plugin';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'sr-only peer plugin-toggle';
      input.dataset.id = manifest.id;
      input.checked = enabled;
      const knob = document.createElement('div');
      knob.className = 'relative w-9 h-5 bg-white/10 rounded-full peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[\'\'] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--accent)]';
      label.appendChild(input);
      label.appendChild(knob);
      input.addEventListener('change', () => {
        togglePlugin(manifest.id, input.checked);
      });
      controls.appendChild(label);
      row.appendChild(controls);
      list.appendChild(row);
    }
  }

  // Swap the section title: detail view shows "‹ plugin name" (transparent back
  // button + name); list view restores the plain "Plugins" heading.
  function updatePluginsSectionTitle(manifests) {
    const titleEl = document.getElementById('plugins-title');
    const openDirRow = document.getElementById('plugins-open-dir-row');
    if (!titleEl) return;
    if (_pluginsView.mode === 'detail') {
      const manifest = (manifests || []).find(m => m.id === _pluginsView.id);
      if (openDirRow) openDirRow.style.display = 'none';
      titleEl.className = 'flex items-center gap-1.5 min-w-0 mt-0 mb-1.5 ml-1';
      titleEl.textContent = '';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'plugin-back-btn';
      back.title = 'Back to all plugins';
      back.innerHTML = '<i class="ph ph-arrow-left"></i>';
      back.addEventListener('click', () => {
        _pluginsView = { mode: 'list' };
        renderPluginsSettings();
      });
      titleEl.appendChild(back);
      const name = document.createElement('span');
      name.className = 'text-[12.5px] font-medium text-[var(--fg)] truncate';
      name.textContent = manifest ? (manifest.name || manifest.id) : 'Plugins';
      titleEl.appendChild(name);
    } else {
      if (openDirRow) openDirRow.style.display = '';
      titleEl.className = 'settings-section-label mt-0 mb-1.5 ml-1';
      titleEl.textContent = 'Plugins';
    }
  }

  // Detail page for one plugin's declared settings (manifest.settings).
  function renderPluginDetailPage(list, manifest) {
    const schema = Array.isArray(manifest.settings) ? manifest.settings : [];

    if (!schema.length) {
      const none = document.createElement('div');
      none.className = 'plugin-empty';
      none.textContent = 'This plugin has no configurable options.';
      list.appendChild(none);
      return;
    }

    for (const s of schema) {
      const field = renderPluginConfigField(manifest, s);
      list.appendChild(field);
      field.querySelectorAll('.custom-dropdown').forEach(dd => {
        if (typeof initCustomDropdown === 'function') initCustomDropdown(dd);
      });
    }
  }

  // Build one option row for a manifest.settings entry, matching the standard
  // settings-row pattern: label/description on the left, control on the right.
  function renderPluginConfigField(manifest, s) {
    const wrap = document.createElement('div');
    wrap.className = 'plugin-row';
    const labelEl = document.createElement('div');
    labelEl.className = 'flex flex-col gap-1';
    const lab = document.createElement('div');
    lab.className = 'text-[12.5px] font-medium text-[var(--fg)]';
    lab.textContent = s.label || s.key;
    labelEl.appendChild(lab);
    if (s.description) {
      const d = document.createElement('div');
      d.className = 'text-[11px] text-[var(--muted-text)] leading-tight max-w-[280px]';
      d.textContent = s.description;
      labelEl.appendChild(d);
    }
    wrap.appendChild(labelEl);

    const current = (_pluginConfigs.get(manifest.id) || {})[s.key];
    const value = current !== undefined ? current : s.default;

    const commit = (v) => { setPluginConfigValue(manifest.id, s.key, v); };

    const controlWrap = document.createElement('div');
    controlWrap.className = 'flex-1 flex items-center justify-end gap-3';

    const inputCls = 'bg-black/20 border border-[var(--border)] rounded text-[var(--fg)] px-2.5 py-1.5 text-[12px] w-[200px] text-left transition-all duration-200 font-inherit placeholder:text-[var(--dim-text)] focus:border-[var(--accent)] focus:bg-black/30 focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_20%,transparent)] focus:outline-none';

    let control;
    if (s.type === 'boolean') {
      const lbl = document.createElement('label');
      lbl.className = 'inline-flex items-center cursor-pointer shrink-0';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'sr-only peer';
      cb.checked = !!value;
      const knob = document.createElement('div');
      knob.className = 'relative w-9 h-5 bg-white/10 rounded-full peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[\'\'] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--accent)]';
      cb.addEventListener('change', () => commit(cb.checked));
      lbl.appendChild(cb);
      lbl.appendChild(knob);
      control = lbl;
    } else if (s.type === 'select') {
      // Use the app's custom dropdown component (hidden native select +
      // .custom-dropdown) so it matches every other settings dropdown.
      const selId = 'plugin-cfg-' + String(manifest.id).replace(/[^a-zA-Z0-9_-]/g, '') + '-' + String(s.key).replace(/[^a-zA-Z0-9_-]/g, '');
      const sel = document.createElement('select');
      sel.id = selId;
      sel.className = 'native-select-hidden';
      for (const opt of (s.options || [])) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => commit(sel.value));
      const dd = document.createElement('div');
      dd.className = 'custom-dropdown';
      dd.dataset.for = selId;
      const box = document.createElement('div');
      box.className = 'flex items-center gap-3';
      box.appendChild(sel);
      box.appendChild(dd);
      control = box;
    } else if (s.type === 'number') {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.value = value !== undefined ? value : '';
      inp.className = inputCls.replace('w-[200px]', 'w-[90px]');
      inp.addEventListener('change', () => {
        const n = parseFloat(inp.value);
        commit(Number.isFinite(n) ? n : s.default);
      });
      control = inp;
    } else {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = value !== undefined ? value : '';
      inp.className = inputCls;
      inp.addEventListener('change', () => commit(inp.value));
      control = inp;
    }
    controlWrap.appendChild(control);
    wrap.appendChild(controlWrap);
    return wrap;
  }

  // Live activate/deactivate a plugin (no restart) and persist to state.json.
  async function togglePlugin(id, enabled) {
    _pluginStates.set(id, !!enabled);
    saveState();
    if (enabled) {
      const api = configApi();
      if (!api || !api.configListPlugins || !api.configReadPluginFile) return;
      const manifests = await api.configListPlugins();
      const manifest = (manifests || []).find(m => m.id === id);
      if (!manifest) return;
      try {
        await activatePlugin(manifest);
      } catch (e) {
        console.error('[plugin] activate failed for', id, ':', e);
      }
    } else {
      try { deactivatePlugin(id); } catch (e) { console.error('[plugin] deactivate failed for', id, ':', e); }
    }
    renderPluginsSettings();
  }

  // Evaluate + activate one plugin manifest. Supports the legacy
  // TerminalVibe.register style and Obsidian-style module.exports
  // (Plugin subclass or { onload/onunload }). Idempotent: re-activating
  // first unloads the previous instance so toggles never double-register.
  async function activatePlugin(manifest) {
    const cfgApi = configApi();
    if (!cfgApi || !cfgApi.configReadPluginFile) return;
    const ns = ensureTerminalVibeGlobal();
    if (_pluginRegistry.has(manifest.id)) {
      try { deactivatePlugin(manifest.id); } catch { }
    }
    _pluginErrors.delete(manifest.id);
    _pluginManifests.set(manifest.id, manifest);

    // Styles first — independent of JS, like Obsidian (styles.css).
    const styleHit = await _readFirstPluginFile(cfgApi, manifest.id, _pluginStyleCandidates(manifest));
    if (styleHit) _injectPluginStyles(manifest.id, styleHit.content);

    const entryHit = await _readFirstPluginFile(cfgApi, manifest.id, _pluginEntryCandidates(manifest));
    if (!entryHit) {
      const msg = 'missing entry (looked for ' + _pluginEntryCandidates(manifest).join(', ') + ')';
      console.warn('[plugin]', manifest.id, msg);
      _pluginErrors.set(manifest.id, msg);
      return;
    }

    let exported = null;
    const before = new Set(_pluginRegistry.keys());
    try {
      exported = _evaluatePluginEntry(entryHit.content, ns);
    } catch (e) {
      console.error('[plugin] failed to evaluate', manifest.id, ':', e);
      _pluginErrors.set(manifest.id, String((e && e.message) || e));
      return;
    }

    // Legacy register() wins when the entry used it; otherwise fall back to
    // whatever the entry assigned to module.exports.
    let def = _pluginRegistry.get(manifest.id);
    if (!def) {
      for (const k of _pluginRegistry.keys()) {
        if (!before.has(k)) {
          const aliasKey = k;
          def = _pluginRegistry.get(aliasKey);
          // Folder name is the canonical id (as in Obsidian): re-key so
          // unload/cleanup by folder works even when register() used another.
          if (aliasKey !== manifest.id) {
            console.warn('[plugin] id mismatch: folder "' + manifest.id + '" registered as "' + aliasKey + '" — using folder id');
            _pluginRegistry.delete(aliasKey);
            _pluginRegistry.set(manifest.id, def);
          }
          break;
        }
      }
    }
    if (!def) {
      def = _normalizePluginExport(exported, manifest);
      if (def) _pluginRegistry.set(manifest.id, def);
    }
    // Obsidian-style Plugin subclass → instantiate with the plugin api.
    if (def && def._PluginClass) {
      const PluginClass = def._PluginClass;
      let instance = null;
      try {
        instance = new PluginClass(_makePluginApi(manifest));
      } catch (e) {
        console.error('[plugin] failed to construct', manifest.id, ':', e);
        _pluginErrors.set(manifest.id, String((e && e.message) || e));
        _pluginRegistry.delete(manifest.id);
        return;
      }
      def = {
        id: manifest.id,
        activate: (api) => { instance.api = api; instance.app = api; return instance.onload ? instance.onload() : undefined; },
        deactivate: () => { if (instance && typeof instance.onunload === 'function') instance.onunload(); },
        _instance: instance,
      };
      _pluginRegistry.set(manifest.id, def);
    }
    if (!def || typeof def.activate !== 'function') {
      const msg = 'entry registered nothing (need TerminalVibe.register or module.exports)';
      console.warn('[plugin]', manifest.id, msg);
      _pluginErrors.set(manifest.id, msg);
      _pluginRegistry.delete(manifest.id);
      return;
    }
    if (def.id && def.id !== manifest.id) {
      console.warn('[plugin] id mismatch: folder "' + manifest.id + '" registered as "' + def.id + '" — using folder id');
    }
    try {
      await def.activate(_makePluginApi(manifest));
    } catch (e) {
      console.error('[plugin] activate failed for', manifest.id, ':', e);
      try { deactivatePlugin(manifest.id); } catch { }
      _pluginErrors.set(manifest.id, String((e && e.message) || e));
      return;
    }
    // Deliver persisted config to the freshly-activated plugin
    _pluginConfigLast.delete(manifest.id);
    deliverPluginConfig(manifest.id, null);
  }

  // Unload a plugin: run its deactivate, then drop everything it registered.
  function deactivatePlugin(id) {
    const def = _pluginRegistry.get(id);
    if (def && typeof def.deactivate === 'function') {
      try {
        const r = def.deactivate();
        if (r && typeof r.catch === 'function') r.catch(e => console.error('[plugin] deactivate hook failed for', id, ':', e));
      } catch (e) { console.error('[plugin] deactivate hook failed for', id, ':', e); }
    }
    for (const [cid, cmd] of [..._pluginCommands]) {
      if (cmd.pluginId === id) _pluginCommands.delete(cid);
    }
    for (const type of ['terminal', 'workspace', 'folder']) {
      _pluginMenuItems[type] = _pluginMenuItems[type].filter(x => x.pluginId !== id);
    }
    for (const [name, rec] of [..._pluginThemes]) {
      if (rec.pluginId === id) {
        delete THEMES[name];
        _pluginThemes.delete(name);
        if (currentThemeName === name) {
          currentThemeName = 'catppuccin-mocha';
          currentTheme = resolveAppearanceTheme(THEMES[currentThemeName], resolvedDarkScheme());
          applyTheme(currentThemeName);
        }
      }
    }
    const removedWidgets = _pluginWidgets.filter(w => w.pluginId === id);
    for (const w of removedWidgets) { try { _removeWidgetDom(w); } catch { } }
    _pluginWidgets.splice(0, _pluginWidgets.length, ..._pluginWidgets.filter(w => w.pluginId !== id));
    renderPluginWidgets();
    for (const [ev, set] of _pluginBus) {
      for (const h of [...set]) { if (h.pluginId === id) set.delete(h); }
    }
    _removePluginStyles(id);
    _pluginErrors.delete(id);
    _pluginConfigCbs.delete(id);
    _pluginConfigLast.delete(id);
    _pluginManifests.delete(id);
    // Drop the registry entry plus any alias keys pointing at the same def
    // (left over from folder/register id mismatches).
    for (const k of [..._pluginRegistry.keys()]) {
      if (k === id || _pluginRegistry.get(k) === def) _pluginRegistry.delete(k);
    }
  }

  function dispatchPluginKeydown(e) {
    for (const cmd of _pluginCommands.values()) {
      if (!cmd.combo) continue;
      if (_pluginComboMatches(cmd.combo, e)) {
        e.preventDefault();
        try { cmd.handler(); } catch (err) { console.error('[plugin] command failed:', cmd.id, err); }
        return true;
      }
    }
    return false;
  }

  // Plugin entry JS calls TerminalVibe.register({ id, activate, deactivate }).
  function registerPlugin(def) {
    if (!def || typeof def.id !== 'string') return;
    _pluginRegistry.set(def.id, def);
  }

  async function loadPlugins() {
    try {
      const api = configApi();
      if (!api || !api.configListPlugins) return; // browser dev mode: no plugin host
      const manifests = await api.configListPlugins();
      if (!Array.isArray(manifests) || !manifests.length) return;

      ensureTerminalVibeGlobal();

      for (const manifest of manifests) {
        if (_pluginStates.get(manifest.id) === false) continue;
        try { await activatePlugin(manifest); } catch (e) { console.error('[plugin] activate failed for', manifest.id, ':', e); }
      }
    } catch (e) {
      console.error('[plugin] loadPlugins failed:', e);
    }
  }

  // Reconcile active plugins with persisted state (used after a settings change
  // pushes new pluginStates to the main window).
  async function syncPlugins() {
    const api = configApi();
    if (!api || !api.configListPlugins) return;
    const manifests = await api.configListPlugins();
    if (!Array.isArray(manifests)) return;
    const ids = new Set(manifests.map(m => m.id));
    for (const [id, def] of [..._pluginRegistry]) {
      if (!ids.has(id) || _pluginStates.get(id) === false) deactivatePlugin(id);
    }
    for (const manifest of manifests) {
      if (_pluginStates.get(manifest.id) === false) continue;
      if (_pluginRegistry.has(manifest.id)) {
        // Config may have been updated by the settings window — re-deliver.
        _pluginConfigLast.delete(manifest.id);
        deliverPluginConfig(manifest.id, null);
        continue;
      }
      try { await activatePlugin(manifest); } catch (e) { console.error('[plugin] activate failed for', manifest.id, ':', e); }
    }
  }

  // Auto-apply on Plugins-page open: activate anything enabled-but-not-loaded
  // (e.g. a folder the user just copied into ~/.terminalvibe/plugins/) and
  // unload anything whose folder disappeared — no restart required.
  let _pluginsAutoSyncing = null;
  async function autoSyncPlugins(manifests) {
    if (_pluginsAutoSyncing) { try { await _pluginsAutoSyncing; } catch { } return; }
    const run = (async () => {
      const live = new Set((manifests || []).map(m => m.id));
      for (const [id] of [..._pluginRegistry]) {
        if (!live.has(id)) { try { deactivatePlugin(id); } catch (e) { console.error('[plugin] deactivate failed for', id, ':', e); } }
      }
      for (const m of (manifests || [])) {
        if (_pluginStates.get(m.id) === false) continue;
        if (_pluginRegistry.has(m.id)) continue;
        try { await activatePlugin(m); } catch (e) { console.error('[plugin] activate failed for', m.id, ':', e); }
      }
    })();
    _pluginsAutoSyncing = run;
    try { await run; } finally { if (_pluginsAutoSyncing === run) _pluginsAutoSyncing = null; }
  }

  /* ═══════════════════════════════════════════════════════════════
   S T*ATE
   ═══════════════════════════════════════════════════════════════ */
  let currentColorScheme = 'dark'; // Preserve the appearance of existing installations.
  const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');

  // Appearance resolution is pure so previews and terminal colors stay in sync.
  function resolveAppearanceTheme(theme, dark) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const luminance = hex => rgb(hex).map(v => {
      v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const nativeDark = luminance(theme.bg) < .4;
    if (nativeDark === dark) return theme;
    const bg = dark ? '#10131a' : '#f7f8fb';
    const fg = dark ? '#e8ecf4' : '#202432';
    const contrast = color => {
      const a = luminance(color), b = luminance(bg);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    const readable = (color, ratio = 4.5) => {
      if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) return fg;
      const start = rgb(color), end = rgb(fg);
      for (let step = 0; step <= 20; step++) {
        const hex = '#' + start.map((v, i) => Math.round(v + (end[i] - v) * step / 20).toString(16).padStart(2, '0')).join('');
        if (contrast(hex) >= ratio) return hex;
      }
      return fg;
    };
    const accent = readable(theme.ui?.accent || theme.palette[4]);
    return { ...theme, bg, fg, cursor: accent, selection: dark ? '#303b55' : '#d8dff5',
      palette: theme.palette.map(color => readable(color, 3)),
      ui: { accent, border: dark ? '#2a3240' : '#d9dde6',
        tabActiveBg: dark ? '#191e29' : '#ffffff', tabHoverBg: dark ? '#222937' : '#e9ecf3',
        dimText: dark ? '#8994a8' : '#667085', mutedText: dark ? '#a0a9bb' : '#505b70' } };
  }
  function resolvedDarkScheme() {
    return currentColorScheme === 'system' ? systemColorScheme.matches : currentColorScheme === 'dark';
  }

  let currentThemeName = 'graphite';
  let currentTheme = resolveAppearanceTheme(THEMES[currentThemeName], resolvedDarkScheme());
  let currentFontSize = 14;
  let currentFontFamily = "'Geist Mono', 'Cascadia Code', 'Consolas', monospace";
  let customFonts = {}; // name -> { name, dataUrl, format }
  const PRESET_FONTS = [
    { name: 'Geist Mono', family: "'Geist Mono', 'Cascadia Code', 'Consolas', monospace" },
    { name: 'JetBrains Mono', family: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace" },
    { name: 'Fira Code', family: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace" },
    { name: 'Cascadia Code', family: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace" },
    { name: 'Hack', family: "'Hack', 'Fira Code', 'Consolas', 'Courier New', monospace" },
    { name: 'Source Code Pro', family: "'Source Code Pro', 'JetBrains Mono', 'Consolas', 'Courier New', monospace" },
    { name: 'Ubuntu Mono', family: "'Ubuntu Mono', 'DejaVu Sans Mono', 'Consolas', 'Courier New', monospace" },
    { name: 'DejaVu Sans Mono', family: "'DejaVu Sans Mono', 'Consolas', 'Courier New', monospace" },
    { name: 'Menlo', family: "'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace" },
    { name: 'Consolas', family: "'Consolas', 'Courier New', monospace" },
    { name: 'Courier New', family: "'Courier New', monospace" },
  ];
  let currentLineHeight = 1.2;
  let currentCursorStyle = 'block';
  let currentCursorBlink = true;
  let currentScrollback = 10000;
  let defaultTerminalPath = '';      // default working directory for new terminals
  let backgroundMode = 'none';       // 'none' | 'per-tab' | 'per-workspace' | 'global'
  let globalBackgroundImage = '';    // data URL for global bg
  let backgroundOpacity = 0.85;       // 0..1
  let animationsEnabled = true;
  let settingsCategory = 'general'; // last-opened settings category (deep-link via openSettings(cat))
  let searchEngine = 'google';        // 'google' | 'duckduckgo' | 'brave' | 'bing' | 'yahoo' | 'startpage' | 'custom'
  let customSearchUrl = '';           // custom search URL with %s placeholder
  const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?igu=1&q=%s',
    duckduckgo: 'https://duckduckgo.com/?q=%s',
    brave: 'https://search.brave.com/search?q=%s',
    startpage: 'https://www.startpage.com/do/search?q=%s',
  };
  const SEARCH_ENGINE_ICONS = {
    google: 'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z',
    duckduckgo: 'M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 .984C18.083.984 23.016 5.916 23.016 12S18.084 23.016 12 23.016.984 18.084.984 12C.984 5.917 5.916.984 12 .984zm0 .938C6.434 1.922 1.922 6.434 1.922 12c0 4.437 2.867 8.205 6.85 9.55-.237-.82-.776-2.753-1.6-6.052-1.184-4.741-2.064-8.606 2.379-9.813.047-.011.064-.064.03-.093-.514-.467-1.382-.548-2.233-.38a.06.06 0 0 1-.07-.058c0-.011 0-.023.011-.035.205-.286.572-.507.822-.64a1.843 1.843 0 0 0-.607-.335c-.059-.022-.059-.12-.006-.144.006-.006.012-.012.024-.012 1.749-.233 3.586.292 4.49 1.448.011.011.023.017.035.023 2.968.635 3.509 4.837 3.328 5.998a9.607 9.607 0 0 0 2.346-.576c.746-.286 1.008-.222 1.101-.053.1.193-.018.513-.28.81-.496.567-1.393 1.01-2.974 1.137-.546.044-1.029.024-1.445.006-.789-.035-1.339-.059-1.633.39-.192.298-.041.998 1.487 1.22 1.09.157 2.078.047 2.798-.034.643-.07 1.073-.118 1.172.069.21.402-.996 1.207-3.066 1.224-.158 0-.315-.006-.467-.011-1.283-.065-2.227-.414-2.816-.735a.094.094 0 0 1-.035-.017c-.105-.059-.31.045-.188.267.07.134.444.478 1.004.776-.058.466.087 1.184.338 2l.088-.016c.041-.009.087-.019.134-.025.507-.082.775.012.926.175.717-.536 1.913-1.294 2.03-1.154.583.694.66 2.332.53 2.99-.004.012-.017.024-.04.035-.274.117-1.783-.296-1.783-.511-.059-1.075-.26-1.173-.493-1.225h-.156c.006.006.012.018.018.03l.052.12c.093.257.24 1.063.13 1.26-.112.199-.835.297-1.284.303-.443.006-.543-.158-.637-.408-.07-.204-.103-.675-.103-.95a.857.857 0 0 1 .012-.216c-.134.058-.333.193-.397.281-.017.262-.017.682.123 1.149.07.221-1.518 1.164-1.74.99-.227-.181-.634-1.952-.459-2.67-.187.017-.338.075-.42.191-.367.508.093 2.933.582 3.248.257.169 1.54-.553 2.176-1.095.105.145.305.158.553.158.326-.012.782-.06 1.103-.158.192.45.423.972.613 1.388 4.47-1.032 7.803-5.037 7.803-9.82 0-5.566-4.512-10.078-10.078-10.078zm1.791 5.646c-.42 0-.678.146-.795.332-.023.047.047.094.094.07.14-.075.357-.161.701-.156.328.006.516.09.67.159l.023.01c.041.017.088-.03.059-.065-.134-.18-.332-.35-.752-.35zm-5.078.198a1.24 1.24 0 0 0-.522.082c-.454.169-.67.526-.67.76 0 .051.112.057.141.011.081-.123.21-.31.617-.478.408-.17.73-.146.951-.094.047.012.083-.041.041-.07a.989.989 0 0 0-.558-.211zm5.434 1.423a.651.651 0 0 0-.655.647.652.652 0 0 0 1.307 0 .646.646 0 0 0-.652-.647zm.283.262h.008a.17.17 0 0 1 .17.17c0 .093-.077.17-.17.17a.17.17 0 0 1-.17-.17c0-.09.072-.165.162-.17zm-5.358.076a.752.752 0 0 0-.758.758c0 .42.338.758.758.758s.758-.337.758-.758a.756.756 0 0 0-.758-.758zm.328.303h.01c.112 0 .2.089.2.2 0 .11-.088.197-.2.197a.195.195 0 0 1-.197-.198c0-.107.082-.194.187-.199z',
    brave: 'M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z',
    startpage: 'm16.885 14.254.04-.06a8.723 8.723 0 0 0 1.851-4.309c-1.334 0-2.648 0-3.982.04a4.901 4.901 0 0 1-4.758 3.696 4.948 4.948 0 0 1-4.56-3.044 89.632 89.632 0 0 0-3.941.514c1.035 3.697 4.46 6.405 8.501 6.405a8.76 8.76 0 0 0 3.743-.83l.06-.02.04.04 5.455 6.603c.378.454.916.711 1.513.711.458 0 .896-.158 1.234-.435.399-.336.657-.79.697-1.304.04-.514-.1-1.009-.438-1.424zM5.118 8.56c.1-2.59 2.27-4.685 4.918-4.685a4.911 4.911 0 0 1 4.898 4.389c1.314.02 2.608.04 3.922.099C18.616 3.717 14.754 0 10.036 0c-4.858 0-8.82 3.934-8.82 8.758v.178a86.7 86.7 0 0 1 3.902-.376z',
  };

  let workspaces = [];       // [{id, label, activeTermId, layout: (Node), folderId?}]
  let folders = [];          // [{id, label, color?, collapsed?}]  — workspace folders/groups
  let sideOrder = [];        // top-level sidebar flow: [{type:'ws'|'folder', id}] in visual order
  let pinnedCollapsed = false; // "Pinned" section collapsed state
  let sidebarMode = 'normal'; // 'normal' | 'hover' | 'hidden'
  let showWsProcs = true;     // show running processes in workspace buttons
  let notifyOnCommandFinish = true; // notify when a command / agent response finishes
  let notificationSound = true;     // play sounds/notify.wav with those notifications
  let terminalLinkTarget = 'tab';     // 'tab' (browser tab beside the terminal) | 'external'
  let activeWsId = null;
  let settingsWindowOpen = false; // separate Electron settings window is up
  let _wsDomCache = {};      // wsId -> DOM element wrapping that workspace's layout
  let focusedSlotId = null;  // DOM id of focused .term-slot
  let _multiSelected = new Set(); // terminal IDs selected via Ctrl+Alt+RightClick
  // Tab double-click detection state. Declared here (IIFE scope) because the
  // old declaration lived after the detached-mode early return, leaving it
  // uninitialized there and breaking every tab click in detached windows.
  let _lastTabClickTime = 0;
  let _lastTabClickTermId = null;
  function isInMultiMode() { return _multiSelected.size > 0; }
  function clearMultiSelect() {
    _multiSelected.clear();
    document.querySelectorAll('.term-slot.multi-selected').forEach(s => s.classList.remove('multi-selected'));
  }
  function toggleMultiSelect(termId) {
    const slot = document.getElementById('slot-' + termId);
    if (!slot) return;
    if (_multiSelected.has(termId)) {
      _multiSelected.delete(termId);
      slot.classList.remove('multi-selected');
    } else {
      _multiSelected.add(termId);
      slot.classList.add('multi-selected');
    }
  }
  function updateFocusedGroup() {
    document.querySelectorAll('.term-group.focused-group').forEach(g => g.classList.remove('focused-group'));
    if (!focusedSlotId) return;
    const slot = document.getElementById(focusedSlotId);
    if (slot) { const g = slot.closest('.term-group'); if (g) g.classList.add('focused-group'); }
  }

  /* Browser tabs render in an absolutely-positioned .browser-slot overlay that
     sits above the .term-slot, so its focus border must live on that overlay —
     a .term-slot.focused::after border is hidden underneath it. These helpers
     keep the focus state of both elements in sync everywhere. */
  function clearSlotFocus() {
    document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
    document.querySelectorAll('.browser-slot.focused').forEach(s => s.classList.remove('focused'));
  }

  function focusSlot(entry) {
    if (!entry || !entry.el) return;
    clearSlotFocus();
    entry.el.classList.add('focused');
    focusedSlotId = entry.el.id;
    updateFocusedGroup();
    if (entry.type === 'browser' && entry.browserContainer) {
      entry.browserContainer.classList.add('focused');
    }
    const found = findTermById(entry.id);
    if (found && found.ws) {
      found.ws.activeTermId = entry.id;
      const group = findGroupContainingTerm(found.ws.layout, entry.id);
      if (group) group.activeTermId = entry.id;
    }
  }

  let ws = null;             // WebSocket
  let wsReady = false;
  let nativePtyReady = false; // native PTY backend ready (Electron main process)
  let agentBrowserReady = false;
  const agentCreates = new Map();
  const sessionContextRequests = new Map();
  const fileDropRequests = new Map();
  let fileDropReady = false;
  let terminalBackendPlatform = null;
  let sessionContextReady = false;
  let workspaceContextReady = false;

  const browserEventHooks = new Map(); // browser tab id -> handler(listener payload)
  if (isDesktop() && window.electronAPI) {
    window.electronAPI.onBrowserEvent(d => browserEventHooks.get(d && d.id)?.(d));
    window.electronAPI.onBrowserKey?.(d => document.dispatchEvent(new KeyboardEvent('keydown', { ...d, bubbles: true, cancelable: true })));
    syncBrowserShortcuts();
  }
  // ResizeObserver fires after layout, before paint: syncing here moves the
  // overlay in the same frame as its slot (a RAF would lag one frame behind).
  const browserSlotRo = new ResizeObserver(() => { syncBrowserSlots(); settleBrowserSurfaces(); });

  // A fast resize can leave the webview guest composited at a stale width
  // (blank strip on one edge). Once resizing goes quiet, nudge each visible
  // webview by 1px for a frame so the guest re-lays out at the real size.
  let _browserSettleTimer = null;
  function settleBrowserSurfaces() {
    clearTimeout(_browserSettleTimer);
    _browserSettleTimer = setTimeout(() => {
      const ws = activeWs();
      if (!ws) return;
      for (const t of getWorkspaceTerminals(ws)) {
        const w = t.type === 'browser' && t.browserContainer?.querySelector('webview.browser-surface');
        if (!w || !w.offsetWidth) continue;
        w.style.width = 'calc(100% - 1px)';
        requestAnimationFrame(() => { w.style.width = '100%'; });
      }
    }, 120);
  }

  function syncBrowserSlots() {
    const paneArea = document.getElementById('pane-area');
    if (!paneArea) return;

    // A full-screen settings layer is up (either the separate Electron window or
    // the in-window overlay fallback). Native views paint above the window's DOM,
    // so detach them all (alive, not destroyed) on every sync — they must never
    // re-raise above the settings layer.
    const profilePicker = document.getElementById('profile-picker');
    const overlayOpen = settingsWindowOpen ||
      (profilePicker && profilePicker.style.display !== 'none') ||
      (document.getElementById('servers-dropdown')?.hidden === false || document.getElementById('servers-dropdown')?.classList.contains('closing')) ||
      (document.getElementById('tab-search')?.style.display === 'flex') ||
      (document.getElementById('settings-overlay')?.classList.contains('open') === true);
    if (overlayOpen || document.body.classList.contains('tab-dragging')) {
      if (window.electronAPI) {
        for (const ws of workspaces) {
          for (const t of getWorkspaceTerminals(ws)) {
            if (t.type === 'browser' && t._viewCreated) window.electronAPI.browserHide(t.id);
          }
        }
      }
      return;
    }

    // PHASE 1: Batch READ (Prevents Layout Thrashing)
    const paneRect = paneArea.getBoundingClientRect();
    const updates = [];
    const viewUpdates = []; // native WebContentsView bounds (viewport coords = contentView coords)

    // OPTIMIZATION: Only process the active workspace. Ignore hidden ones completely.
    const ws = activeWs();
    if (ws) {
      for (const t of getWorkspaceTerminals(ws)) {
        if (t.type === 'browser' && t.browserContainer) {
          if (!t.el || !t.el.isConnected || t.el.style.display === 'none' || t.el.offsetWidth === 0) {
            // OPTIMIZATION: Offscreen positioning instead of display:none prevents iframe reloads
            updates.push({ container: t.browserContainer, x: -9999, y: -9999, w: 0, h: 0 });
            if (t._viewCreated) viewUpdates.push({ id: t.id, show: false });
          } else {
            const slotRect = t.el.getBoundingClientRect();
            // The overlay hides the group's maximized frame; let it draw its own.
            t.browserContainer.classList.toggle('maximized', !!t.el.closest('.term-group.maximized'));
            updates.push({
              container: t.browserContainer,
              x: slotRect.left - paneRect.left,
              y: slotRect.top - paneRect.top,
              w: slotRect.width,
              h: slotRect.height
            });
            // The native view overlays .browser-content (below the toolbar), tracked in
            // viewport coords which map 1:1 to contentView bounds at zoom 1.
            if (t._viewCreated) {
              const cw = t.browserContainer.querySelector('.browser-content');
              if (cw) {
                viewUpdates.push({ id: t.id, content: cw, show: true });
              }
            }
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
          if (t._viewCreated) viewUpdates.push({ id: t.id, show: false });
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

    if (window.electronAPI) {
      for (const v of viewUpdates) {
        if (v.show) {
          const r = v.content.getBoundingClientRect();
          window.electronAPI.browserResize(v.id, {
            x: Math.round(r.left), y: Math.round(r.top),
            width: Math.round(r.width), height: Math.round(r.height)
          });
          window.electronAPI.browserShow(v.id);
        } else {
          window.electronAPI.browserHide(v.id);
        }
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   B R*OWSER TAB IFRAME (sandboxed, suspend/resume)
   ═══════════════════════════════════════════════════════════════ */

  // Background browser tabs are suspended after this much invisibility
  // to free memory (dev-server pages can hold hundreds of MB).
  const BROWSER_SUSPEND_MS = 30_000;

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
    const wsHost = window.location.hostname || '127.0.0.1';
    ws = new WebSocket(`ws://${wsHost}:${WS_PORT}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      wsReady = true;
      if (agentBrowserReady) ws.send(JSON.stringify({ type: 'agent:ready' }));

      if (workspaces.length) {
        for (const ws of workspaces) {
          const terms = getWorkspaceTerminals(ws);
          for (const t of terms) {
            if (t.pending) {
              const slot = getSlotDimensions(t);
              sendControl({ type: 'create', id: t.id, cols: slot.cols, rows: slot.rows, cwd: t.cwd || null, argv: t.argv || [] });
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
        const sidBytes = arr.subarray(0, ID_LEN);
        const data = arr.subarray(ID_LEN);
        const sid = new TextDecoder().decode(sidBytes).trimEnd();
        const result = findTermById(sid);
        if (result) {
          const oscCwd = _extractOSC7Cwd(data);
          if (oscCwd) result.term.cwd = oscCwd;
          result.term.term.write(data);
        }
      } else {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'agent:request') {
            const connection = ws;
            handleAgentRequest(msg).then(
              result => { if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'agent:result', id: msg.id, result })); },
              error => { if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'agent:result', id: msg.id, error: error.message })); }
            );
          } else if (msg.type === 'session-context:result' || msg.type === 'workspace-context:result') {
            const pending=sessionContextRequests.get(msg.requestId);
            if(pending) {clearTimeout(pending.timer);sessionContextRequests.delete(msg.requestId);if(msg.error) pending.reject(new Error(msg.error));else pending.resolve(msg.result);}
          } else if (msg.type === 'file:result') {
            const pending=fileDropRequests.get(msg.requestId);
            if(pending) {clearTimeout(pending.timer);fileDropRequests.delete(msg.requestId);if(msg.error) pending.reject(new Error(msg.error));else pending.resolve(msg.path);}
          } else if (msg.type === 'agent:created') {
            const pending = agentCreates.get(msg.requestId);
            if (pending) { clearTimeout(pending.timer); agentCreates.delete(msg.requestId); pending.resolve(msg.started); }
          } else if (msg.type === 'ready') {
            if (msg.port) { WS_PORT = msg.port; }
            sessionContextReady = msg.sessionContextDrop === true;
            workspaceContextReady = msg.workspaceContextDrop === true;
            fileDropReady = msg.fileDrop === true;
            terminalBackendPlatform = msg.platform || null;
          } else if (msg.type === 'exit') handleExit(msg.id, msg.code);
          else if (msg.type === 'error') handleError(msg.id, msg.msg);
          else if (msg.type === 'pong') { }
        } catch { }
      }
    };

    ws.onclose = () => {
      wsReady = false;
      for (const pending of agentCreates.values()) { clearTimeout(pending.timer); pending.reject(new Error('Terminal backend disconnected')); }
      agentCreates.clear();
      sessionContextReady = false;
      workspaceContextReady = false;
      fileDropReady = false;
      for(const pending of fileDropRequests.values()) {clearTimeout(pending.timer);pending.reject(new Error('Terminal backend disconnected'));}
      fileDropRequests.clear();
      for(const pending of sessionContextRequests.values()) {clearTimeout(pending.timer);pending.reject(new Error('Terminal backend disconnected'));}
      sessionContextRequests.clear();
      setTimeout(connectWS, 2000);
    };

    ws.onerror = () => { ws.close(); };
  }

  function _extractOSC7Cwd(uint8Data) {
    // OSC 7: \x1b]7;file://hostname/path\x07  or  \x1b]7;file:///path\x07
    const str = new TextDecoder().decode(uint8Data);
    // Match the entire OSC 7 file:// URI
    const match = str.match(/\x1b\]7;(file:\/\/[^\x07\x1b]+)/);
    if (match) {
      try {
        let uri = match[1];
        let pathPart = uri.slice(7); // strip 'file://'
        // If pathPart doesn't start with /, it's file://hostname/path → remove hostname
        if (!pathPart.startsWith('/')) {
          const slashIdx = pathPart.indexOf('/');
          if (slashIdx !== -1) pathPart = pathPart.slice(slashIdx);
          else pathPart = '/' + pathPart;
        }
        return decodeURIComponent(pathPart);
      } catch { }
    }
    return null;
  }

  function _extractOSC7CwdStr(str) {
    // OSC 7: \x1b]7;file://hostname/path\x07  or  \x1b]7;file:///path\x07
    const match = str.match(/\x1b\]7;(file:\/\/[^\x07\x1b]+)/);
    if (match) {
      try {
        let pathPart = match[1].slice(7); // strip 'file://'
        // If pathPart doesn't start with /, it's file://hostname/path → remove hostname
        if (!pathPart.startsWith('/')) {
          const slashIdx = pathPart.indexOf('/');
          if (slashIdx !== -1) pathPart = pathPart.slice(slashIdx);
          else pathPart = '/' + pathPart;
        }
        return decodeURIComponent(pathPart);
      } catch { }
    }
    return null;
  }

  function _getFocusedCwd() {
    const t = activeTerminal();
    if (t && t.cwd) return t.cwd;
    // Fallback: find any terminal in the active workspace with a known cwd
    const wsp = activeWs();
    if (wsp) {
      for (const term of getWorkspaceTerminals(wsp)) {
        if (term.cwd) return term.cwd;
      }
    }
    return null;
  }

  function sendControl(obj) {
    // Auto-run tabs: type the startup command into the fresh shell, once.
    // ponytail: written as typeahead right after spawn; the tty buffers it until the shell reads.
    const entry = obj.type === 'create' ? findTermById(obj.id)?.term : null;
    const runCmd = entry && entry.runCmd;
    if (runCmd) delete entry.runCmd;
    const typeCmd = () => {
      if (entry) fitTerm(entry, true);
      if (runCmd) _sendStdinRaw(obj.id, new TextEncoder().encode(runCmd + '\r'));
    };
    if (isDesktop() && window.electronAPI && nativePtyReady) {
      const api = window.electronAPI;
      if (obj.type === 'create') api.terminalCreate({ id: obj.id, cols: obj.cols, rows: obj.rows, cwd: obj.cwd || null, inheritFromId: obj.inheritFromId }).then(typeCmd);
      else if (obj.type === 'resize') api.terminalResize({ id: obj.id, cols: obj.cols, rows: obj.rows });
      else if (obj.type === 'close') api.terminalClose(obj.id);
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      typeCmd();
    }
  }

  function _sendStdinRaw(sid, data) {
    if (isDesktop() && window.electronAPI && nativePtyReady) {
      window.electronAPI.terminalWrite({ id: sid, data });
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

  function sendStdin(sid, data) {
    const src = findTermById(sid);
    if (src && src.term.locked) return; // locked terminal: swallow all input
    // PTY dimensions must be current before Enter launches a full-screen app.
    if (src && (src.term._resizeTimeout || data.includes(13) || data.includes(10))) fitTerm(src.term, true);
    _sendStdinRaw(sid, data);
    // Mouse reports (SGR ESC[<…, X10 ESC[M…) and focus reports (ESC[I / ESC[O)
    // describe this pane only; mirrored into a shell they print as garbage.
    const paneLocal = data[0] === 27 && data[1] === 91 &&
      (data[2] === 60 || data[2] === 77 || (data.length === 3 && (data[2] === 73 || data[2] === 79)));
    if (_multiSelected.size > 1 && !paneLocal) {
      for (const otherId of _multiSelected) {
        if (otherId !== sid) {
          const other = findTermById(otherId);
          if (other && other.term.locked) continue; // never write into a locked pane
          if (other && (other.term._resizeTimeout || data.includes(13) || data.includes(10))) fitTerm(other.term, true);
          _sendStdinRaw(otherId, data);
        }
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   N A*TIVE PTY (Electron)
   ═══════════════════════════════════════════════════════════════ */
  function connectNativePTY() {
    // Electron: node-pty runs natively in the main process over IPC
    if (isDesktop() && window.electronAPI) {
      const api = window.electronAPI;
      wsReady = true;
      nativePtyReady = true;

      api.onTerminalData(({ id, data }) => {
        const result = findTermById(id);
        if (result) {
          const oscCwd = _extractOSC7CwdStr(data);
          if (oscCwd) result.term.cwd = oscCwd;
          result.term.term.write(data);
        }
      });
      api.onTerminalExit(({ id, code }) => handleExit(id, code));
      if (api.onTerminalFinished) api.onTerminalFinished(onTerminalFinished);
      if (api.onTerminalDetachedClosed) {
        api.onTerminalDetachedClosed(({ id }) => {
          const result = findTermById(id);
          if (result) {
            result.term = null;
            result.dead = false;
          }
          renderPaneArea();
          syncBrowserSlots();
        });
      }
      // A tab dragged out of a detached window and dropped over this window:
      // re-create the tab here attached to the same running PTY.
      if (api.onTerminalReattach) {
        api.onTerminalReattach(({ id, cols, rows, cwd, placement }) => {
          try { reattachTerminal(id, cols, rows, cwd, placement); } catch (e) { console.error('[reattach] failed:', e); }
        });
      }
      if (api.onTerminalReattachLayout) {
        api.onTerminalReattachLayout(({ layout, focusId }) => {
          try { reattachLayout(layout, focusId); } catch (e) { console.error('[reattach-layout] failed:', e); }
        });
      }
      // While such a tab is being dragged, highlight the tab bars as a drop target.
      if (api.onTabDragOver) {
        api.onTabDragOver(({ over }) => {
          document.querySelectorAll('.term-group-tabs.reattach-target').forEach(el => el.classList.remove('reattach-target'));
          if (over) document.querySelectorAll('.term-group-tabs').forEach(el => el.classList.add('reattach-target'));
        });
      }
      // The main process accepted a cross-window move for a tab living HERE —
      // snapshot its buffer, remove it without killing the PTY, and report
      // how many tabs remain so main can decide whether to close a window.
      if (api.onTabDragComplete) {
        api.onTabDragComplete(({ id }) => {
          window._tabMovedAway = window._tabMovedAway || new Set();
          window._tabMovedAway.add(id);
          let ready = { id, remaining: 0 };
          try {
            for (const wsp of workspaces) {
              const group = findGroupContainingTerm(wsp.layout, id);
              if (!group) continue;
              const entry = group.terminals.find(x => x.id === id);
              if (entry && entry.term) {
                const payload = serializeTermBuffer(entry);
                if (payload) localStorage.setItem(DETACH_BUFFER_KEY(id), JSON.stringify(payload));
                ready = { id, cols: entry.term.cols, rows: entry.term.rows, cwd: entry.cwd, label: entry.label, remaining: 0 };
              }
              removeTerminal(wsp.id, id, false, true);
              ready.remaining = getWorkspaceTerminals(wsp).length;
              break;
            }
          } catch { }
          if (api.tabDragReady) api.tabDragReady(ready);
        });
      }
      // The main process broadcasts which detached terminal is being dragged —
      // drag data set in another window's renderer is unreadable here, so this
      // id is how the main window recognizes the cross-window drop.
      if (api.onTabDragActive) {
        api.onTabDragActive(({ id }) => {
          if (id) {
            window.externalDragTermId = id;
            window.lastExternalDragTermId = id;
            startResizing(true);
            if (window._clearExternalDragTimer) {
              clearTimeout(window._clearExternalDragTimer);
              window._clearExternalDragTimer = null;
            }
          } else {
            window.externalDragTermId = null;
            // tab-drag:start broadcasts {id:null} to every window (incl. this one)
            // right after our own dragstart — don't tear down a local drag's shield.
            if (!window.draggedTermId) stopResizing();
            if (window._clearExternalDragTimer) clearTimeout(window._clearExternalDragTimer);
            window._clearExternalDragTimer = setTimeout(() => {
              window.lastExternalDragTermId = null;
            }, 1500);
          }
        });
      }

      restoreOrCreateInitial();
      return;
    }

    // Browser mode: fall back to the WebSocket PTY server
    restoreOrCreateInitial();
  }

  // Create initial workspace or restore pending terminals after the PTY backend is ready
  function restoreOrCreateInitial() {
    if (workspaces.length) {
      for (const wsp of workspaces) {
        const terms = getWorkspaceTerminals(wsp);
        for (const t of terms) {
          if (t.pending) {
            const slot = getSlotDimensions(t);
            sendControl({ type: 'create', id: t.id, cols: slot.cols, rows: slot.rows, cwd: t.cwd || null, argv: t.argv || [] });
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
      if (node.children.length === 1) {
        if (node.size) node.children[0].size = { ...node.size, ...node.children[0].size };
        return node.children[0];
      }
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
  function applyCornerStyle() {
    document.body.classList.add('roundless'); // sharp base; the design rounds selected components
  }

  function applySidebarMode() {
    document.body.classList.toggle('sb-hidden', sidebarMode === 'hidden');
    if (window.__sidebarCtl) window.__sidebarCtl.apply(sidebarMode);
  }

  function applyWsProcsSetting() {
    document.body.classList.toggle('no-ws-procs', !showWsProcs);
    if (showWsProcs) refreshAllWorkspaceProcs();
  }

  function applyAnimationsSetting() {
    document.body.classList.toggle('ui-animations', animationsEnabled);
    const toggle = document.getElementById('set-animations');
    if (toggle) toggle.checked = animationsEnabled;
    const rightSidebar = document.getElementById('sidebar-right');
    if (rightSidebar) rightSidebar.inert = document.body.classList.contains('sb-right-hidden');
    if (!animationsEnabled) document.querySelectorAll('.session-overlay.closing').forEach(el => el.remove());
  }

  function applyTheme(name) {
    applyAnimationsSetting();
    const sourceTheme = THEMES[name];
    if (!sourceTheme) return;
    const dark = resolvedDarkScheme();
    const theme = resolveAppearanceTheme(sourceTheme, dark);
    document.documentElement.dataset.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelectorAll('.scheme-choice').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.scheme === currentColorScheme)));
    currentThemeName = name;
    currentTheme = theme;

    applyCornerStyle();

    document.documentElement.style.setProperty('--app-font', currentFontFamily);

    const r = document.documentElement.style;
    document.querySelectorAll('.theme-choice').forEach(card => {
      card.setAttribute('aria-pressed', String(card.dataset.theme === name));
    });
    r.setProperty('--bg', theme.bg);
    r.setProperty('--fg', theme.fg);
    r.setProperty('--cursor', theme.cursor);
    r.setProperty('--selection', theme.selection);
    const accent = (theme.ui && theme.ui.accent) || theme.palette[4] || theme.palette[12] || theme.fg;
    r.setProperty('--accent', accent);
    r.setProperty('--ws-active-strip', accent);
    r.setProperty('--accent-dim', hexToRgba(accent, 0.15));
    try { localStorage.setItem('tv-boot-colors', JSON.stringify({ bg: theme.bg, fg: theme.fg, accent })); } catch { }
    const multiColor = (theme.ui && theme.ui.multiSelect) || theme.palette[3] || '#f9e2af';
    r.setProperty('--multi-select', multiColor);

    // UI overrides from custom theme
    const uiProps = ['border', 'tabActiveBg', 'tabHoverBg', 'dimText', 'mutedText', 'sidebarBg', 'surfaceBg', 'hoverBg', 'activeBg'];
    const uiCss = { border: '--border', tabActiveBg: '--tab-active-bg', tabHoverBg: '--tab-hover-bg', dimText: '--dim-text', mutedText: '--muted-text', sidebarBg: '--ui-sidebar', surfaceBg: '--ui-surface', hoverBg: '--ui-hover', activeBg: '--ui-active' };
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
        if (t.type !== 'browser') {
          t._bgTransparent = termHasBgImage(t);
          t.term.options.theme = makeXtermTheme(theme, t._bgTransparent);
        }
      }
    }

    renderThemeCards();
    renderSidebar();
    renderPaneArea();
    applyBackground();
    pluginEmit('theme:changed', { name });
  }

  /* transparentBg: when a background image is active behind the panel, xterm
     must not paint its own background — otherwise the renderer covers the
     image everywhere except the padding around the cell grid. The panel
     supplies the colour instead (see "Terminal Background Layers" in CSS). */
  function makeXtermTheme(theme, transparentBg) {
    const p = theme.palette;
    return {
      background: transparentBg ? '#00000000' : theme.bg,
      foreground: theme.fg,
      cursor: theme.cursor,
      cursorAccent: theme.bg,
      selectionBackground: theme.selection,
      black: p[0], red: p[1], green: p[2], yellow: p[3],
      blue: p[4], magenta: p[5], cyan: p[6], white: p[7],
      brightBlack: p[8], brightRed: p[9], brightGreen: p[10], brightYellow: p[11],
      brightBlue: p[12], brightMagenta: p[13], brightCyan: p[14], brightWhite: p[15],
    };
  }

  function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* ═══════════════════════════════════════════════════════════════
   B A*CKGROUND IMAGE & OPACITY
   ═══════════════════════════════════════════════════════════════ */
  /* The opacity slider is "terminal background opacity": 100% = fully solid
     terminal, 0% = image fully visible. The image layer therefore renders at
     the complement, on top of the solid theme colour that fills the panel. */
  function bgImageAlpha(wsp) {
    const opacity = (wsp && wsp.bgOpacity != null) ? wsp.bgOpacity : backgroundOpacity;
    return Math.max(0, Math.min(1, 1 - opacity));
  }

  function cssUrl(dataUrl) {
    return 'url("' + String(dataUrl).replace(/["\\]/g, '\\$&') + '")';
  }

  /* Is an image showing behind this terminal, in either mode? */
  function termHasBgImage(entry) {
    if (!entry || entry.type === 'browser') return false;
    if (backgroundMode === 'global') return !!globalBackgroundImage;
    if (backgroundMode === 'per-workspace') {
      const found = findTermById(entry.id);
      return found ? !!found.ws.bgImage : false;
    }
    if (backgroundMode === 'per-tab') return !!entry.bgImage;
    return false;
  }

  function applyBackground() {
    const paneArea = document.getElementById('pane-area');

    // Global mode: colour + image layers live on #pane-area so one image
    // spans every panel.
    if (paneArea) {
      const useGlobal = backgroundMode === 'global' && !!globalBackgroundImage;
      paneArea.classList.toggle('has-global-bg', useGlobal);
      paneArea.style.setProperty('--tv-bg-image', useGlobal ? cssUrl(globalBackgroundImage) : 'none');
      paneArea.style.setProperty('--tv-bg-image-opacity', useGlobal ? String(bgImageAlpha()) : '0');
      paneArea.style.backgroundImage = '';   // legacy inline image, layers handle it now
    }

    // Loop terminals to keep xterm transparency in sync with each mode.
    for (const wsp of workspaces) {
      // Per-workspace mode: one image spans the whole workspace container.
      const container = _wsDomCache ? _wsDomCache[wsp.id] : null;
      if (container) {
        const useWs = backgroundMode === 'per-workspace' && !!wsp.bgImage;
        container.classList.toggle('has-ws-bg', useWs);
        container.style.setProperty('--tv-bg-image', useWs ? cssUrl(wsp.bgImage) : 'none');
        container.style.setProperty('--tv-bg-image-opacity', useWs ? String(bgImageAlpha(wsp)) : '0');
      }

      const terms = getWorkspaceTerminals(wsp);
      for (const t of terms) {
        applyTermBgImage(t, wsp);
      }
    }
  }

  function applyTermBgImage(entry, wsp) {
    if (!entry || !entry.el) return;
    const slot = entry.el;

    // Browser tabs render their own opaque content — no background layer.
    let usePerTab = false;
    let bgImg = '';
    if (entry.type !== 'browser') {
      if (backgroundMode === 'per-tab' && entry.bgImage) {
        usePerTab = true;
        bgImg = entry.bgImage;
      } else if (backgroundMode === 'per-workspace') {
        // The image is painted once on the workspace container
        // (.ws-pane-container.has-ws-bg) so it spans the whole workspace.
        if (!wsp) {
          const found = findTermById(entry.id);
          if (found) wsp = found.ws;
        }
      }
    }

    slot.style.backgroundImage = '';   // legacy inline image, layers handle it now
    slot.classList.toggle('has-bg-image', usePerTab);
    slot.style.setProperty('--tv-bg-image', usePerTab ? cssUrl(bgImg) : 'none');
    slot.style.setProperty('--tv-bg-image-opacity', usePerTab ? String(bgImageAlpha(wsp)) : '0');

    // Let the panel's layers show through the cell grid when an image is up.
    if (entry.type !== 'browser' && entry.term) {
      const wantTransparent = termHasBgImage(entry);
      if (entry._bgTransparent !== wantTransparent) {
        entry._bgTransparent = wantTransparent;
        entry.term.options.theme = makeXtermTheme(currentTheme, wantTransparent);
      }
    }

    // Drop the properties used by the old .term-wrap overlay.
    const wrap = slot.querySelector('.term-wrap');
    if (wrap) {
      wrap.style.removeProperty('--term-bg-color');
      wrap.style.removeProperty('--term-bg-opacity');
    }
  }

  /* Imported backgrounds live as data URLs inside the saved state, so giant
     photos overflow the localStorage quota and silently skip persistence.
     Re-encode anything over the budget: cap the longest edge and keep the
     original only if re-encoding can't shrink it. GIFs are exempt — canvas
     re-encoding would flatten the animation. */
  const BG_IMG_BUDGET = 300 * 1024;
  const BG_IMG_MAX_EDGE = 1920;

  function optimizeBgImage(dataUrl, callback) {
    if (!dataUrl || dataUrl.length < BG_IMG_BUDGET || dataUrl.startsWith('data:image/gif')) {
      callback(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      let out = dataUrl;
      try {
        const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
        if (longEdge > 0) {
          const scale = Math.min(1, BG_IMG_MAX_EDGE / longEdge);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const re = canvas.toDataURL('image/webp', 0.85);
          if (re && re !== 'data:,' && re.length < out.length) out = re;
        }
      } catch { }
      callback(out);
    };
    img.onerror = () => callback(dataUrl);
    img.src = dataUrl;
  }

  function loadBgImageFromFile(file, callback) {
    if (!file) { callback(''); return; }
    const reader = new FileReader();
    reader.onload = (e) => optimizeBgImage(e.target.result, callback);
    reader.onerror = () => { callback(''); };
    reader.readAsDataURL(file);
  }

  /* Workspace icons are tiny thumbnails stored as data URLs in the saved
     state, so rasterize picks down to a small square. GIFs (animation) and
     SVGs (vector) pass through untouched. */
  const WS_ICON_SIZE = 64;

  function optimizeIconImage(dataUrl, callback) {
    if (!dataUrl || dataUrl.startsWith('data:image/gif') || dataUrl.startsWith('data:image/webp') || dataUrl.startsWith('data:image/svg')) {
      callback(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      let out = dataUrl;
      try {
        const scale = Math.min(1, WS_ICON_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        let re = canvas.toDataURL('image/webp', 0.9);
        if (!re || re === 'data:,' || re.length > out.length) re = canvas.toDataURL('image/png');
        if (re && re !== 'data:,' && re.length < out.length) out = re;
      } catch { }
      callback(out);
    };
    img.onerror = () => callback(dataUrl);
    img.src = dataUrl;
  }

  function setGlobalBackgroundImage(dataUrl) {
    globalBackgroundImage = dataUrl;
    applyBackground();
    saveState();
  }

  function setTermBackgroundImage(entry, dataUrl) {
    entry.bgImage = dataUrl || '';
    applyTermBgImage(entry);
    saveState();
  }

  /* ═══════════════════════════════════════════════════════════════
   S T*ATE PERSISTENCE
   ═══════════════════════════════════════════════════════════════ */
  // Per-profile suffix appended once the active profile is known (desktop only).
  let STATE_KEY = 'ghostterm-state-v2';
  // Per-window key: each detached window gets a unique winId from the main
  // process (electron/main.js terminal:detach), so multiple detached windows
  // never clobber each other's saved state and never restore stale workspaces
  // from a previous detached session.
  const DETACHED_WIN_ID = DETACHED_ONLY ? DETACHED_PARAMS.get('winId') : null;
  const DETACHED_STATE_KEY = 'ghostterm-state-detached-' + (DETACHED_WIN_ID || 'default');

  function serializeLayout(node) {
    if (!node) return null;
    if (node.type === 'split') {
      return {
        type: 'split',
        id: node.id,
        direction: node.direction,
        sizes: node.sizes,
        ...(node.size ? { size: node.size } : {}),
        children: node.children.map(serializeLayout)
      };
    }
    if (node.type === 'group') {
      return {
        type: 'group',
        id: node.id,
        activeTermId: node.activeTermId,
        ...(node.size ? { size: node.size } : {}),
        history: node._history || [],
        terminals: node.terminals.map(t => {
          const o = { id: t.id, label: t.label };
          if (t.color) o.color = t.color;
          if (t.type === 'browser') { o.type = 'browser'; o.url = t.url; }
          else if (t.cwd) o.cwd = t.cwd;
          if (t.bgImage) o.bgImage = t.bgImage;
          if (t.dead) o.dead = true;
          if (t.agentManaged) o.agentManaged = true;
          if (t.locked) o.locked = true;
          if (t.pinLabel) o.pinLabel = true;
          if (t.toolProvider) o.toolProvider = t.toolProvider;
          if (t.claudeSessionId) o.claudeSessionId = t.claudeSessionId;
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
        ...(data.size ? { size: data.size } : {}),
        children: data.children.map(c => deserializeLayout(c, ws))
      };
    }
    if (data.type === 'group') {
      const group = {
        type: 'group',
        id: data.id,
        activeTermId: data.activeTermId,
        ...(data.size ? { size: data.size } : {}),
        _history: data.history || [],
        terminals: []
      };
      for (const tData of data.terminals) {
        let entry;
        if (tData.type === 'browser') {
          entry = { id: tData.id, label: tData.label, type: 'browser', url: tData.url || 'about:blank', iframe: null, el: null, opened: false };
        } else {
          // A restored tab starts a fresh shell, not the previous foreground app.
          // Keep explicit names; automatic titles are rebuilt from the saved cwd
          // before rendering, without waiting for shell startup or PTY output.
          const label = tData.pinLabel || tData.argv ? tData.label : shortTitle(tData.cwd || 'Terminal');
          entry = _createTermEntry(ws, tData.id, label);
          entry.pending = true;
        }
        if (tData.color) entry.color = tData.color;
        if (tData.cwd) entry.cwd = tData.cwd;
        if (tData.argv) entry.argv = tData.argv;
        if (tData.cmd) entry.runCmd = tData.cmd; // auto-run launch only; never serialized
        if (tData.bgImage) entry.bgImage = tData.bgImage;
        if (tData.dead) entry.dead = true;
        if (tData.agentManaged) entry.agentManaged = true;
        if (tData.locked) entry.locked = true;
        if (tData.pinLabel) entry.pinLabel = true;
        if (tData.toolProvider) entry.toolProvider = tData.toolProvider;
        if (tData.claudeSessionId) entry.claudeSessionId = tData.claudeSessionId;
        group.terminals.push(entry);
      }
      return group;
    }
  }

  /* Backgrounds and workspace icons are persisted as real files in
     ~/.terminalvibe/images/ instead of base64 data URLs inside the saved
     state — data URLs blow up state.json/localStorage and overflow the quota.
     Each image gets a content-hashed filename so identical images dedupe and
     re-saving is a no-op. The saved state stores only a tiny { image: id }
     reference; restore swaps it back to a data URL by reading the file.
     Plain-browser mode has no filesystem, so it keeps data URLs as before. */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function isDataUrl(v) { return typeof v === 'string' && v.startsWith('data:'); }
  function isImgRef(v) { return v && typeof v === 'object' && typeof v.image === 'string'; }

  function imgRefId(dataUrl) {
    const m = /^data:([^;,]+)/.exec(dataUrl);
    const mime = (m && m[1]) ? m[1].toLowerCase() : '';
    let ext = 'img';
    if (mime === 'image/webp') ext = 'webp';
    else if (mime === 'image/png') ext = 'png';
    else if (mime === 'image/jpeg') ext = 'jpg';
    else if (mime === 'image/gif') ext = 'gif';
    else if (mime === 'image/svg+xml') ext = 'svg';
    else if (mime.startsWith('image/')) { const e = mime.slice(6).replace(/[^a-z0-9]/g, ''); if (e) ext = e; }
    return fnv1a(dataUrl) + '.' + ext;
  }

  // Swaps every image data URL in a state object for an { image: id } ref and
  // returns the { id, dataUrl } list needed to materialize the files. Ids
  // already written this session are sent bare (no dataUrl) to keep the IPC
  // payload tiny — the main process skips them once the file exists.
  const _writtenImgIds = new Set();
  function collectStateImages(state) {
    const images = [];
    const add = (dataUrl) => {
      if (!isDataUrl(dataUrl)) return null;
      const id = imgRefId(dataUrl);
      if (_writtenImgIds.has(id)) images.push({ id });
      else { _writtenImgIds.add(id); images.push({ id, dataUrl }); }
      return id;
    };
    // Register an existing ref so the main process never garbage-collects the
    // files behind it (a settings-only window persists refs it didn't create).
    const keepRef = (ref) => { if (isImgRef(ref)) images.push({ id: ref.image }); };
    const walkLayout = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.terminals)) {
        for (const t of node.terminals) {
          if (!t) continue;
          if (isDataUrl(t.bgImage)) t.bgImage = { image: add(t.bgImage) };
          else keepRef(t.bgImage);
        }
      }
      if (Array.isArray(node.children)) for (const c of node.children) walkLayout(c);
    };
    if (isDataUrl(state.globalBackgroundImage)) state.globalBackgroundImage = { image: add(state.globalBackgroundImage) };
    else keepRef(state.globalBackgroundImage);
    if (Array.isArray(state.workspaces)) {
      for (const ws of state.workspaces) {
        if (!ws) continue;
        if (isDataUrl(ws.icon)) ws.icon = { image: add(ws.icon) };
        else keepRef(ws.icon);
        if (isDataUrl(ws.bgImage)) ws.bgImage = { image: add(ws.bgImage) };
        else keepRef(ws.bgImage);
        if (ws.layout) walkLayout(ws.layout);
      }
    }
    return images;
  }

  // Reverse of collectStateImages: swap { image: id } refs back to data URLs
  // by reading the image files through the main process.
  async function resolveStateImages(state) {
    if (!state || typeof state !== 'object') return;
    const api = configApi();
    if (!api || !api.configReadImage) return;
    const resolve = async (ref) => {
      if (!isImgRef(ref)) return ref;
      const dataUrl = await api.configReadImage(ref.image);
      return dataUrl || '';
    };
    const walkLayout = async (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.terminals)) {
        for (const t of node.terminals) { if (t && isImgRef(t.bgImage)) t.bgImage = await resolve(t.bgImage); }
      }
      if (Array.isArray(node.children)) for (const c of node.children) await walkLayout(c);
    };
    if (isImgRef(state.globalBackgroundImage)) state.globalBackgroundImage = await resolve(state.globalBackgroundImage);
    if (Array.isArray(state.workspaces)) {
      for (const ws of state.workspaces) {
        if (!ws) continue;
        if (isImgRef(ws.icon)) ws.icon = await resolve(ws.icon);
        if (isImgRef(ws.bgImage)) ws.bgImage = await resolve(ws.bgImage);
        if (ws.layout) await walkLayout(ws.layout);
      }
    }
  }

  // Writes image files first (so refs never dangle), then the state itself to
  // disk and localStorage. On desktop the state holds { image: id } refs;
  // plain-browser mode falls back to base64 data URLs in localStorage.
  function persistStateToStorage(state, key) {
    const api = configApi();
    const images = (api && api.configWriteImages) ? collectStateImages(state) : [];
    // Resolves once the disk write is confirmed so callers that switch profiles
    // (or reload) right after saving can await it — otherwise the write is
    // routed by _activeProfileId and a deferred commit lands on the NEW profile.
    const commit = () => {
      const write = (!DETACHED_ONLY && api && api.configWriteState)
        ? api.configWriteState(state)
        : Promise.resolve();
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch (err) {
        console.warn('[state] localStorage write failed (disk copy saved):', err);
      }
      return write;
    };
    if (images.length) return api.configWriteImages(images).then(commit).catch(commit);
    return commit();
  }

  function saveState() {
    // During an in-place profile switch the old profile's final state was
    // already persisted before teardown; suppress any mid-teardown save so the
    // half-torn-down (emptying) state never overwrites it.
    if (_profileSwitching) return;
    // In the settings window we must NOT clobber the main window's live
    // workspaces/folders/sideOrder. Only merge the settings fields into the
    // shared state and ping the main window to re-apply them.
    if (SETTINGS_ONLY) {
      const settings = {
        theme: currentThemeName,
        colorScheme: currentColorScheme,
        fontSize: currentFontSize,
        fontFamily: currentFontFamily,
        customFonts,
        lineHeight: currentLineHeight,
        cursorStyle: currentCursorStyle,
        cursorBlink: currentCursorBlink,
        scrollback: currentScrollback,
        animationsEnabled,
        settingsCategory,
        pinnedCollapsed,
        sidebarMode,
        showWsProcs,
        notifyOnCommandFinish,
        notificationSound,
        terminalLinkTarget,
        backgroundMode,
        globalBackgroundImage,
        backgroundOpacity,
        shortcuts: customShortcuts,
        searchEngine,
        customSearchUrl,
        defaultTerminalPath,
        pluginStates: Object.fromEntries(_pluginStates),
        pluginConfigs: Object.fromEntries(_pluginConfigs),
      };
      // Disk state is what restoreState prefers — write it even when the
      // localStorage copy overflows the quota.
      let merged = settings;
      try {
        merged = Object.assign(JSON.parse(localStorage.getItem(STATE_KEY) || '{}'), settings);
      } catch { }
      return persistStateToStorage(merged, STATE_KEY).then(() => {
        // The main window reads disk state on this event. Notify only after
        // image/state writes finish, or it can restore the old setting.
        window.electronAPI?.settingsChanged?.();
      });
    }


    syncBrowserShortcuts();
    const key = DETACHED_ONLY ? DETACHED_STATE_KEY : STATE_KEY;
    const state = {
      theme: currentThemeName,
      colorScheme: currentColorScheme,
      fontSize: currentFontSize,
      fontFamily: currentFontFamily,
      customFonts,
      lineHeight: currentLineHeight,
      cursorStyle: currentCursorStyle,
      cursorBlink: currentCursorBlink,
      scrollback: currentScrollback,
      animationsEnabled,
      settingsCategory,
      pinnedCollapsed,
      sidebarMode,
      showWsProcs,
      notifyOnCommandFinish,
      notificationSound,
      terminalLinkTarget,
      backgroundMode,
      globalBackgroundImage,
      backgroundOpacity,
      searchEngine,
      customSearchUrl,
      defaultTerminalPath,
      sidebarExpanded: document.getElementById('sidebar').classList.contains('expanded'),
      sidebarWidth: document.getElementById('sidebar').offsetWidth || null,
      shortcuts: customShortcuts,
      pluginStates: Object.fromEntries(_pluginStates),
      pluginConfigs: Object.fromEntries(_pluginConfigs),
      activeWsId,
      folders: folders.map(f => {
        const o = { id: f.id, label: f.label, collapsed: f.collapsed };
        if (f.color) o.color = f.color;
        if (f.pinned) o.pinned = true;
        return o;
      }),
      sideOrder: sideOrder.map(e => ({ t: e.type, id: e.id })),
      workspaces: workspaces.map(ws => {
        const o = { id: ws.id, label: ws.label, activeTermId: ws.activeTermId, layout: serializeLayout(ws.layout) };
        if (ws.color) o.color = ws.color;
        if (ws.icon) o.icon = ws.icon;
        if (ws.folderId) o.folderId = ws.folderId;
        if (ws.pinned) o.pinned = true;
        if (ws.bgImage) o.bgImage = ws.bgImage;
        if (ws.bgOpacity != null) o.bgOpacity = ws.bgOpacity;
        return o;
      }),
    };
    return persistStateToStorage(state, key);
  }

  async function restoreState() {
    try {
      const key = DETACHED_ONLY ? DETACHED_STATE_KEY : STATE_KEY;
      let raw = null;
      if (!DETACHED_ONLY) {
        const api = configApi();
        if (api && api.configReadState) {
          const diskState = await api.configReadState();
          if (diskState) raw = JSON.stringify(diskState);
        }
      }
      if (!raw) raw = localStorage.getItem(key);
      if (!raw) return false;
      const state = JSON.parse(raw);
      await resolveStateImages(state);

      if (['system', 'light', 'dark'].includes(state.colorScheme)) currentColorScheme = state.colorScheme;
      if (state.theme && THEMES[state.theme]) {
        currentThemeName = state.theme;
        currentTheme = resolveAppearanceTheme(THEMES[currentThemeName], resolvedDarkScheme());
      }

      if (state.fontSize) currentFontSize = state.fontSize;
      if (state.fontFamily) currentFontFamily = state.fontFamily;
      if (state.customFonts) {
        customFonts = {};
        for (const [k, v] of Object.entries(state.customFonts)) {
          if (v && v.dataUrl) customFonts[k] = { name: v.name || k, dataUrl: v.dataUrl, format: v.format || 'truetype' };
        }
        injectCustomFonts();
      }
      if (state.lineHeight) currentLineHeight = state.lineHeight;
      if (state.cursorStyle) currentCursorStyle = state.cursorStyle;
      if (state.cursorBlink !== undefined) currentCursorBlink = state.cursorBlink;
      if (state.scrollback) currentScrollback = state.scrollback;
      animationsEnabled = state.animationsEnabled !== false;
      applyAnimationsSetting();
      if (typeof state.settingsCategory === 'string') settingsCategory = state.settingsCategory;
      if (state.pinnedCollapsed !== undefined) pinnedCollapsed = !!state.pinnedCollapsed;
      if (state.sidebarMode) sidebarMode = state.sidebarMode;
      if (state.showWsProcs !== undefined) showWsProcs = !!state.showWsProcs;
      if (state.notifyOnCommandFinish !== undefined) notifyOnCommandFinish = !!state.notifyOnCommandFinish;
      if (state.notificationSound !== undefined) notificationSound = !!state.notificationSound;
      if (['tab', 'external'].includes(state.terminalLinkTarget)) terminalLinkTarget = state.terminalLinkTarget;
      if (state.backgroundMode) backgroundMode = state.backgroundMode;
      if (state.globalBackgroundImage) globalBackgroundImage = state.globalBackgroundImage;
      if (state.backgroundOpacity !== undefined) backgroundOpacity = state.backgroundOpacity;
      if (state.searchEngine) searchEngine = state.searchEngine;
      if (state.customSearchUrl) customSearchUrl = state.customSearchUrl;
      if (state.defaultTerminalPath !== undefined) defaultTerminalPath = state.defaultTerminalPath;
      if (state.shortcuts) {
        for (const [k, v] of Object.entries(state.shortcuts)) {
          if (customShortcuts[k]) customShortcuts[k] = v;
        }
        // Seed any new defaults not in saved state (e.g. tabSearch added later)
        for (const k of Object.keys(DEFAULT_SHORTCUTS)) {
          if (!(k in customShortcuts)) customShortcuts[k] = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS[k]));
        }
        syncBrowserShortcuts();
      }
      if (state.pluginStates) {
        for (const [k, v] of Object.entries(state.pluginStates)) _pluginStates.set(k, !!v);
      }
      if (state.pluginConfigs) {
        for (const [k, v] of Object.entries(state.pluginConfigs)) {
          if (v && typeof v === 'object') _pluginConfigs.set(k, Object.assign({}, v));
        }
      }

      if (!state.workspaces?.length) return false;
      if (typeof state.sidebarExpanded === 'boolean') document.getElementById('sidebar').classList.toggle('expanded', state.sidebarExpanded);
      if (state.sidebarWidth) {
        savedSidebarWidth = Math.max(state.sidebarWidth, SB_EXPANDED_MIN);
        if (state.sidebarExpanded && sidebarSplit) {
          const containerW = document.getElementById('app').offsetWidth;
          const pct = Math.max(5, (savedSidebarWidth / containerW) * 100);
          sidebarSplit.setSizes([pct, 100 - pct]);
        }
      }

      if (state.folders) {
        for (const fData of state.folders) {
          const f = { id: fData.id, label: fData.label || 'Folder', collapsed: !!fData.collapsed };
          if (fData.color) f.color = fData.color;
          if (fData.pinned) f.pinned = true;
          folders.push(f);
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
        if (wsData.icon) ws.icon = wsData.icon;
        if (wsData.folderId) ws.folderId = wsData.folderId;
        if (wsData.pinned) ws.pinned = true;
        if (wsData.bgImage) ws.bgImage = wsData.bgImage;
        if (wsData.bgOpacity != null) ws.bgOpacity = wsData.bgOpacity;

        ws.layout = deserializeLayout(wsData.layout, ws);
        workspaces.push(ws);
        wsCount++;
      }
      normalizeOrder();

      if (Array.isArray(state.sideOrder)) {
        for (const e of state.sideOrder) sideOrder.push({ type: e.t || e.type, id: e.id });
        sanitizeSideOrder();
      } else {
        rebuildSideOrder();
      }

      activeWsId = state.activeWsId || workspaces[0]?.id;
      return true;
    } catch { return false; }
  }

  /* ═══════════════════════════════════════════════════════════════
   P R*OFILES
   Each profile owns its own full state (settings + workspaces). On desktop
   the main process routes config:readState/writeState to the active
   profile's file; here we only namespace the localStorage mirror and draw
   the boot-time picker.
   ═══════════════════════════════════════════════════════════════ */
  let _activeProfile = null; // { id, name, avatar } | null
  let _profileSwitching = false; // suppress beforeunload save during a profile switch
  let ppNavHandler = null; // single live keydown handler for the profile picker

  // Browser profiles use the same picker and namespaced state as desktop,
  // without exposing an Electron bridge to the rest of the app.
  const BROWSER_PROFILES_KEY = 'terminalvibe.browserProfiles';
  function readBrowserProfiles() {
    const raw = localStorage.getItem(BROWSER_PROFILES_KEY);
    if (raw) return JSON.parse(raw);
    const meta = {
      profiles: [{ id: 'default', name: 'Default', avatar: '' }],
      active: 'default', default: 'default',
    };
    const legacy = localStorage.getItem('ghostterm-state-v2');
    if (legacy && !localStorage.getItem('ghostterm-state-v2:default')) {
      localStorage.setItem('ghostterm-state-v2:default', legacy);
    }
    return writeBrowserProfiles(meta);
  }
  function writeBrowserProfiles(meta) {
    localStorage.setItem(BROWSER_PROFILES_KEY, JSON.stringify(meta));
    return meta;
  }
  async function switchBrowserProfile(id) {
    const meta = readBrowserProfiles();
    if (!meta.profiles.some(p => p.id === id)) return false;
    meta.active = id;
    writeBrowserProfiles(meta);
    return true;
  }
  const browserProfilesApi = {
    profilesList: async () => readBrowserProfiles(),
    profilesCreate: async ({ name, avatar }) => {
      const meta = readBrowserProfiles();
      meta.profiles.push({ id: uuid(), name: String(name || 'Profile').slice(0, 40), avatar: avatar || '' });
      return writeBrowserProfiles(meta);
    },
    profilesUpdate: async ({ id, name, avatar }) => {
      const meta = readBrowserProfiles();
      const p = meta.profiles.find(p => p.id === id);
      if (p && name !== undefined) p.name = String(name).slice(0, 40);
      if (p && avatar !== undefined) p.avatar = avatar;
      return writeBrowserProfiles(meta);
    },
    profilesDelete: async id => {
      const meta = readBrowserProfiles();
      if (meta.profiles.length <= 1) return meta;
      meta.profiles = meta.profiles.filter(p => p.id !== id);
      if (meta.active === id) meta.active = meta.profiles[0].id;
      if (meta.default === id) meta.default = meta.profiles[0].id;
      writeBrowserProfiles(meta);
      localStorage.removeItem('ghostterm-state-v2:' + id);
      return meta;
    },
    profilesSetDefault: async id => {
      const meta = readBrowserProfiles();
      if (meta.profiles.some(p => p.id === id)) meta.default = id;
      return writeBrowserProfiles(meta);
    },
    profilesSwitch: switchBrowserProfile,
    profilesSwitchInPlace: switchBrowserProfile,
  };
  function profilesApi() { return configApi() || browserProfilesApi; }

  // Namespaces every localStorage key used by state persistence so profiles
  // never collide in plain-browser mode either.
  function applyProfileKey(p) {
    _activeProfile = p;
    if (p) STATE_KEY = 'ghostterm-state-v2:' + p.id;
  }

  async function initActiveProfile() {
    const api = profilesApi();
    if (!api || !api.profilesList) return null;
    try {
      const meta = await api.profilesList();
      const p = meta.profiles.find(x => x.id === meta.active) || null;
      applyProfileKey(p);
      return { meta, current: p };
    } catch { return null; }
  }

  function editProfile(p) {
    showPrompt('Edit profile', p.name, { icon: p.avatar || '' }, async (name, _color, avatar) => {
      if (!name) return;
      const api = profilesApi();
      if (!api || !api.profilesUpdate) return;
      const meta = await api.profilesUpdate({ id: p.id, name, avatar });
      const updated = meta.profiles.find(x => x.id === p.id);
      if (updated) _activeProfile = updated;
      // Re-render the picker if still open, otherwise just stay on this profile
      const wrap = document.getElementById('profile-picker');
      if (wrap && wrap.style.display !== 'none') {
        renderProfilePicker(meta, _activeProfile, (np) => { confirmProfileSwitch(np); });
      }
    });
  }

  function deleteProfile(p) {
    showConfirm(`Delete profile "${p.name}"?`, async () => {
      const api = profilesApi();
      if (!api || !api.profilesDelete) return;
      const meta = await api.profilesDelete(p.id);
      // Deleting the active profile moved the active pointer server-side; a
      // reload picks up the new active profile and fresh state. Otherwise
      // just re-render the grid.
      if (_activeProfile && _activeProfile.id === p.id) { _profileSwitching = true; location.reload(); return; }
      renderProfilePicker(meta, _activeProfile, (np) => { confirmProfileSwitch(np); });
    });
  }

  function setDefaultProfile(p) {
    const api = profilesApi();
    if (!api || !api.profilesSetDefault) return;
    api.profilesSetDefault(p.id).then(meta => {
      const wrap = document.getElementById('profile-picker');
      if (wrap && wrap.style.display !== 'none') renderProfilePicker(meta, _activeProfile, (np) => { confirmProfileSwitch(np); });
    });
  }

  function renderProfilePicker(meta, current, onPick) {
    const wrap = document.getElementById('profile-picker');
    const grid = document.getElementById('pp-grid');
    if (!wrap || !grid) return;
    grid.innerHTML = '';
    for (const p of meta.profiles) {
      const box = document.createElement('div');
      box.className = 'pp-box' + (current && p.id === current.id ? ' current' : '');
      box.tabIndex = -1; // keyboard-focusable so arrows land on a box when the picker opens
      if (p.avatar) {
        const img = document.createElement('img');
        img.src = p.avatar; img.alt = ''; img.draggable = false;
        box.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'pp-avatar-ph';
        ph.innerHTML = '<i class="ph ph-user"></i>';
        box.appendChild(ph);
      }
      const name = document.createElement('div');
      name.className = 'pp-name';
      name.textContent = p.name;
      box.appendChild(name);
      if (p.id === meta.default) {
        const badge = document.createElement('div');
        badge.className = 'pp-badge';
        badge.title = 'Default profile';
        badge.textContent = 'Default';
        box.appendChild(badge);
      }
      const menu = document.createElement('div');
      menu.className = 'pp-edit';
      menu.title = 'Profile options';
      menu.innerHTML = '<i class="ph ph-dots-three-vertical"></i>';
      menu.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ctxEl.classList.contains('open') && ctxEl._ppKebab) { hideCtxMenu(); return; }
        const r = menu.getBoundingClientRect();
        showCtxMenu({ pageX: r.left + r.width, pageY: r.bottom + 4 }, 'profile', { p, defaultId: meta.default });
        ctxEl._ppKebab = true; // remember this open came from a kebab so it can toggle-close
        // Open leftward, right-aligned to the kebab's right edge
        ctxEl.style.left = Math.max(0, r.right - ctxEl.offsetWidth - 4) + 'px';
      });
      box.appendChild(menu);
      box.addEventListener('click', () => { wrap.inert = true; wrap.style.display = 'none'; onPick(p); });
      box.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showCtxMenu(e, 'profile', { p, defaultId: meta.default });
      });
      grid.appendChild(box);
    }
    // New-profile box
    const add = document.createElement('div');
    add.className = 'pp-box pp-add';
    add.tabIndex = -1;
    add.innerHTML = '<div class="pp-avatar-ph"><i class="ph ph-plus"></i></div><div class="pp-name">New profile</div>';
    add.addEventListener('click', () => {
      showPrompt('Profile name', '', { icon: '' }, async (name, _color, avatar) => {
        if (!name) return;
        const meta = await profilesApi().profilesCreate({ name, avatar });
        const created = meta.profiles[meta.profiles.length - 1];
        wrap.inert = true; wrap.style.display = 'none';
        confirmProfileSwitch(created);
      });
    });
    grid.appendChild(add);
    wrap.inert = false; wrap.style.display = '';
    // Keyboard navigation: arrows move a selection highlight, Enter/Space picks.
    const boxes = [...grid.querySelectorAll('.pp-box')];
    let sel = Math.max(0, boxes.findIndex(b => b.classList.contains('current')));

    function paint() {
      boxes.forEach((b, i) => b.classList.toggle('sel', i === sel));
      boxes[sel] && boxes[sel].scrollIntoView({ block: 'nearest' });
      boxes[sel] && boxes[sel].focus({ preventScroll: true }); // focus follows the selection
    }
    const cols = () => Math.max(1, Math.floor((grid.clientWidth + 20) / 160));
    const nav = (e) => {
      if (!wrap || wrap.style.display === 'none') { document.removeEventListener('keydown', nav); return; }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft' || e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const step = (e.code === 'ArrowRight' || e.code === 'ArrowLeft') ? 1 : cols();
        const dir = (e.code === 'ArrowRight' || e.code === 'ArrowDown') ? 1 : -1;
        sel = (sel + dir * step + boxes.length) % boxes.length;
        paint();
      } else if (e.code === 'Enter' || e.code === ' ') {
        e.preventDefault(); e.stopPropagation();
        boxes[sel] && boxes[sel].click();
      }
    };
    if (ppNavHandler) document.removeEventListener('keydown', ppNavHandler);
    ppNavHandler = nav; // single live listener; re-renders must not stack duplicates
    document.addEventListener('keydown', nav);
    paint();
  }

  // Boot gate: >1 profile → always show the picker and wait for a choice.
  // Single profile (or legacy state.json) auto-activates with no UI.
  async function profileGate() {
    await document.fonts.load('14px "Geist Mono"');
    const res = await initActiveProfile();
    if (!res) return; // profile storage unavailable
    const { meta, current } = res;
    // Auto-open the active profile at boot — no picker. If none is active yet,
    // fall back to the first (default) profile. Switching only happens via the
    // titlebar picker from here on.
    if (!current) {
      const target = meta.profiles.find(x => x.id === meta.default) || meta.profiles[0];
      if (!target) return;
      applyProfileKey(target);
      await profilesApi().profilesSwitch(target.id);
    }
  }

  // Destroy every workspace/terminal/browser view in place and reset global
  // state so restoreState() can rebuild from the next profile's state. Reuses
  // _removeWorkspace, which closes ptys, disposes xterm instances, destroys
  // browser WebContentsViews (browserDestroy) and drops _wsDomCache entries.
  function teardownAllWorkspaces() {
    const ids = workspaces.map(w => w.id);
    for (const id of ids) { try { _removeWorkspace(id); } catch (e) { console.error('teardown ws', id, e); } }
    workspaces = []; folders = []; sideOrder = []; activeWsId = null; _wsDomCache = {};
    _pluginStates.clear(); _pluginConfigs.clear(); // restoreState only adds keys; drop stale ones
  }

  function apiProfilesSwitch(p) {
    applyProfileKey(p);
    _profileSwitching = true; // block any accidental saveState flush mid-transition
    // Cover the old profile synchronously so it doesn't flash during the swap.
    const splash = document.getElementById('splash');
    if (splash) { splash.style.transition = 'none'; splash.classList.remove('hide'); }
    teardownAllWorkspaces();
    return profilesApi().profilesSwitchInPlace(p.id).then(async ok => {
      try {
        if (ok) {
          // Custom themes + plugins are global (already loaded at boot) — do NOT
          // re-fetch them here; that async IPC round-trip was the switch bottleneck.
          await restoreState();          // per-profile state (settings + workspaces)
          applyTheme(currentThemeName);  // builds the pane DOM (renderPaneArea) + sidebar
          applySidebarMode();
          applyWsProcsSetting();
          restoreOrCreateInitial();      // spawn PTYs into the now-existing DOM
          // Plugin enabled-state is per-profile; non-blocking, after the splash.
          syncPlugins();
        }
      } finally {
        // Always release the transition lock + hide the splash, even if the
        // target profile has no state or restore throws — never strand the app.
        _profileSwitching = false;
        if (splash) splash.classList.add('hide');
      }
    }).catch(() => {
      _profileSwitching = false;
      if (splash) splash.classList.add('hide');
    });
  }

  function openProfilePicker() {
    const api = profilesApi();
    if (!api || !api.profilesList) return;
    api.profilesList().then(meta => {
      renderProfilePicker(meta, _activeProfile, (p) => {
        confirmProfileSwitch(p);
      });
    });
  }

  // Escape closes the profile picker, staying on the current profile
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    const wrap = document.getElementById('profile-picker');
    if (wrap && wrap.style.display !== 'none') {
      wrap.inert = true; wrap.style.display = 'none';
      e.stopPropagation();
    }
  });

  /* ═══════════════════════════════════════════════════════════════
   W O*RKSPACE MANAGEMENT
   ═══════════════════════════════════════════════════════════════ */
  let wsCount = 0;

  function createWorkspace(label, folderId, details) {
    wsCount++;
    const id = uuid();
    const ws = { id, label: label || ('Workspace ' + (workspaces.length + 1)), layout: null, activeTermId: null, folderId: folderId || undefined };
    if (details && details.color) ws.color = details.color;
    if (details && details.icon) ws.icon = details.icon;
    workspaces.push(ws);
    if (!folderId) sideOrder.push({ type: 'ws', id });
    else rebuildWorkspaces();
    activateWorkspace(id);
    addTerminal(id);
    return ws;
  }

  /* ── Folder helpers ──
     Workspaces stay in a flat array; the top-level sidebar flow (which interleaves
     root workspaces and folders) is kept in `sideOrder`. Folder children remain a
     contiguous run inside `workspaces`, in the order they appear per folder. */
  function getGroupList(folderKey) {
    return workspaces.filter(w => (w.folderId || null) === (folderKey || null));
  }

  function normalizeOrder() {
    const valid = new Set(folders.map(f => f.id));
    const root = [];
    const byFolder = new Map();
    for (const ws of workspaces) {
      if (!ws.folderId || !valid.has(ws.folderId)) {
        ws.folderId = null;
        root.push(ws);
      } else {
        if (!byFolder.has(ws.folderId)) byFolder.set(ws.folderId, []);
        byFolder.get(ws.folderId).push(ws);
      }
    }
    workspaces = root;
    for (const f of folders) workspaces.push(...(byFolder.get(f.id) || []));
  }

  // Default top-level order: every root workspace first, then folders.
  function rebuildSideOrder() {
    sideOrder = [];
    for (const ws of getGroupList(null)) sideOrder.push({ type: 'ws', id: ws.id });
    for (const f of folders) sideOrder.push({ type: 'folder', id: f.id });
  }

  // Validate sideOrder against current workspaces/folders and append anything missing.
  function sanitizeSideOrder() {
    const validWs = new Set(workspaces.filter(w => !w.folderId).map(w => w.id));
    const validFolder = new Set(folders.map(f => f.id));
    const seenWs = new Set();
    const seenFolder = new Set();
    const clean = [];
    for (const e of sideOrder) {
      if (e.type === 'ws' && validWs.has(e.id) && !seenWs.has(e.id)) { clean.push(e); seenWs.add(e.id); }
      else if (e.type === 'folder' && validFolder.has(e.id) && !seenFolder.has(e.id)) { clean.push(e); seenFolder.add(e.id); }
    }
    for (const id of validWs) if (!seenWs.has(id)) clean.push({ type: 'ws', id });
    for (const id of validFolder) if (!seenFolder.has(id)) clean.push({ type: 'folder', id });
    sideOrder = clean;
  }

  // Rebuild the flat `workspaces` array honoring sideOrder: root workspaces in their
  // sideOrder sequence first, then one contiguous run per folder.
  function rebuildWorkspaces() {
    const root = [];
    for (const e of sideOrder) {
      if (e.type === 'ws') { const ws = findWs(e.id); if (ws && !ws.folderId) root.push(ws); }
    }
    const rest = [];
    for (const f of folders) rest.push(...getGroupList(f.id));
    workspaces = [...root, ...rest];
  }

  // sideOrder slot for making a ws the `li`-th root item (or appended if out of range)
  function rootSlotForLocal(li) {
    const wsIdxs = [];
    sideOrder.forEach((e, i) => { if (e.type === 'ws') wsIdxs.push(i); });
    if (!wsIdxs.length) return 0;
    if (li >= wsIdxs.length) return wsIdxs[wsIdxs.length - 1] + 1;
    return wsIdxs[Math.max(0, li)];
  }

  // Move a top-level item (root workspace or folder) to a specific sideOrder slot.
  function moveTopLevelItem(type, id, slot) {
    let from = sideOrder.findIndex(e => e.type === type && e.id === id);
    let entry = null;
    if (from !== -1) {
      [entry] = sideOrder.splice(from, 1);
    }
    let to = slot;
    if (from !== -1 && from < to) to--;
    to = Math.max(0, Math.min(to, sideOrder.length));
    if (!entry) entry = { type, id };
    sideOrder.splice(to, 0, entry);
    if (type === 'ws') {
      const ws = findWs(id);
      if (ws) ws.folderId = undefined;
    }
    rebuildWorkspaces();
    renderSidebar();
    saveState();
  }

  function moveWsTo(wsId, folderKey, localIndex) {
    const ws = findWs(wsId);
    if (!ws) return;
    const newKey = folderKey || null;
    if (newKey === null) {
      // Move to the top level; `localIndex` is an index within the root list.
      const li = localIndex === undefined ? getGroupList(null).length : localIndex;
      moveTopLevelItem('ws', wsId, rootSlotForLocal(li));
      return;
    }
    const from = workspaces.indexOf(ws);
    if (from !== -1) workspaces.splice(from, 1);
    ws.folderId = newKey;

    // A root workspace entering a folder must leave the top-level flow
    const soIdx = sideOrder.findIndex(e => e.type === 'ws' && e.id === wsId);
    if (soIdx !== -1) sideOrder.splice(soIdx, 1);

    // Indices (in the post-removal array) of items already in the target folder
    const groupItems = [];
    for (let i = 0; i < workspaces.length; i++) {
      if ((workspaces[i].folderId || null) === newKey) groupItems.push(i);
    }

    let idx;
    if (groupItems.length) {
      const li = Math.max(0, Math.min(localIndex === undefined ? groupItems.length : localIndex, groupItems.length));
      idx = li < groupItems.length ? groupItems[li] : groupItems[groupItems.length - 1] + 1;
    } else {
      // Empty folder: append after the current root run
      let insertAt = 0;
      for (let i = 0; i < workspaces.length; i++) {
        if (!workspaces[i].folderId) insertAt = i + 1;
      }
      idx = insertAt;
    }

    workspaces.splice(idx, 0, ws);
    renderSidebar();
    saveState();
  }

  function createFolder(label, color) {
    const id = uuid();
    const f = { id, label: label || ('Folder ' + (folders.length + 1)) };
    if (color) f.color = color;
    folders.push(f);
    sideOrder.push({ type: 'folder', id });
    renderSidebar();
    saveState();
    return f;
  }

  function renameFolder(id) {
    const f = folders.find(x => x.id === id);
    if (!f) return;
    showPrompt('Edit folder', f.label, { color: f.color || '' }, (value, color) => {
      f.label = value.trim() || f.label;
      f.color = color || undefined;
      renderSidebar();
      saveState();
    });
  }

  function removeFolder(id) {
    const f = folders.find(x => x.id === id);
    if (!f) return;
    const inFolder = getGroupList(id).length;
    const msg = inFolder > 0
      ? `Remove folder "${f.label}"? Its ${inFolder} workspace${inFolder > 1 ? 's' : ''} will move to the top level.`
      : `Remove folder "${f.label}"?`;
    showConfirm(msg, () => {
      const children = getGroupList(id);
      const entryIdx = sideOrder.findIndex(e => e.type === 'folder' && e.id === id);
      if (entryIdx !== -1) {
        sideOrder.splice(entryIdx, 1, ...children.map(w => ({ type: 'ws', id: w.id })));
      } else {
        for (const w of children) sideOrder.push({ type: 'ws', id: w.id });
      }
      folders = folders.filter(x => x.id !== id);
      for (const ws of workspaces) { if (ws.folderId === id) ws.folderId = null; }
      normalizeOrder();
      renderSidebar();
      saveState();
    });
  }

  function toggleFolderCollapsed(id) {
    const f = folders.find(x => x.id === id);
    if (!f) return;
    f.collapsed = !f.collapsed;
    renderSidebar();
    saveState();
  }

  function togglePinWorkspace(id) {
    const ws = findWs(id);
    if (!ws) return;
    ws.pinned = !ws.pinned;
    renderSidebar();
    saveState();
  }

  function togglePinFolder(id) {
    const f = folders.find(x => x.id === id);
    if (!f) return;
    f.pinned = !f.pinned;
    renderSidebar();
    saveState();
  }

  function activateWorkspace(id, skipRender) {
    if (id === activeWsId) return;
    clearMultiSelect();
    const prevWs = workspaces.find(w => w.id === activeWsId);
    activeWsId = id;
    if (!skipRender) {
      // Collapsed folders only render their active workspace button, so a
      // switch involving a collapsed folder needs a full sidebar rebuild.
      const ws = workspaces.find(w => w.id === id);
      const inCollapsed = w => {
        if (!w || !w.folderId) return false;
        const f = folders.find(f => f.id === w.folderId);
        return !!(f && f.collapsed);
      };
      if (inCollapsed(ws) || inCollapsed(prevWs)) {
        renderSidebar();
      } else {
        // Update active class in-place to avoid flicker from full sidebar rebuild
        document.querySelectorAll('.ws-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.wsid === id);
          btn.setAttribute('aria-current', btn.dataset.wsid === id ? 'true' : 'false');
        });
      }
      switchWorkspacePane();
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

    // A freshly built container (or a cached one from a previous session) has no
    // background layers yet — apply the per-workspace/global image right away so
    // the image is visible as soon as the workspace is shown, not only after the
    // next renderPaneArea() call (split/action).
    applyBackground();

    // Sync overlays immediately: overlays of the workspace we just switched
    // away from must hide in this tick (their slots report 0 size now), and
    // the active workspace's overlay gets an approximate position that the
    // delayed resyncs below correct once the flex tree settles.
    syncBrowserSlots();

    // Let layout settle before measuring: reading rects in the same tick as
    // display:block (or inside a fixed 30ms timeout) can capture a size from
    // before the flex tree settles, making .browser-slot short. Double-RAF runs
    // after the next paint; a late re-sync self-corrects any transient size.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const all = getWorkspaceTerminals(wsp);
      all.forEach(fitTerm);
      clearSlotFocus();
      const active = all.find(x => x.id === wsp.activeTermId);
      if (active && active.el) {
        focusSlot(active);
        if (active.type !== 'browser') active.term.focus();
      }
      updateFocusedGroup();
      syncBrowserSlots();
    }));
    setTimeout(() => {
      syncBrowserSlots();
      const all = getWorkspaceTerminals(wsp);
      all.forEach(fitTerm);
    }, 120);
    // Fallback: _termFitObserver catches most flex settles, but a forced
    // second pass handles cases where the slot was observed while still at
    // zero size (cache restore, nested splits).
    setTimeout(() => {
      const all = getWorkspaceTerminals(wsp);
      all.forEach(fitTerm);
      syncBrowserSlots();
    }, 350);
  }

  // Workspace ids in the sidebar's visual order: pinned items first (in their
  // sideOrder sequence), then the rest, with each folder expanded into its
  // children where it sits. Used by Ctrl+Shift+PageUp/PageDown so the cycle
  // follows the layout even when workspaces live inside folders.
  function getOrderedWorkspaceIds() {
    const ids = [];
    const visit = (e) => {
      if (e.type === 'ws') {
        const ws = findWs(e.id);
        if (ws) ids.push(ws.id);
      } else if (e.type === 'folder') {
        for (const ws of getGroupList(e.id)) ids.push(ws.id);
      }
    };
    const pinned = [];
    const unpinned = [];
    for (const e of sideOrder) {
      if (e.type === 'ws') {
        const ws = findWs(e.id);
        if (ws) (ws.pinned ? pinned : unpinned).push(e);
      } else {
        const f = folders.find(f => f.id === e.id);
        if (f) (f.pinned ? pinned : unpinned).push(e);
      }
    }
    pinned.forEach(visit);
    unpinned.forEach(visit);
    return ids;
  }

  function nextWorkspace() {
    const ids = getOrderedWorkspaceIds();
    if (ids.length <= 1) return;
    const idx = ids.indexOf(activeWsId);
    activateWorkspace(ids[(idx + 1) % ids.length]);
  }

  function prevWorkspace() {
    const ids = getOrderedWorkspaceIds();
    if (ids.length <= 1) return;
    const idx = ids.indexOf(activeWsId);
    activateWorkspace(ids[(idx - 1 + ids.length) % ids.length]);
  }

  // Alt+N workspace switching: 1-based index into the sidebar's visual order.
  function switchWsByNumber(n) {
    const ids = getOrderedWorkspaceIds();
    if (n < 1 || n > ids.length) return;
    activateWorkspace(ids[n - 1]);
  }

  const _closingWs = new Set();

  function removeWorkspace(id) {
    const ws = findWs(id);
    if (!ws || _closingWs.has(id)) return;
    // Never remove the last workspace — the app must always keep at least one
    // (otherwise the UI lands in a dead zero-workspace state).
    if (workspaces.length <= 1) {
      if (typeof zoomBadge === 'function') zoomBadge('Cannot remove the last workspace');
      return;
    }
    _closingWs.add(id);
    const termCount = getWorkspaceTerminals(ws).length;
    const msg = termCount > 0
      ? `Close "${ws.label}" with ${termCount} terminal${termCount > 1 ? 's' : ''}?`
      : `Close "${ws.label}"?`;
    showConfirm(msg,
      () => { try { _removeWorkspace(id); } finally { _closingWs.delete(id); } },
      () => _closingWs.delete(id));
  }

  function _removeWorkspace(id) {
    const ws = findWs(id);
    if (!ws) return;
    const terms = getWorkspaceTerminals(ws);
    terms.forEach(t => { try { removeTerminal(ws.id, t.id, true); } catch (e) { console.error('removeTerminal failed during workspace teardown', e); } });

    // Clean up cached DOM
    if (_wsDomCache[id]) { _wsDomCache[id].remove(); delete _wsDomCache[id]; }

    const idx = workspaces.findIndex(w => w.id === id);
    workspaces.splice(idx, 1);
    const soIdx = sideOrder.findIndex(e => e.type === 'ws' && e.id === id);
    if (soIdx !== -1) sideOrder.splice(soIdx, 1);
    if (activeWsId === id) {
      if (workspaces.length) { activateWorkspace(workspaces[Math.max(0, idx - 1)].id); renderSidebar(); }
      else { activeWsId = null; renderSidebar(); renderPaneArea(); }
    } else {
      renderSidebar();
    }
    saveState();
    if (DETACHED_ONLY) window.close();
  }

  // Strip "user@host:" prefix and turn "/a/b/c" into "c" (~ stays "~")
  function shortTitle(title) {
    const path = title.includes('@') && title.includes(':') ? title.slice(title.indexOf(':') + 1) : title;
    if (!path || path === '~') return path;
    return path.split('/').filter(Boolean).pop() || path;
  }

  function renameWorkspace(id) {
    const ws = findWs(id);
    if (!ws) return;

    showPrompt('Edit workspace', ws.label, { color: ws.color || '', icon: ws.icon || '' }, (value, color, icon) => {
      ws.label = value.trim() || ws.label;
      ws.color = color || undefined;
      if (icon) ws.icon = icon; else delete ws.icon;
      renderSidebar();
      saveState();
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   T E*RMINAL MANAGEMENT
   ═══════════════════════════════════════════════════════════════ */
  // Below Chromium's ~16 context cap; keeps WebGL available to the active and
  // recently-active terminals without ever exhausting the pool (blank canvas).
  const _WEBGL_MAX = 8;
  // Keep an explicitly selected Courier font, but don't fall back to its thin,
  // serif glyphs just because the preferred coding font isn't installed.
  function terminalFontFamily(family) {
    if (family.trim().startsWith("'Courier New'")) return family;
    return family.replace("'Courier New', monospace",
      "'Cascadia Mono', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono', monospace");
  }

  function _useCanvas(entry) {
    const term = entry.term;
    if (term._canvasAddon) return;
    try {
      const addon = new CanvasAddon.CanvasAddon();
      term.loadAddon(addon);
      term._canvasAddon = addon;
    } catch (e) {
      console.warn('[terminal] Canvas renderer unavailable', e);
    }
  }

  function _releaseWebgl(entry) {
    const term = entry.term;
    try { term._webglAddon?.dispose(); } catch (e) { }
    term._webglAddon = null;
    // Disposing WebGL restores xterm's DOM renderer, not the previous addon.
    // Canvas draws continuous block/box glyphs even with extra line spacing.
    _useCanvas(entry);
  }

  function _disposeTermRenderers(term) {
    // xterm 5 disposes its core before its addons. Release renderers first,
    // while the core can still restore the default renderer during cleanup.
    term._imageAddon?.dispose();
    term._imageAddon = null;
    term._webglAddon?.dispose();
    term._webglAddon = null;
    term._canvasAddon?.dispose();
    term._canvasAddon = null;
  }
  // Attach WebGL on first show and KEEP it while hidden (dispose+recreate on
  // every tab switch paid a full context/shaders rebuild each time and stalled
  // switching). Contexts are only released when the live count hits _WEBGL_MAX,
  // evicting the least-recently-used terminal. Closing a terminal releases its
  // addon via xterm's dispose, so the count self-heals (we scan, not count).
  function _syncWebgl(entry, visible) {
    if (!entry || entry.type === 'browser' || !entry.term) return;
    const term = entry.term;
    if (!visible || entry._webglUnavailable) {
      if (!term._webglAddon) _useCanvas(entry);
      return;
    }
    if (term._webglAddon) { entry._webglLastUse = performance.now(); return; }
    let live = 0, oldest = null, oldestT = Infinity;
    for (const wsp of workspaces) {
      for (const t of getWorkspaceTerminals(wsp)) {
        if (!t.term || !t.term._webglAddon) continue;
        live++;
        const lt = t._webglLastUse || 0;
        if (lt < oldestT) { oldestT = lt; oldest = t; }
      }
    }
    if (live >= _WEBGL_MAX && oldest && oldest.term._webglAddon) {
      _releaseWebgl(oldest);
    }
    try {
      if (term._canvasAddon) {
        term._canvasAddon.dispose();
        term._canvasAddon = null;
      }
      const addon = new WebglAddon.WebglAddon();
      term._webglAddon = addon;
      addon.onContextLoss(() => {
        entry._webglUnavailable = true;
        _releaseWebgl(entry);
      });
      term.loadAddon(addon);
      entry._webglLastUse = performance.now();
    } catch (e) {
      entry._webglUnavailable = true;
      _releaseWebgl(entry);
      console.warn('[terminal] WebGL unavailable; using Canvas', e);
    }
  }

  function _loadTerminalImages(term) {
    // Install before processing PTY output so capability probes advertise SIXEL
    // and Yazi can select native previews. The addon also enables pixel reports.
    const addon = new ImageAddon.ImageAddon({
      sixelSupport: true,
      iipSupport: true,
      enableSizeReports: true,
      storageLimit: 32,
    });
    term.loadAddon(addon);
    term._imageAddon = addon;
  }

  function setAutomaticTerminalTitle(entry, title) {
    if (entry.pinLabel || entry.argv) return;
    const label = shortTitle(title);
    if (!label) return;
    const changed = entry.label !== label;
    entry.label = label;
    const tab = document.querySelector(`.tg-tab[data-termid="${entry.id}"]`);
    const text = tab?.querySelector('.tg-tab-name');
    if (text) text.textContent = label;
    if (tab) tab.title = label;
    if (changed) renderSidebar();
  }

  function setupTerminalTitles(entry) {
    for (const code of [0, 2]) entry.term.parser.registerOscHandler(code, title => {
      if (entry._atShellPrompt || (/claude/i.test(title) && entry._claudeRunning !== true)) {
        entry._historyRevision = (entry._historyRevision || 0) + 1;
      }
      entry._atShellPrompt = false;
      if (/claude/i.test(title)) entry._claudeRunning = true;
      // Claude Code titles: "◐◓◑◒ <topic>" while working, "✳ <topic>" when idle.
      if (/^[\u25D0-\u25D3]/.test(title)) entry._agentWorking = true;
      else if (/^\u2733/.test(title) && entry._agentWorking) {
        entry._agentWorking = false;
        onTerminalFinished({ id: entry.id, kind: 'agent', name: 'claude' });
      }
      setAutomaticTerminalTitle(entry, title);
      syncClaudeHistoryButton(entry);
      scheduleClaudeHistoryRefresh(entry);
      // Keep xterm's normal title processing, including repeated CLI titles.
      return false;
    });
    // Parse complete OSC sequences so split PTY chunks cannot lose a cwd update.
    entry.term.parser.registerOscHandler(7, data => {
      const cwd = _extractOSC7CwdStr('\x1b]7;' + data + '\x07');
      if (cwd) entry.cwd = cwd;
      return true;
    });
    entry.term.parser.registerOscHandler(133, data => {
      if (data.split(';')[0] === 'A') {
        entry._atShellPrompt = true;
        entry._claudeRunning = false;
        entry._historyRevision = (entry._historyRevision || 0) + 1;
        setAutomaticTerminalTitle(entry, entry.cwd || 'Terminal');
        syncClaudeHistoryButton(entry);
      }
      return true;
    });
  }

  function hasClaudeHistory(entry) {
    return !entry.dead && entry._atShellPrompt !== true &&
      (entry._claudeRunning ?? (entry.toolProvider === 'claude' || /claude/i.test(entry.label)));
  }

  function syncClaudeHistoryButton(entry) {
    const button = document.querySelector(`[data-claude-history="${entry.id}"]`);
    if (button) button.hidden = !hasClaudeHistory(entry);
  }

  async function refreshClaudeHistoryButton(entry) {
    if (entry.type === 'browser' || entry.dead || entry._historyProbe) return;
    const revision = entry._historyRevision;
    entry._historyProbe = true;
    try {
      const name = await checkTerminalRunning(entry.id);
      if (findTermById(entry.id)?.term !== entry || revision !== entry._historyRevision || name === 'unknown') return;
      entry._claudeRunning = /^(claude|claude-code)(\.exe)?$/i.test(name || '');
      if (entry._claudeRunning) entry._atShellPrompt = false;
      syncClaudeHistoryButton(entry);
    } finally { entry._historyProbe = false; }
  }

  function scheduleClaudeHistoryRefresh(entry) {
    // Coalesce rapidly changing CLI titles without postponing detection forever.
    if (entry._historyTimer) return;
    entry._historyTimer = setTimeout(() => {
      delete entry._historyTimer;
      if (findTermById(entry.id)?.term === entry) void refreshClaudeHistoryButton(entry);
    }, 100);
  }

  function refreshClaudeHistoryAfterInput(entry) {
    entry._historyInputTimers?.forEach(clearTimeout);
    entry._historyInputTimers = [150, 600].map(ms => setTimeout(() => {
      if (findTermById(entry.id)?.term === entry) void refreshClaudeHistoryButton(entry);
    }, ms));
  }

  function _createTermEntry(wsp, id, label) {
    const term = new Terminal({
      theme: makeXtermTheme(currentTheme),
      fontFamily: terminalFontFamily(currentFontFamily),
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
      customGlyphs: true,
      // OSC 8 hyperlinks (Claude, ls --hyperlink, …): same routing as plain URLs.
      linkHandler: { activate: (e, uri) => openTerminalLink(id, uri, e) },
    });

    const fitAddon = new FitAddon.FitAddon();
    const searchAddon = new SearchAddon.SearchAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon((e, uri) => openTerminalLink(id, uri, e));
    try { const u11 = new Unicode11Addon.Unicode11Addon(); term.loadAddon(u11); term.unicode.activeVersion = '11'; } catch { }
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);
    _loadTerminalImages(term);
    // WebGL attached lazily via _syncWebgl only while the terminal is VISIBLE.
    // Chromium caps concurrent WebGL contexts (~16); giving every terminal its
    // own context at creation exhausted the pool when many tabs were added
    // quickly, leaving the newest canvases blank (white page + dead icon).

    term.onData(data => {
      if (wsReady) sendStdin(id, new TextEncoder().encode(data));
      if (/[\r\x03\x04]/.test(data)) {
        refreshWorkspaceProcsSoon();
        refreshClaudeHistoryAfterInput(entry);
      }
    });
    term.onBinary(data => {
      if (wsReady) {
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
        sendStdin(id, bytes);
      }
    });

    const entry = { id, label, term, fit: fitAddon, search: searchAddon, el: null, opened: false, locked: false, _bgTransparent: false };
    setupTerminalTitles(entry);
    term.buffer.onBufferChange(buffer => {
      if (buffer.type !== 'alternate') return;
      // A TUI may enter the alternate screen before its tab's final layout fit.
      // Resync after parsing finishes, even if the pane's pixel size is unchanged.
      requestAnimationFrame(() => {
        if (findTermById(entry.id)?.term === entry) fitTerm(entry, true);
      });
    });

    // The grid only fits whole character cells, so a sub-cell strip is left at the
    // right/bottom edge showing the panel background. Tint the panel with the
    // background colour of the bottom-right cell so the strip blends in with
    // whatever the running program paints (works for any TUI, not one app).
    const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
    const paletteToCss = n => {
      if (n < 16) return term.options.theme?.[ANSI_KEYS[n]] || null;
      if (n < 232) {
        const i = n - 16, lv = v => (v ? 55 + v * 40 : 0);
        return `rgb(${lv(Math.floor(i / 36))},${lv(Math.floor(i / 6) % 6)},${lv(i % 6)})`;
      }
      const g = 8 + (n - 232) * 10;
      return `rgb(${g},${g},${g})`;
    };
    let edgeTimer = null;
    const syncEdgeBg = () => {
      edgeTimer = null;
      const slot = entry.el;
      if (!slot || !slot.style) return;
      if (slot.closest('.has-global-bg, .has-ws-bg')) { slot.style.backgroundColor = ''; return; }
      try {
        const buf = term.buffer.active;
        const line = buf.getLine(buf.baseY + term.rows - 1);
        const cell = line && line.getCell(term.cols - 1);
        let css = '';
        if (cell) {
          if (cell.isBgRGB()) {
            const c = cell.getBgColor();
            css = `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`;
          } else if (cell.isBgPalette()) {
            css = paletteToCss(cell.getBgColor()) || '';
          }
        }
        slot.style.backgroundColor = css;
      } catch { }
    };
    term.onWriteParsed(() => { if (!edgeTimer) edgeTimer = setTimeout(syncEdgeBg, 150); });
    return entry;
  }

  // opts (plugins: api.terminal.open): { cwd, cmd, label } — start directory,
  // a command typed into the fresh shell, and a pinned tab label.
  function addTerminal(wsId, targetGroupId, opts = {}) {
    const wsp = findWs(wsId || activeWsId);
    if (!wsp) return;

    // Resolve the destination and its previous tab before selecting the new one.
    // The + button may belong to a different split from the focused terminal.
    let targetGroup = targetGroupId ? findGroupById(wsp.layout, targetGroupId) : null;
    if (!targetGroup && wsp.activeTermId) targetGroup = findGroupContainingTerm(wsp.layout, wsp.activeTermId);
    if (!targetGroup) targetGroup = findFirstGroup(wsp.layout);
    const groupTerms = targetGroup?.terminals || [];
    const previous = groupTerms.find(t => t.id === targetGroup.activeTermId && t.type !== 'browser')
      || [...(targetGroup?._history || [])].reverse().map(id => groupTerms.find(t => t.id === id && t.type !== 'browser')).find(Boolean)
      || groupTerms.find(t => t.type !== 'browser')
      || getWorkspaceTerminals(wsp).find(t => t.type !== 'browser' && t.cwd);
    const cwd = opts.cwd || previous?.cwd || ((defaultTerminalPath && defaultTerminalPath.trim())
      ? defaultTerminalPath.trim().replace(/^["']|["']$/g, '') : null);
    const id = uuid();
    const label = opts.label || (cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Terminal';
    const entry = _createTermEntry(wsp, id, label);
    entry.cwd = cwd;
    if (opts.cmd) entry.runCmd = opts.cmd;
    if (opts.label) entry.pinLabel = true;

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
            addTabSessionHistory(tab, wsp, entry);
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
            tab.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-terminalvibe-tab', entry.id); e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(true); if (window.electronAPI && window.electronAPI.tabDragStart) window.electronAPI.tabDragStart({ id: entry.id, cols: entry.term ? entry.term.cols : 80, rows: entry.term ? entry.term.rows : 24, cwd: entry.cwd, label: entry.label }); });
            tab.addEventListener('dragend', e => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); if (!DETACHED_ONLY && entry.term && (!e.dataTransfer || e.dataTransfer.dropEffect === 'none')) detachTerminal(wsp.id, entry.id); if (!DETACHED_ONLY && window.electronAPI && window.electronAPI.tabDragEnd) window.electronAPI.tabDragEnd({ id: entry.id, cancelled: true }); });
            tab.addEventListener('dragover', e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
              const r = tab.getBoundingClientRect();
              const isLeft = e.clientX < r.left + r.width / 2;
              tab.classList.add(isLeft ? 'drop-left' : 'drop-right');
              const activeDragId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId;
              if (activeDragId && window.electronAPI && window.electronAPI.tabDragHover) {
                let beforeTabId = null;
                if (isLeft) {
                  beforeTabId = entry.id;
                } else {
                  const curIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                  beforeTabId = (curIdx !== -1 && curIdx + 1 < targetGroup.terminals.length) ? targetGroup.terminals[curIdx + 1].id : null;
                }
                window.electronAPI.tabDragHover({
                  id: activeDragId,
                  targetGroupId: targetGroup.id,
                  zone: 'center',
                  beforeTabId,
                });
              }
            });
            tab.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !tab.contains(e.relatedTarget)) { tab.classList.remove('drop-left', 'drop-right'); } });
            tab.addEventListener('drop', e => {
              e.preventDefault();
              const draggedId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));
              if (!window.draggedTermId && draggedId && !findGroupContainingTerm(wsp.layout, draggedId)) {
                const api = window.electronAPI;
                if (api && api.tabDragDrop) {
                  const r = tab.getBoundingClientRect();
                  const isLeft = e.clientX < r.left + r.width / 2;
                  let beforeTabId = null;
                  if (isLeft) {
                    beforeTabId = entry.id;
                  } else {
                    const curIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                    beforeTabId = (curIdx !== -1 && curIdx + 1 < targetGroup.terminals.length) ? targetGroup.terminals[curIdx + 1].id : null;
                  }
                  api.tabDragDrop({ id: draggedId, targetGroupId: targetGroup.id, zone: 'center', beforeTabId });
                }
                window.externalDragTermId = null;
                tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
                return;
              }
              if (draggedId && draggedId !== entry.id) {
                const fromIdx = targetGroup.terminals.findIndex(x => x.id === draggedId);
                let toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                if (fromIdx !== -1 && toIdx !== -1) {
                  const [moved] = targetGroup.terminals.splice(fromIdx, 1);
                  toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                  const insertIdx = e.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2 ? toIdx : toIdx + 1;
                  targetGroup.terminals.splice(insertIdx, 0, moved);
                  targetGroup.activeTermId = draggedId;
                }
                renderPaneArea();
                activateTerminal(wsp.id, draggedId);
              }
              tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
            });
            tabsContainer.appendChild(tab);
            updateTabBarOverflow(groupEl);
            scrollTabIntoView(groupEl, entry.id);
            // Create and add the slot
            const slot = getOrCreateSlot(entry, wsp, body);
            clearSlotFocus();
            body.querySelectorAll('.term-slot').forEach(s => {
              s.style.display = 'none';
              const hid = findTermById(s.id.startsWith('slot-') ? s.id.slice(5) : '');
              if (hid) _syncWebgl(hid.term, false);
            });
            slot.style.display = entry.type === 'browser' ? 'flex' : 'block';
            body.appendChild(slot);
            if (entry.type !== 'browser') _syncWebgl(entry, true);
            focusSlot(entry);
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

    // The slot is already mounted: measuring it settles layout synchronously.
    // Start the shell now so its init can run while the first frame is painted.
    const slot = getSlotDimensions(entry);
    sendControl({ type: 'create', id, cols: slot.cols, rows: slot.rows, cwd, inheritFromId: previous?.id, argv: entry.argv || [] });
    requestAnimationFrame(() => fitTerm(entry));

    saveState();
    pluginEmit('terminal:add', { wsId: wsp.id, termId: id, type: 'terminal', label: entry.label });
    return entry;
  }

  function addBrowserTab(wsId, targetGroupId, url) {
    const wsp = findWs(wsId || activeWsId);
    if (!wsp) return;

    const id = uuid();
    const allTerms = getWorkspaceTerminals(wsp);
    const label = `browser ${allTerms.length + 1}`;
    const entry = { id, label, type: 'browser', url: url || 'about:blank', iframe: null, el: null, opened: false, _focusUrlOnActivate: true };

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
            tab.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-terminalvibe-tab', entry.id); e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(true); if (window.electronAPI && window.electronAPI.tabDragStart) window.electronAPI.tabDragStart({ id: entry.id, cols: entry.term ? entry.term.cols : 80, rows: entry.term ? entry.term.rows : 24, cwd: entry.cwd, label: entry.label }); });
            tab.addEventListener('dragend', e => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); if (!DETACHED_ONLY && entry.term && (!e.dataTransfer || e.dataTransfer.dropEffect === 'none')) detachTerminal(wsp.id, entry.id); if (!DETACHED_ONLY && window.electronAPI && window.electronAPI.tabDragEnd) window.electronAPI.tabDragEnd({ id: entry.id, cancelled: true }); });
            tab.addEventListener('dragover', e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
              const r = tab.getBoundingClientRect();
              const isLeft = e.clientX < r.left + r.width / 2;
              tab.classList.add(isLeft ? 'drop-left' : 'drop-right');
              const activeDragId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId;
              if (activeDragId && window.electronAPI && window.electronAPI.tabDragHover) {
                let beforeTabId = null;
                if (isLeft) {
                  beforeTabId = entry.id;
                } else {
                  const curIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                  beforeTabId = (curIdx !== -1 && curIdx + 1 < targetGroup.terminals.length) ? targetGroup.terminals[curIdx + 1].id : null;
                }
                window.electronAPI.tabDragHover({
                  id: activeDragId,
                  targetGroupId: targetGroup.id,
                  zone: 'center',
                  beforeTabId,
                });
              }
            });
            tab.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !tab.contains(e.relatedTarget)) { tab.classList.remove('drop-left', 'drop-right'); } });
            tab.addEventListener('drop', e => {
              e.preventDefault();
              const draggedId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));
              if (!window.draggedTermId && draggedId && !findGroupContainingTerm(wsp.layout, draggedId)) {
                const api = window.electronAPI;
                if (api && api.tabDragDrop) {
                  const r = tab.getBoundingClientRect();
                  const isLeft = e.clientX < r.left + r.width / 2;
                  let beforeTabId = null;
                  if (isLeft) {
                    beforeTabId = entry.id;
                  } else {
                    const curIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                    beforeTabId = (curIdx !== -1 && curIdx + 1 < targetGroup.terminals.length) ? targetGroup.terminals[curIdx + 1].id : null;
                  }
                  api.tabDragDrop({ id: draggedId, targetGroupId: targetGroup.id, zone: 'center', beforeTabId });
                }
                window.externalDragTermId = null;
                tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
                return;
              }
              if (draggedId && draggedId !== entry.id) {
                const fromIdx = targetGroup.terminals.findIndex(x => x.id === draggedId);
                let toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                if (fromIdx !== -1 && toIdx !== -1) {
                  const [moved] = targetGroup.terminals.splice(fromIdx, 1);
                  toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id);
                  const insertIdx = e.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2 ? toIdx : toIdx + 1;
                  targetGroup.terminals.splice(insertIdx, 0, moved);
                  targetGroup.activeTermId = draggedId;
                }
                renderPaneArea();
                activateTerminal(wsp.id, draggedId);
              }
              tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
            });
            tabsContainer.appendChild(tab);
            updateTabBarOverflow(groupEl);
            scrollTabIntoView(groupEl, entry.id);
            // Create slot
            const slot = getOrCreateSlot(entry, wsp, body);
            clearSlotFocus();
            body.querySelectorAll('.term-slot').forEach(s => { s.style.display = 'none'; });
            slot.style.display = 'flex';
            body.appendChild(slot);
            focusSlot(entry);
            // Hiding the previously-active browser slot must take effect on
            // its overlay in the same tick or its white surface lingers.
            syncBrowserSlots();
            // Focus URL input for new browser tabs
            if (entry._focusUrlOnActivate) {
              entry._focusUrlOnActivate = false;
              const bc = entry.browserContainer;
              if (bc) {
                const focusInput = () => {
                  const urlInput = bc.querySelector('.browser-url');
                  if (urlInput) { urlInput.focus(); urlInput.select(); }
                };
                requestAnimationFrame(() => requestAnimationFrame(focusInput));
                setTimeout(focusInput, 100);
              }
            }
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
    pluginEmit('terminal:add', { wsId: wsp.id, termId: id, type: 'browser', url: entry.url });
    return entry;
  }

  function getSlotDimensions(entry) {
    if (entry && entry.fit && typeof entry.fit.proposeDimensions === 'function') {
      try {
        const d = entry.fit.proposeDimensions();
        if (d && d.cols && d.rows) return { cols: d.cols, rows: d.rows };
      } catch { }
    }
    if (entry.el) {
      const w = entry.el.offsetWidth - 16;
      const h = entry.el.offsetHeight - 12;
      const cw = 8; const ch = 17;
      return { cols: Math.max(1, Math.floor(w / cw)), rows: Math.max(1, Math.floor(h / ch)) };
    }
    return { cols: 80, rows: 24 };
  }

  function activateTerminal(wsId, termId) {
    const wsp = findWs(wsId);
    if (!wsp) return;
    wsp.activeTermId = termId;
    pluginEmit('terminal:activate', { wsId, termId });

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
      clearSlotFocus();

      if (group) {
        const groupEl = document.getElementById('group-' + group.id);
        if (groupEl) {
          // Update tab active state
          groupEl.querySelectorAll('.tg-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.termid === termId);
          });
          updateTabBarOverflow(groupEl);
          scrollTabIntoView(groupEl, termId);
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
            const showAs = t.type === 'browser' ? 'flex' : 'block';
            slot.style.display = isActive ? showAs : 'none';
            if (t.type !== 'browser') _syncWebgl(t, isActive);
            if (t.type === 'browser') {
              if (isActive) resumeBrowserTab(t);
              else {
                suspendBrowserTab(t);
                // Hide the overlay NOW — waiting for the delayed sync leaves
                // the white browser surface painted above the terminal for
                // 2+ frames (visible as a blank white flash / stuck overlay).
                if (t.browserContainer) {
                  t.browserContainer.style.visibility = 'hidden';
                }
              }
            }
          });
          // Sync overlays in the same tick: hiding must never wait for a RAF.
          syncBrowserSlots();
        }
      }
      const terms = getWorkspaceTerminals(wsp);
      const t = terms.find(x => x.id === termId);
      if (t && t.el) {
        focusSlot(t);
        if (t.type === 'browser') {
          // handled after syncBrowserSlots positions the container
        } else {
          // Use double RAF to let flex layout settle, then fit.
          // The 20ms timeout was too short for nested splits; RAF waits for paint.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (t.term && !t.dead && t.el && t.el.offsetParent !== null) {
                t.term.focus();
                fitTerm(t);
              }
            });
          });
        }
      }
    }
    // Double-RAF + trailing resync — same fix as switchWorkspacePane, single RAF
    // can still read a pre-settle size on a busy frame right after display toggle.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const terms = getWorkspaceTerminals(wsp);
      syncBrowserSlots();
      const t = terms.find(x => x.id === termId);
      if (t && t.type === 'browser' && t._focusUrlOnActivate) {
        t._focusUrlOnActivate = false;
        const urlInput = t.browserContainer?.querySelector('.browser-url');
        if (urlInput) { urlInput.focus(); urlInput.select(); }
      }
    }));
    setTimeout(() => {
      syncBrowserSlots();
      const terms = getWorkspaceTerminals(wsp);
      const t = terms.find(x => x.id === termId);
      if (t && t.type === 'browser' && t._focusUrlOnActivate) {
        t._focusUrlOnActivate = false;
        const urlInput = t.browserContainer?.querySelector('.browser-url');
        if (urlInput) { urlInput.focus(); urlInput.select(); }
      }
    }, 100);
    clearTimeout(activateTerminal._saveTimer);
    activateTerminal._saveTimer = setTimeout(saveState, 500);
  }

  function detachTerminal(wsId, termId) {
    const wsp = findWs(wsId);
    if (!wsp || !wsp.layout) return;
    const entry = getWorkspaceTerminals(wsp).find(t => t.id === termId);
    if (!entry || entry.type === 'browser') return;
    if (!isDesktop() || !window.electronAPI?.terminalDetach) return;

    const slot = getSlotDimensions(entry);
    const cwd = entry.cwd || undefined;

    // Stash the terminal's current screen + scrollback so the detached window
    // can show the same session. The PTY keeps running (no fresh shell is
    // spawned), so the content is transferred, not recreated.
    try {
      const payload = serializeTermBuffer(entry);
      if (payload) localStorage.setItem(DETACH_BUFFER_KEY(termId), JSON.stringify(payload));
    } catch { }

    window.electronAPI.terminalDetach({ id: termId, cols: slot.cols, rows: slot.rows, cwd }).then(ok => {
      if (!ok) { try { localStorage.removeItem(DETACH_BUFFER_KEY(termId)); } catch { } return; }
      // Detach succeeded — remove the terminal from this workspace without
      // killing the PTY. The detached window attaches to the SAME running PTY.
      removeTerminal(wsId, termId, false, true);
    });
  }

  // Per-terminal key holding the serialized xterm buffer while a detach is in flight.
  const DETACH_BUFFER_KEY = (termId) => 'ghostterm-detach-buffer-' + termId;

  function serializeTermBuffer(entry) {
    try {
      const term = entry.term;
      const buf = term.buffer.active;
      const lines = [];
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y);
        lines.push(line ? line.translateToString(true) : '');
      }
      return {
        label: entry.label,
        cols: term.cols,
        rows: term.rows,
        cursorX: buf.cursorX,
        cursorY: buf.cursorY,
        viewportY: buf.viewportY,
        lines,
      };
    } catch { return null; }
  }

  function restoreTermBuffer(entry, payload) {
    try {
      const term = entry.term;
      if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) return;
      // Replay the captured lines as plain text.
      term.write(payload.lines.join('\r\n'));
      // Move the cursor back to its saved position: up to the saved row, then
      // to column 0, then right to the saved column.
      const lastIdx = payload.lines.length - 1;
      const up = Math.max(0, lastIdx - (payload.cursorY || 0));
      if (up > 0) term.write(`\x1b[${up}A`);
      term.write('\x1b[G');
      const right = Math.max(0, payload.cursorX || 0);
      if (right > 0) term.write(`\x1b[${right}C`);
      // Restore the scroll offset (0 = top of the buffer).
      const buf = term.buffer.active;
      const maxViewport = Math.max(0, buf.length - term.rows);
      const target = Math.min(maxViewport, payload.viewportY ?? maxViewport);
      if (target < maxViewport) term.scrollLines(target - maxViewport);
    } catch { }
  }

  // Reverse of detachTerminal: the detached window was closed by dragging its
  // tab over this window; re-create the tab here attached to the SAME PTY
  // (no terminal:create — that would kill the session and spawn a new shell).
  // `placement` ({ targetGroupId, zone }) drops it into a specific group,
  // splitting the pane like a normal tab drag-and-drop.
  function reattachTerminal(termId, cols, rows, cwd, placement) {
    // A sidebar drop reports the target workspace's group directly, which may
    // live in an inactive workspace — resolve the owning workspace first so a
    // detached tab can land there instead of always using the active one.
    let wsp = null;
    if (placement && placement.targetGroupId) {
      for (const ws of workspaces) {
        if (ws.layout && findGroupById(ws.layout, placement.targetGroupId)) { wsp = ws; break; }
      }
    }
    if (!wsp) wsp = _attachTargetWorkspace();

    // Read the stashed buffer first so the tab can keep its name; the PTY is
    // re-attached, the content replayed from this snapshot.
    const stash = _takeDetachStash(termId);

    const entry = _createTermEntry(wsp, termId, (stash && stash.label) || 'terminal');
    entry.cwd = cwd;

    if (!wsp.layout) {
      wsp.layout = { type: 'group', id: 'group-' + uuid(), terminals: [entry], activeTermId: termId };
    } else {
      const targetGroup = (placement && placement.targetGroupId && findGroupById(wsp.layout, placement.targetGroupId))
        || (activeTerminal() && findGroupContainingTerm(wsp.layout, activeTerminal().id))
        || findFirstGroup(wsp.layout);
      if (!targetGroup) return;

      if (placement && placement.zone && placement.zone !== 'center' && targetGroup.terminals.length > 0) {
        // Direct split placement: create new group and split the layout tree directly
        const newGroup = {
          type: 'group',
          id: 'group-' + uuid(),
          terminals: [entry],
          activeTermId: termId
        };
        const direction = (placement.zone === 'left' || placement.zone === 'right') ? 'row' : 'column';
        const isFirst = (placement.zone === 'left' || placement.zone === 'top');
        if (wsp._maximizedGroupId) wsp._maximizedGroupId = null;
        wsp.layout = splitGroupNodeInTree(wsp.layout, targetGroup.id, newGroup, direction, isFirst);
        wsp.layout = removeEmptyGroups(wsp.layout);
      } else {
        targetGroup.terminals.push(entry);
        if (!targetGroup._history) targetGroup._history = [];
        if (targetGroup.activeTermId) targetGroup._history.push(targetGroup.activeTermId);
        targetGroup.activeTermId = termId;
        // Dropped on a specific tab — place it at that position in the bar.
        if (placement && placement.beforeTabId) {
          const idx = targetGroup.terminals.findIndex(x => x.id === placement.beforeTabId);
          if (idx !== -1) {
            targetGroup.terminals.splice(targetGroup.terminals.indexOf(entry), 1);
            targetGroup.terminals.splice(idx, 0, entry);
          }
        }
      }
    }
    wsp.activeTermId = termId;
    renderPaneArea();
    activateTerminal(wsp.id, termId);
    _finishReattach(entry, termId, cols, rows, stash, true);

    renderSidebar();
    saveState();
  }

  // Workspace a re-attached terminal lands in: the active one, or a fresh
  // empty one when all were closed while the tab was detached
  // (createWorkspace would spawn a new terminal/PTY).
  function _attachTargetWorkspace() {
    let wsp = workspaces.find(w => w.id === activeWsId) || workspaces[0];
    if (wsp) return wsp;
    wsp = { id: uuid(), label: 'Workspace 1', layout: null, activeTermId: null };
    workspaces.push(wsp);
    sideOrder.push({ type: 'ws', id: wsp.id });
    activeWsId = wsp.id;
    const empty = document.getElementById('empty-state');
    if (empty) empty.style.display = 'none';
    return wsp;
  }

  function _takeDetachStash(termId) {
    try {
      const raw = localStorage.getItem(DETACH_BUFFER_KEY(termId));
      localStorage.removeItem(DETACH_BUFFER_KEY(termId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  // Open at the size the PTY is running at so replayed lines don't wrap,
  // replay the stashed screen/scrollback, then announce the attach so main
  // flushes output buffered while the source window was closing. Finally fit
  // to the new layout and sync the PTY to the fitted size.
  function _finishReattach(entry, termId, cols, rows, stash, focus) {
    try { entry.term.resize(cols || 80, rows || 24); } catch { }
    if (stash) { try { restoreTermBuffer(entry, stash); } catch { } }
    if (window.electronAPI && window.electronAPI.terminalAttached) {
      window.electronAPI.terminalAttached(termId);
    }
    setTimeout(() => {
      try {
        fitTerm(entry);
        if (entry.term && window.electronAPI && window.electronAPI.terminalResize) {
          window.electronAPI.terminalResize({ id: termId, cols: entry.term.cols, rows: entry.term.rows });
        }
      } catch { }
      if (focus) { try { entry.term && entry.term.focus(); } catch { } }
    }, 80);
  }

  // A whole detached window was attached back: rebuild its split layout here
  // with fresh xterm entries bound to the same live PTYs, docked to the right
  // of the active pane (or as the whole layout of an empty workspace).
  function reattachLayout(layout, focusId) {
    const wsp = _attachTargetWorkspace();
    const moved = [];
    const build = node => {
      if (node.type === 'split') {
        return { type: 'split', id: 'split-' + uuid(), direction: node.direction, sizes: node.sizes, children: node.children.map(build) };
      }
      const terminals = node.terminals.map(t => {
        const stash = _takeDetachStash(t.id);
        const entry = _createTermEntry(wsp, t.id, (stash && stash.label) || t.label || 'terminal');
        entry.cwd = t.cwd;
        moved.push({ entry, t, stash });
        return entry;
      });
      const activeTermId = terminals.some(e => e.id === node.activeTermId) ? node.activeTermId : terminals[0]?.id || null;
      return { type: 'group', id: 'group-' + uuid(), terminals, activeTermId };
    };
    const tree = removeEmptyGroups(build(layout));
    if (!tree || !moved.length) return;

    const cur = wsp.layout && activeTerminal();
    const anchor = wsp.layout && ((cur && findGroupContainingTerm(wsp.layout, cur.id)) || findFirstGroup(wsp.layout));
    if (wsp._maximizedGroupId) wsp._maximizedGroupId = null;
    wsp.layout = anchor ? splitGroupNodeInTree(wsp.layout, anchor.id, tree, 'row', false) : tree;

    const focus = moved.some(m => m.t.id === focusId) ? focusId : moved[0].t.id;
    wsp.activeTermId = focus;
    renderPaneArea();
    activateTerminal(wsp.id, focus);
    for (const { entry, t, stash } of moved) _finishReattach(entry, t.id, t.cols, t.rows, stash, t.id === focus);
    renderSidebar();
    saveState();
  }

  // Detached window → send every live terminal (with the split layout) back
  // to the main window. Buffers are stashed like a single-tab move.
  function attachWindowToMain() {
    const wsp = activeWs();
    const api = window.electronAPI;
    if (!wsp || !wsp.layout || !api || !api.attachWindow) return;
    const ids = [];
    const strip = node => {
      if (node.type === 'split') {
        return { type: 'split', direction: node.direction, sizes: node.sizes, children: node.children.map(strip) };
      }
      const terminals = node.terminals.filter(t => t.term && t.type !== 'browser' && !t.dead).map(t => {
        const payload = serializeTermBuffer(t);
        try { if (payload) localStorage.setItem(DETACH_BUFFER_KEY(t.id), JSON.stringify(payload)); } catch { }
        ids.push(t.id);
        return { id: t.id, label: t.label, cwd: t.cwd, cols: t.term.cols, rows: t.term.rows };
      });
      return { type: 'group', terminals, activeTermId: node.activeTermId };
    };
    const layout = strip(wsp.layout);
    if (!ids.length) return;
    const cur = activeTerminal();
    api.attachWindow({ layout, ids, focusId: cur && ids.includes(cur.id) ? cur.id : ids[0] });
  }

  const _processCheckPending = new Set(); // termIds with an in-flight running-process check
  const _closeLockConfirmed = new Set();  // locked termIds whose close was already confirmed

  function removeTerminal(wsId, termId, skipRender, skipPtyClose, confirmed, checked) {
    const wsp = findWs(wsId);
    if (!wsp || !wsp.layout) return;
    if (_multiSelected.has(termId)) { _multiSelected.delete(termId); document.getElementById('slot-' + termId)?.classList.remove('multi-selected'); }

    // Confirm before closing a tab that has a process running inside it
    // (something other than the idle shell), or a browser tab showing content.
    // Skipped for dead terminals, blank browser tabs, detaches and internal
    // teardowns.
    if (!confirmed && !checked && !skipRender && !skipPtyClose) {
      const entry = getWorkspaceTerminals(wsp).find(t => t.id === termId);
      if (browserHasContent(entry)) {
        if (dontAskAgain('closebrowser')) {
          removeTerminal(wsId, termId, skipRender, skipPtyClose, true, true);
          return;
        }
        const closesWorkspace = getWorkspaceTerminals(wsp).length <= 1;
        showDangerConfirm('Close browser tab?',
          `<span class="cc-label">${escHtml(entry.label || 'Browser')}</span> is showing content (${escHtml(entry.url)}).` +
          (closesWorkspace ? ' Closing it will close the tab and remove the workspace.' : ' Closing it will close the tab and lose its page.'),
          'Close Tab',
          () => removeTerminal(wsId, termId, skipRender, skipPtyClose, true, true),
          () => { },
          'closebrowser');
        return;
      }
      // Locked terminal — confirm before proceeding
      if (entry.locked && !_closeLockConfirmed.has(termId)) {
        if (dontAskAgain('closelocked')) {
          _closeLockConfirmed.add(termId);
          removeTerminal(wsId, termId, skipRender, skipPtyClose, false, false);
          return;
        }
        const closesWorkspace = getWorkspaceTerminals(wsp).length <= 1;
        showDangerConfirm('Locked terminal',
          `<span class="cc-label">${escHtml(entry.label)}</span> is locked.` +
          (closesWorkspace ? ' Closing it will close the tab and remove the workspace.' : ' Closing it will close the tab.'),
          'Close Tab',
          () => { _closeLockConfirmed.add(termId); removeTerminal(wsId, termId, skipRender, skipPtyClose, false, false); },
          () => { },
          'closelocked');
        return;
      }

      if (isLiveTerminal(entry)) {
        if (_processCheckPending.has(termId)) return;
        _processCheckPending.add(termId);
        checkTerminalRunning(termId).then(running => {
          _processCheckPending.delete(termId);
          if (running) {
            if (dontAskAgain('closeprocess')) {
              removeTerminal(wsId, termId, skipRender, skipPtyClose, true, true);
              return;
            }
            const closesWorkspace = getWorkspaceTerminals(wsp).length <= 1;
            showCloseConfirm(entry.label, closesWorkspace,
              () => removeTerminal(wsId, termId, skipRender, skipPtyClose, true, true),
              () => _closeLockConfirmed.delete(termId));
          } else {
            removeTerminal(wsId, termId, skipRender, skipPtyClose, false, true);
          }
        });
        return;
      }
    }

    // Last tab in workspace — remove the workspace with confirmation
    // Skip confirmation when detaching (skipPtyClose) — just remove silently
    if (!skipRender && !skipPtyClose && getWorkspaceTerminals(wsp).length <= 1) {
      // Last tab of the last workspace: close just the tab and keep the
      // (now empty) workspace so the app never reaches zero workspaces.
      if (workspaces.length <= 1) {
        // Fall through to the normal tab removal below.
      } else {
        if (_closingWs.has(wsId)) return;
        if (confirmed) { _removeWorkspace(wsId); return; }
        _closingWs.add(wsId);
        const label = wsp.label;
        showConfirm(`Close "${label}"?`,
          () => { try { _removeWorkspace(wsId); } finally { _closingWs.delete(wsId); } },
          () => _closingWs.delete(wsId));
        return;
      }
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
      if (!skipPtyClose) {
        sendControl({ type: 'close', id: termId });
        try {
          if (entry.term) {
            _disposeTermRenderers(entry.term);
            entry.term.dispose();
          }
        } catch { }
      }
    } else {
      if (entry._msgCleanup) entry._msgCleanup();
      if (entry._resizeObs) { entry._resizeObs.disconnect(); entry._resizeObs = null; }
      if (entry._suspendTimer) { clearTimeout(entry._suspendTimer); entry._suspendTimer = null; }
      if (entry.browserContainer) { entry.browserContainer.remove(); entry.browserContainer = null; }
      if (entry._viewCreated && window.electronAPI) { window.electronAPI.browserDestroy(entry.id); browserEventHooks.delete(entry.id); }
    }
    if (entry.el) {
      try { _termFitObserver.unobserve(entry.el); } catch { }
      if (entry.term) {
        if (entry.term._fitObserverRaf) cancelAnimationFrame(entry.term._fitObserverRaf);
        delete entry.term._fitObserverRaf;
      }
      entry.el.remove();
    }

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
          updateTabBarOverflow(groupEl);
          if (group.activeTermId) scrollTabIntoView(groupEl, group.activeTermId);
          // Show/hide slots
          const body = groupEl.querySelector('.term-group-body');
          if (body) {
            clearSlotFocus();
            group.terminals.forEach(t => {
              const slot = document.getElementById('slot-' + t.id);
              if (!slot) return;
              const isActive = t.id === group.activeTermId;
              slot.style.display = isActive ? (t.type === 'browser' ? 'flex' : 'block') : 'none';
              if (isActive) {
                slot.classList.add('focused');
                if (t.type === 'browser' && t.browserContainer) t.browserContainer.classList.add('focused');
              }
            });
          }
        }
        syncBrowserSlots();
      }
      // Focus the new active tab
      const newActiveId = wsp.activeTermId || (group ? group.activeTermId : null);
      if (newActiveId) {
        const newEntry = getWorkspaceTerminals(wsp).find(x => x.id === newActiveId);
        if (newEntry && newEntry.el) {
          focusSlot(newEntry);

          if (newEntry.type !== 'browser' && newEntry.term) {
            setTimeout(() => {
              newEntry.term.focus();
              fitTerm(newEntry);
            }, 60);
          }
        }
      }
    }
    renderSidebar();
    saveState();

    // If this was the last terminal (detach case), remove the now-empty workspace —
    // unless it is the last workspace, which must always be kept.
    if (skipPtyClose && getWorkspaceTerminals(wsp).length === 0 && workspaces.length > 1) {
      _removeWorkspace(wsId);
    }
    pluginEmit('terminal:remove', { wsId, termId, type: entry?.type });
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

  // Lock/unlock a terminal tab: locked panes swallow all keyboard/paste input
  // (enforced at the sendStdin chokepoint) and show a badge across the top.
  function toggleTermLock(entry) {
    entry.locked = !entry.locked;
    if (entry.locked) entry._lockBadgeDismissed = false; // fresh lock → show badge again
    updateTermLockBadge(entry);
    // Refresh the tab's lock icon
    const tab = document.querySelector(`.tg-tab[data-termid="${entry.id}"]`);
    if (tab) {
      let icon = tab.querySelector('.tg-tab-lock');
      if (entry.locked && !icon) {
        icon = document.createElement('i');
        icon.className = 'ph ph-lock-simple tg-tab-lock';
        tab.insertBefore(icon, tab.querySelector('.tg-tab-name'));
      } else if (!entry.locked && icon) {
        icon.remove();
      }
    }
    saveState();
  }

  function updateTermLockBadge(entry) {
    if (!entry) return;
    const slot = entry.el;
    if (!slot) return;
    let badge = slot.querySelector('.term-lock-badge');
    if (entry.locked && !entry._lockBadgeDismissed) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'term-lock-badge';
        slot.appendChild(badge);
      }
      badge.innerHTML = '<i class="ph ph-lock-simple"></i><span>Terminal locked — typing is disabled</span><button class="term-lock-close" title="Dismiss"><i class="ph ph-x"></i></button>';
      badge.querySelector('.term-lock-close').onclick = (e) => {
        e.stopPropagation();
        entry._lockBadgeDismissed = true; // dismiss the badge only — the lock stays on
        updateTermLockBadge(entry);
      };
    } else if (badge) {
      badge.remove();
    }
  }

  function renameTerminalInGroup(wsId, termId) {
    const wsp = findWs(wsId);
    if (!wsp) return;
    const terms = getWorkspaceTerminals(wsp);
    const t = terms.find(x => x.id === termId);
    if (!t) return;

    showPrompt('Edit tab', t.label, { color: t.color || '' }, (value, color) => {
      if (value.trim() && value.trim() !== t.label) t.pinLabel = true;
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
      saveState();
    });
  }

  function handleExit(id, code) {
    const result = findTermById(id);
    if (!result) return;
    const { ws, term: t } = result;
    t.dead = true;
    pluginEmit('terminal:exit', { termId: id, code });
    if (t.agentManaged) {
      t.term.write(`\r\n[Agent process exited: ${code}]\r\n`);
      t.term.options.disableStdin = true;
      renderPaneArea();
      saveState();
      return;
    }
    if (getWorkspaceTerminals(ws).length <= 1) {
      if (DETACHED_ONLY) {
        window.close();
        return;
      }
      // Last workspace: close the dead tab but keep the workspace itself.
      if (workspaces.length <= 1) {
        removeTerminal(ws.id, id);
        return;
      }
      _removeWorkspace(ws.id);
      return;
    }
    if (!isDesktop()) sendControl({ type: 'close', id });
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

  function syncTerminalSize(entry) {
    if (entry._resizeTimeout) clearTimeout(entry._resizeTimeout);
    entry._resizeTimeout = null;
    if (entry.dead || findTermById(entry.id)?.term !== entry) return;
    const { cols, rows } = entry.term;
    if (cols > 0 && rows > 0) sendControl({ type: 'resize', id: entry.id, cols, rows });
  }

  function fitTerm(entry, immediate = false) {
    if (!entry || !entry.el || entry.type === 'browser') return;
    if (entry.dead) return;
    // Never fit a hidden terminal. When the slot (or an ancestor group /
    // workspace container) is display:none, computed dimensions resolve to 0
    // and FitAddon calls term.resize(0-ish) — corrupting the buffer so the
    // tab renders blank the next time it is activated. A later fit when the
    // slot becomes visible (activateTerminal / syncBrowserSlots path) picks
    // the correct size up.
    if (entry.el.style.display === 'none' || entry.el.offsetParent === null) return;
    // Guard against zero-size slots (flex not settled yet) — FitAddon would
    // measure 0x0 and resize the terminal to 1x1, corrupting the buffer.
    const rect = entry.el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    try {
      // Frontend fits instantly for snappy visual feedback
      entry.fit.fit();
      // Keep drag updates coalesced, but never capture a stale grid in a timer.
      if (entry._resizeTimeout) clearTimeout(entry._resizeTimeout);
      if (immediate) syncTerminalSize(entry);
      else entry._resizeTimeout = setTimeout(() => syncTerminalSize(entry), 80);

    } catch { }
  }

  // Auto-fit each terminal when its slot actually changes size (split
  // creation, flex settling, sidebar toggle, etc.). The previous
  // pane-area-only ResizeObserver never saw internal flex changes, so
  // terminals kept a stale cols/rows until the sash drag forced a manual
  // fit. Observing the slot itself catches every layout change.
  const _termFitObserver = new ResizeObserver(entries => {
    if (_suppressResize) return;
    for (const en of entries) {
      const slot = en.target;
      if (!slot || !slot.id || !slot.id.startsWith('slot-')) continue;
      const id = slot.id.slice(5);
      const found = findTermById(id);
      if (!found || !found.term || found.term.type === 'browser') continue;
      if (found.term.el && (found.term.el.style.display === 'none' || found.term.el.offsetParent === null)) continue;
      // Skip zero-size transients (flex not yet settled)
      if (en.contentRect.width < 20 || en.contentRect.height < 20) continue;
      // No size dedupe here: ResizeObserver only fires on real changes, and a
      // cache updated only by this observer goes stale when a pane is fitted
      // elsewhere (e.g. after a suppressed sash/window resize). Returning to
      // the cached width then skipped the refit, leaving a narrow grid in a
      // wide pane and TUIs cut off. FitAddon is a no-op when the grid matches.
      if (found.term._fitObserverRaf) cancelAnimationFrame(found.term._fitObserverRaf);
      found.term._fitObserverRaf = requestAnimationFrame(() => {
        found.term._fitObserverRaf = null;
        fitTerm(found.term);
      });
    }
  });

  /* ═══════════════════════════════════════════════════════════════
   S P*LIT MANAGEMENT (VS Code recursive logic)
═══════════════════════════════════════════════════════════════ */

  function splitGroupDirectly(wsId, groupId, direction) {
    const wsp = findWs(wsId);
    if (!wsp || !wsp.layout) return;

    const cwd = _getFocusedCwd() || ((defaultTerminalPath && defaultTerminalPath.trim()) ? defaultTerminalPath.trim().replace(/^["']|["']$/g, '') : null);

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
    const id = uuid();
    const label = (cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Terminal';
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
      sendControl({ type: 'create', id, cols: slot.cols, rows: slot.rows, cwd, argv: newEntry.argv || [] });
      requestAnimationFrame(() => fitTerm(newEntry));
    }, 80);
    // The pane-area observer + _termFitObserver will refit after flex
    // settles, but a trailing pass guarantees the pre-existing pane (shrunk
    // to 50%) is also corrected even if its slot didn't fire.
    setTimeout(() => { for (const t of getWorkspaceTerminals(wsp)) fitTerm(t); }, 180);
    setTimeout(() => { for (const t of getWorkspaceTerminals(wsp)) fitTerm(t); }, 400);
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
      // Hide overlays belonging to the now-hidden groups in the same tick —
      // their white surfaces paint above the maximized pane until the next
      // sync, which shows up as a blank white page over the terminal.
      syncBrowserSlots();
    }

    // Update maximize button icons in all groups
    const MAXIMIZE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    const RESTORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>';

    container.querySelectorAll('.term-group').forEach(el => {
      const maxBtn = el.querySelector('[data-action="maximize"]');
      if (maxBtn) {
        const isNowMax = wsp._maximizedGroupId && el.id === 'group-' + wsp._maximizedGroupId;
        maxBtn.innerHTML = isNowMax ? RESTORE_ICON : MAXIMIZE_ICON;
        maxBtn.title = isNowMax ? 'Restore' : 'Maximize';
      }
    });

    // Update focus
    clearSlotFocus();
    focusedSlotId = null;
    const all = getWorkspaceTerminals(wsp);
    const active = all.find(x => x.id === wsp.activeTermId);
    if (active && active.el) {
      focusSlot(active);
      if (active.type !== 'browser') active.term.focus();
    }
    updateFocusedGroup();

    // Fit terminals after layout settles — 0ms can fire before the
    // display/position changes above have actually been painted.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      all.forEach(t => fitTerm(t));
      syncBrowserSlots();
    }));
    setTimeout(() => syncBrowserSlots(), 100);
  }

  /* ═══════════════════════════════════════════════════════════════
   P A*NE AREA RENDERING (Recursive execution tree)
═══════════════════════════════════════════════════════════════ */
  function getMinSizes(node) {
    if (!node) return { minW: 0, minH: 0 };
    const requestedW = typeof node.size?.width === 'number' ? node.size.width : 0;
    const requestedH = typeof node.size?.height === 'number' ? node.size.height : 0;
    if (node.type === 'group') return { minW: Math.max(SPLIT_MIN_PX, requestedW), minH: Math.max(SPLIT_MIN_PX, requestedH) };
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
      return { minW: Math.max(minW, requestedW), minH: Math.max(minH, requestedH) };
    }
    return { minW: 0, minH: 0 };
  }

  function applyLayoutNodeSize(el, node, parentDirection) {
    if (!node.size) return;
    const legacyCompact = node.size.width === 'min' && node.size.height === 'min';
    const mins = getMinSizes(node);
    for (const [axis, minimum] of [['width', mins.minW], ['height', mins.minH]]) {
      if (node.size[axis] === undefined) continue;
      // Old compact layouts stored both minima. Keep the cross axis filling
      // its split instead of leaving a blank strip beside the worker panes.
      if (legacyCompact && (!parentDirection || axis !== (parentDirection === 'row' ? 'width' : 'height'))) continue;
      const value = Math.max(minimum, node.size[axis] === 'min' ? 0 : node.size[axis]);
      el.style[axis] = value + 'px';
      el.style[axis === 'width' ? 'maxWidth' : 'maxHeight'] = value + 'px';
    }
    el.style.alignSelf = 'flex-end';
  }

  // ── Tab bar: reveal active tab & refresh chevron overflow state ──
  function scrollTabIntoView(groupEl, termId, behavior = 'smooth') {
    const tabs = groupEl.querySelector('.term-group-tabs');
    if (!tabs) return;
    const tab = tabs.querySelector(`.tg-tab[data-termid="${termId}"]`);
    if (!tab) return;
    const contentLeft = tab.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
    const contentRight = contentLeft + tab.offsetWidth;
    const cur = tabs.scrollLeft;
    if (contentLeft < cur) tabs.scrollTo({ left: contentLeft, behavior });
    else if (contentRight > cur + tabs.clientWidth) tabs.scrollTo({ left: contentRight - tabs.clientWidth, behavior });
  }

  function updateTabBarOverflow(groupEl) {
    const tabs = groupEl.querySelector('.term-group-tabs');
    const wrap = groupEl.querySelector('.term-group-tabs-wrap');
    if (!tabs || !wrap) return;
    const over = tabs.scrollWidth > tabs.clientWidth + 1;
    wrap.classList.toggle('overflow', over);
    wrap.classList.toggle('at-start', tabs.scrollLeft <= 2);
    wrap.classList.toggle('at-end', tabs.scrollLeft >= tabs.scrollWidth - tabs.clientWidth - 2);
  }

  function renderPaneArea() {
    const wsp = activeWs();
    // Invalidate cache for current workspace so switchWorkspacePane rebuilds it
    if (wsp && _wsDomCache[wsp.id]) {
      _wsDomCache[wsp.id].remove();
      delete _wsDomCache[wsp.id];
    }
    switchWorkspacePane();
    applyBackground();
  }

  function buildNodeDom(node, wsp, parentDirection) {
    if (!node) return null;

    if (node.type === 'split') {
      const container = document.createElement('div');
      container.className = `split-container ${node.direction}`;
      container.id = 'split-' + node.id;

      const mins = getMinSizes(node);
      container.style.minWidth = mins.minW + 'px';
      container.style.minHeight = mins.minH + 'px';
      applyLayoutNodeSize(container, node, parentDirection);

      node.children.forEach((child, idx) => {
        if (idx > 0) {
          const sash = document.createElement('div');
          sash.className = `sash ${node.direction}`;
          makeSashDraggableTree(sash, container, node, idx);
          container.appendChild(sash);
        }

        const childDom = buildNodeDom(child, wsp, node.direction);
        if (childDom) {
          const size = node.sizes[idx] !== undefined ? node.sizes[idx] : (100 / node.children.length);
          childDom.style.flex = `${size} 1 0%`;
          const axis = node.direction === 'row' ? 'width' : 'height';
          if (child.size?.[axis] !== undefined) childDom.style.flex = `0 0 ${childDom.style[axis]}`;
          container.appendChild(childDom);
        }
      });

      return container;
    }

    if (node.type === 'group') {
      const groupEl = document.createElement('div');
      groupEl.className = 'term-group';
      const maximizedTag = document.createElement('span');
      maximizedTag.className = 'maximized-tag';
      maximizedTag.textContent = 'Maximized';
      groupEl.addEventListener('pointermove', e => {
        if (!groupEl.classList.contains('maximized')) return;
        const bounds = groupEl.getBoundingClientRect();
        const right = bounds.right - 2, bottom = bounds.bottom - 2;
        const overTagCorner = e.clientX >= right - maximizedTag.offsetWidth && e.clientX <= right &&
          e.clientY >= bottom - maximizedTag.offsetHeight && e.clientY <= bottom;
        maximizedTag.classList.toggle('on-left', overTagCorner);
      });
      groupEl.addEventListener('pointerleave', () => maximizedTag.classList.remove('on-left'));
      groupEl.append(maximizedTag);
      groupEl.id = 'group-' + node.id;
      groupEl.dataset.groupId = node.id;
      applyLayoutNodeSize(groupEl, node, parentDirection);

      const header = document.createElement('div');
      header.className = 'term-group-header';
      header.addEventListener('mousedown', e => { if (!e.target.closest('[draggable]')) e.preventDefault(); });

      const tabsContainer = document.createElement('div');
      tabsContainer.className = 'term-group-tabs';
      tabsContainer.addEventListener('scroll', () => updateTabBarOverflow(groupEl));

      // Unified drop target calculation for the tab bar area
      const getTabBarDropTarget = (cx) => {
        const tabs = Array.from(tabsContainer.querySelectorAll('.tg-tab'))
          .filter(el => !el.classList.contains('dragging'));
        if (!tabs.length) return null;
        let closest = tabs[0];
        let bestDist = Infinity;
        for (const t of tabs) {
          const r = t.getBoundingClientRect();
          const dist = Math.abs(cx - (r.left + r.width / 2));
          if (dist < bestDist) { bestDist = dist; closest = t; }
        }
        const r = closest.getBoundingClientRect();
        const insertBefore = cx < (r.left + r.width / 2);
        return { closest, insertBefore };
      };

      const handleTabBarDragOver = (e) => {
        const hasExternal = window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
        if (!window.draggedTermId && !hasExternal) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
        const hit = getTabBarDropTarget(e.clientX);
        let beforeTabId = null;
        if (hit && hit.closest) {
          hit.closest.classList.add(hit.insertBefore ? 'drop-left' : 'drop-right');
          const targetId = hit.closest.dataset.termid;
          if (hit.insertBefore) {
            beforeTabId = targetId;
          } else {
            const curIdx = node.terminals.findIndex(x => x.id === targetId);
            beforeTabId = (curIdx !== -1 && curIdx + 1 < node.terminals.length) ? node.terminals[curIdx + 1].id : null;
          }
        }
        const activeDragId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId;
        if (activeDragId && window.electronAPI && window.electronAPI.tabDragHover) {
          window.electronAPI.tabDragHover({
            id: activeDragId,
            targetGroupId: node.id,
            zone: 'center',
            beforeTabId,
          });
        }
      };

      const handleTabBarDrop = (e) => {
        tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
        const extId = window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));

        // Cross-window drag (tab from a detached window): attach into this group
        if (!window.draggedTermId) {
          if (!extId) return;
          e.preventDefault();
          e.stopPropagation();
          let beforeTabId = null;
          const hit = getTabBarDropTarget(e.clientX);
          if (hit && hit.closest) {
            const targetId = hit.closest.dataset.termid;
            if (hit.insertBefore) {
              beforeTabId = targetId;
            } else {
              const curIdx = node.terminals.findIndex(x => x.id === targetId);
              beforeTabId = (curIdx !== -1 && curIdx + 1 < node.terminals.length) ? node.terminals[curIdx + 1].id : null;
            }
          }
          if (!findGroupContainingTerm(wsp.layout, extId)) {
            const api = window.electronAPI;
            if (api && api.tabDragDrop) {
              api.tabDragDrop({ id: extId, targetGroupId: node.id, zone: 'center', beforeTabId });
            }
          }
          window.externalDragTermId = null;
          return;
        }

        // Local drag
        e.preventDefault();
        e.stopPropagation();
        const draggedId = window.draggedTermId;
        const hit = getTabBarDropTarget(e.clientX);
        if (!hit || !hit.closest) {
          window.draggedTermId = null;
          window.dragSourceGroupId = null;
          return;
        }
        const targetTermId = hit.closest.dataset.termid;
        const insertBefore = hit.insertBefore;
        if (window.dragSourceGroupId === node.id) {
          const fromIdx = node.terminals.findIndex(x => x.id === draggedId);
          let toIdx = node.terminals.findIndex(x => x.id === targetTermId);
          if (fromIdx === -1 || toIdx === -1) return;
          const [moved] = node.terminals.splice(fromIdx, 1);
          toIdx = node.terminals.findIndex(x => x.id === targetTermId);
          const insertIdx = insertBefore ? toIdx : toIdx + 1;
          node.terminals.splice(insertIdx, 0, moved);
          node.activeTermId = draggedId;
          renderPaneArea();
          saveState();
        } else {
          handleTerminalDrop(draggedId, node.id, 'center', wsp);
        }
        window.draggedTermId = null;
        window.dragSourceGroupId = null;
      };

      tabsContainer.addEventListener('dragover', handleTabBarDragOver);
      tabsContainer.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !tabsContainer.contains(e.relatedTarget)) {
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
            el.classList.remove('drop-left', 'drop-right');
          });
        }
      });
      tabsContainer.addEventListener('drop', handleTabBarDrop);

      // VSCode-style edge paging chevrons, shown only while the bar overflows
      const tabsWrap = document.createElement('div');
      tabsWrap.className = 'term-group-tabs-wrap';
      const pageAmt = () => Math.max(80, Math.round(tabsContainer.clientWidth * 0.6));
      const chevLeft = document.createElement('div');
      chevLeft.className = 'tg-chevron tg-chevron-left';
      chevLeft.title = 'Scroll tabs left';
      chevLeft.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
      chevLeft.addEventListener('click', () => tabsContainer.scrollBy({ left: -pageAmt(), behavior: 'smooth' }));
      const chevRight = document.createElement('div');
      chevRight.className = 'tg-chevron tg-chevron-right';
      chevRight.title = 'Scroll tabs right';
      chevRight.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      chevRight.addEventListener('click', () => tabsContainer.scrollBy({ left: pageAmt(), behavior: 'smooth' }));
      tabsWrap.appendChild(tabsContainer);
      tabsWrap.appendChild(chevLeft);
      tabsWrap.appendChild(chevRight);
      tabsWrap.addEventListener('dragover', handleTabBarDragOver);
      tabsWrap.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !tabsWrap.contains(e.relatedTarget)) {
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
        }
      });
      tabsWrap.addEventListener('drop', handleTabBarDrop);

      header.addEventListener('dragover', (e) => {
        if (e.target.closest('.tg-actions')) return;
        handleTabBarDragOver(e);
      });
      header.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !header.contains(e.relatedTarget)) {
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
        }
      });
      header.addEventListener('drop', (e) => {
        if (e.target.closest('.tg-actions')) return;
        handleTabBarDrop(e);
      });

      node.terminals.forEach(t => {
        const tab = document.createElement('div');
        const isActive = t.id === node.activeTermId;
        tab.className = 'tg-tab' + (isActive ? ' active' : '') + (t.dead ? ' dead' : '');
        tab.dataset.termid = t.id;
        tab.draggable = true;

        tab.innerHTML = `
        <span class="tg-tab-dot${t.type === 'browser' ? ' tg-tab-icon' : ''}">${t.type === 'browser' ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><ellipse cx="8" cy="8" rx="3" ry="6.5"/><line x1="1.5" y1="8" x2="14.5" y2="8"/></svg>' : ''}</span>
        ${t.locked ? '<i class="ph ph-lock-simple tg-tab-lock"></i>' : ''}<span class="tg-tab-name">${escHtml(t.label)}</span>
        <span class="tg-tab-close" title="Close">✕</span>
        `;
        tab.title = t.label;
        addTabSessionHistory(tab, wsp, t);
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
          e.dataTransfer.setData('application/x-terminalvibe-tab', t.id);
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'move';
          window.draggedTermId = t.id;
          window.dragSourceGroupId = node.id;
          tab.classList.add('dragging');
          startResizing(true);
          // Announce the drag to the main process so every OTHER window can
          // recognize this tab if it's dropped there (drag data is unreadable
          // across renderers).
          if (window.electronAPI && window.electronAPI.tabDragStart) {
            window.electronAPI.tabDragStart({ id: t.id, cols: t.term ? t.term.cols : 80, rows: t.term ? t.term.rows : 24, cwd: t.cwd, label: t.label });
          }
        });
        tab.addEventListener('dragend', e => {
          tab.classList.remove('dragging');
          // Reset the drag source: a stale id makes the next cross-window drop
          // onto a pane look like a local drag (→ no left/right/top/bottom split).
          window.draggedTermId = null;
          window.dragSourceGroupId = null;
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
            el.classList.remove('drop-left', 'drop-right');
          });
          stopResizing();
          // Main window: releasing a terminal tab where no window accepted the drop
          // detaches it into its own window.
          if (!DETACHED_ONLY && t.type !== 'browser' && t.term
            && (!e.dataTransfer || e.dataTransfer.dropEffect === 'none')) {
            setTimeout(() => {
              if (window._tabMovedAway && window._tabMovedAway.has(t.id)) {
                window._tabMovedAway.delete(t.id);
                return;
              }
              const g = findGroupContainingTerm(wsp.layout, t.id);
              if (!g) return;
              detachTerminal(wsp.id, t.id);
            }, 80);
          }
          if (!DETACHED_ONLY && window.electronAPI && window.electronAPI.tabDragEnd) {
            window.electronAPI.tabDragEnd({ id: t.id, cancelled: true });
          }
        });

        // Detached window: the tab uses the same HTML5 drag technique as the
        // main window's tabs (draggable + dragstart/dragend, reorder still
        // works locally). On top of that, dragend reports the release
        // position to the main process — releasing outside this window
        // re-attaches the tab to the main window.
        if (DETACHED_ONLY) {
          // Track pointer presence during the drag: dragenter/dragover mean
          // the pointer is over THIS window; a dragleave with no
          // relatedTarget means it left the window entirely. At dragend this
          // state (not a timing heuristic) decides local-drop vs drag-out.
          if (!window._detachDragTrackInit) {
            window._detachDragTrackInit = true;
            window._detachDragInside = false;
            document.addEventListener('dragenter', () => { window._detachDragInside = true; }, true);
            document.addEventListener('dragover', () => { window._detachDragInside = true; }, true);
            document.addEventListener('dragleave', e => { if (!e.relatedTarget) window._detachDragInside = false; }, true);
          }
          tab.addEventListener('dragstart', () => {
            window._detachDragInside = true;
            try {
              const payload = serializeTermBuffer(t);
              if (payload) localStorage.setItem(DETACH_BUFFER_KEY(t.id), JSON.stringify(payload));
            } catch { }
          });
          tab.addEventListener('dragend', e => {
            const api = window.electronAPI;
            if (!api || !api.tabDragEnd) return;
            // dropEffect === 'none' means no local target accepted the drop —
            // the drag ended outside this window's handlers (the re-attach
            // case). Coordinates on dragend are often stale/clamped once the
            // pointer has left the window, so they're only a secondary signal.
            const unhandled = !e.dataTransfer || e.dataTransfer.dropEffect === 'none';
            const outside = e && (e.clientX < 0 || e.clientX > window.innerWidth || e.clientY < 0 || e.clientY > window.innerHeight);
            // Tracked dragenter/dragleave state: was the pointer still over
            // this window when the button was released?
            const insideAtEnd = !!window._detachDragInside;
            api.tabDragEnd({
              id: t.id,
              unhandled: !!unhandled,
              insideAtEnd,
              clientX: e ? e.clientX : null,
              clientY: e ? e.clientY : null,
              screenX: e ? e.screenX : null,
              screenY: e ? e.screenY : null,
              outside: !!outside,
              cols: t.term.cols, rows: t.term.rows, cwd: t.cwd,
            });
          });
        }

        tab.addEventListener('dragover', e => {
          const hasExternal = window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
          if (!window.draggedTermId && !hasExternal) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
            el.classList.remove('drop-left', 'drop-right');
          });
          const rect = tab.getBoundingClientRect();
          const midX = rect.left + rect.width / 2;
          const isLeft = e.clientX < midX;
          if (isLeft) {
            tab.classList.add('drop-left');
          } else {
            tab.classList.add('drop-right');
          }
          const activeDragId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId;
          if (activeDragId && window.electronAPI && window.electronAPI.tabDragHover) {
            let beforeTabId = null;
            if (isLeft) {
              beforeTabId = t.id;
            } else {
              const curIdx = node.terminals.findIndex(x => x.id === t.id);
              beforeTabId = (curIdx !== -1 && curIdx + 1 < node.terminals.length) ? node.terminals[curIdx + 1].id : null;
            }
            window.electronAPI.tabDragHover({
              id: activeDragId,
              targetGroupId: node.id,
              zone: 'center',
              beforeTabId,
            });
          }
        });
        tab.addEventListener('dragleave', (e) => {
          if (!e.relatedTarget || !tab.contains(e.relatedTarget)) {
            tab.classList.remove('drop-left', 'drop-right');
          }
        });
        tab.addEventListener('drop', e => {
          e.preventDefault();
          e.stopPropagation();
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
            el.classList.remove('drop-left', 'drop-right');
          });
          // Cross-window drag (tab from a detached window): attach it into
          // this group, at the release position relative to this tab.
          if (!window.draggedTermId) {
            const extId = window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));
            if (extId && !findGroupContainingTerm(wsp.layout, extId)) {
              const api = window.electronAPI;
              if (api && api.tabDragDrop) {
                const rect0 = tab.getBoundingClientRect();
                const isLeft = e.clientX < rect0.left + rect0.width / 2;
                let beforeTabId = null;
                if (isLeft) {
                  beforeTabId = t.id;
                } else {
                  const curIdx = node.terminals.findIndex(x => x.id === t.id);
                  beforeTabId = (curIdx !== -1 && curIdx + 1 < node.terminals.length) ? node.terminals[curIdx + 1].id : null;
                }
                api.tabDragDrop({
                  id: extId, targetGroupId: node.id, zone: 'center',
                  beforeTabId,
                });
              }
            }
            window.externalDragTermId = null;
            return;
          }
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

      header.appendChild(tabsWrap);

      const actions = document.createElement('div');
      actions.className = 'term-group-actions';
      actions.addEventListener('mousedown', e => e.preventDefault());

      const addTabBtn = document.createElement('div');
      addTabBtn.className = 'tg-btn';
      addTabBtn.title = 'New terminal in this group';
      addTabBtn.innerHTML = '<i class="ph ph-plus"></i>';
      addTabBtn.addEventListener('click', () => addTerminal(wsp.id, node.id));

      const splitH = document.createElement('div');
      splitH.className = 'tg-btn';
      splitH.title = 'Split Horizontal';
      splitH.innerHTML = '<i class="ph ph-square-split-horizontal"></i>';
      splitH.onclick = () => splitGroupDirectly(wsp.id, node.id, 'row');

      const splitV = document.createElement('div');
      splitV.className = 'tg-btn';
      splitV.title = 'Split Vertical';
      splitV.innerHTML = '<i class="ph ph-square-split-vertical"></i>';
      splitV.onclick = () => splitGroupDirectly(wsp.id, node.id, 'column');

      const addBrowserBtn = document.createElement('div');
      addBrowserBtn.className = 'tg-btn';
      addBrowserBtn.title = 'New browser tab';
      addBrowserBtn.innerHTML = '<i class="ph ph-globe"></i>';
      addBrowserBtn.onclick = () => addBrowserTab(wsp.id, node.id);

      const isMax = wsp._maximizedGroupId === node.id;
      const maxBtn = document.createElement('div');
      maxBtn.className = 'tg-btn';
      maxBtn.dataset.action = 'maximize';
      maxBtn.title = isMax ? 'Restore' : 'Maximize';
      maxBtn.innerHTML = isMax
        ? '<i class="ph ph-corners-in"></i>'
        : '<i class="ph ph-corners-out"></i>';
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
      const claudeSessionsItem = makeDropdownItem('Claude sessions…', '<i class="ph ph-clock-counter-clockwise"></i>', () => openClaudeHistory(wsp, node.terminals.find(t => t.id === node.activeTermId)));
      dropdown.appendChild(claudeSessionsItem);
      dropdown.appendChild(makeDropdownItem('Split horizontal', splitH.innerHTML, () => splitGroupDirectly(wsp.id, node.id, 'row')));
      dropdown.appendChild(makeDropdownItem('Split vertical', splitV.innerHTML, () => splitGroupDirectly(wsp.id, node.id, 'column')));
      dropdown.appendChild(makeDropdownItem(isMax ? 'Restore' : 'Maximize', maxBtn.innerHTML, () => { if (node.activeTermId) toggleMaximizeTerminal(wsp.id, node.activeTermId); }));

      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        claudeSessionsItem.hidden = node.terminals.find(t => t.id === node.activeTermId)?.type === 'browser';
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

      // Ensure the active tab is revealed (instant on full re-render)
      requestAnimationFrame(() => {
        updateTabBarOverflow(groupEl);
        if (node.activeTermId) scrollTabIntoView(groupEl, node.activeTermId, 'auto');
      });

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
        const showAs = t.type === 'browser' ? 'flex' : 'block';
        slot.style.display = isAct ? showAs : 'none';
        if (isAct && slot.id === focusedSlotId) slot.classList.add('focused');
        else slot.classList.remove('focused');
        body.appendChild(slot);
      });

      setupGroupDragAndDrop(body, node, wsp, overlay);

      // Click on group body focuses the active terminal
      body.addEventListener('mousedown', (e) => {
        // Configurable multi-select shortcut
        if (matchShortcutMouse(e, 'multiSelect')) {
          const activeEntry = node.terminals.find(t => t.id === node.activeTermId);
          if (activeEntry && activeEntry.type !== 'browser') {
            e.preventDefault(); e.stopPropagation();
            toggleMultiSelect(node.activeTermId);
          }
          return;
        }
        // Don't steal focus when clicking inside an iframe
        if (e.target.tagName === 'IFRAME') return;
        clearSlotFocus();
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
            if (activeEntry.browserContainer) activeEntry.browserContainer.classList.add('focused');
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
      // Re-ensure observed after cache re-attach (idempotent)
      try { if (entry.type !== 'browser') _termFitObserver.observe(entry.el); } catch { }
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

        const btnHistory = document.createElement('button');
        btnHistory.className = 'browser-btn';
        btnHistory.title = 'History';
        btnHistory.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 16 14"/></svg>';

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
        toolbar.appendChild(btnHistory);
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

        let loading = false;
        function showLoading(on) {
          loading = on;
          loadingBar.classList.toggle('active', on);
          btnReload.classList.toggle('spin', on);
        }

        function showError(url, msg) {
          if (window.electronAPI) window.electronAPI.browserHide(entry.id);
          contentWrap.style.background = '#fff';
          pageView.style.display = '';
          var friendlyMsg = msg;
          if (msg.includes('connect') || msg.includes('ECONNREFUSED') || msg.includes('timed out')) {
            friendlyMsg = 'Cannot connect to the site. It may be offline or unreachable.';
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
          if (window.electronAPI) window.electronAPI.browserHide(entry.id);
          contentWrap.style.background = '#fff';
          pageView.style.display = '';
          pageView.innerHTML = `
          <div class="browser-start-page">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
          <p>Enter a URL or search term above</p>
          </div>`;
        }

        /* Browser surface slot (reference technique): the page renders in a
           DOM element inside .browser-content — a <webview> tag on Electron
           (DOM element, separate process, loads any site) or a plain <iframe>
           elsewhere — so DOM chrome and the settings overlay can layer above it
           (a native WebContentsView always paints above the window's DOM).
           Absolute positioning + pixel pinning beats the classic 150px
           guest-attach sizing bug. */
        function getBrowserSurface() {
          const isElectron = isDesktop() && window.electronAPI;
          const tag = isElectron ? 'webview' : 'iframe';
          let surface = contentWrap.querySelector(tag + '.browser-surface');
          if (!surface) {
            if (!contentWrap.clientWidth || !contentWrap.clientHeight) {
              if (!contentWrap._waitRo) {
                contentWrap._waitRo = new ResizeObserver(() => {
                  if (!contentWrap.clientWidth || !contentWrap.clientHeight) return;
                  contentWrap._waitRo.disconnect();
                  contentWrap._waitRo = null;
                  const s = getBrowserSurface();
                  if (s && entry._surfaceSrc) s.src = targetUrl(entry._surfaceSrc);
                });
                contentWrap._waitRo.observe(contentWrap);
              }
              return null;
            }
            surface = document.createElement(tag);
            surface.className = 'browser-surface browser-fallback';
            surface.setAttribute('data-browser-surface-slot', entry.id);
            surface.style.cssText = 'width:100%;height:100% !important;border:0';
            contentWrap.appendChild(surface);
            // Electron's shadow iframe must stretch on both axes. Keep the
            // webview a flex container; display:block can leave the guest's
            // composited surface at its previous width during a split drag.
            const pinIframe = () => {
              const frame = surface.shadowRoot?.querySelector('iframe');
              if (!frame) return false;
              frame.style.cssText = 'display:block;flex:1 1 auto;width:100%;height:100%;min-width:0;min-height:0;border:0';
              return true;
            };
            if (isElectron && !pinIframe()) {
              const mo = new MutationObserver(() => { if (pinIframe()) mo.disconnect(); });
              mo.observe(surface, { childList: true, subtree: true });
            }
            if (isElectron) {
              surface.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes');
              surface.setAttribute('allowpopups', '');
              // Clicking inside the webview never reaches the host DOM, so the
              // .browser-slot mousedown handler can't mark the tab as focused.
              // The <webview> tag emits focus/blur DOM events when its guest
              // gains/loses focus — use them to keep the slot highlighted.
              surface.addEventListener('focus', () => {
                if (entry.type === 'browser') focusSlot(entry);
              });
              surface.addEventListener('dom-ready', () => { surface._guestReady = true; pinIframe(); });
              surface.addEventListener('did-start-loading', () => showLoading(true));
              surface.addEventListener('did-stop-loading', () => {
                entry._retryCount = 0;
                clearTimeout(entry._loadTimer);
                showLoading(false);
                resumeBrowserTab(entry);
              });
              surface.addEventListener('did-navigate', e => syncUrl(e.url));
              surface.addEventListener('did-navigate-in-page', e => syncUrl(e.url));
              surface.addEventListener('page-title-updated', e => setBrowserHistoryTitle(entry.url, e.title));
              surface.addEventListener('did-fail-load', (e, errorCode) => {
                if (errorCode === -3) return; // ERR_ABORTED = redirect, not real error
                // Retry a few times before giving up
                entry._retryCount = (entry._retryCount || 0) + 1;
                if (entry._retryCount <= 3) {
                  setTimeout(() => setSurfaceUrl(surface, targetUrl(entry.url)), 500);
                  return;
                }
                clearTimeout(entry._loadTimer);
                showLoading(false);
                showError(entry.url, 'Failed to load page.');
              });
              surface.addEventListener('new-window', e => { e.preventDefault(); openExternalUrl(e.url); });
            } else {
              surface.addEventListener('load', () => {
                clearTimeout(entry._loadTimer);
                showLoading(false);
                resumeBrowserTab(entry);
              });
              surface.addEventListener('error', () => {
                clearTimeout(entry._loadTimer);
                showLoading(false);
                showError(entry.url, 'Failed to load page.');
              });
            }
          }
          return surface;
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
          if (url && url.startsWith('file://') && isDesktop() && window.electronAPI) {
            // Electron iframes can't load file:// with nodeIntegration disabled from a http(s) page;
            // resolve to a local URL that is reachable. Falls back to the raw file URL.
            try {
              const p = url.slice(7);
              const resolved = window.electronAPI.resolveLocalPath(p);
              return (resolved && typeof resolved.then === 'function')
                ? url
                : ('asset://localhost/' + (resolved || p));
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
            if (isDesktop() && window.electronAPI) {
              return normalizeAssetUrl(window.electronAPI.resolveLocalPath(p).then ? 'asset://localhost/' + p : ('asset://localhost/' + p));
            }
            return 'file://' + p.replace(/\\/g, '/');
          }

          if (url.startsWith('file://') && isDesktop() && window.electronAPI) {
            return normalizeAssetUrl('asset://localhost/' + url.slice(7));
          }

          if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(url)) return url;
          if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url)) return 'http://' + url;
          if (!url.includes('.') || url.includes(' ')) {
            const tpl = searchEngine === 'custom' && customSearchUrl ? customSearchUrl : (SEARCH_ENGINES[searchEngine] || SEARCH_ENGINES.google);
            return tpl.replace('%s', encodeURIComponent(url));
          }
          return 'https://' + url;
        }

        function targetUrl(url) {
          if (!url) return url;
          if (isDesktop() && window.electronAPI) {
            // Electron native view: no proxy. asset:// / file:// resolve to local paths.
            if (url.startsWith('asset://')) {
              let filePath = decodeURIComponent(url.replace(/^asset:\/\/localhost\//, ''));
              if (!filePath.startsWith('/')) filePath = '/' + filePath;
              return 'file://' + filePath;
            }
            if (url.startsWith('file://')) return url;
            return url;
          }
          return url;
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
          // Electron records the final (post-redirect) URL via did-navigate → syncUrl.
          if (!(isDesktop() && window.electronAPI)) recordBrowserHistory(url);
          updateNavButtons();
          entry.label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 28) || 'browser';
          renderSidebar();

          /* DOM surface slot (reference technique): the page renders in a
             <webview> tag — a DOM element, so the settings overlay can cover it
             and the webview stays alive behind the modal. */
          pageView.style.display = 'none';
          if (entry._loadTimer) clearTimeout(entry._loadTimer);
          entry._loadTimer = setTimeout(() => {
            if (loading) {
              showLoading(false);
              showError(entry.url, 'Page load timed out. The site may be unreachable or require authentication.');
            }
          }, 20000);

          entry._surfaceSrc = url;
          entry.url = url;
          const surface = getBrowserSurface();
          if (!surface) return;
          setSurfaceUrl(surface, targetUrl(url));
        }

        // Setting webview.src makes Electron call loadURL() un-awaited, so every
        // navigation superseded mid-load (page JS redirect, user typing a new URL)
        // logs an ERR_ABORTED stack in main. Once the guest is attached, call
        // loadURL ourselves and swallow the benign abort.
        function setSurfaceUrl(surface, url) {
          if (surface._guestReady && surface.loadURL) surface.loadURL(url).catch(() => { });
          else surface.src = url;
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
          recordBrowserHistory(url);
          updateNavButtons();
          renderSidebar();
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
        btnHistory.addEventListener('click', () => { focusSlot(entry); openPalette('history'); });
        btnOpenExt.addEventListener('click', () => { if (entry.url && entry.url !== 'about:blank') openExternalUrl(entry.url); });

        bc.addEventListener('mousedown', (e) => {
          focusSlot(entry);
          syncBrowserSlots();
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
    try { _termFitObserver.observe(slot); } catch { }
    // Attach WebGL only if the slot is actually on screen (renderPaneArea opens
    // hidden terminals too; their contexts get attached later on activate).
    _syncWebgl(entry, slot.offsetParent !== null && slot.style.display !== 'none');
    applyTermBgImage(entry);
    updateTermLockBadge(entry);
    // Initial fit: ensure terminal fills its slot immediately on first open.
    // Use RAF to let flex layout settle, then fit if slot has non-zero size.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (entry.term && !entry.dead && entry.el && entry.el.offsetParent !== null) {
          const rect = entry.el.getBoundingClientRect();
          if (rect.width >= 20 && rect.height >= 20) fitTerm(entry);
        }
      });
    });

    // Ctrl+Alt+LeftClick toggles multi-select (skip browser tabs). Capture
    // phase: xterm must never see this click, or a TUI with mouse tracking
    // gets press/drag reports for a gesture that belongs to the app.
    slot.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.ctrlKey && e.altKey && entry.type !== 'browser') {
        e.preventDefault(); e.stopPropagation();
        toggleMultiSelect(entry.id);
      }
    }, true);
    slot.addEventListener('mousedown', () => {
      focusSlot(entry);
      entry.term.focus();
    });

    // Right-click on terminal body area
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtxMenu(e, 'terminal', { wsId: wsp.id, termId: entry.id, _fromBody: true });
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

      // Capture the visible layout before releasing requested sizes. Otherwise
      // switching back to old flex weights makes the divider jump on mouse-down.
      const panes = [...container.children].filter(c => !c.classList.contains('sash'));
      startSizes = panes.map(p => isRow ? p.offsetWidth : p.offsetHeight);
      const wsp = activeWs();
      if (wsp) syncSplitSizes(wsp.layout);

      // Nested size requests also contribute to an ancestor's minimum size.
      // Release the adjacent subtrees as well as the path to this divider so
      // a worker's requested pixels cannot keep the whole row/column locked.
      const release = (current, parent, index, subtree = false) => {
        if (subtree && current.type === 'split') {
          current.children.forEach((child, i) => release(child, current, i, true));
        }
        const sized = !!current.size;
        delete current.size;
        const el = document.getElementById((current.type === 'split' ? 'split-' : 'group-') + current.id);
        if (!el) return;
        if (sized) for (const key of ['width', 'height', 'maxWidth', 'maxHeight', 'alignSelf']) el.style[key] = '';
        const mins = getMinSizes(current);
        el.style.minWidth = mins.minW + 'px';
        el.style.minHeight = mins.minH + 'px';
        if (parent) el.style.flex = `${parent.sizes[index]} 1 0%`;
      };
      const releasePath = (current, parent, index) => {
        if (current !== node && (current.type !== 'split' || !current.children.some((child, i) => releasePath(child, current, i)))) return false;
        if (current === node) {
          release(current.children[childIdx - 1], current, childIdx - 1, true);
          release(current.children[childIdx], current, childIdx, true);
        }
        release(current, parent, index);
        return true;
      };
      if (wsp) releasePath(wsp.layout, null, 0);

      const dim = isRow ? 'width' : 'height';
      panes.forEach((p, i) => {
        p.style.willChange = dim;
        p.style.flex = 'none';
        p.style[dim] = startSizes[i] + 'px';
      });
      _suppressResize = true;
      startResizing();

      let moveRaf = null, lastEv = null;
      const onMove = (ev) => {
        lastEv = ev;
        if (!moveRaf) moveRaf = requestAnimationFrame(() => { moveRaf = null; applyMove(lastEv); });
      };
      const applyMove = (ev) => {
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
        // Move browser overlays in the same event as their split placeholders.
        // Waiting for ResizeObserver + another RAF leaves an exposed edge.
        syncBrowserSlots();
      };

      const onUp = () => {
        if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = null; applyMove(lastEv); }
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

    const getZoneFromPoint = (cx, cy) => {
      const rect = bodyEl.getBoundingClientRect();
      const x = cx - rect.left;
      const y = cy - rect.top;
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);

      const distLeft = x / w;
      const distRight = (w - x) / w;
      const distTop = y / h;
      const distBottom = (h - y) / h;
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);

      if (minDist === distLeft) return 'left';
      if (minDist === distRight) return 'right';
      if (minDist === distTop) return 'top';
      return 'bottom';
    };

    // Files dropped on a split go to that split's active terminal (no split overlay).
    const dropTarget = () => groupNode.terminals.find(t => t.id === groupNode.activeTermId) || groupNode.terminals[0];
    const isWorkspaceDrag = e => e.dataTransfer?.types.includes('application/x-terminalvibe-workspace');
    const isSessionDrag = e => isWorkspaceDrag(e) || e.dataTransfer?.types.includes('application/x-terminalvibe-session');
    const isAttachmentDrag = e => isSessionDrag(e) || isFileDrag(e);
    let sessionDropProcess=null, sessionDropProbe=null, lastSessionHover=null;
    const inSessionDropArea = e => {
      const terminal=dropTarget();
      if(!terminal?.el || terminal.type==='browser' || terminal.locked || terminal.dead) return false;
      if(e.target.closest?.('.session-overlay')) return false;
      const inside = rect => e.clientX>=rect.left && e.clientX<rect.right && e.clientY>=rect.top && e.clientY<rect.bottom;
      if(!inside(terminal.el.getBoundingClientRect())) return false;
      const sidebar=terminal.el.querySelector('.session-overlay');
      return !sidebar || !inside(sidebar.getBoundingClientRect());
    };
    const acceptsSessionDrop = e => inSessionDropArea(e) &&
      sessionDropProcess?.terminal===dropTarget() && Date.now()-sessionDropProcess.checkedAt<1000 &&
      /^(claude|claude-code)(\.exe)?$/i.test(sessionDropProcess.name || '');
    let sessionDropEffect = null;
    const clearSessionDropEffect = () => {sessionDropEffect?.remove();sessionDropEffect=null;};
    const showSessionDropEffect = () => {
      const terminal=dropTarget();
      if(!terminal?.el) return;
      if(!sessionDropEffect?.isConnected) {
        sessionDropEffect=document.createElement('div');sessionDropEffect.className='session-context-drop-effect';
        sessionDropEffect.setAttribute('aria-hidden','true');
        sessionDropEffect.innerHTML='<div class="session-context-drop-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11-9 9a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9-9"/></svg><span>Drop session to attach</span></div>';
        terminal.el.append(sessionDropEffect);
      }
      sessionDropEffect.querySelector('span').textContent = isFileDrag(lastSessionHover || {}) ? 'Drop files to attach' : isWorkspaceDrag(lastSessionHover || {}) ? 'Drop workspace to attach' : 'Drop session to attach';
      const rect=terminal.el.getBoundingClientRect();
      const sidebar=terminal.el.querySelector('.session-overlay')?.getBoundingClientRect();
      sessionDropEffect.style.left=Math.max(0,sidebar && sidebar.width ? sidebar.right-rect.left : 0)+'px';
    };
    const probeSessionDropTarget = e => {
      lastSessionHover=inSessionDropArea(e) ? e : null;
      if(!lastSessionHover) return;
      const terminal=dropTarget();
      if(sessionDropProbe || (sessionDropProcess?.terminal===terminal && Date.now()-sessionDropProcess.checkedAt<500)) return;
      const probe=checkTerminalRunning(terminal.id);sessionDropProbe=probe;
      probe.then(name=>{
        if(sessionDropProbe!==probe) return;
        sessionDropProbe=null;sessionDropProcess={terminal,name,checkedAt:Date.now()};
        if(lastSessionHover && dropTarget()===terminal && (isFileDrag(lastSessionHover) || (isWorkspaceDrag(lastSessionHover) && window.draggedWsId) || document.querySelector('.session-overlay.session-dragging')) && acceptsSessionDrop(lastSessionHover)) showSessionDropEffect();
        else clearSessionDropEffect();
      }).catch(()=>{sessionDropProbe=null;sessionDropProcess=null;clearSessionDropEffect();});
    };
    // Capture context drags before the terminal's textarea/default drop handlers.
    bodyEl.addEventListener('dragenter', e => {
      if(!isAttachmentDrag(e)) return;
      probeSessionDropTarget(e);
      e.stopPropagation();
      if(isFileDrag(e) && inSessionDropArea(e)) e.preventDefault();
      if(acceptsSessionDrop(e)) {e.preventDefault();showSessionDropEffect();}else clearSessionDropEffect();
    }, true);
    bodyEl.addEventListener('dragover', e => {
      if(!isAttachmentDrag(e)) return;
      probeSessionDropTarget(e);
      e.stopPropagation();
      const accepted = isFileDrag(e) ? inSessionDropArea(e) : acceptsSessionDrop(e);
      if(accepted) {e.preventDefault();e.dataTransfer.dropEffect='copy';}
      else e.dataTransfer.dropEffect='none';
      if(acceptsSessionDrop(e)) showSessionDropEffect(); else clearSessionDropEffect();
    }, true);
    bodyEl.addEventListener('dragleave', e => {
      if(!isAttachmentDrag(e)) return;
      e.stopPropagation();
      if(!e.relatedTarget || !bodyEl.contains(e.relatedTarget) || e.relatedTarget.closest?.('.session-overlay')) {lastSessionHover=null;clearSessionDropEffect();}
    }, true);
    bodyEl.addEventListener('drop', e => {
      if(!isAttachmentDrag(e)) return;
      e.preventDefault();e.stopPropagation();
      lastSessionHover=null;
      clearSessionDropEffect();
      if(isFileDrag(e)) {
        if(inSessionDropArea(e)) dropFilesIntoTerminal(dropTarget(), [...e.dataTransfer.files]).catch(err => console.error('[drop] failed:', err));
        return;
      }
      if(!acceptsSessionDrop(e)) return;
      if(isWorkspaceDrag(e)) {
        const source=findWs(e.dataTransfer.getData('application/x-terminalvibe-workspace'));
        if(source) attachContextToChat(dropTarget(),null,() => buildWorkspaceContext(source));
      } else attachContextToChat(dropTarget(),e.dataTransfer.getData('application/x-terminalvibe-session'));
    }, true);
    bodyEl.addEventListener('dragenter', e => {
      if (isFileDrag(e)) { e.preventDefault(); return; }
      const hasExternal = window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
      if (!window.draggedTermId && !hasExternal) return;
      e.preventDefault();
      dragDepth++;
      overlay.classList.add('active');
    });

    bodyEl.addEventListener('dragover', e => {
      if (isFileDrag(e)) {
        const t = dropTarget();
        if (t && t.type !== 'browser') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
        return;
      }
      const hasExternal = window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
      if (!window.draggedTermId && !hasExternal) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      overlay.classList.add('active');

      const zone = getZoneFromPoint(e.clientX, e.clientY);

      if (zone === 'left') {
        overlay.style.left = '0'; overlay.style.top = '0';
        overlay.style.width = '50%'; overlay.style.height = '100%';
      } else if (zone === 'right') {
        overlay.style.left = '50%'; overlay.style.top = '0';
        overlay.style.width = '50%'; overlay.style.height = '100%';
      } else if (zone === 'top') {
        overlay.style.left = '0'; overlay.style.top = '0';
        overlay.style.width = '100%'; overlay.style.height = '50%';
      } else {
        overlay.style.left = '0'; overlay.style.top = '50%';
        overlay.style.width = '100%'; overlay.style.height = '50%';
      }

      const activeDragId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId;
      if (activeDragId && window.electronAPI && window.electronAPI.tabDragHover) {
        window.electronAPI.tabDragHover({
          id: activeDragId,
          targetGroupId: groupNode.id,
          zone,
          beforeTabId: null,
        });
      }
    });

    bodyEl.addEventListener('dragleave', (e) => {
      dragDepth--;
      if (dragDepth <= 0 || !e.relatedTarget || !bodyEl.contains(e.relatedTarget)) {
        dragDepth = 0;
        overlay.classList.remove('active');
        if (window.electronAPI && window.electronAPI.tabDragHover) {
          window.electronAPI.tabDragHover({ id: null });
        }
      }
    });

    bodyEl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (isFileDrag(e)) { dropFilesIntoTerminal(dropTarget(), [...e.dataTransfer.files]).catch(err => console.error('[drop] failed:', err)); return; }
      dragDepth = 0;
      overlay.classList.remove('active');
      if (window.electronAPI && window.electronAPI.tabDragHover) {
        window.electronAPI.tabDragHover({ id: null });
      }

      const draggedId = window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));
      if (!draggedId) return;

      const zone = getZoneFromPoint(e.clientX, e.clientY);

      // Cross-window drag: the terminal lives in a detached window, not in
      // this layout — ask main to re-attach it here (splitting per zone)
      // instead of running the local move/split handler.
      if (!window.draggedTermId && !findGroupContainingTerm(wsp.layout, draggedId)) {
        const api = window.electronAPI;
        if (api && api.tabDragDrop) {
          api.tabDragDrop({ id: draggedId, targetGroupId: groupNode.id, zone });
        }
        window.externalDragTermId = null;
        return;
      }

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
        const maxTerm = activeTerminal();
        if (maxTerm) toggleMaximizeTerminal(wsp.id, maxTerm.id);
        else wsp._maximizedGroupId = null;
      }
      const groupEl = document.getElementById('group-' + targetGroupId)
        || document.getElementById(targetGroupId)
        || document.querySelector(`[data-group-id="${targetGroupId}"]`);
      if (groupEl) {
        const dir = (zone === 'left' || zone === 'right') ? 'row' : 'column';
        const currentSize = dir === 'row' ? groupEl.offsetWidth : groupEl.offsetHeight;
        const MIN_REQUIRED = 100;
        if (currentSize < MIN_REQUIRED) {
          if (typeof zoomBadge === 'function') zoomBadge("Not enough space");
          zone = 'center';
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

  // Move a tab (terminal or browser) from its current workspace into another
  // workspace (sidebar drag-and-drop). The entry object itself is moved, so the
  // PTY / browser session is preserved. Returns true on success.
  function moveTabToWorkspace(termId, targetWsId) {
    if (!termId || !targetWsId) return false;
    const found = findTermById(termId);
    if (!found) return false;
    const srcWs = found.ws;
    const targetWs = findWs(targetWsId);
    if (!targetWs || srcWs.id === targetWs.id) return false;
    const srcGroup = findGroupContainingTerm(srcWs.layout, termId);
    if (!srcGroup) return false;
    const idx = srcGroup.terminals.findIndex(t => t.id === termId);
    if (idx === -1) return false;
    const [entry] = srcGroup.terminals.splice(idx, 1);

    // Fix up source group activation + history
    if (srcGroup._history) srcGroup._history = srcGroup._history.filter(id => id !== termId);
    if (srcGroup.activeTermId === termId) {
      let nextId = null;
      if (srcGroup._history) {
        while (srcGroup._history.length) {
          const candidate = srcGroup._history.pop();
          if (candidate !== termId && srcGroup.terminals.some(t => t.id === candidate)) {
            nextId = candidate;
            break;
          }
        }
      }
      if (!nextId) {
        nextId = srcGroup.terminals.length
          ? srcGroup.terminals[Math.min(idx, srcGroup.terminals.length - 1)].id
          : null;
      }
      srcGroup.activeTermId = nextId;
    }
    if (srcWs.activeTermId === termId) {
      srcWs.activeTermId = srcGroup.activeTermId || null;
    }
    if (srcWs._maximizedGroupId === srcGroup.id && srcGroup.terminals.length === 0) {
      srcWs._maximizedGroupId = null;
    }
    srcWs.layout = removeEmptyGroups(srcWs.layout);
    if (!srcWs.layout) {
      // Keep the (now empty) workspace alive instead of deleting it.
      srcWs.layout = { type: 'group', id: 'group-' + uuid(), terminals: [], activeTermId: null };
      srcWs.activeTermId = null;
    } else {
      const remaining = getWorkspaceTerminals(srcWs);
      if (remaining.length && !remaining.some(t => t.id === srcWs.activeTermId)) {
        srcWs.activeTermId = remaining[0].id;
        const fallbackGroup = findGroupContainingTerm(srcWs.layout, srcWs.activeTermId);
        if (fallbackGroup && !fallbackGroup.activeTermId) fallbackGroup.activeTermId = srcWs.activeTermId;
      } else if (!remaining.length) {
        srcWs.activeTermId = null;
      }
    }

    // Insert into the target workspace: prefer the group holding its active tab.
    if (!targetWs.layout) {
      targetWs.layout = { type: 'group', id: 'group-' + uuid(), terminals: [entry], activeTermId: termId };
    } else {
      let targetGroup = (targetWs.activeTermId && findGroupContainingTerm(targetWs.layout, targetWs.activeTermId))
        || findFirstGroup(targetWs.layout);
      if (!targetGroup) {
        targetWs.layout = { type: 'group', id: 'group-' + uuid(), terminals: [entry], activeTermId: termId };
      } else {
        targetGroup.terminals.push(entry);
        if (!targetGroup._history) targetGroup._history = [];
        if (targetGroup.activeTermId) targetGroup._history.push(targetGroup.activeTermId);
        targetGroup.activeTermId = termId;
      }
    }
    targetWs.activeTermId = termId;

    // Drop cached DOM for both workspaces so stale slots are never reused.
    try {
      if (_wsDomCache[srcWs.id]) { _wsDomCache[srcWs.id].remove(); delete _wsDomCache[srcWs.id]; }
      if (_wsDomCache[targetWs.id]) { _wsDomCache[targetWs.id].remove(); delete _wsDomCache[targetWs.id]; }
    } catch { }

    renderSidebar();
    if (srcWs.id === activeWsId || targetWs.id === activeWsId) {
      renderPaneArea();
      if (srcWs.id === activeWsId) {
        const remaining = getWorkspaceTerminals(srcWs);
        if (remaining.length) {
          const toActivate = remaining.some(t => t.id === srcWs.activeTermId)
            ? srcWs.activeTermId : remaining[0].id;
          activateTerminal(srcWs.id, toActivate);
        } else {
          syncBrowserSlots();
        }
      }
    }
    // Keep the moved browser surface correctly positioned even when the target
    // workspace is not active yet (its container rebuilds on switch).
    try { syncBrowserSlots(); } catch { }
    // Moved the last tab out: drop the now-empty source workspace, same as
    // closing its last tab. Follow the tab if the source was active.
    if (!getWorkspaceTerminals(srcWs).length) {
      if (srcWs.id === activeWsId) activateWorkspace(targetWs.id);
      _removeWorkspace(srcWs.id);
      return true;
    }
    saveState();
    return true;
  }

  /* ═══════════════════════════════════════════════════════════════
   S I*DEBAR RENDERING
   ═══════════════════════════════════════════════════════════════ */
  function makeKeyboardButton(el, label) {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('keydown', e => {
      if (e.target === el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        e.stopPropagation();
        el.click();
      }
    });
  }

  function renderSidebar() {
    const sb = document.getElementById('sidebar-inner') || document.getElementById('sidebar');
    if (!sideOrder.length && (workspaces.length || folders.length)) rebuildSideOrder();
    const actionsEl = sb.querySelector('.sidebar-actions');
    sb.querySelectorAll('.ws-header, .ws-folder-row, .ws-btn, .ws-pin-label, .ws-pin-sep').forEach(e => e.remove());

    const clearDropMarks = () => {
      sb.querySelectorAll('.ws-btn.drop-above, .ws-btn.drop-below, .ws-btn.drop-into').forEach(el => el.classList.remove('drop-above', 'drop-below', 'drop-into'));
      sb.querySelectorAll('.ws-folder-row.drop-into, .ws-folder-row.drop-above, .ws-folder-row.drop-below').forEach(el => el.classList.remove('drop-into', 'drop-above', 'drop-below'));
    };

    // Tab being dragged (local tab or detached-window tab announced via IPC).
    // Workspace/folder drags set draggedWsId/draggedFolderId instead, so those
    // are excluded here — this helper only reports tab drags.
    const getSidebarTabDragId = () => {
      if (window.draggedWsId || window.draggedFolderId) return null;
      return window.draggedTermId || window.externalDragTermId || window.lastExternalDragTermId || null;
    };

    // Container-level drop handling for gaps between and around sidebar items
    if (!sb._wsSidebarDrop) {
      sb._wsSidebarDrop = true;
      const findClosestItem = (cy) => {
        const items = Array.from(sb.querySelectorAll('.ws-btn[draggable="true"], .ws-folder-row[draggable="true"]'))
          .filter(el => el.dataset.slot !== undefined);
        if (!items.length) return null;
        let closest = items[0];
        let bestDist = Infinity;
        for (const el of items) {
          const r = el.getBoundingClientRect();
          const dist = Math.abs(cy - (r.top + r.height / 2));
          if (dist < bestDist) { bestDist = dist; closest = el; }
        }
        return closest;
      };
      sb.addEventListener('dragover', (e) => {
        const dw = window.draggedWsId;
        const df = window.draggedFolderId;
        if (!dw && !df) return;
        if (e.target !== sb) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const closest = findClosestItem(e.clientY);
        if (!closest) return;
        clearDropMarks();
        const r = closest.getBoundingClientRect();
        if (e.clientY > r.top + r.height / 2) {
          closest.classList.add('drop-below');
        } else {
          closest.classList.add('drop-above');
        }
      });
      sb.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !sb.contains(e.relatedTarget)) {
          clearDropMarks();
        }
      });
      sb.addEventListener('drop', (e) => {
        const dw = window.draggedWsId;
        const df = window.draggedFolderId;
        if (!dw && !df) return;
        if (e.target !== sb) return;
        e.preventDefault();
        e.stopPropagation();
        const closest = findClosestItem(e.clientY);
        clearDropMarks();
        window._wsDragged = true;
        setTimeout(() => { window._wsDragged = false; }, 0);
        if (!closest) {
          if (df) { window.draggedFolderId = null; moveTopLevelItem('folder', df, 0); }
          else if (dw) { window.draggedWsId = null; moveTopLevelItem('ws', dw, 0); }
          return;
        }
        const slot = parseInt(closest.dataset.slot, 10);
        const r = closest.getBoundingClientRect();
        const below = e.clientY > r.top + r.height / 2;
        if (df) {
          window.draggedFolderId = null;
          moveTopLevelItem('folder', df, slot + (below ? 1 : 0));
        } else if (dw) {
          window.draggedWsId = null;
          moveTopLevelItem('ws', dw, slot + (below ? 1 : 0));
        }
      });
    }

    // Header above the workspace list: "Workspaces" title + new workspace / new folder.
    const header = document.createElement('div');
    header.className = 'ws-header';
    const headerTitle = document.createElement('span');
    headerTitle.className = 'ws-header-title';
    headerTitle.textContent = 'Workspaces';
    header.appendChild(headerTitle);

    const headerActions = document.createElement('div');
    headerActions.className = 'ws-header-actions';

    const addBtn = document.createElement('div');
    addBtn.className = 'ws-add';
    makeKeyboardButton(addBtn, 'New workspace');
    addBtn.title = 'New workspace';
    addBtn.innerHTML = '<i class="ph ph-plus"></i>';
    addBtn.addEventListener('click', () => {
      showPrompt('New workspace', 'Workspace ' + (workspaces.length + 1), { color: '', icon: '' }, (value, color, icon) => {
        createWorkspace(value.trim() || undefined, undefined, { color, icon });
        renderSidebar();
        saveState();
      });
    });
    // Drop on ws-add = move to the front of the top-level flow
    addBtn.addEventListener('dragover', e => {
      if (!window.draggedWsId && !window.draggedFolderId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    addBtn.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const dw = window.draggedWsId;
      const df = window.draggedFolderId;
      window.draggedWsId = null;
      window.draggedFolderId = null;
      window._wsDragged = true;
      setTimeout(() => { window._wsDragged = false; }, 0);
      if (df) moveTopLevelItem('folder', df, 0);
      else if (dw) moveTopLevelItem('ws', dw, 0);
    });
    headerActions.appendChild(addBtn);

    const folderBtn = document.createElement('div');
    folderBtn.className = 'ws-folder-add-btn';
    folderBtn.title = 'New folder';
    makeKeyboardButton(folderBtn, 'New folder');
    folderBtn.innerHTML = '<i class="ph ph-folder-plus"></i>';
    folderBtn.addEventListener('click', () => showPrompt('New folder', '', { color: '' }, (value, color) => createFolder(value, color)));
    headerActions.appendChild(folderBtn);

    header.appendChild(headerActions);
    sb.insertBefore(header, sb.firstChild);
    // Plugin banner widgets ("sidebar-top", e.g. an image above the
    // workspaces) must stay above the header: renderSidebar rebuilds the
    // header on every render, so re-assert their position here.
    const _topWidgets = [...sb.querySelectorAll('[data-plugin-widget]')]
      .filter(el => el.dataset.widgetPosition === 'sidebar-top');
    for (let i = _topWidgets.length - 1; i >= 0; i--) sb.insertBefore(_topWidgets[i], sb.firstChild);

    // ── Workspace button builder (shared by root list and folders) ──
    // slot is the sideOrder index for top-level buttons (undefined for folder children)
    // wsSeq numbers each workspace button in top-to-bottom display order (used as the
    // collapsed-sidebar title, e.g. "3").
    let wsSeq = 0;
    const buildWsBtn = (wsp, folderKey, slot) => {
      const btn = document.createElement('div');
      const isActive = wsp.id === activeWsId;
      btn.className = 'ws-btn' + (isActive ? ' active' : '');
      btn.draggable = true;
      btn.dataset.wsid = wsp.id;
      if (slot !== undefined) btn.dataset.slot = String(slot);
      const wsNum = ++wsSeq;
      const tabCount = getWorkspaceTerminals(wsp).length;
      const isInFolder = folderKey != null;
      // Workspace icons come in several shapes: a data-URL/URL string
      // (uploaded image), { image: id } (unresolved file ref — normally
      // resolved to a data URL at restore), or { phosphor: name } (icon-font
      // reference kept in older states). Anything unrenderable falls back to
      // the number badge; this must never throw (see escHtml note above).
      const wsIconHtml = () => {
        const icon = wsp.icon;
        if (typeof icon === 'string' && icon) {
          return `<img class="ws-icon" src="${escHtml(icon)}" alt="" draggable="false">`;
        }
        if (icon && typeof icon === 'object' && typeof icon.phosphor === 'string' && icon.phosphor) {
          return `<i class="ws-icon ws-icon-ph ph ph-${escHtml(icon.phosphor)}" aria-hidden="true"></i>`;
        }
        return `<span class="ws-label">${wsNum}</span>`;
      };
      const labelHtml = wsIconHtml();
      btn.innerHTML = `<span class="ws-strip"></span>${labelHtml}<div class="ws-info"><span class="ws-name">${escHtml(wsp.label)}</span><div class="ws-procs"></div></div><span class="ws-meta">${wsp.pinned && !isInFolder ? '<span class="ws-pin-icon"><i class="ph ph-push-pin-simple"></i></span>' : ''}<span class="ws-count">${tabCount}</span></span>`;
      if (wsp.pinned) btn.classList.add('pinned');
      btn.title = wsp.label;
      makeKeyboardButton(btn, wsp.label);
      btn.setAttribute('aria-current', isActive ? 'true' : 'false');
      if (wsp.color) {
        btn.dataset.color = wsp.color;
        btn.style.setProperty('--ws-color', wsp.color);
      }
      btn.addEventListener('click', (e) => {
        if (window._wsDragged) { window._wsDragged = false; return; }
        activateWorkspace(wsp.id);
      });
      btn.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); _suppressPasteUntil = Date.now() + 200; removeWorkspace(wsp.id); } });
      btn.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'workspace', wsp.id); });

      // Drag & drop: move / reorder (folder-aware)
      btn.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/x-terminalvibe-workspace', wsp.id);
        e.dataTransfer.setData('text/plain', wsp.id);
        e.dataTransfer.effectAllowed = 'copyMove';
        btn.classList.add('dragging');
        window.draggedWsId = wsp.id;
        startResizing();
      });
      btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        window.draggedWsId = null;
        document.querySelectorAll('.session-context-drop-effect').forEach(el => el.remove());
        clearDropMarks();
        stopResizing();
      });
      btn.addEventListener('dragover', e => {
        // ── Tab drop: dragging a tab onto a workspace button moves it there ──
        const tabDragId = getSidebarTabDragId();
        if (tabDragId) {
          // Already in this workspace → no-op (avoids flicker + self-move).
          const src = findTermById(tabDragId);
          if (src && src.ws.id === wsp.id) return;
          e.preventDefault();
          e.stopPropagation();
          try { e.dataTransfer.dropEffect = 'move'; } catch { }
          clearDropMarks();
          btn.classList.add('drop-into');
          const api = window.electronAPI;
          if (api && api.tabDragHover && !window.draggedTermId) {
            const tws = findWs(wsp.id);
            const tg = tws ? ((tws.activeTermId && findGroupContainingTerm(tws.layout, tws.activeTermId)) || findFirstGroup(tws.layout)) : null;
            if (tg) { try { api.tabDragHover({ id: tabDragId, targetGroupId: tg.id, zone: 'center', beforeTabId: null }); } catch { } }
          }
          return;
        }
        const dw = window.draggedWsId;
        const df = window.draggedFolderId;
        if (slot !== undefined) {
          // top-level target: accept root/folder-child workspaces and folders
          if (!dw && !df) return;
          if (dw === wsp.id) return;
        } else {
          // folder-internal target: only workspace drags (reorder / move into this folder)
          if (!dw || dw === wsp.id) return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = btn.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        clearDropMarks();
        btn.classList.add(above ? 'drop-above' : 'drop-below');
        if (slot === undefined) e.stopPropagation();
      });
      btn.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !btn.contains(e.relatedTarget)) {
          btn.classList.remove('drop-above', 'drop-below', 'drop-into');
        }
      });
      btn.addEventListener('drop', e => {
        // ── Tab drop: include the dragged tab in this workspace ──
        const tabDragId = getSidebarTabDragId();
        if (tabDragId) {
          e.preventDefault();
          e.stopPropagation();
          clearDropMarks();
          if (window.draggedTermId) {
            const termId = window.draggedTermId;
            const src = findTermById(termId);
            // Last tab out would leave the source empty → it gets removed, so ask first.
            if (src && src.ws.id !== wsp.id && getWorkspaceTerminals(src.ws).length === 1) {
              showConfirm(`Move the last tab and close "${src.ws.label}"?`, () => moveTabToWorkspace(termId, wsp.id));
            } else {
              moveTabToWorkspace(termId, wsp.id);
            }
          } else {
            // Detached-window tab: ask main to re-attach it into this workspace's group.
            const extId = window.externalDragTermId || window.lastExternalDragTermId || tabDragId;
            const tws = findWs(wsp.id);
            let tg = tws ? ((tws.activeTermId && findGroupContainingTerm(tws.layout, tws.activeTermId)) || findFirstGroup(tws.layout)) : null;
            if (!tg && tws && !tws.layout) {
              tg = { type: 'group', id: 'group-' + uuid(), terminals: [], activeTermId: null };
              tws.layout = tg;
            }
            const api = window.electronAPI;
            if (api && api.tabDragDrop && tg) {
              try { if (api.tabDragHover) api.tabDragHover({ id: null }); } catch { }
              api.tabDragDrop({ id: extId, targetGroupId: tg.id, zone: 'center' });
            }
            window.externalDragTermId = null;
          }
          return;
        }
        e.preventDefault();
        const dw = window.draggedWsId;
        const df = window.draggedFolderId;
        if (slot !== undefined) {
          if (!dw && !df) return;
          if (dw === wsp.id) return;
          const rect = btn.getBoundingClientRect();
          const above = e.clientY < rect.top + rect.height / 2;
          e.stopPropagation();
          clearDropMarks();
          window._wsDragged = true;
          setTimeout(() => { window._wsDragged = false; }, 0);
          if (df) {
            window.draggedFolderId = null;
            moveTopLevelItem('folder', df, slot + (above ? 0 : 1));
          } else {
            window.draggedWsId = null;
            moveTopLevelItem('ws', dw, slot + (above ? 0 : 1));
          }
        } else {
          if (!dw || dw === wsp.id) return;
          const rect = btn.getBoundingClientRect();
          const above = e.clientY < rect.top + rect.height / 2;
          const to = getGroupList(folderKey).findIndex(w => w.id === wsp.id);
          e.stopPropagation();
          clearDropMarks();
          window.draggedWsId = null;
          window._wsDragged = true;
          setTimeout(() => { window._wsDragged = false; }, 0);
          moveWsTo(dw, folderKey, above ? to : to + 1);
        }
      });

      if (showWsProcs) updateWorkspaceProcs(wsp, btn);
      return btn;
    };

    // ── Folder row builder ──
    // Renders a folder as a tree node with its child workspaces nested below.
    const buildFolderEl = (folder, slot) => {
      const wss = getGroupList(folder.id);
      const isLast = folders[folders.length - 1]?.id === folder.id;

      const row = document.createElement('div');
      row.className = 'ws-folder-row' + (folder.collapsed ? ' collapsed' : '') + (isLast ? ' last' : '');
      row.dataset.slot = String(slot);
      if (folder.color) {
        row.dataset.color = folder.color;
        row.style.setProperty('--ws-color', folder.color);
      }

      const headerEl = document.createElement('div');
      headerEl.className = 'ws-folder-header';
      headerEl.title = folder.label;
      makeKeyboardButton(headerEl, folder.label);
      headerEl.setAttribute('aria-expanded', String(!folder.collapsed));
      headerEl.innerHTML = `
        <span class="ws-folder-icon ws-folder-icon-closed"><i class="ph ph-folder"></i></span>
        <span class="ws-folder-icon ws-folder-icon-open"><i class="ph ph-folder-open"></i></span>
        <span class="ws-folder-name">${escHtml(folder.label)}</span>
        ${folder.pinned ? '<span class="ws-folder-pin-icon"><i class="ph ph-push-pin-simple"></i></span>' : ''}
        <span class="ws-folder-count">${wss.length}</span>
        <span class="ws-folder-actions">
          <button type="button" class="ws-folder-action ws-folder-add" title="New workspace here"><i class="ph ph-plus" aria-hidden="true"></i></button>
          <button type="button" class="ws-folder-action ws-folder-more" title="Folder actions" aria-haspopup="menu"><i class="ph ph-dots-three" aria-hidden="true"></i></button>
        </span>`;
      headerEl.querySelectorAll('.ws-folder-action').forEach(action => {
        action.setAttribute('aria-label', action.title + ': ' + folder.label);
        action.addEventListener('mousedown', e => e.stopPropagation());
        action.addEventListener('dragstart', e => {e.preventDefault();e.stopPropagation();});
      });
      if (folder.pinned) row.classList.add('pinned');

      headerEl.addEventListener('click', e => {
        if (e.target.closest('.ws-folder-action')) return;
        if (window._wsDragged || window.draggedFolderId) { window._wsDragged = false; return; }
        toggleFolderCollapsed(folder.id);
      });
      headerEl.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'folder', folder.id); });

      headerEl.querySelector('.ws-folder-add').addEventListener('click', e => { e.stopPropagation(); createWorkspace(undefined, folder.id); });
      headerEl.querySelector('.ws-folder-more').addEventListener('click', e => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        showCtxMenu({pageX:rect.left + window.scrollX, pageY:rect.bottom + window.scrollY + 6}, 'folder', folder.id);
      });

      // Drop onto the folder button:
      //   folder → top half = insert above, bottom half = below
      //   ws closed folder → top third = above, middle third = into, bottom third = below
      //   ws open folder   → header top half = above, header bottom half = into,
      //                      anything below the header (the folder's content) = below the whole container
      row.addEventListener('dragover', e => {
        const dw = window.draggedWsId;
        const df = window.draggedFolderId;
        if (!dw && !df) return;
        if (df === folder.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const hr = headerEl.getBoundingClientRect();
        const open = !folder.collapsed && wss.length > 0;
        const p = (e.clientY - hr.top) / hr.height;
        let zone;
        if (df) {
          zone = p < 0.5 ? 'above' : 'below';
        } else if (open) {
          zone = e.clientY < hr.top + hr.height / 2 ? 'above' : (e.clientY <= hr.bottom + 1 ? 'into' : 'below');
        } else {
          zone = p < 0.34 ? 'above' : (p < 0.66 ? 'into' : 'below');
        }
        clearDropMarks();
        row.classList.add(zone === 'above' ? 'drop-above' : zone === 'into' ? 'drop-into' : 'drop-below');
      });
      row.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !row.contains(e.relatedTarget)) {
          row.classList.remove('drop-into', 'drop-above', 'drop-below');
        }
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const dw = window.draggedWsId;
        const df = window.draggedFolderId;
        if (!dw && !df) return;
        if (df === folder.id) return;
        const hr = headerEl.getBoundingClientRect();
        const open = !folder.collapsed && wss.length > 0;
        const p = (e.clientY - hr.top) / hr.height;
        let zone;
        if (df) {
          zone = p < 0.5 ? 'above' : 'below';
        } else if (open) {
          zone = e.clientY < hr.top + hr.height / 2 ? 'above' : (e.clientY <= hr.bottom + 1 ? 'into' : 'below');
        } else {
          zone = p < 0.34 ? 'above' : (p < 0.66 ? 'into' : 'below');
        }
        e.stopPropagation();
        clearDropMarks();
        window._wsDragged = true;
        setTimeout(() => { window._wsDragged = false; }, 0);
        if (df) {
          window.draggedFolderId = null;
          moveTopLevelItem('folder', df, slot + (zone === 'above' ? 0 : 1));
        } else if (zone === 'above') {
          window.draggedWsId = null;
          moveTopLevelItem('ws', dw, slot);
        } else if (zone === 'into') {
          window.draggedWsId = null;
          moveWsTo(dw, folder.id, getGroupList(folder.id).length);
        } else {
          window.draggedWsId = null;
          moveTopLevelItem('ws', dw, slot + 1);
        }
      });

      // Drag a folder row to reorder folders
      row.draggable = true;
      row.addEventListener('dragstart', e => {
        if (e.target.closest('.ws-btn')) return;
        if (window.draggedWsId) { e.preventDefault(); return; }
        e.dataTransfer.setData('application/x-terminalvibe-folder', folder.id);
        e.dataTransfer.setData('text/plain', folder.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
        window.draggedFolderId = folder.id;
        startResizing();
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        window.draggedFolderId = null;
        clearDropMarks();
        stopResizing();
      });

      row.appendChild(headerEl);

      // Tree children: nested workspace buttons under the folder row.
      // When the folder is collapsed, only the active workspace stays visible.
      const visibleWs = folder.collapsed ? wss.filter(w => w.id === activeWsId) : wss;
      if (visibleWs.length) {
        const children = document.createElement('div');
        children.className = 'ws-folder-children';
        for (const wsp of visibleWs) children.appendChild(buildWsBtn(wsp, folder.id));
        row.appendChild(children);
      }
      return row;
    };

    // ── Render the top-level flow from sideOrder (root workspaces + folders) ──
    // Pinned items always appear first, then unpinned in sideOrder order
    const pinnedItems = [];
    const unpinnedItems = [];
    for (const e of sideOrder) {
      if (e.type === 'ws') {
        const wsp = findWs(e.id);
        if (wsp) (wsp.pinned ? pinnedItems : unpinnedItems).push({ ...e, _wsp: wsp });
      } else {
        const folder = folders.find(f => f.id === e.id);
        if (folder) (folder.pinned ? pinnedItems : unpinnedItems).push({ ...e, _folder: folder });
      }
    }
    if (pinnedItems.length) {
      const pinLabel = document.createElement('div');
      pinLabel.className = 'ws-pin-label' + (pinnedCollapsed ? ' collapsed' : '');
      pinLabel.title = pinnedCollapsed ? 'Expand pinned' : 'Collapse pinned';
      pinLabel.innerHTML = `<i class="ph ph-caret-down ws-pin-caret"></i><span>Pinned</span><span class="ws-pin-count">${pinnedItems.length}</span>`;
      pinLabel.addEventListener('click', () => {
        pinnedCollapsed = !pinnedCollapsed;
        renderSidebar();
        saveState();
      });
      sb.insertBefore(pinLabel, actionsEl);
      let pinnedSlot = 0;
      if (!pinnedCollapsed) {
        for (const e of pinnedItems) {
          if (e.type === 'ws') {
            if (e._wsp) sb.insertBefore(buildWsBtn(e._wsp, null, pinnedSlot), actionsEl);
          } else {
            if (e._folder) sb.insertBefore(buildFolderEl(e._folder, pinnedSlot), actionsEl);
          }
          pinnedSlot++;
        }
      }
      const pinSep = document.createElement('div');
      pinSep.className = 'ws-pin-sep';
      sb.insertBefore(pinSep, actionsEl);
    }
    let unpinnedSlot = pinnedItems.length;
    for (const e of unpinnedItems) {
      if (e.type === 'ws') {
        if (e._wsp) sb.insertBefore(buildWsBtn(e._wsp, null, unpinnedSlot), actionsEl);
      } else {
        if (e._folder) sb.insertBefore(buildFolderEl(e._folder, unpinnedSlot), actionsEl);
      }
      unpinnedSlot++;
    }
  }

  /* ── Workspace sidebar: live processes per workspace ──
     Show up to three processes and a count of any remaining processes.
     The tooltip lists all running processes (excluding idle shells). */
  const _wsProcsCache = new Map(); // wsId -> { processes: {id,name,label,cwd}[], termIds, ts }
  const _WS_PROCS_TTL = 900;
  // Idle shells and unidentified sessions are never shown in the workspace
  // button: an idle powershell.exe / cmd.exe / wsl.exe is not a "running
  // process", and 'unknown' (backend couldn't tell) must not render as text.
  const _WS_PROCS_HIDE_RE = /^(unknown|bash|zsh|sh|fish|dash|ash|ksh|tcsh|csh|pwsh|powershell|cmd|wsl|nu|conhost|openconsole|windowsterminal)$/i;
  const _isHiddenWsProc = (n) => {
    if (!n) return true;
    const base = String(n).trim().replace(/\.exe$/i, '');
    return !base || _WS_PROCS_HIDE_RE.test(base);
  };

  // Brand logo for a known process (proc-icons.js), else a generic terminal glyph.
  function procIconHtml(name, fallback = 'ph-terminal-window') {
    const key = String(name).toLowerCase().replace(/[\d.]+$/, '');
    if (key === 'codex') return '<i class="ws-proc-icon ph ph-open-ai-logo"></i>';
    const slug = window.PROC_ICON_ALIAS?.[key];
    const d = slug && window.PROC_ICON_PATHS?.[slug];
    return d ? `<svg class="ws-proc-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
             : `<i class="ws-proc-icon ph ${fallback}"></i>`;
  }

  function renderWsProcs(procsEl, processes) {
    if (!procsEl) return;
    // Preserve the hover/focus target while polling updates the count and list.
    const sig = JSON.stringify(processes);
    if (procsEl.dataset.sig === sig) return;
    procsEl.dataset.sig = sig;
    const workspaceButton = procsEl.closest('.ws-btn');
    workspaceButton.dataset.tip = workspaceButton.querySelector('.ws-name')?.textContent || 'Workspace';
    if (!processes?.length) {
      procsEl.replaceChildren();
      delete workspaceButton.dataset.tipProcesses;
      return;
    }
    workspaceButton.dataset.tipProcesses = sig;
    // Same process in several panes → one chip with a count, not duplicates.
    const groups = [];
    for (const process of processes) {
      const group = groups.find(g => g.name === process.name);
      if (group) group.count++; else groups.push({ name: process.name, count: 1 });
    }
    const shown = groups.slice(0, 3);
    const previousRows = [...procsEl.querySelectorAll('.ws-proc:not(.ws-proc-more)')];
    previousRows.slice(shown.length).forEach(row => row.remove());
    shown.forEach((process, index) => {
      let row = previousRows[index];
      if (!row) {
        row = document.createElement('span'); row.className = 'ws-proc';
        row.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } });
        row.addEventListener('auxclick', e => { e.preventDefault(); e.stopPropagation(); });
        row.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
        procsEl.insertBefore(row, procsEl.querySelector('.ws-proc-more'));
      }
      const html = `${procIconHtml(process.name)}${process.count > 1 ? `<span class="ws-proc-count">${process.count}</span>` : ''}<span>${escHtml(process.name)}</span>`;
      if (row.innerHTML !== html) row.innerHTML = html;
    });
    let count = procsEl.querySelector('.ws-proc-more');
    const remaining = groups.length - shown.length;
    if (!remaining) { count?.remove(); return; }
    if (!count) {
      count = document.createElement('span');
      count.className = 'ws-proc ws-proc-more'; count.draggable = false;
      // Process details belong to the workspace card; left clicks bubble to it.
      count.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } });
      count.addEventListener('auxclick', e => { e.preventDefault(); e.stopPropagation(); });
      count.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
      procsEl.append(count);
    }
    count.textContent = '+' + remaining;
    count.setAttribute('aria-label', `${remaining} more running ${remaining === 1 ? 'process' : 'processes'}`);
  }

  function updateWorkspaceProcs(wsp, btn) {
    const procsEl = btn && btn.querySelector('.ws-procs');
    if (!procsEl) return;
    const terms = getWorkspaceTerminals(wsp).filter(isLiveTerminal);
    const termIds = terms.map(t => t.id).sort().join(',');
    const cached = _wsProcsCache.get(wsp.id);
    if (cached && cached.termIds === termIds && Date.now() - cached.ts < _WS_PROCS_TTL) {
      renderWsProcs(procsEl, cached.processes, wsp.id);
      return;
    }
    if (!terms.length) {
      _wsProcsCache.set(wsp.id, { processes: [], termIds, ts: Date.now() });
      renderWsProcs(procsEl, [], wsp.id);
      return;
    }
    Promise.all(terms.map(t => checkTerminalRunning(t.id))).then(names => {
      if (!btn.isConnected) return;
      const processes = names.map((name, i) => ({id:terms[i].id, name, label:terms[i].label, cwd:terms[i].cwd}))
        .filter(process => !_isHiddenWsProc(process.name));
      _wsProcsCache.set(wsp.id, { processes, termIds, ts: Date.now() });
      renderWsProcs(procsEl, processes, wsp.id);
    });
  }

  // Enter / Ctrl+C / Ctrl+D usually start or stop a process: re-check right
  // away (twice, since a command can take a moment to spawn or exit).
  let _wsProcsSoonTimers = [];
  function refreshWorkspaceProcsSoon() {
    if (!showWsProcs) return;
    _wsProcsSoonTimers.forEach(clearTimeout);
    _wsProcsSoonTimers = [150, 600].map(ms => setTimeout(() => {
      _wsProcsCache.clear();
      refreshAllWorkspaceProcs();
    }, ms));
  }

  function refreshAllWorkspaceProcs() {
    if (!showWsProcs) return;
    document.querySelectorAll('.ws-btn').forEach(btn => {
      const wsp = findWs(btn.dataset.wsid);
      if (wsp) updateWorkspaceProcs(wsp, btn);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   C O*NTEXT MENU
   ═══════════════════════════════════════════════════════════════ */
  const ctxEl = document.getElementById('ctx');
  let ctxPreviousFocus;

  function showCtxMenu(e, type, data) {
    if (!ctxEl.contains(document.activeElement)) ctxPreviousFocus = document.activeElement;
    // Take focus out of a browser pane so clicking back into it fires focusin (closes the menu).
    if (document.activeElement?.matches?.('webview, iframe')) document.activeElement.blur();
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
      const wsPinned = findWs(wsId)?.pinned;
      item('<i class="ph ph-plus"></i>', 'New terminal', 'Ctrl+Shift+T', () => { activateWorkspace(wsId); addTerminal(wsId); });
      sep();
      item(`<i class="ph ph-push-pin${wsPinned ? '-slash' : ''}"></i>`, wsPinned ? 'Unpin from top' : 'Pin to top', '', () => togglePinWorkspace(wsId));
      item('<i class="ph ph-pencil-simple"></i>', 'Edit workspace', '', () => renameWorkspace(wsId));
      if (folders.length || findWs(wsId)?.folderId) {
        sep();
        // Submenu keeps the menu short when there are many folders
        const ws = findWs(wsId);
        const sub = document.createElement('div');
        sub.className = 'ctx-sub';
        const subItem = (icon, label, fn, checked, danger) => {
          const el = document.createElement('div');
          el.className = 'ctx-item' + (danger ? ' danger' : '') + (checked ? ' checked' : '');
          el.innerHTML = `<span>${icon}</span><span>${label}</span>${checked ? '<span class="ci-key"><i class="ph ph-check"></i></span>' : ''}`;
          el.addEventListener('click', () => { if (!fn) return; hideCtxMenu(); fn(); });
          sub.appendChild(el);
        };
        const subSep = () => { const el = document.createElement('div'); el.className = 'ctx-sep'; sub.appendChild(el); };
        if (ws?.folderId) {
          subItem('<i class="ph ph-folder-minus"></i>', 'Remove from folder', () => moveWsTo(wsId, null, getGroupList(null).length));
          subSep();
        }
        for (const f of folders) {
          const inFolder = ws?.folderId === f.id;
          subItem(`<i class="ph ph-folder${inFolder ? '-open' : ''}"></i>`, escHtml(f.label), inFolder ? null : () => moveWsTo(wsId, f.id, getGroupList(f.id).length), inFolder);
        }
        subSep();
        subItem('<i class="ph ph-folder-simple-plus"></i>', 'New folder…', () => showPrompt('New folder', '', { color: '' }, (value, color) => { const nf = createFolder(value, color); if (nf) moveWsTo(wsId, nf.id, 0); }));

        const trigger = document.createElement('div');
        trigger.className = 'ctx-item has-sub';
        trigger.innerHTML = `<span><i class="ph ph-folder-simple"></i></span><span>Move to folder</span><span class="ci-sub-caret"><i class="ph ph-caret-right"></i></span>`;
        trigger.appendChild(sub);
        ctxEl.appendChild(trigger);
      }
      sep();
      item('<i class="ph ph-x"></i>', 'Close workspace', '', () => removeWorkspace(wsId), true);
    } else if (type === 'folder') {
      const folderId = data;
      const folderPinned = folders.find(f => f.id === folderId)?.pinned;
      item('<i class="ph ph-plus"></i>', 'New workspace here', 'Ctrl+Shift+T', () => { const wsp = createWorkspace(undefined, folderId); if (wsp) activateWorkspace(wsp.id); });
      sep();
      item(`<i class="ph ph-push-pin${folderPinned ? '-slash' : ''}"></i>`, folderPinned ? 'Unpin from top' : 'Pin to top', '', () => togglePinFolder(folderId));
      item('<i class="ph ph-pencil-simple"></i>', 'Edit folder', '', () => renameFolder(folderId));
      sep();
      item('<i class="ph ph-x"></i>', 'Delete folder', '', () => removeFolder(folderId), true);
    } else if (type === 'profile') {
      const { p, defaultId } = data;
      item('<i class="ph ph-pencil-simple"></i>', 'Edit profile', '', () => editProfile(p));
      if (p.id !== defaultId) item('<i class="ph ph-star"></i>', 'Set as default profile', '', () => setDefaultProfile(p));
      if (p.avatar) item('<i class="ph ph-image"></i>', 'Remove picture', '', async () => {
        const api = profilesApi();
        if (!api || !api.profilesUpdate) return;
        const meta = await api.profilesUpdate({ id: p.id, avatar: '' });
        const updated = meta.profiles.find(x => x.id === p.id);
        if (updated) _activeProfile = updated;
        const wrap = document.getElementById('profile-picker');
        if (wrap && wrap.style.display !== 'none') renderProfilePicker(meta, _activeProfile, (np) => { confirmProfileSwitch(np); });
      });
      if (p.id && (typeof p === 'object')) {
        sep();
        item('<i class="ph ph-trash"></i>', 'Delete profile', '', () => {
          profilesApi().profilesList().then(m => {
            if (m.profiles.length <= 1) return; // never delete the last profile
            deleteProfile(p);
          });
        }, true);
      }
    } else if (type === 'terminal') {
      const { wsId, termId } = data;
      const wsp = findWs(wsId);
      const isMaximized = wsp && wsp._maximizedGroupId && findGroupContainingTerm(wsp.layout, termId)?.id === wsp._maximizedGroupId;
      item(isMaximized ? '<i class="ph ph-corners-in"></i>' : '<i class="ph ph-corners-out"></i>', isMaximized ? 'Restore tab' : 'Maximize tab', '', () => toggleMaximizeTerminal(wsId, termId));
      item('<i class="ph ph-plus"></i>', 'New terminal', 'Ctrl+Shift+T', () => addTerminal(wsId));
      item('<i class="ph ph-pencil-simple"></i>', 'Edit tab', '', () => renameTerminal(wsId, termId));
      {
        const termEntry = findTermById(termId)?.term;
        if (termEntry && termEntry.type !== 'browser') {
          const locked = !!termEntry.locked;
          item(`<i class="ph ph-lock${locked ? '-simple-open' : '-simple'}"></i>`, locked ? 'Unlock terminal' : 'Lock terminal', '', () => toggleTermLock(termEntry));
        }
      }
      if (backgroundMode === 'per-tab') {
        const termEntry = getWorkspaceTerminals(wsp).find(t => t.id === termId);
        if (termEntry && termEntry.bgImage) {
          item('<i class="ph ph-image"></i>', 'Clear tab background', '', () => {
            setTermBackgroundImage(termEntry, '');
            applyBackground();
          });
        } else {
          item('<i class="ph ph-image"></i>', 'Set tab background', '', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
              const file = e.target.files[0];
              if (!file) return;
              loadBgImageFromFile(file, (dataUrl) => {
                setTermBackgroundImage(termEntry, dataUrl);
                applyBackground();
              });
            };
            input.click();
          });
        }
      } else if (backgroundMode === 'per-workspace' && wsp) {
        if (wsp.bgImage) {
          item('<i class="ph ph-image"></i>', 'Clear workspace background', '', () => {
            wsp.bgImage = '';
            delete wsp.bgOpacity;
            applyBackground();
            saveState();
          });
        } else {
          item('<i class="ph ph-image"></i>', 'Set workspace background', '', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
              const file = e.target.files[0];
              if (!file) return;
              loadBgImageFromFile(file, (dataUrl) => {
                wsp.bgImage = dataUrl;
                wsp.bgOpacity = backgroundOpacity;
                applyBackground();
                saveState();
              });
            };
            input.click();
          });
        }
      }
      // Copy — only when right-clicking on the terminal body
      if (data._fromBody) {
        item('<i class="ph ph-copy"></i>', 'Copy', 'Ctrl+Shift+C', () => {
          const t = findTermById(termId);
          if (t && t.term.type !== 'browser' && t.term.term.hasSelection()) {
            const text = t.term.term.getSelection();
            if (isDesktop() && window.electronAPI) {
              window.electronAPI.clipboardWrite(text);
            } else {
              navigator.clipboard.writeText(text);
            }
          }
        });
      }
      sep();
      if (isDesktop() && !DETACHED_ONLY && window.electronAPI?.terminalDetach) {
        item('<i class="ph ph-export"></i>', 'Detach to window', '', () => detachTerminal(wsId, termId));
      }
      item('<i class="ph ph-x"></i>', 'Close terminal', 'Ctrl+Shift+W', () => removeTerminal(wsId, termId), true);
    }

    // Plugin-provided context-menu items (appended after built-ins)
    const pluginItems = _pluginMenuItems[type];
    if (pluginItems && pluginItems.length) {
      let addedSep = false;
      for (const it of pluginItems) {
        if (it.when && !it.when(data)) continue;
        if (!addedSep) { sep(); addedSep = true; }
        item(it.icon, escHtml(it.label), '', () => it.handler(data));
      }
    }

    // Keep menus in the DOM so motion follows the appearance preference.
    // Browser panes are DOM webviews, covered by this overlay's z-index.
    ctxEl.inert = false;
    ctxEl.setAttribute('role', 'menu');
    ctxEl.querySelectorAll('.ctx-item').forEach(el => {
      el.setAttribute('role', 'menuitem');
      el.tabIndex = -1;
    });
    ctxEl.classList.add('open');
    const menuW = ctxEl.offsetWidth;
    const menuH = ctxEl.offsetHeight;
    let x = e.pageX;
    let y = e.pageY;
    if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;
    ctxEl.style.left = Math.max(0, x) + 'px';
    ctxEl.style.top = Math.max(0, y) + 'px';
    // Flip the submenu to the left when the menu sits near the right screen edge
    ctxEl.classList.toggle('sub-flip', x + menuW + 210 > window.innerWidth);
  }

  function hideCtxMenu() {
    const restoreFocus = ctxEl.contains(document.activeElement);
    ctxEl.classList.remove('open');
    ctxEl.inert = true;
    if (restoreFocus && ctxPreviousFocus?.isConnected) ctxPreviousFocus.focus({ preventScroll: true });
  }
  document.addEventListener('contextmenu', e => { if (!ctxEl.contains(e.target)) hideCtxMenu(); }, true);
  document.addEventListener('click', e => { if (!e.target.closest('#ctx')) hideCtxMenu(); });
  // Clicks inside a browser pane (webview / iframe / native view) never reach
  // this document: close when focus moves into one or the window loses focus.
  document.addEventListener('focusin', e => { if (e.target.matches?.('webview, iframe') && ctxEl.classList.contains('open')) hideCtxMenu(); });
  window.addEventListener('blur', () => { if (ctxEl.classList.contains('open')) hideCtxMenu(); });
  document.addEventListener('keydown', e => {
    if (!ctxEl.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideCtxMenu(); return; }
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const items = [...ctxEl.querySelectorAll('.ctx-item')].filter(el => el.getClientRects().length);
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowRight') { document.activeElement?.querySelector('.ctx-sub > .ctx-item')?.focus(); return; }
    if (e.key === 'ArrowLeft') { document.activeElement?.closest('.ctx-sub')?.parentElement.focus(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList.contains('has-sub')) {
      document.activeElement.querySelector('.ctx-sub > .ctx-item')?.focus(); return;
    }
    if (e.key === 'Enter' || e.key === ' ') { if (index >= 0) items[index].click(); }
    else items[index < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }, true);

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
  const promptIconBtn = document.getElementById('prompt-icon-btn');
  const promptIconImg = document.getElementById('prompt-icon-img');
  const promptIconClear = document.getElementById('prompt-icon-clear');
  const promptIconFile = document.getElementById('prompt-icon-file');

  function showPrompt(label, value, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    promptLabel.textContent = label;
    promptInput.value = value;

    // Color swatches (last one opens a Coloris picker for any color)
    let selectedColor = '';
    let colorisInput = null;
    const customSwatch = promptColors.querySelector('.prompt-swatch-custom');
    const setActiveSwatch = (el) => {
      promptSwatches.forEach(x => x.classList.remove('active'));
      if (el) el.classList.add('active');
    };
    if (opts.color !== undefined) {
      promptColors.style.display = 'block';
      selectedColor = opts.color || '';
      const isPreset = (c) => Array.from(promptSwatches).some(s => s !== customSwatch && s.dataset.color === c);
      promptSwatches.forEach(s => {
        if (s === customSwatch) return;
        s.classList.toggle('active', s.dataset.color === selectedColor);
        s.onclick = () => {
          selectedColor = s.dataset.color;
          setActiveSwatch(s);
        };
      });
      if (selectedColor && !isPreset(selectedColor)) {
        customSwatch.style.background = selectedColor;
        setActiveSwatch(customSwatch);
      }
      customSwatch.onclick = () => {
        const tempInput = document.createElement('input');
        tempInput.type = 'text';
        tempInput.value = selectedColor || '#89b4fa';
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        tempInput.style.pointerEvents = 'none';
        // Anchor the popup next to the swatch (Coloris positions from the input's rect)
        const r = customSwatch.getBoundingClientRect();
        tempInput.style.left = Math.max(8, Math.min(window.innerWidth - 210, r.left - 85)) + 'px';
        tempInput.style.top = Math.min(window.innerHeight - 8, r.bottom + 6) + 'px';
        tempInput.style.width = '1px';
        tempInput.style.height = '1px';
        tempInput.setAttribute('data-coloris', '');
        document.body.appendChild(tempInput);
        colorisInput = tempInput;
        // This Coloris build exposes no .open()/.on(): a click on a
        // [data-coloris] input opens the picker via its own delegation, and
        // picked values arrive as 'input' events on that input.
        tempInput.addEventListener('input', () => {
          selectedColor = tempInput.value;
          customSwatch.style.background = tempInput.value;
          setActiveSwatch(customSwatch);
        });
        tempInput.addEventListener('close', () => { tempInput.remove(); colorisInput = null; });
        setTimeout(() => tempInput.click(), 0);
      };
    } else {
      promptColors.style.display = 'none';
    }

    // Workspace icon picker (left of the input). selectedIcon is usually a
    // data-URL string, but workspaces restored from older states can carry
    // object refs ({ phosphor: name }); those pass through untouched and only
    // strings are previewed (assigning an object to img.src would stick a
    // "[object Object]" URL in the preview and lose the real value).
    let selectedIcon = '';
    const setIcon = (dataUrl) => {
      selectedIcon = dataUrl || '';
      promptIconBtn.classList.toggle('has-icon', !!selectedIcon);
      if (typeof selectedIcon === 'string' && selectedIcon) promptIconImg.src = selectedIcon;
      else promptIconImg.removeAttribute('src');
    };
    if (opts.icon !== undefined) {
      promptIconBtn.style.display = '';
      setIcon(opts.icon || '');
      promptIconBtn.onclick = () => { promptIconFile.value = ''; promptIconFile.click(); };
      promptIconClear.onclick = (e) => { e.stopPropagation(); setIcon(''); };
      promptIconFile.onchange = () => {
        const file = promptIconFile.files && promptIconFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => optimizeIconImage(e.target.result, setIcon);
        reader.readAsDataURL(file);
      };
    } else {
      promptIconBtn.style.display = 'none';
    }

    promptOverlay.inert = false;
    promptOverlay.classList.add('open');
    promptInput.focus();
    promptInput.select();

    const close = () => {
      promptOverlay.inert = true;
      promptOverlay.classList.remove('open');
      // Dismiss a still-open Coloris popup and drop its temp input
      if (colorisInput) {
        const ci = colorisInput;
        try { if (document.querySelector('#clr-picker.clr-open')) Coloris.close(); } catch { }
        ci.remove();
        colorisInput = null;
      }
      promptOk.onclick = null;
      promptCancel.onclick = null;
      promptInput.onkeydown = null;
      promptOverlay.onclick = null;
      promptSwatches.forEach(s => { s.onclick = null; });
      promptIconBtn.onclick = null;
      promptIconClear.onclick = null;
      promptIconFile.onchange = null;
      promptIconFile.value = '';
    };

    const submit = () => {
      const val = promptInput.value;
      close();
      callback(val, selectedColor, selectedIcon);
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

  function showConfirm(message, callback, onCancel) {
    onCancel = onCancel || (() => { });
    promptLabel.textContent = message;
    promptInput.style.display = 'none';
    promptColors.style.display = 'none';
    promptIconBtn.style.display = 'none';

    promptOverlay.inert = false;
    promptOverlay.classList.add('open');
    promptOk.focus();

    let onKey;
    let cancelled = false;
    const close = () => {
      promptOverlay.inert = true;
      promptOverlay.classList.remove('open');
      promptInput.style.display = '';
      promptOk.onclick = null;
      promptCancel.onclick = null;
      promptOverlay.onclick = null;
      document.removeEventListener('keydown', onKey, true);
    };
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      onCancel();
      close();
    };

    const submit = () => { close(); callback(); };

    onKey = e => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    };

    promptOk.onclick = submit;
    promptCancel.onclick = cancel;
    promptOverlay.onclick = e => { if (e.target === promptOverlay) cancel(); };
    document.addEventListener('keydown', onKey, true);
  }

  const closeConfirmOverlay = document.getElementById('close-confirm-overlay');
  const closeConfirmTitle = document.getElementById('cc-title');
  const closeConfirmMessage = document.getElementById('cc-message');
  const closeConfirmOk = document.getElementById('cc-close');
  const closeConfirmCancel = document.getElementById('cc-cancel');
  const closeConfirmDontAgain = document.getElementById('cc-dontagain');
  const closeConfirmDontAgainRow = document.getElementById('cc-dont-again-row');

  // "Don't ask again" preferences are stored per-confirmation type.
  function dontAskAgain(key) {
    try { return localStorage.getItem('tv-dontask-' + key) === '1'; } catch { return false; }
  }
  function setDontAskAgain(key) {
    try { localStorage.setItem('tv-dontask-' + key, '1'); } catch { }
  }

  function showCloseConfirm(label, closesWorkspace, callback, onCancel) {
    showDangerConfirm('Close tab?',
      `<span class="cc-label">${escHtml(label)}</span> is running a process.` +
      (closesWorkspace ? ' Closing it will terminate the process and remove the workspace.' : ' Closing it will terminate the process.'),
      'Close Tab', callback, onCancel, 'closeprocess');
  }

  // Shared destructive-style confirmation (red warning icon + red button).
  // `key` optionally enables a "Don't ask again" checkbox; when the user
  // confirms with it checked, future confirmations of that type are skipped.
  function showDangerConfirm(title, messageHTML, okLabel, callback, onCancel, key, submitShortcut) {
    onCancel = onCancel || (() => { });
    closeConfirmTitle.textContent = title;
    closeConfirmMessage.innerHTML = messageHTML;
    closeConfirmOk.textContent = okLabel;
    if (closeConfirmDontAgain) closeConfirmDontAgain.checked = false;
    if (closeConfirmDontAgainRow) closeConfirmDontAgainRow.style.display = key ? 'flex' : 'none';

    closeConfirmOverlay.inert = false;
    closeConfirmOverlay.classList.add('open');
    closeConfirmCancel.focus();

    let onKey;
    let cancelled = false;
    const close = () => {
      closeConfirmOverlay.inert = true;
      closeConfirmOverlay.classList.remove('open');
      closeConfirmOk.onclick = null;
      closeConfirmCancel.onclick = null;
      closeConfirmOverlay.onclick = null;
      document.removeEventListener('keydown', onKey, true);
    };
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      onCancel();
      close();
    };
    const submit = () => {
      if (key && closeConfirmDontAgain && closeConfirmDontAgain.checked) setDontAskAgain(key);
      close();
      callback();
    };

    onKey = e => {
      e.stopPropagation();
      if (submitShortcut && matchShortcut(e, submitShortcut)) { e.preventDefault(); submit(); return; }
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    };

    closeConfirmOk.onclick = submit;
    closeConfirmCancel.onclick = cancel;
    closeConfirmOverlay.onclick = e => { if (e.target === closeConfirmOverlay) cancel(); };
    document.addEventListener('keydown', onKey, true);
  }

  // Live terminals with a running process (excluding idle shells), across all
  // workspaces. Resolves to [{label, name}] with the process name per tab.
  // Idle shells / 'unknown' are excluded (see _isHiddenWsProc) so an idle
  // powershell / cmd / wsl tab never blocks quit with a bogus entry.
  function gatherRunningProcesses() {
    const pending = [];
    for (const wsp of workspaces) {
      for (const t of getWorkspaceTerminals(wsp)) {
        if (isLiveTerminal(t)) {
          pending.push(checkTerminalRunning(t.id).then(name => (name && !_isHiddenWsProc(name)) ? { label: t.label, name } : null));
        }
      }
    }
    return Promise.all(pending).then(results => results.filter(Boolean));
  }

  function runningMsg(running, action) {
    return running.length > 0
      ? `There ${running.length > 1 ? 'are' : 'is'} ${running.length} terminal${running.length > 1 ? 's' : ''} with running processes: ` +
      running.map(r => `<span class="cc-label">${escHtml(r.label)}</span> (${escHtml(r.name)})`).join(', ') +
      `. ${action}`
      : 'All terminals are idle.';
  }

  // ── Finish notifications: main reports a command or an agent (Claude Code /
  // Codex) response that ended; skip it if you're looking at that tab, else
  // play the TerminalVibe chime and show a desktop notification. ──
  let _notifyAudio = null;
  function playNotifySound() {
    try {
      _notifyAudio = _notifyAudio || new Audio('sounds/notify.wav');
      _notifyAudio.currentTime = 0;
      _notifyAudio.play().catch(() => { });
    } catch { }
  }
  function isTermOnScreen(ws, termId) {
    if (ws.id !== activeWsId) return false;
    const group = findGroupContainingTerm(ws.layout, termId);
    return !!group && group.activeTermId === termId && (!ws._maximizedGroupId || ws._maximizedGroupId === group.id);
  }
  function onTerminalFinished({ id, kind, name }) {
    if (!notifyOnCommandFinish) return;
    const found = findTermById(id);
    if (!found || (document.hasFocus() && isTermOnScreen(found.ws, id))) return;
    if (notificationSound) playNotifySound();
    const agent = /^claude/i.test(name || '') ? 'Claude Code' : /^codex/i.test(name || '') ? 'Codex' : null;
    const title = kind === 'agent' ? `${agent || name} finished responding` : (name ? `${name} finished` : 'Command finished');
    try {
      const n = new Notification(title, { body: `${found.term.label} · ${found.ws.label}`, silent: true, icon: 'logo.png' });
      n.onclick = () => {
        window.electronAPI?.focusWindow?.();
        const now = findTermById(id);
        if (!now) return;
        if (now.ws.id !== activeWsId) activateWorkspace(now.ws.id);
        activateTerminal(now.ws.id, id);
      };
    } catch { }
  }

  // Count live terminals with a running process (excluding idle shells)
  // across all workspaces, then ask for confirmation before quitting.
  // Pressing the quit shortcut a second time quits: in the modal (submit
  // shortcut) or before it opens (_quitPending, while processes are counted).
  let _quitPending = false;
  function confirmQuitApp() {
    const quit = () => {
      _quitPending = false;
      // Desktop: tell main to release the close it intercepted from the OS
      // button (window.close() would just re-trigger the intercepted close).
      if (isDesktop() && window.electronAPI && window.electronAPI.appCloseConfirmed) {
        window.electronAPI.appCloseConfirmed();
      } else {
        window.close();
      }
    };
    if (_quitPending) return quit();
    _quitPending = true;
    gatherRunningProcesses().then(running => {
      if (!_quitPending) return;
      showDangerConfirm('Quit TerminalVibe?', runningMsg(running, 'Quitting will terminate them.'), 'Quit', quit,
        () => { _quitPending = false; }, undefined, 'quitApp');
    }, () => { _quitPending = false; });
  }

  // Switching profiles tears down every workspace (closing PTYs), so ask for
  // confirmation first if any terminal still has a process running inside it.
  function confirmProfileSwitch(p) {
    // No-op when re-selecting the already-active profile
    if (_activeProfile && p.id === _activeProfile.id) return;
    // Await the disk write: config:writeState is routed by _activeProfileId,
    // so switching before the commit resolves lands the old profile's state in
    // the NEW profile's file (all profiles end up showing the default content).
    const doSwitch = () => saveState().then(() => apiProfilesSwitch(p));
    gatherRunningProcesses().then(running => {
      if (running.length === 0) { doSwitch(); return; }
      showDangerConfirm('Switch profile?', runningMsg(running, 'Switching profiles will terminate them.'), 'Switch', doSwitch);
    });
  }

  function isLiveTerminal(entry) {
    return !!entry && entry.type !== 'browser' && !entry.dead;
  }

  // A browser tab is considered to be showing content when it has navigated
  // away from the blank start page (i.e. it has a real URL loaded).
  function browserHasContent(entry) {
    if (!entry || entry.type !== 'browser') return false;
    const u = entry.url;
    return !!u && u !== 'about:blank' && u.trim() !== '';
  }

  // Ask the backend whether a real process (excluding the idle shell) is
  // running inside the PTY. Resolves null when idle, otherwise the process
  // name (or 'unknown' when we can't tell, so we never silently kill a busy
  // session).
  function checkTerminalRunning(termId) {
    return new Promise((resolve) => {
      if (isDesktop() && window.electronAPI && window.electronAPI.terminalHasRunningProcess) {
        window.electronAPI.terminalHasRunningProcess(termId)
          .then(info => {
            if (info && typeof info === 'object') resolve(info.running ? (info.name || 'unknown') : null);
            else resolve(info ? 'unknown' : null); // legacy boolean backends
          })
          .catch(() => resolve('unknown'));
        return;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        const onMsg = (e) => {
          if (typeof e.data !== 'string') return;
          try {
            const msg = JSON.parse(e.data);
            if (msg && msg.type === 'hasprocess' && msg.id === termId) {
              clearTimeout(timer);
              ws.removeEventListener('message', onMsg);
              resolve(msg.running ? (msg.name || 'unknown') : null);
            }
          } catch { }
        };
        const timer = setTimeout(() => {
          ws.removeEventListener('message', onMsg);
          resolve('unknown');
        }, 1500);
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ type: 'hasprocess', id: termId }));
        return;
      }
      resolve('unknown');
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   F O*NT SIZE (Ctrl+Scroll) + Browser zoom
═══════════════════════════════════════════════════════════════ */
  const FONT_MIN = 8;
  const FONT_MAX = 32;

  /* ── Zoom badge ── */
  const zoomBadge = (function () {
    const el = document.createElement('div');
    el.id = 'zoom-badge';
    document.body.appendChild(el);
    var timer = null;
    return function showZoomBadge(text) {
      el.textContent = text;
      el.classList.add('visible');
      clearTimeout(timer);
      timer = setTimeout(function () { el.classList.remove('visible'); }, 800);
    };
  })();

  document.getElementById('pane-area').addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !e.deltaY || e.target.closest?.('.session-overlay')) return;
    const slot = e.target.closest?.('.term-slot');
    const active = slot ? findTermById(slot.id.slice(5))?.term : activeTerminal();

    // Zoom the hovered terminal, including TUIs that consume wheel events.
    // Browser tabs and the session drawer retain their own scrolling behavior.
    if (!active?.term || active.type === 'browser') return;

    // Stop the wheel scroll from bubbling and zooming the actual browser window
    e.preventDefault();
    e.stopPropagation();

    // Track zoom per terminal instance
    if (!active._customFontSize) active._customFontSize = active.term.options.fontSize || currentFontSize;

    // Normalize trackpad/wheel deltas for predictable scrolling
    const delta = e.deltaY > 0 ? -1 : 1;
    const newSize = Math.max(FONT_MIN, Math.min(FONT_MAX, active._customFontSize + delta));

    if (newSize === active._customFontSize) return;
    active._customFontSize = newSize;

    // Use requestAnimationFrame for visual update to avoid layout thrashing
    if (active._zoomRaf) cancelAnimationFrame(active._zoomRaf);
    active._zoomRaf = requestAnimationFrame(() => {
      active._zoomRaf = null;
      if (findTermById(active.id)?.term !== active) return;
      active.term.options.fontSize = active._customFontSize;
      zoomBadge(active._customFontSize + 'px');
    });

    // Debounce the heavy FitAddon grid recalculation and backend PTY resize communication
    // Prevents sending 60 resize payloads per second which freezes the app
    if (active._zoomFitTimeout) clearTimeout(active._zoomFitTimeout);
    active._zoomFitTimeout = setTimeout(() => {
      active._zoomFitTimeout = null;
      if (findTermById(active.id)?.term === active) fitTerm(active, true);
    }, 150);

  }, { capture: true, passive: false });

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
   T A*B SEARCH (Ctrl+Shift+O)
   ═══════════════════════════════════════════════════════════════ */
  const tabSearchEl = document.getElementById('tab-search');
  const tsInput = document.getElementById('ts-input');
  const tsResults = document.getElementById('ts-results');
  let tsSelected = -1;
  let tsItems = [];

  // Subsequence fuzzy match: all query chars must appear in order. Lower
  // score is better; matches at word starts / consecutive runs rank higher.
  function fuzzyScore(query, text) {
    if (!query) return 0;
    query = query.toLowerCase(); text = text.toLowerCase();
    let qi = 0, score = 0, run = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) {
        qi++;
        const wordStart = ti === 0 || text[ti - 1] === ' ';
        score += wordStart ? 0 : (run ? 1 : 3);
        run = run + 1;
      } else run = 0;
    }
    return qi === query.length ? score : Infinity;
  }

  // One overlay, three modes: 'tabs' (jump to tab), 'cmds' (command palette),
  // 'snips' (saved commands). Items: { label, meta, icon, run(e), del?, pin? }.
  let tsMode = 'tabs';
  let tsShown = [];
  let tsReturnFocus = null;

  function collectTabItems() {
    const items = [];
    for (const ws of workspaces) {
      for (const t of getWorkspaceTerminals(ws)) {
        items.push({
          label: t.label, meta: ws.label, icon: t.type === 'browser' ? 'ph-globe-hemisphere-west' : 'ph-terminal-window',
          run: () => { activateTerminal(ws.id, t.id); activateWorkspace(ws.id); },
        });
      }
    }
    return items;
  }

  function collectCommandItems() {
    const key = a => formatKeyCombo(customShortcuts[a]);
    const wsp = () => activeWs();
    const act = () => activeTerminal();
    const split = dir => { const w = wsp(), t = act(); const g = w && t && findGroupContainingTerm(w.layout, t.id); if (g) splitGroupDirectly(w.id, g.id, dir); };
    const cmds = [
      ['New terminal', 'newTerminal', 'ph-plus', () => addTerminal()],
      ['Close terminal', 'closeTerminal', 'ph-x', () => { const w = wsp(); if (w && w.activeTermId) removeTerminal(w.id, w.activeTermId); }],
      ['Split horizontal', 'splitH', 'ph-columns', () => split('row')],
      ['Split vertical', 'splitV', 'ph-rows', () => split('column')],
      ['New browser tab', 'browserTab', 'ph-globe-hemisphere-west', () => { const w = wsp(), t = act(); const g = w && (t ? findGroupContainingTerm(w.layout, t.id) : findFirstGroup(w.layout)); if (g) addBrowserTab(w.id, g.id); }],
      ['Search in terminal', 'search', 'ph-magnifying-glass', () => openSearch()],
      ['Go to tab…', 'tabSearch', 'ph-browsers', () => openPalette('tabs')],
      ['Snippets…', 'snippets', 'ph-lightning', () => openPalette('snips')],
      ['Browser history…', null, 'ph-clock-counter-clockwise', () => openPalette('history')],
      ['Next tab', 'nextTab', 'ph-arrow-right', () => nextTab()],
      ['Previous tab', 'prevTab', 'ph-arrow-left', () => prevTab()],
      ['Next workspace', 'nextWorkspace', 'ph-caret-double-down', () => nextWorkspace()],
      ['Previous workspace', 'prevWorkspace', 'ph-caret-double-up', () => prevWorkspace()],
      ['Maximize / restore tab', 'maximizeTab', 'ph-arrows-out', () => { const w = wsp(); if (w && w.activeTermId) toggleMaximizeTerminal(w.id, w.activeTermId); }],
      ['Toggle sidebar', 'toggleSidebar', 'ph-sidebar-simple', () => toggleSidebar()],
      ['Switch profile…', 'profiles', 'ph-user-switch', () => openProfilePicker()],
      ['Detach terminal to window', null, 'ph-arrow-square-out', () => { const w = wsp(); if (w && w.activeTermId) detachTerminal(w.id, w.activeTermId); }],
      ['New workspace', null, 'ph-folder-plus', () => createWorkspace()],
      ['Open settings', null, 'ph-gear', () => openSettingsGlobal()],
    ].map(([label, sc, icon, run]) => ({ label, meta: sc ? key(sc) : '', icon, run }));
    for (const w of workspaces) {
      cmds.push({ label: 'Workspace: ' + w.label, meta: '', icon: 'ph-squares-four', run: () => activateWorkspace(w.id) });
    }
    for (const c of _pluginCommands.values()) {
      cmds.push({ label: c.label, meta: 'plugin', icon: 'ph-puzzle-piece', run: () => { try { c.handler(); } catch (e) { console.error('[plugin] command failed:', c.id, e); } } });
    }
    return cmds;
  }

  // ── Browser history (global, most recent first, deduped by URL).
  const BH_KEY = 'terminalvibe.browserHistory';
  const BH_MAX = 1000;
  function loadBrowserHistory() {
    try { const a = JSON.parse(localStorage.getItem(BH_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  function saveBrowserHistory(list) { try { localStorage.setItem(BH_KEY, JSON.stringify(list.slice(0, BH_MAX))); } catch { } }
  function recordBrowserHistory(url, title) {
    if (!url || url === 'about:blank') return;
    const list = loadBrowserHistory();
    const i = list.findIndex(h => h.url === url);
    const prev = i >= 0 ? list.splice(i, 1)[0] : null;
    list.unshift({ url, title: title || (prev && prev.title) || '', ts: Date.now() });
    saveBrowserHistory(list);
  }
  function setBrowserHistoryTitle(url, title) {
    const list = loadBrowserHistory();
    const h = list.find(x => x.url === url);
    if (h && title && h.title !== title) { h.title = title; saveBrowserHistory(list); }
  }

  function collectHistoryItems() {
    const list = loadBrowserHistory();
    const items = list.map((h, i) => ({
      label: h.title || h.url, meta: h.url.replace(/^https?:\/\/(www\.)?/, ''), search: (h.title || '') + ' ' + h.url,
      icon: 'ph-clock-counter-clockwise', delTitle: 'Remove from history',
      run: () => {
        const t = activeTerminal();
        if (t && t.type === 'browser' && t._loadUrl) { t._loadUrl(h.url); return; }
        const w = activeWs();
        const g = w && (t ? findGroupContainingTerm(w.layout, t.id) : findFirstGroup(w.layout));
        if (w) addBrowserTab(w.id, g && g.id, h.url);
      },
      del: () => { list.splice(i, 1); saveBrowserHistory(list); openPalette('history', tsInput.value); },
    }));
    if (list.length) items.push({
      label: 'Clear browsing history', meta: list.length + ' entries', icon: 'ph-trash', pin: true,
      run: () => { saveBrowserHistory([]); },
    });
    return items;
  }

  // ── Snippets (saved commands). Enter = insert, Ctrl+Enter = insert and run.
  const SNIP_KEY = 'terminalvibe.snippets';
  // Seeded only until the user saves their own list (deleting them all sticks).
  const DEFAULT_SNIPPETS = [
    { name: 'Git status', cmd: 'git status' },
    { name: 'Git log (graph)', cmd: 'git log --oneline --graph --decorate -20' },
    { name: 'Git pull', cmd: 'git pull' },
    { name: 'List files', cmd: 'ls -la' },
    { name: 'Disk usage', cmd: 'df -h' },
    { name: 'Docker containers', cmd: 'docker ps' },
    { name: 'npm install', cmd: 'npm install' },
    { name: 'npm run dev', cmd: 'npm run dev' },
  ];
  function loadSnippets() {
    try {
      const raw = localStorage.getItem(SNIP_KEY);
      if (raw === null) return DEFAULT_SNIPPETS.map(s => ({ ...s }));
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch { return []; }
  }
  function saveSnippets(list) { try { localStorage.setItem(SNIP_KEY, JSON.stringify(list)); } catch { } }

  function collectSnippetItems() {
    const list = loadSnippets();
    const items = list.map((sn, i) => ({
      label: sn.name, meta: sn.cmd, icon: 'ph-lightning',
      run: e => {
        const t = activeTerminal();
        if (!t || t.type === 'browser' || !t.term) return;
        t.term.paste(sn.cmd);
        if (e && e.ctrlKey) sendStdin(t.id, new TextEncoder().encode('\r'));
      },
      del: () => { list.splice(i, 1); saveSnippets(list); openPalette('snips', tsInput.value); },
    }));
    items.push({
      label: 'New snippet…', meta: '', icon: 'ph-plus', pin: true,
      run: () => showPrompt('Snippet name', '', {}, name => {
        if (!name.trim()) return;
        showPrompt('Command to insert', '', {}, cmd => {
          if (!cmd) return;
          list.push({ name: name.trim(), cmd });
          saveSnippets(list);
          openPalette('snips');
        });
      }),
    });
    return items;
  }

  function renderTabSearch() {
    const q = tsInput.value;
    tsShown = tsItems
      .map((it, i) => ({ it, i, score: it.pin ? (q ? Infinity : 1e9) : fuzzyScore(q, it.search || it.label) }))
      .filter(x => x.score !== Infinity)
      // History keeps recency order on ties; other modes sort alphabetically.
      .sort((a, b) => a.score - b.score || (tsMode === 'history' ? a.i - b.i : a.it.label.localeCompare(b.it.label)))
      .map(x => x.it);
    tsResults.innerHTML = '';
    tsInput.removeAttribute('aria-activedescendant');
    document.getElementById('ts-status').textContent = tsShown.length + (tsShown.length === 1 ? ' result' : ' results');
    if (!tsShown.length) {
      const empty = document.createElement('div');
      empty.className = 'ts-empty';
      empty.textContent = q ? 'No matches. Try a different search or category.' : tsMode === 'tabs' ? 'No open tabs. Open a terminal to get started.' : 'Nothing here yet.';
      tsResults.appendChild(empty);
      tsSelected = -1;
      return;
    }
    tsShown.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'ts-item';
      row.id = 'ts-result-' + i;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.innerHTML = `<i class="ph ${it.icon}"></i><span class="ts-label"></span><span class="ts-ws"></span>`;
      row.querySelector('.ts-label').textContent = it.label;
      row.querySelector('.ts-ws').textContent = it.meta;
      if (it.del) {
        const d = document.createElement('i');
        d.className = 'ph ph-trash ts-del';
        d.title = it.delTitle || 'Delete snippet';
        d.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); it.del(); });
        row.appendChild(d);
      }
      row.addEventListener('mousedown', e => { e.preventDefault(); tsPick(i, e); });
      row.addEventListener('mouseenter', () => setTsSelected(i));
      tsResults.appendChild(row);
    });
    setTsSelected(0);
  }

  function setTsSelected(i) {
    if (i < 0 || i >= tsShown.length) return;
    tsSelected = i;
    tsResults.querySelectorAll('.ts-item').forEach((el, idx) => {
      el.classList.toggle('selected', idx === i);
      el.setAttribute('aria-selected', String(idx === i));
    });
    tsInput.setAttribute('aria-activedescendant', tsResults.children[i].id);
    tsResults.children[i].scrollIntoView({ block: 'nearest' });
  }

  function tsPick(i, e) {
    if (i < 0 || i >= tsShown.length) return;
    const item = tsShown[i];
    closeTabSearch();
    item.run(e);
  }

  const TS_PLACEHOLDERS = { tabs: 'Search tabs…', cmds: 'Type a command…', snips: 'Search snippets… (Ctrl+Enter runs)', history: 'Search browser history…' };
  function openPalette(mode, query) {
    if (!tabSearchEl || tsResults.contains(document.activeElement)) return;
    if (tabSearchEl.style.display === 'none') tsReturnFocus = document.activeElement;
    tsMode = mode;
    document.querySelectorAll('[data-palette-mode]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.paletteMode === mode)));
    tsItems = mode === 'cmds' ? collectCommandItems() : mode === 'snips' ? collectSnippetItems()
      : mode === 'history' ? collectHistoryItems() : collectTabItems();
    tsInput.placeholder = TS_PLACEHOLDERS[mode];
    tsInput.setAttribute('aria-label', TS_PLACEHOLDERS[mode]);
    tsInput.setAttribute('aria-expanded', 'true');
    tabSearchEl.inert = false;
    tabSearchEl.style.display = 'flex';
    syncBrowserSlots();
    tsInput.value = query || '';
    renderTabSearch();
    tsInput.focus();
  }
  function openTabSearch() { openPalette('tabs'); }

  function closeTabSearch() {
    if (!tabSearchEl) return;
    tabSearchEl.inert = true;
    tabSearchEl.style.display = 'none';
    syncBrowserSlots();
    tsInput.setAttribute('aria-expanded', 'false');
    tsInput.removeAttribute('aria-activedescendant');
    if (tsReturnFocus && tsReturnFocus.isConnected && tsReturnFocus.getClientRects().length) {
      tsReturnFocus.focus();
      return;
    }
    const t = activeTerminal();
    if (t && t.type !== 'browser' && t.term) t.term.focus();
  }

  document.querySelectorAll('[data-palette-mode]').forEach(btn => {
    btn.addEventListener('click', () => openPalette(btn.dataset.paletteMode, tsInput.value));
  });
  document.getElementById('empty-commands').addEventListener('click', () => openPalette('cmds'));
  tabSearchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.target !== tsInput) { e.stopPropagation(); closeTabSearch(); }
    if (e.key !== 'Tab') return;
    const controls = [...tabSearchEl.querySelectorAll('button, input')];
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  tsInput.addEventListener('input', renderTabSearch);
  tsInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeTabSearch(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setTsSelected(Math.min(tsSelected + 1, tsResults.children.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setTsSelected(Math.max(tsSelected - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); tsPick(tsSelected, e); }
  });
  tabSearchEl.addEventListener('mousedown', e => { if (e.target === tabSearchEl) closeTabSearch(); });

  /* ═══════════════════════════════════════════════════════════════
   T O*OLBAR BUTTONS
   ═══════════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════════════════════
   C U*STOM DROPDOWN
   ═══════════════════════════════════════════════════════════════ */
  function customFontFamily(name) {
    const safe = String(name).replace(/['"]/g, '').trim();
    return `'${safe}', monospace`;
  }

  function fontFormatFromName(fileName) {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    return { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[ext] || null;
  }

  function injectCustomFonts() {
    let styleEl = document.getElementById('tv-custom-fonts-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'tv-custom-fonts-style';
      document.head.appendChild(styleEl);
    }
    let css = '';
    for (const [name, f] of Object.entries(customFonts)) {
      const safe = String(name).replace(/['"]/g, '').trim();
      css += `@font-face{font-family:'${safe}';src:url(${f.dataUrl}) format('${f.format}');font-display:swap;}\n`;
    }
    styleEl.textContent = css;
  }

  function importFontFiles(files) {
    for (const file of files) {
      const format = fontFormatFromName(file.name);
      if (!format) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const base = file.name.replace(/\.[^.]+$/, '');
        customFonts[base] = { name: base, dataUrl: reader.result, format };
        injectCustomFonts();
        saveState();
        refreshFontPresetUI();
        renderCustomFontsList();
      };
      reader.readAsDataURL(file);
    }
  }

  function removeCustomFont(name) {
    delete customFonts[name];
    injectCustomFonts();
    if (currentFontFamily === customFontFamily(name)) {
      currentFontFamily = PRESET_FONTS[0].family;
    }
    saveState();
    refreshFontPresetUI();
    renderCustomFontsList();
    applySettings();
  }

  function renderCustomFontsList() {
    const list = document.getElementById('custom-fonts-list');
    if (!list) return;
    list.innerHTML = '';
    const names = Object.keys(customFonts);
    if (!names.length) {
      const empty = document.createElement('div');
      empty.className = 'text-[11px] text-[var(--dim-text)]';
      empty.textContent = 'No custom fonts imported yet.';
      list.appendChild(empty);
      return;
    }
    for (const name of names) {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3 px-2.5 py-1.5 rounded bg-black/20 border border-[var(--border)]';
      const label = document.createElement('span');
      label.className = 'text-[12px] text-[var(--fg)] truncate max-w-[220px]';
      label.style.fontFamily = customFontFamily(name);
      label.textContent = name;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'text-[11px] text-[#e55] hover:text-[#f77] cursor-pointer bg-transparent border-0 shrink-0';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => removeCustomFont(name));
      row.appendChild(label);
      row.appendChild(rm);
      list.appendChild(row);
    }
  }

  function refreshFontPresetUI() {
    const select = document.getElementById('set-fontpreset');
    const customRow = document.getElementById('fontfamily-custom-row');
    if (!select || !customRow) return;
    select.innerHTML = '';

    const addOpt = (value, label, selected) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (selected) opt.selected = true;
      select.appendChild(opt);
    };

    for (const p of PRESET_FONTS) {
      addOpt(p.family, p.name, currentFontFamily === p.family);
    }

    const customNames = Object.keys(customFonts);
    if (customNames.length) {
      const g = document.createElement('optgroup');
      g.label = 'Imported';
      for (const name of customNames) {
        addOpt(customFontFamily(name), name, currentFontFamily === customFontFamily(name));
      }
      select.appendChild(g);
    }

    addOpt('__custom__', 'Custom CSS font-family…', false);

    const matchesPreset = PRESET_FONTS.some(p => p.family === currentFontFamily);
    const matchesCustom = customNames.some(n => currentFontFamily === customFontFamily(n));
    const useCustom = !matchesPreset && !matchesCustom;

    if (useCustom) {
      select.value = '__custom__';
      customRow.classList.remove('hidden');
      customRow.classList.add('flex');
      document.getElementById('set-fontfamily').value = currentFontFamily;
    } else {
      customRow.classList.add('hidden');
      customRow.classList.remove('flex');
      if (matchesPreset) select.value = currentFontFamily;
      if (matchesCustom) select.value = customFontFamily(customNames.find(n => currentFontFamily === customFontFamily(n)));
    }

    const dd = document.querySelector('.custom-dropdown[data-for="set-fontpreset"]');
    if (dd) initCustomDropdown(dd);
  }

  let closeActiveDropdown = null;
  let dropdownSequence = 0;
  function initCustomDropdown(dd) {
    dd._disposeDropdown?.();
    const select = document.getElementById(dd.dataset.for);
    if (!select) return;
    const lifetime = new AbortController();
    let openedEvents = null;
    dd.replaceChildren();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-dropdown-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="custom-dropdown-label"></span><i class="ph ph-caret-down dropdown-arrow" aria-hidden="true"></i>';
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.id = `dropdown-options-${++dropdownSequence}`;
    menu.popover = 'manual';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', select.getAttribute('aria-label') || dd.dataset.for.replace(/^set-/, '').replaceAll('-', ' '));
    btn.setAttribute('aria-controls', menu.id);
    dd.append(btn, menu);
    const label = btn.querySelector('.custom-dropdown-label');
    const arrow = btn.querySelector('.dropdown-arrow');
    function appendIcon(host, pathData) {
      if (!pathData) return;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('dropdown-icon'); svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData); svg.append(path); host.append(svg);
    }
    function refresh() {
      label.replaceChildren();
      appendIcon(label, select.selectedOptions[0]?.dataset.icon);
      label.append(document.createTextNode(select.selectedOptions[0]?.textContent || ''));
      btn.disabled = select.disabled;
      for (const option of menu.children) {
        const selected = option.dataset.value === select.value;
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-selected', String(selected));
      }
    }
    function close(restoreFocus = false) {
      openedEvents?.abort(); openedEvents = null;
      if (menu.matches(':popover-open')) menu.hidePopover();
      menu.classList.remove('open'); btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      arrow.classList.replace('ph-caret-up', 'ph-caret-down');
      if (closeActiveDropdown === close) closeActiveDropdown = null;
      if (restoreFocus && btn.isConnected) btn.focus({ preventScroll: true });
    }
    function open(keyboard = false) {
      if (select.disabled) return;
      closeActiveDropdown?.();
      menu.replaceChildren();
      for (const option of select.options) {
        const item = document.createElement('div');
        item.className = 'custom-dropdown-option';
        item.dataset.value = option.value;
        item.tabIndex = -1;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-disabled', String(option.disabled));
        if (option.dataset.swatches) {
          const swatches = document.createElement('span'); swatches.className = 'theme-swatch';
          for (const color of option.dataset.swatches.split(',')) {
            const swatch = document.createElement('span'); swatch.style.background = color; swatches.append(swatch);
          }
          item.append(swatches);
        }
        appendIcon(item, option.dataset.icon);
        const text = document.createElement('span'); text.textContent = option.textContent; item.append(text);
        item.addEventListener('click', () => {
          if (option.disabled) return;
          const value = option.value;
          close(true);
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          refresh();
        });
        menu.append(item);
      }
      refresh();
      btn.classList.add('open'); menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      arrow.classList.replace('ph-caret-down', 'ph-caret-up');
      // Top-layer popovers escape overflow clipping and transformed ancestors,
      // while staying in the settings DOM for focus containment and theme styles.
      Object.assign(menu.style, { position: 'fixed', inset: 'auto', margin: '0', width: 'max-content', minWidth: '0', maxHeight: '256px', visibility: 'hidden' });
      menu.showPopover();
      const anchor = btn.getBoundingClientRect();
      const modal = dd.closest('#settings-modal')?.getBoundingClientRect();
      const bounds = { left: Math.max(8, modal?.left + 8 || 8), right: Math.min(innerWidth - 8, modal?.right - 8 || innerWidth - 8),
        top: Math.max(8, modal?.top + 8 || 8), bottom: Math.min(innerHeight - 8, modal?.bottom - 8 || innerHeight - 8) };
      const width = Math.min(Math.max(anchor.width, menu.scrollWidth + 2), bounds.right - bounds.left);
      const below = Math.max(0, bounds.bottom - anchor.bottom - 6);
      const above = Math.max(0, anchor.top - bounds.top - 6);
      const desired = Math.min(256, menu.scrollHeight + 2);
      const upward = below < desired && above > below;
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${Math.min(256, upward ? above : below)}px`;
      menu.style.left = `${Math.max(bounds.left, Math.min(anchor.right - width, bounds.right - width))}px`;
      const height = menu.getBoundingClientRect().height;
      menu.style.top = `${upward ? anchor.top - 6 - height : anchor.bottom + 6}px`;
      menu.style.visibility = '';
      const selected = menu.querySelector('[aria-selected="true"]');
      if (selected) menu.scrollTop = Math.max(0, selected.offsetTop - menu.clientHeight / 2);
      if (keyboard) (selected || menu.firstElementChild)?.focus({ preventScroll: true });
      closeActiveDropdown = close;
      openedEvents = new AbortController();
      const signal = openedEvents.signal;
      document.addEventListener('pointerdown', e => { if (!dd.contains(e.target)) close(); }, { capture: true, signal });
      document.addEventListener('scroll', e => { if (!menu.contains(e.target)) close(); }, { capture: true, signal });
      window.addEventListener('resize', () => close(), { signal });
      window.addEventListener('blur', () => close(), { signal });
    }
    btn.addEventListener('click', () => menu.matches(':popover-open') ? close() : open());
    dd.addEventListener('keydown', e => {
      const isOpen = menu.matches(':popover-open');
      if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab' && isOpen) { close(true); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
      if (!isOpen && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(true); return; }
      if (!isOpen) return; // Native button Enter/Space triggers click.
      e.preventDefault(); e.stopPropagation();
      const options = [...menu.children].filter(item => item.getAttribute('aria-disabled') !== 'true');
      const index = options.indexOf(document.activeElement);
      if (e.key === 'Enter' || e.key === ' ') { options[index]?.click(); return; }
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
      options[next]?.focus({ preventScroll: true }); options[next]?.scrollIntoView({ block: 'nearest' });
    }, { signal: lifetime.signal });
    select.addEventListener('change', refresh, { signal: lifetime.signal });
    dd._disposeDropdown = () => { close(); lifetime.abort(); };
    refresh();
  }

  // Init all custom dropdowns
  document.querySelectorAll('.custom-dropdown').forEach(initCustomDropdown);

  const settingsOverlay = document.getElementById('settings-overlay');

  function renderThemeCards() {
    const grid = document.getElementById('theme-card-grid');
    if (!grid) return;
    const focusedTheme = grid.contains(document.activeElement) ? document.activeElement.dataset.theme : null;
    grid.replaceChildren();
    for (const [key, sourceTheme] of Object.entries(THEMES)) {
      const theme = resolveAppearanceTheme(sourceTheme, resolvedDarkScheme());
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-choice';
      card.dataset.theme = key;
      card.setAttribute('aria-pressed', String(key === currentThemeName));
      card.setAttribute('aria-label', theme.label || key);
      const preview = document.createElement('span');
      preview.className = 'theme-choice-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.style.setProperty('--preview-bg', theme.bg);
      preview.style.setProperty('--preview-fg', theme.fg);
      preview.style.setProperty('--preview-accent', theme.ui?.accent || theme.palette[4] || theme.fg);
      // Real palette samples, rather than an unrelated light/dark variant.
      const colors = document.createElement('span');
      colors.className = 'theme-choice-colors';
      for (const color of [theme.bg, theme.fg, theme.ui?.accent || theme.palette[4]]) {
        const dot = document.createElement('span');
        dot.style.setProperty('--sample-color', color || theme.fg);
        colors.appendChild(dot);
      }
      const palette = document.createElement('span');
      palette.className = 'theme-choice-palette';
      for (const color of theme.palette.slice(1, 7)) {
        const swatch = document.createElement('span');
        swatch.style.setProperty('--sample-color', color);
        palette.appendChild(swatch);
      }
      preview.append(colors, palette);
      const footer = document.createElement('span');
      footer.className = 'theme-choice-footer';
      const label = document.createElement('span');
      label.className = 'theme-choice-name';
      label.textContent = theme.label || key;
      const check = document.createElement('i');
      check.className = 'ph ph-check-circle theme-choice-check';
      check.setAttribute('aria-hidden', 'true');
      footer.append(label, check);
      card.append(preview, footer);
      card.addEventListener('click', () => {
        const select = document.getElementById('set-theme');
        select.value = key;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      grid.appendChild(card);
    }
    if (focusedTheme) [...grid.children].find(card => card.dataset.theme === focusedTheme)?.focus({ preventScroll: true });
  }

  function openSettings(cat) {
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
    renderThemeCards();

    // Sidebar style
    const sbModeSelect = document.getElementById('set-sidebar-mode');
    sbModeSelect.value = sidebarMode;
    sbModeSelect.onchange = e => {
      sidebarMode = e.target.value;
      applySidebarMode();
      saveState();
    };
    const sbModeDD = document.querySelector('.custom-dropdown[data-for="set-sidebar-mode"]');
    if (sbModeDD) initCustomDropdown(sbModeDD);

    // Notify when a command finishes
    const notifyFinishToggle = document.getElementById('set-notify-finish');
    if (notifyFinishToggle) {
      notifyFinishToggle.checked = notifyOnCommandFinish;
      notifyFinishToggle.onchange = e => {
        notifyOnCommandFinish = e.target.checked;
        saveState();
      };
    }
    const notifySoundToggle = document.getElementById('set-notify-sound');
    if (notifySoundToggle) {
      notifySoundToggle.checked = notificationSound;
      notifySoundToggle.onchange = e => {
        notificationSound = e.target.checked;
        if (notificationSound) playNotifySound(); // preview
        saveState();
      };
    }

    const animationsToggle = document.getElementById('set-animations');
    animationsToggle.checked = animationsEnabled;
    animationsToggle.onchange = e => {
      animationsEnabled = e.target.checked;
      applyAnimationsSetting();
      saveState();
    };

    // Workspace process details
    const wsProcsToggle = document.getElementById('set-wsprocs');
    if (wsProcsToggle) {
      wsProcsToggle.checked = showWsProcs;
      wsProcsToggle.onchange = e => {
        showWsProcs = e.target.checked;
        applyWsProcsSetting();
        renderSidebar();
        saveState();
      };
    }

    // Font size
    document.getElementById('set-fontsize').value = currentFontSize;
    document.getElementById('set-fontsize-val').textContent = currentFontSize + 'px';

    // Font family
    refreshFontPresetUI();
    renderCustomFontsList();

    // Line height
    document.getElementById('set-lineheight').value = currentLineHeight;
    document.getElementById('set-lineheight-val').textContent = currentLineHeight.toFixed(1);

    // Cursor style
    document.getElementById('set-cursor').value = currentCursorStyle;

    // Cursor blink
    const blinkToggle = document.getElementById('set-cursorblink');
    blinkToggle.checked = currentCursorBlink;

    // Scrollback
    document.getElementById('set-scrollback').value = currentScrollback;
    document.getElementById('set-scrollback-val').textContent = currentScrollback.toLocaleString();

    // Default path
    const defaultPathInput = document.getElementById('set-default-path');
    if (defaultPathInput) defaultPathInput.value = defaultTerminalPath || '';
    const defaultPathBrowse = document.getElementById('set-default-path-browse');
    if (defaultPathBrowse) {
      defaultPathBrowse.style.display = (isDesktop() && window.electronAPI?.selectDirectory) ? 'inline-flex' : 'none';
    }

    // Terminal links
    const linkSelect = document.getElementById('set-link-target');
    linkSelect.value = terminalLinkTarget;
    const linkDD = document.querySelector('.custom-dropdown[data-for="set-link-target"]');
    if (linkDD) initCustomDropdown(linkDD);

    // Search engine
    const searchSelect = document.getElementById('set-search-engine');
    searchSelect.value = searchEngine;
    for (const opt of searchSelect.options) {
      if (SEARCH_ENGINE_ICONS[opt.value]) opt.dataset.icon = SEARCH_ENGINE_ICONS[opt.value];
    }
    const searchDD = document.querySelector('.custom-dropdown[data-for="set-search-engine"]');
    if (searchDD) initCustomDropdown(searchDD);
    document.getElementById('set-custom-search-row').classList.toggle('hidden', searchEngine !== 'custom');
    document.getElementById('set-custom-search-row').classList.toggle('flex', searchEngine === 'custom');
    document.getElementById('set-custom-search-url').value = customSearchUrl;

    // Background
    refreshBgSettingsUI();

    // Shortcuts
    renderShortcutsList();

    // Always open on the first category (General) unless deep-linked
    document.getElementById('settings-nav-search').value = '';
    document.querySelectorAll('.settings-cat-btn').forEach(btn => { btn.hidden = false; });
    switchSettingsCat(typeof cat === 'string' ? cat : 'general');
    settingsOverlay.inert = false;
    settingsOverlay.classList.add('open');
    document.activeElement?.blur();

    settingsOverlay.focus({ preventScroll: true });
    syncBrowserSlots();
    if (cat === 'plugins') renderPluginsSettings();
  }

  function closeSettings() {
    closeActiveDropdown?.();
    applyTheme(currentThemeName);
    settingsOverlay.inert = true;
    settingsOverlay.classList.remove('open');
    syncBrowserSlots();
    // In the Electron settings window, closing the overlay closes the window
    if (SETTINGS_ONLY && window.electronAPI?.settingsClose) {
      const exits = settingsOverlay.getAnimations({ subtree: true });
      Promise.allSettled(exits.map(animation => animation.finished)).then(() => {
        if (!settingsOverlay.classList.contains('open')) window.electronAPI.settingsClose();
      });
    }
  }

  function renderShortcutsList() {
    const list = document.getElementById('shortcuts-list');
    if (!list) return;
    const searchInput = document.getElementById('shortcuts-search');
    const query = (searchInput?.value || '').trim().toLowerCase();
    list.innerHTML = '';
    let shown = 0;
    for (const [action, sc] of Object.entries(customShortcuts)) {
      const label = SHORTCUT_LABELS[action] || action;
      const combo = formatKeyCombo(sc);
      if (query && !label.toLowerCase().includes(query) && !combo.toLowerCase().includes(query)) continue;
      shown++;
      const item = document.createElement('div');
      item.className = 'shortcut-item';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const key = document.createElement('span');
      key.className = 'shortcut-key' + (!sc.key ? ' empty' : '');
      key.textContent = combo;
      key.addEventListener('click', () => startRecording(item, key, action));
      const resetBtn = document.createElement('span');
      resetBtn.className = 'shortcut-reset';
      resetBtn.title = 'Reset to default';
      resetBtn.innerHTML = '<i class="ph ph-arrow-u-up-left"></i>';
      const defaultSc = DEFAULT_SHORTCUTS[action];
      resetBtn.addEventListener('click', () => {
        if (defaultSc) {
          customShortcuts[action] = JSON.parse(JSON.stringify(defaultSc));
          saveState();
          renderShortcutsList();
        }
      });
      const keys = document.createElement('div');
      keys.className = 'shortcut-keys';
      keys.appendChild(key);
      keys.appendChild(resetBtn);
      item.appendChild(labelEl);
      item.appendChild(keys);
      list.appendChild(item);
    }
    if (!shown) {
      const empty = document.createElement('div');
      empty.className = 'shortcuts-empty';
      empty.textContent = 'No shortcuts match your search';
      list.appendChild(empty);
    }
  }

  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'shortcuts-search') renderShortcutsList();
  });

  function startRecording(item, keyEl, action) {
    // Cancel any existing recording
    document.querySelectorAll('.shortcut-key.recording').forEach(el => el.classList.remove('recording'));
    keyEl.classList.add('recording');
    keyEl.textContent = 'Press a key...';

    const isClickAction = customShortcuts[action]?.key === 'Click' || DEFAULT_SHORTCUTS[action]?.key === 'Click';
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

      // Escape clears the shortcut (empty = disabled)
      if (e.code === 'Escape') {
        cancelled = true;
        cleanup();
        keyEl.classList.remove('recording');
        customShortcuts[action] = { ctrl: false, shift: false, alt: false, meta: false, key: null };
        saveState();
        renderShortcutsList();
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
      if (isClickAction && !mainKey && (modState.ctrl || modState.alt || modState.meta)) {
        keyEl.textContent = formatKeyCombo({ ...modState, key: 'Click' });
      } else if (mainKey) {
        keyEl.textContent = formatKeyCombo({ ...modState, key: mainKey });
      }
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
        // For click shortcuts: finalize with modifier-only combo
        if (isClickAction && (modState.ctrl || modState.alt || modState.meta)) {
          apply({ ...modState, key: 'Click' });
        } else {
          keyEl.textContent = 'Press a key...';
          modState = { ctrl: false, shift: false, alt: false, meta: false };
        }
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

  let skillsBusy = false;
  async function skillRequest(id, enabled) {
    if (window.electronAPI?.listSkills) {
      return id === undefined ? window.electronAPI.listSkills() : window.electronAPI.setSkillEnabled(id, enabled);
    }
    const response = await fetch('/api/skills', id === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not update skills');
    return data;
  }

  async function renderSkillsSettings() {
    if (skillsBusy) return;
    const list = document.getElementById('skills-list');
    const status = document.getElementById('skills-status');
    skillsBusy = true;
    list.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading skills…';
    try {
      drawSkillRows(await skillRequest());
      status.textContent = '';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      skillsBusy = false;
      list.setAttribute('aria-busy', 'false');
    }
  }

  function drawSkillRows(skills) {
    const list = document.getElementById('skills-list');
    list.replaceChildren();
    for (const skill of skills) {
      const row = document.createElement('div');
      row.className = 'skill-row';
      const info = document.createElement('div');
      info.className = 'skill-info';
      const name = document.createElement('div');
      name.className = 'skill-name';
      name.textContent = skill.name;
      const state = document.createElement('span');
      state.className = 'skill-state';
      state.textContent = skill.conflict ? 'Conflicting copies' : skill.enabled ? 'Active' : skill.installed ? 'Inactive' : 'Not installed';
      name.append(' ', state);
      const location = document.createElement('div');
      location.className = 'skill-path';
      location.textContent = skill.path;
      info.append(name, location);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skill-action';
      button.textContent = skill.enabled ? 'Deactivate' : skill.installed ? 'Activate' : 'Install';
      button.setAttribute('aria-label', `${button.textContent} TerminalVibe skill for ${skill.name}`);
      button.disabled = skill.conflict;
      button.dataset.conflict = String(skill.conflict);
      button.addEventListener('click', async () => {
        if (skillsBusy) return;
        skillsBusy = true;
        const status = document.getElementById('skills-status');
        list.setAttribute('aria-busy', 'true');
        list.querySelectorAll('button').forEach(b => { b.disabled = true; });
        status.textContent = 'Updating skill…';
        try {
          drawSkillRows(await skillRequest(skill.id, !skill.enabled));
          status.textContent = `Skill ${skill.enabled ? 'deactivated' : 'activated'} for ${skill.name}. Start a new agent session to apply.`;
          list.querySelector(`[aria-label$="for ${skill.name}"]`)?.focus();
        } catch (error) {
          status.textContent = error.message;
          list.querySelectorAll('button').forEach(b => { b.disabled = b.dataset.conflict === 'true'; });
        } finally {
          skillsBusy = false;
          list.setAttribute('aria-busy', 'false');
        }
      });
      row.append(info, button);
      list.append(row);
    }
  }

  function switchSettingsCat(cat) {
    closeActiveDropdown?.();
    if (!document.querySelector(`.settings-cat-btn[data-cat="${CSS.escape(cat)}"]`)) cat = 'general';
    const prevCat = document.querySelector('.settings-cat-btn.active')?.dataset.cat;
    document.querySelectorAll('.settings-cat-btn').forEach(b => { b.classList.toggle('active', b.dataset.cat === cat); b.setAttribute('aria-pressed', String(b.dataset.cat === cat)); });
    document.querySelectorAll('.settings-section[data-cat]').forEach(s => s.classList.toggle('active', s.dataset.cat === cat));
    // Reset scroll to top of the new section
    document.querySelector('.settings-section')?.parentElement?.scrollTo({ top: 0 });
    const categoryTitle = document.getElementById('settings-category-title');
    if (categoryTitle) categoryTitle.textContent = document.querySelector('.settings-cat-btn.active span')?.textContent || 'Settings';
    settingsCategory = cat;
    saveState();
    if (cat === 'plugins') renderPluginsSettings();
    if (cat === 'skills') renderSkillsSettings();
    if (prevCat === 'plugins' && cat !== 'plugins') _pluginsView = { mode: 'list' };
  }

  // Category button click handlers
  document.querySelectorAll('.settings-cat-btn').forEach(btn => {
    makeKeyboardButton(btn);
    btn.addEventListener('click', () => {
      switchSettingsCat(btn.dataset.cat);
    });
  });

  function applySettings() {
    document.documentElement.style.setProperty('--app-font', currentFontFamily);
    const wsp = activeWs();
    if (!wsp) return;
    const terms = getWorkspaceTerminals(wsp);
    for (const t of terms) {
      if (t.type === 'browser') continue;
      t._customFontSize = currentFontSize; // Reset temporary zoom on global change
      t.term.options.fontSize = currentFontSize;
      t.term.options.fontFamily = terminalFontFamily(currentFontFamily);
      t.term.options.lineHeight = currentLineHeight;
      t.term.options.cursorStyle = currentCursorStyle;
      t.term.options.cursorBlink = currentCursorBlink;
      t.term.options.scrollback = currentScrollback;
      fitTerm(t);
    }
    saveState();
  }

  // Apply only the settings fields from shared storage (never touches
  // workspaces/folders/sideOrder) — used by the settings window on boot and
  // by the main window when the settings window pushes changes.
  async function restoreSettingsOnly() {
    try {
      let state = {};
      const api = configApi();
      if (api && api.configReadState) {
        const diskState = await api.configReadState();
        if (diskState) state = diskState;
      }
      if (!state.theme) {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw) state = JSON.parse(raw);
      }
      await resolveStateImages(state);
      if (['system', 'light', 'dark'].includes(state.colorScheme)) currentColorScheme = state.colorScheme;
      if (state.theme && THEMES[state.theme]) { currentThemeName = state.theme; currentTheme = resolveAppearanceTheme(THEMES[currentThemeName], resolvedDarkScheme()); }
      if (state.fontSize) currentFontSize = state.fontSize;
      if (state.fontFamily) currentFontFamily = state.fontFamily;
      if (state.customFonts) {
        customFonts = {};
        for (const [k, v] of Object.entries(state.customFonts)) {
          if (v && v.dataUrl) customFonts[k] = { name: v.name || k, dataUrl: v.dataUrl, format: v.format || 'truetype' };
        }
        injectCustomFonts();
      }
      if (state.lineHeight) currentLineHeight = state.lineHeight;
      if (state.cursorStyle) currentCursorStyle = state.cursorStyle;
      if (state.cursorBlink !== undefined) currentCursorBlink = state.cursorBlink;
      if (state.scrollback) currentScrollback = state.scrollback;
      animationsEnabled = state.animationsEnabled !== false;
      applyAnimationsSetting();
      if (typeof state.settingsCategory === 'string') settingsCategory = state.settingsCategory;
      if (state.pinnedCollapsed !== undefined) pinnedCollapsed = !!state.pinnedCollapsed;
      if (state.sidebarMode) {
        if (sidebarMode !== state.sidebarMode) {
          sidebarMode = state.sidebarMode;
          applySidebarMode();
        }
      }
      if (state.showWsProcs !== undefined) showWsProcs = !!state.showWsProcs;
      if (state.notifyOnCommandFinish !== undefined) notifyOnCommandFinish = !!state.notifyOnCommandFinish;
      if (state.notificationSound !== undefined) notificationSound = !!state.notificationSound;
      if (['tab', 'external'].includes(state.terminalLinkTarget)) terminalLinkTarget = state.terminalLinkTarget;
      if (state.backgroundMode) backgroundMode = state.backgroundMode;
      if (state.globalBackgroundImage) globalBackgroundImage = state.globalBackgroundImage;
      if (state.backgroundOpacity !== undefined) backgroundOpacity = state.backgroundOpacity;
      if (state.searchEngine) searchEngine = state.searchEngine;
      if (state.customSearchUrl) customSearchUrl = state.customSearchUrl;
      if (state.defaultTerminalPath !== undefined) defaultTerminalPath = state.defaultTerminalPath;
      if (state.shortcuts) {
        for (const [k, v] of Object.entries(state.shortcuts)) {
          if (customShortcuts[k]) customShortcuts[k] = v;
        }
        syncBrowserShortcuts();
      }
      if (state.pluginStates) {
        for (const [k, v] of Object.entries(state.pluginStates)) _pluginStates.set(k, !!v);
      }
      if (state.pluginConfigs) {
        for (const [k, v] of Object.entries(state.pluginConfigs)) {
          if (v && typeof v === 'object') _pluginConfigs.set(k, Object.assign({}, v));
        }
      }
    } catch { }
  }

  // Browser tabs are DOM <webview>s now, so the in-window overlay covers
  // them — same technique as the reference preview panel. No separate window.
  function openSettingsGlobal(cat) {
    openSettings(cat);
  }

  /* ═══════════════════════════════════════════════════════════════
   K E*YBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════════════ */
  // Capture-phase — intercepts before xterm.js
  document.addEventListener('keydown', e => {
    // Escape clears multi-select mode (skip when settings is open)
    if (e.key === 'Escape' && isInMultiMode() && !settingsOverlay.classList.contains('open')) {
      e.preventDefault(); e.stopPropagation();
      clearMultiSelect();
      return;
    }
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
        navigator.clipboard.writeText(text);
      }
      return;
    }
    // Paste — leave it to the focused text field
    const inTextField = isTextField(e.target);
    if (matchShortcut(e, 'paste')) {
      const t = activeTerminal();
      if (t && t.type !== 'browser' && !inTextField) {
        e.preventDefault(); e.stopPropagation();
        doPaste(t);
      }
      return;
    }
    // Ctrl+V paste (non-shift variant)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v') {
      const t = activeTerminal();
      if (t && t.type !== 'browser' && !inTextField) {
        e.preventDefault(); e.stopPropagation();
        doPaste(t);
      }
      return;
    }
    // Workspace switching
    if (matchShortcut(e, 'nextWorkspace')) { e.preventDefault(); e.stopPropagation(); nextWorkspace(); return; }
    if (matchShortcut(e, 'prevWorkspace')) { e.preventDefault(); e.stopPropagation(); prevWorkspace(); return; }
    // Alt+N → workspace at sidebar position N
    for (let i = 1; i <= 9; i++) {
      if (matchShortcut(e, 'switchWs' + i)) {
        e.preventDefault(); e.stopPropagation();
        switchWsByNumber(i);
        return;
      }
    }
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
    if (matchShortcut(e, 'tabSearch')) { e.preventDefault(); e.stopPropagation(); openTabSearch(); return; }
    if (matchShortcut(e, 'commandPalette')) { e.preventDefault(); e.stopPropagation(); openPalette('cmds'); return; }
    if (matchShortcut(e, 'snippets')) { e.preventDefault(); e.stopPropagation(); openPalette('snips'); return; }
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
    if (matchShortcut(e, 'quitApp')) {
      e.preventDefault(); e.stopPropagation();
      confirmQuitApp();
      return;
    }
    if (matchShortcut(e, 'maximizeTab')) {
      e.preventDefault(); e.stopPropagation();
      const wsp = activeWs();
      if (wsp && wsp.activeTermId) toggleMaximizeTerminal(wsp.id, wsp.activeTermId);
      return;
    }
    if (matchShortcut(e, 'profiles')) { e.preventDefault(); e.stopPropagation(); openProfilePicker(); return; }
    if (matchShortcut(e, 'toggleSidebar')) { e.preventDefault(); e.stopPropagation(); toggleSidebar(); return; }
    // Arrow key tab switching (legacy)
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
      if (e.code === 'ArrowLeft') { e.preventDefault(); prevTab(); return; }
      if (e.code === 'ArrowRight') { e.preventDefault(); nextTab(); return; }
    }
    // Plugin command combos (last, so built-in shortcuts win)
    if (dispatchPluginKeydown(e)) return;
  });

  // Settings-window bootstrap: skip the entire terminal/browser layer.
  async function settingsOnlyBoot() {
    await loadCustomThemes();
    await restoreSettingsOnly();
    await loadPlugins();
    applyTheme(currentThemeName);
    document.body.classList.add('settings-only');
    const splash = document.getElementById('splash');
    if (splash) splash.classList.add('hide');
    openSettings();
  }

  async function detachedOnlyBoot() {
    await document.fonts.load('14px "Geist Mono"');
    await loadCustomThemes();
    // Restore only theme/font settings (not workspaces) for the detached window
    try {
      let raw = null;
      const api = configApi();
      if (api && api.configReadState) {
        const diskState = await api.configReadState();
        if (diskState) raw = JSON.stringify(diskState);
      }
      if (!raw) raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        if (['system', 'light', 'dark'].includes(state.colorScheme)) currentColorScheme = state.colorScheme;
        if (state.theme && THEMES[state.theme]) { currentThemeName = state.theme; currentTheme = resolveAppearanceTheme(THEMES[currentThemeName], resolvedDarkScheme()); }
        if (state.fontSize) currentFontSize = state.fontSize;
        if (state.fontFamily) currentFontFamily = state.fontFamily;
        if (state.customFonts) {
          customFonts = {};
          for (const [k, v] of Object.entries(state.customFonts)) {
            if (v && v.dataUrl) customFonts[k] = { name: v.name || k, dataUrl: v.dataUrl, format: v.format || 'truetype' };
          }
          injectCustomFonts();
        }
        if (state.lineHeight) currentLineHeight = state.lineHeight;
        if (state.cursorBlink !== undefined) currentCursorBlink = state.cursorBlink;
        if (state.cursorStyle) currentCursorStyle = state.cursorStyle;
        if (state.scrollback !== undefined) currentScrollback = state.scrollback;
        if (state.notifyOnCommandFinish !== undefined) notifyOnCommandFinish = !!state.notifyOnCommandFinish;
        if (state.notificationSound !== undefined) notificationSound = !!state.notificationSound;
      }
    } catch { }
    applyTheme(currentThemeName);
    document.body.classList.add('detached');

    // Hide splash screen (normal init hides it at line ~6017, after the detached return)
    const splash = document.getElementById('splash');
    if (splash) splash.classList.add('hide');

    // Show the titlebar so the window is draggable
    const tb = document.getElementById('titlebar');
    if (tb) tb.classList.add('active');
    document.getElementById('btn-attach-main')?.addEventListener('click', attachWindowToMain);

    // Hide sidebar
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'none';

    // Wire up Electron PTY bridge (same as normal init)
    if (isDesktop() && window.electronAPI) {
      const api = window.electronAPI;
      wsReady = true;
      nativePtyReady = true;
      api.onTerminalData(({ id, data }) => {
        const result = findTermById(id);
        if (result && result.term && result.term.type !== 'browser') {
          result.term.term.write(data);
        }
      });
      // A split's shell exiting removes just that tab; handleExit closes
      // the window only when it was the last one.
      api.onTerminalExit(({ id, code }) => handleExit(id, code));
      if (api.onTerminalFinished) api.onTerminalFinished(onTerminalFinished);
      // Main process accepted a cross-window move for a tab living in
      // THIS window — snapshot its buffer, remove the tab locally, and
      // report how many tabs remain (main closes this window at 0).
      if (api.onTabDragComplete) {
        api.onTabDragComplete(({ id }) => {
          let ready = { id, remaining: 0 };
          try {
            const wsp = workspaces[0];
            const group = wsp && findGroupContainingTerm(wsp.layout, id);
            const entry = group && group.terminals.find(x => x.id === id);
            if (entry && entry.term) {
              const payload = serializeTermBuffer(entry);
              if (payload) localStorage.setItem(DETACH_BUFFER_KEY(id), JSON.stringify(payload));
              ready = { id, cols: entry.term.cols, rows: entry.term.rows, cwd: entry.cwd, label: entry.label, remaining: 0 };
            }
            if (group) {
              group.terminals = group.terminals.filter(x => x.id !== id);
              if (group.activeTermId === id) group.activeTermId = group.terminals[0]?.id || null;
              wsp.layout = removeEmptyGroups(wsp.layout);
              ready.remaining = getWorkspaceTerminals(wsp).length;
              if (ready.remaining > 0) {
                renderPaneArea();
                const nt = activeTerminal();
                if (nt) activateTerminal(wsp.id, nt.id);
                saveState();
              }
            }
          } catch { }
          if (api.tabDragReady) api.tabDragReady(ready);
        });
      }
      // A terminal dragged from another window (main or a sibling
      // detached window) and dropped here — re-create the tab attached
      // to the same PTY, placed like a normal tab drop.
      if (api.onTerminalReattach) {
        api.onTerminalReattach(({ id, cols, rows, cwd, placement }) => {
          try { reattachTerminal(id, cols, rows, cwd, placement); } catch (e) { console.error('[reattach] failed:', e); }
        });
      }
      // Which terminal another window is currently dragging — used by the
      // shared tab-bar/pane drop handlers to route the cross-window drop.
      if (api.onTabDragActive) {
        api.onTabDragActive(({ id }) => {
          if (id) {
            window.externalDragTermId = id;
            window.lastExternalDragTermId = id;
            startResizing();
            if (window._clearExternalDragTimer) {
              clearTimeout(window._clearExternalDragTimer);
              window._clearExternalDragTimer = null;
            }
          } else {
            window.externalDragTermId = null;
            // tab-drag:start broadcasts {id:null} to every window (incl. this one)
            // right after our own dragstart — don't tear down a local drag's shield.
            if (!window.draggedTermId) stopResizing();
            if (window._clearExternalDragTimer) clearTimeout(window._clearExternalDragTimer);
            window._clearExternalDragTimer = setTimeout(() => {
              window.lastExternalDragTermId = null;
            }, 1500);
          }
        });
      }
    }

    // Read detached params
    const termId = DETACHED_PARAMS.get('termId');
    const cols = parseInt(DETACHED_PARAMS.get('cols')) || 80;
    const rows = parseInt(DETACHED_PARAMS.get('rows')) || 24;
    const cwd = DETACHED_PARAMS.get('cwd') || undefined;

    if (!termId) return;

    let restored = false;
    let detachedBuffer = null; // stashed screen/scrollback (with tab label)
    try { restored = await restoreState(); } catch { }

    if (!restored) {
      // Create a minimal workspace to hold the terminal
      const wsId = 'detached-ws';
      const wsp = {
        id: wsId,
        label: 'Detached',
        layout: { type: 'group', id: 'group-detached', terminals: [], activeTermId: null },
      };
      workspaces = [wsp];
      activeWsId = wsId;
      sideOrder = [{ type: 'ws', id: wsId }];

      // Read the stashed buffer now so the tab keeps its original name
      try {
        const raw = localStorage.getItem(DETACH_BUFFER_KEY(termId));
        if (raw) detachedBuffer = JSON.parse(raw);
      } catch { }

      // Create the terminal entry
      const entry = _createTermEntry(wsp, termId, (detachedBuffer && detachedBuffer.label) || 'terminal');
      entry.cwd = cwd;
      wsp.layout.terminals = [entry];
      wsp.layout.activeTermId = termId;
    }

    // Render the pane area (creates the DOM and opens the xterm)
    const empty = document.getElementById('empty-state');
    if (empty) empty.style.display = 'none';
    renderPaneArea();

    // The PTY for this terminal is already running in the main process (it
    // was never killed on detach), so we do NOT send terminal:create — that
    // would kill the session and spawn a fresh shell. Instead, replay the
    // captured screen/scrollback and then let live output stream in.
    const active = activeTerminal();
    if (active && active.type !== 'browser') {
      // Open at the size the PTY was running at so the replayed lines
      // don't wrap, then fit to the actual window size after layout.
      try { active.term.resize(cols, rows); } catch { }
      if (!detachedBuffer) {
        // restored-from-state path: the stash wasn't read above
        try {
          const raw = localStorage.getItem(DETACH_BUFFER_KEY(termId));
          detachedBuffer = raw ? JSON.parse(raw) : null;
        } catch { }
      }
      try { localStorage.removeItem(DETACH_BUFFER_KEY(termId)); } catch { }
      if (detachedBuffer) restoreTermBuffer(active, detachedBuffer);
    }

    // Tell main we're ready so it flushes any output produced while the
    // window was booting (it buffers PTY data for detached terminals).
    if (window.electronAPI && window.electronAPI.terminalAttached) {
      window.electronAPI.terminalAttached(termId);
    }

    // Fit after DOM is laid out
    setTimeout(() => {
      const t = activeTerminal();
      if (t && t.type !== 'browser') fitTerm(t);
    }, 80);
  }

  // Background image settings controls (declared here so the settings-window
  // bootstrap can read them before the wiring below runs — TDZ guard).
  const bgModeSelect = document.getElementById('set-bg-mode');
  const bgOpacitySlider = document.getElementById('set-bg-opacity');
  const bgOpacityVal = document.getElementById('set-bg-opacity-val');
  const bgUploadArea = document.getElementById('set-bg-image-area');
  const bgFileInput = document.getElementById('set-bg-image-input');
  const bgPreview = bgUploadArea.querySelector('.bg-upload-preview');
  const bgClearBtn = document.getElementById('bg-image-clear');
  const bgPerTabNote = document.getElementById('bg-per-tab-note');
  const bgControlsRow = document.getElementById('bg-image-controls');

  // Settings-window bootstrap: skip the entire terminal/browser layer.
  if (SETTINGS_ONLY) { settingsOnlyBoot(); return; }

  // Detached-terminal bootstrap: minimal terminal-only window.
  function setupServersDropdown() {
    const button = document.getElementById('btn-servers');
    const dropdown = document.getElementById('servers-dropdown');
    const list = document.getElementById('servers-list');
    const refresh = document.getElementById('servers-refresh');
    if (!button || !dropdown || !list || !refresh) return;
    const POLL_MS = 3000;
    let loading = false, hasResult = false, signature = null, poll = null;
    const message = text => {
      const el = document.createElement('p');
      el.className = 'servers-message'; el.textContent = text;
      list.replaceChildren(el);
    };
    const position = () => {
      const rect = button.getBoundingClientRect();
      dropdown.style.top = (rect.bottom + 6) + 'px';
      dropdown.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    };
    const finishClose = e => {
      if (e.target !== dropdown || !dropdown.hidden || !dropdown.classList.contains('closing')) return;
      if (dropdown.getAnimations().some(animation => animation.transitionProperty === 'opacity' && animation.playState === 'running')) return;
      dropdown.classList.remove('closing');syncBrowserSlots();
    };
    dropdown.addEventListener('transitionend', finishClose);
    dropdown.addEventListener('transitioncancel', finishClose);
    const close = () => {
      clearInterval(poll); poll = null;
      const restoreFocus = dropdown.contains(document.activeElement);
      dropdown.hidden = true;dropdown.inert = true;
      // Keep native browser views behind the painted dropdown during its fade.
      const fades = dropdown.getAnimations().filter(animation => animation.transitionProperty === 'opacity');
      dropdown.classList.toggle('closing', fades.length > 0);
      if (fades.length) Promise.allSettled(fades.map(animation => animation.finished)).then(() => finishClose({target:dropdown}));
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus({preventScroll:true});
      syncBrowserSlots();
    };
    // `silent`: background poll — no busy state; the list only re-renders when it changed.
    const load = async (silent = false) => {
      if (loading) return;
      loading = true;
      if (!silent) { refresh.disabled = true; refresh.title = 'Refresh servers'; list.setAttribute('aria-busy', 'true'); }
      if (!hasResult) message('Checking listening ports…');
      try {
        let servers;
        if (window.electronAPI?.listRunningServers) servers = await window.electronAPI.listRunningServers();
        else {
          const response = await fetch('/api/servers');
          if (!response.ok) throw new Error('Server discovery failed');
          servers = (await response.json()).servers;
        }
        if (!Array.isArray(servers)) throw new Error('Invalid server list');
        const fragment = document.createDocumentFragment();
        const normalized = [];
        for (const server of servers) {
          const url = new URL(server.url);
          if (!['http:', 'https:'].includes(url.protocol)) continue;
          normalized.push([url.href, server.process, server.port, server.pid]);
          const row = document.createElement('a');
          row.className = 'server-row'; row.href = url.href;
          row.title = `Open ${url.origin}${server.pid ? ' · PID ' + server.pid : ''}`;
          const icon = document.createElement('span'); icon.className = 'server-icon'; icon.innerHTML = procIconHtml(server.process || '', 'ph-globe'); icon.setAttribute('aria-hidden', 'true');
          const details = document.createElement('span'); details.className = 'server-details';
          const name = document.createElement('span'); name.className = 'server-name'; name.textContent = server.process || 'Listening server';
          const address = document.createElement('span'); address.className = 'server-address'; address.textContent = url.origin;
          const port = document.createElement('span'); port.className = 'server-port'; port.textContent = ':' + server.port;
          details.append(name, address); row.append(icon, details, port);
          row.addEventListener('click', event => {
            event.preventDefault(); close();
            const wsp = activeWs();
            if (wsp) addBrowserTab(wsp.id, null, url.href);
            else openExternalUrl(url.href);
          });
          const entry = document.createElement('div'); entry.className = 'server-entry';
          entry.append(row);
          if (server.pid) {
            // Sibling of the link, not nested: an <a> must not contain a button.
            const kill = document.createElement('button');
            kill.type = 'button'; kill.className = 'server-kill';
            kill.title = `Stop ${name.textContent} (PID ${server.pid})`;
            kill.setAttribute('aria-label', kill.title);
            kill.innerHTML = '<i class="ph ph-stop-circle" aria-hidden="true"></i>';
            kill.addEventListener('click', () => {
              showConfirm(`Stop ${name.textContent} on port ${server.port} (PID ${server.pid})?`, async () => {
                kill.disabled = true;
                try {
                  if (window.electronAPI?.killRunningServer) await window.electronAPI.killRunningServer(server.pid, server.port);
                  else {
                    const response = await fetch('/api/servers/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: server.pid, port: server.port }) });
                    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not stop the server.');
                  }
                  // Give the process a moment to release its port before re-listing.
                  setTimeout(() => load(), 400);
                } catch (error) {
                  kill.disabled = false;
                  address.textContent = String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
                  entry.classList.add('failed');
                }
              });
            });
            entry.append(kill);
          }
          fragment.appendChild(entry);
        }
        const nextSignature = JSON.stringify(normalized);
        if (nextSignature !== signature) {
          if (normalized.length) list.replaceChildren(fragment);
          else message('No listening servers found.');
          signature = nextSignature;
        }
        hasResult = true;
      } catch (error) {
        console.warn('[servers]', error);
        if (!hasResult) message('Could not load servers. Refresh to try again.');
        else if (!silent) refresh.title = 'Could not refresh servers. Showing previous results; click to retry.';
      } finally {
        loading = false; refresh.disabled = false; list.setAttribute('aria-busy', 'false');
      }
    };
    button.addEventListener('click', () => {
      if (!dropdown.hidden) { close(); return; }
      dropdown.classList.remove('closing');dropdown.hidden = false;dropdown.inert = false;
      button.setAttribute('aria-expanded', 'true');
      position(); syncBrowserSlots(); load(hasResult);
      poll = setInterval(() => load(true), POLL_MS);
    });
    refresh.addEventListener('click', () => load());
    document.addEventListener('mousedown', event => {
      if (!dropdown.hidden && !dropdown.contains(event.target) && !button.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => {
      if (dropdown.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); button.focus(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && (dropdown.contains(document.activeElement) || document.activeElement === button)) {
        event.preventDefault();
        const items = [...dropdown.querySelectorAll('button:not(:disabled), a')];
        const index = items.indexOf(document.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
    window.addEventListener('resize', () => { if (!dropdown.hidden) position(); });
  }
  setupServersDropdown();

  if (DETACHED_ONLY) { detachedOnlyBoot(); return; }

  // Open/close
  document.getElementById('btn-settings').addEventListener('click', () => openSettingsGlobal());
  const startSession = () => activeWs() ? addTerminal() : createWorkspace();
  document.getElementById('empty-new-terminal').addEventListener('click', startSession);
  const btnProfiles = document.getElementById('btn-profiles');
  if (btnProfiles) btnProfiles.addEventListener('click', openProfilePicker);
  // Native browser views sit above DOM overlays; hide them while the picker
  // is visible and restore them when it closes, including Escape and switching.
  const profilePickerObserver = new MutationObserver(() => syncBrowserSlots());
  profilePickerObserver.observe(document.getElementById('profile-picker'), { attributes: true, attributeFilter: ['style'] });
  const btnSidebarRight = document.getElementById('btn-sidebar-right');
  if (btnSidebarRight) btnSidebarRight.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('sb-right-hidden');
    const sidebar = document.getElementById('sidebar-right');
    sidebar.inert = hidden;
    if (hidden) sidebar.querySelectorAll('.sbr-page').forEach(page => {
      page.style.display = page.id === 'sbr-main' ? 'flex' : 'none';
    });
    btnSidebarRight.setAttribute('aria-expanded', String(!hidden));
  });

  // Right sidebar pages (main / clipboard)
  const sbrOpen = document.getElementById('sbr-open-clipboard');
  const sbrBack = document.getElementById('sbr-clipboard-back');
  const sbrMain = document.getElementById('sbr-main');
  const sbrClip = document.getElementById('sbr-clipboard');
  const sbrClipContent = document.getElementById('sbr-clipboard-content');
  if (sbrOpen && sbrBack && sbrMain && sbrClip) {
    let clipboardView = 'clipboard';
    const clipboardTabs = [...sbrClip.querySelectorAll('[data-clipboard-view]')];
    const CLIP_KEY = 'terminalvibe.clipboardHistory';
    const CLIP_MAX = 200;
    const CLIP_FAVORITES_KEY = CLIP_KEY + '.favorites';
    const CLIP_LAST_KEY = CLIP_KEY + '.lastSeen';
    let favorites = new Set(), lastCapturedText = null, editingText = null, editDraft = '';
    let clipHistory = [];
    try { clipHistory = JSON.parse(localStorage.getItem(CLIP_KEY) || '[]'); } catch { clipHistory = []; }
    if (!Array.isArray(clipHistory)) clipHistory = [];
    clipHistory = [...new Set(clipHistory.filter(text => typeof text === 'string' && text.trim()))];
    try {
      const saved = JSON.parse(localStorage.getItem(CLIP_FAVORITES_KEY) || '[]');
      if (Array.isArray(saved)) favorites = new Set(saved.filter(text => clipHistory.includes(text)));
      lastCapturedText = localStorage.getItem(CLIP_LAST_KEY);
    } catch {}
    const saveClipHistory = () => {
      localStorage.setItem(CLIP_KEY, JSON.stringify(clipHistory));
      localStorage.setItem(CLIP_FAVORITES_KEY, JSON.stringify([...favorites]));
    };
    const readClip = async () => (isDesktop() && window.electronAPI?.clipboardRead)
      ? window.electronAPI.clipboardRead()
      : navigator.clipboard.readText();
    const renderClipHistory = () => {
      sbrClipContent.textContent = '';
      clipboardTabs.forEach(tab => {
        const selected = tab.dataset.clipboardView === clipboardView;
        tab.setAttribute('aria-selected', String(selected));tab.tabIndex = selected ? 0 : -1;
        if (selected) sbrClipContent.setAttribute('aria-labelledby', tab.id);
      });
      if (clipboardView === 'favorites' && !clipHistory.some(text => favorites.has(text))) {
        sbrClipContent.innerHTML = '<div class="clipboard-empty"><h3>No favorites yet</h3><p>Star a clipboard entry to find it here.</p></div>';
        return;
      }
      if (!clipHistory.length) {
        sbrClipContent.innerHTML = '<div class="clipboard-empty"><span class="clipboard-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="8" height="4" rx="1.5"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5"/></svg></span><h3>Nothing copied yet</h3><p>Copy some text to see it here.</p><p class="clipboard-empty-hint">Select an item to paste it into the active terminal.</p></div>';
        return;
      }
      const ordered = clipboardView === 'favorites' ? clipHistory.filter(text => favorites.has(text)) : clipHistory;
      ordered.forEach(text => {
        const el = document.createElement('div');el.className = 'sbr-clip-item';
        el.classList.toggle('is-favorite', favorites.has(text));
        const editing = editingText === text;
        const preview = document.createElement(editing ? 'textarea' : 'div');
        preview.className = editing ? 'sbr-clip-editor' : 'sbr-clip-text';
        if (editing) {
          preview.value = editDraft;preview.setAttribute('aria-label', 'Edit clipboard entry');
          preview.addEventListener('input', () => { editDraft = preview.value; });
          preview.addEventListener('click', e => e.stopPropagation());
          preview.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault();editingText = null;renderClipHistory(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault();saveEdit(); }
          });
        } else {
          preview.textContent = text;preview.tabIndex = 0;preview.setAttribute('role', 'button');
          preview.setAttribute('aria-label', 'Paste clipboard entry');preview.title = 'Click to paste';
          preview.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault();e.stopPropagation();preview.click(); }
          });
        }
        const saveEdit = () => {
          if (!editDraft.trim()) return;
          const wasFavorite = favorites.delete(text);
          clipHistory = clipHistory.filter(item => item !== editDraft || item === text).map(item => item === text ? editDraft : item);
          if (wasFavorite) favorites.add(editDraft);
          editingText = null;saveClipHistory();renderClipHistory();
        };
        const actions = document.createElement('div');actions.className = 'sbr-clip-actions';
        actions.addEventListener('click', e => e.stopPropagation());
        const action = (name, title, icon, callback) => {
          const button = document.createElement('button');button.type = 'button';button.className = 'sbr-clip-action';
          button.dataset.action = name;button.title = title;button.setAttribute('aria-label', title);
          button.innerHTML = '<i class="ph ' + icon + '" aria-hidden="true"></i>';
          button.addEventListener('click', callback);actions.append(button);return button;
        };
        action('edit', editing ? 'Save changes (Ctrl+Enter; Escape to cancel)' : 'Edit entry', editing ? 'ph-check' : 'ph-pencil-simple', () => {
          if (editing) saveEdit();
          else { editingText = text;editDraft = text;renderClipHistory();sbrClipContent.querySelector('textarea')?.focus(); }
        });
        action('delete', 'Delete entry', 'ph-trash', () => {
          clipHistory = clipHistory.filter(item => item !== text);favorites.delete(text);
          if (editingText === text) editingText = null;
          saveClipHistory();renderClipHistory();
        });
        const favorite = action('favorite', favorites.has(text) ? 'Remove favorite' : 'Favorite entry', 'ph-star', () => {
          if (favorites.has(text)) favorites.delete(text);else favorites.add(text);
          saveClipHistory();renderClipHistory();
        });
        favorite.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="' + (favorites.has(text) ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/></svg>';
        favorite.setAttribute('aria-pressed', String(favorites.has(text)));
        el.append(preview, actions);
        el.addEventListener('click', () => {
          if (editing) return;
          if (isDesktop() && window.electronAPI?.clipboardWrite) window.electronAPI.clipboardWrite(text);
          else navigator.clipboard.writeText(text).catch(() => {});
          const t = activeTerminal();
          if (t?.term && t.type !== 'browser' && !t.locked && !t.dead) { t.term.paste(text);t.term.focus?.(); }
        });
        sbrClipContent.appendChild(el);
      });
    };
    const selectClipboardView = view => {
      clipboardView = view;renderClipHistory();sbrClipContent.scrollTop = 0;
    };
    clipboardTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectClipboardView(tab.dataset.clipboardView));
      tab.addEventListener('keydown', e => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();e.stopPropagation();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? clipboardTabs.length - 1
          : (index + (e.key === 'ArrowRight' ? 1 : -1) + clipboardTabs.length) % clipboardTabs.length;
        clipboardTabs[next].click();clipboardTabs[next].focus();
      });
    });
    const captureClip = async () => {
      try {
        const text = await readClip();
        if (!text || !text.trim() || lastCapturedText === text) return;
        lastCapturedText = text;localStorage.setItem(CLIP_LAST_KEY, text);
        if (clipHistory[0] === text) return;
        clipHistory = [text, ...clipHistory.filter(t => t !== text)];
        while (clipHistory.length > CLIP_MAX) {
          let index = clipHistory.length - 1;
          while (index > 0 && favorites.has(clipHistory[index])) index--;
          clipHistory.splice(index, 1);
        }
        saveClipHistory();
        if (sbrClip.style.display !== 'none' && editingText === null) renderClipHistory();
      } catch { }
    };
    captureClip();
    // Capture on focus / every 3s while visible instead of every second forever.
    window.addEventListener('focus', captureClip);
    setInterval(() => { if (!document.hidden) captureClip(); }, 3000);
    const showClipboardPage = async () => {
      clipboardView = 'clipboard';
      sbrMain.style.display = 'none';
      sbrClip.style.display = 'flex';
      await captureClip();
      renderClipHistory();
    };
    sbrOpen.addEventListener('click', showClipboardPage);
    sbrBack.addEventListener('click', () => {
      sbrClip.style.display = 'none';
      sbrMain.style.display = 'flex';
    });
  }

  // ── Auto-run workspaces: a saved workspace layout whose tabs each start a
  // command (or open a URL) when launched from the right panel.
  // Live agent orchestration. Launch arguments are passed directly to the PTY,
  // never typed into an interactive shell. Running entries survive rearrangement.
  // Capture every tab, including hidden splits and both xterm buffers. Keep
  // large snapshots in a file rather than forcing them through Claude's draft.
  async function buildWorkspaceContext(wsp) {
    const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
    const layout = node => !node ? null : node.type === 'group' ?
      { type: node.type, id: node.id, activeTermId: node.activeTermId, tabs: node.terminals.map(t => t.id) } :
      { type: node.type, id: node.id, direction: node.direction, sizes: node.sizes, children: node.children.map(layout) };
    const parts = [`# Workspace: ${clean(wsp.label)}`, `Captured: ${new Date().toISOString()}`, `Workspace ID: ${wsp.id}`,
      'Reference data from all splits and tabs, including the receiving chat. Terminal content includes all scrollback still retained by TerminalVibe; previously discarded output cannot be recovered. Browser content is the accessible loaded document, not nested frames, images or canvas.',
      `## Split layout\n${JSON.stringify(layout(wsp.layout), null, 2)}`];
    const sessionIds = new Set();
    for (const t of getWorkspaceTerminals(wsp)) {
      parts.push(`## ${t.type === 'browser' ? 'Browser' : 'Terminal'}: ${clean(t.label)}`,
        `Tab ID: ${t.id}\nWorking directory: ${clean(t.cwd) || 'unknown'}\nLocked: ${!!t.locked}\nExited: ${!!t.dead}`);
      if (t.claudeSessionId) { sessionIds.add(t.claudeSessionId); parts.push(`Claude session ID: ${t.claudeSessionId}`); }
      if (t.argv?.length) parts.push(`Launch arguments: ${JSON.stringify(t.argv)}`);
      if (t.type === 'browser') {
        parts.push(`Stored URL: ${clean(t.url)}`);
        try {
          const snapshot = await handleAgentRequest({method:'read', params:{paneId:t.id, full:true}});
          parts.push(snapshot.accessible ? `Loaded browser document:\n${clean(JSON.stringify(snapshot, null, 2))}` :
            `Browser content unavailable: ${clean(snapshot.reason)}`);
        } catch (error) { parts.push(`Browser content unavailable: ${clean(error.message)}`); }
        continue;
      }
      const buffers = t.term?.buffer;
      if (!buffers) { parts.push('Terminal buffer unavailable.'); continue; }
      const seen = new Set();
      for (const [name, buffer] of [['normal', buffers.normal], ['alternate', buffers.alternate], ['active', buffers.active]]) {
        if (!buffer || seen.has(buffer)) continue;
        seen.add(buffer);
        const lines = [];
        for (let i = 0; i < buffer.length; i++) {
          const line = buffer.getLine(i);
          const text = line?.translateToString(!buffer.getLine(i + 1)?.isWrapped) || '';
          // Rejoin soft-wrapped rows so long commands and paths remain intact.
          if (line?.isWrapped && lines.length) lines[lines.length - 1] += text;
          else lines.push(text);
        }
        parts.push(`### ${name} terminal buffer (${buffer.length} retained rows)\n${clean(lines.join('\n'))}`);
      }
    }
    return {title:clean(wsp.label), text:parts.join('\n\n'), sessionIds:[...sessionIds]};
  }

  async function attachContextToChat(entry, sessionId, workspaceContext = null) {
    const notice=document.createElement('div');notice.className='session-drop-feedback';notice.setAttribute('role','status');
    const host=entry?.el; if(!host) return;
    const say=(icon,text,cls='')=>{notice.className='session-drop-feedback '+cls;notice.innerHTML=`<i class="ph ${icon}" aria-hidden="true"></i>`;const t=document.createElement('span');t.textContent=text;notice.append(t);};
    say('ph-circle-notch',workspaceContext ? 'Adding workspace context…' : 'Adding saved session context…','is-pending');host.append(notice);
    try {
      if(entry.type==='browser' || entry.locked || entry.dead) throw new Error('Choose an unlocked, running Claude terminal');
      let result;
      if(workspaceContext) {
        // Check the dedicated capability before gathering potentially large data.
        // Older preloads must never pass a workspace to the session-ID channel.
        if(isDesktop() && !window.electronAPI?.attachWorkspaceContext) throw new Error('Save your work and fully restart TerminalVibe to enable workspace context attachments.');
        if(!isDesktop() && !workspaceContextReady) throw new Error('Restart the TerminalVibe backend and reload to enable workspace context attachments.');
        workspaceContext = await (typeof workspaceContext === 'function' ? workspaceContext() : workspaceContext);
        if(entry.type==='browser' || entry.locked || entry.dead) throw new Error('The target chat is no longer available');
      }
      if(workspaceContext && window.electronAPI?.attachWorkspaceContext) result=await window.electronAPI.attachWorkspaceContext(entry.id,workspaceContext);
      else if(!workspaceContext && window.electronAPI?.attachSessionContext) result=await window.electronAPI.attachSessionContext(entry.id,sessionId);
      else {
        if(isDesktop()) throw new Error('Save active work and restart Electron to enable session context drops.');
        if(!wsReady) throw new Error('Terminal backend is disconnected');
        if(!sessionContextReady) throw new Error('Save active work, restart the dev backend, and reload TerminalVibe to enable session context drops.');
        result=await new Promise((resolve,reject)=>{
          const requestId=uuid();const timer=setTimeout(()=>{sessionContextRequests.delete(requestId);reject(new Error('Context attachment timed out. Update the backend if it does not support session drops.'));},60000);
          sessionContextRequests.set(requestId,{resolve,reject,timer});
          ws.send(JSON.stringify({type:workspaceContext ? 'workspace-context' : 'session-context',id:entry.id,sessionId,workspaceContext,requestId}));
        });
      }
      say('ph-check-circle',workspaceContext ? 'Workspace context file added' : 'Session context added','is-success');
      document.dispatchEvent(new CustomEvent('session-context:attached',{detail:result}));
      entry.term?.focus();
    } catch(error) {
      say('ph-warning-circle',error.message,'is-error');
      document.dispatchEvent(new CustomEvent('session-context:attached',{detail:{error:error.message}}));
    }
    setTimeout(()=>notice.remove(),2000);
  }

  const claudeHistoryCache = new Map();
  const CLAUDE_HISTORY_TTL = 30000;
  function cachedClaudeHistory(cwd) { return claudeHistoryCache.get(cwd || '')?.data || null; }
  function loadClaudeHistory(cwd, force = false) {
    const key = cwd || '';
    let cache = claudeHistoryCache.get(key);
    if (!cache) {
      cache = {data:null,loadedAt:0,pending:null};claudeHistoryCache.set(key,cache);
      // Keep history in memory only, and bound it when many projects are used.
      if (claudeHistoryCache.size > 8) for (const [oldKey,entry] of claudeHistoryCache) {
        if (oldKey !== key && !entry.pending) { claudeHistoryCache.delete(oldKey);break; }
      }
    }
    if (cache.pending) return cache.pending;
    if (!force && cache.data && Date.now() - cache.loadedAt < CLAUDE_HISTORY_TTL) return Promise.resolve(cache.data);
    cache.pending = (async () => {
      let data;
      if (window.electronAPI?.claudeSessions) data = await window.electronAPI.claudeSessions(cwd);
      else {
        const response = await fetch('/api/claude-sessions?cwd=' + encodeURIComponent(cwd || ''));
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Session history API is unavailable on this app server. Update the frontend dev server, then reopen this drawer.');
        data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load local sessions');
        if (data.scope !== 'all-projects') throw new Error('Session history backend is outdated. Load the updated server to browse Claude history across projects.');
      }
      if (!Array.isArray(data?.sessions)) throw new Error('Invalid session history response');
      cache.data = data;cache.loadedAt = Date.now();return data;
    })().finally(() => {
      cache.pending = null;
      for (const [oldKey,entry] of claudeHistoryCache) {
        if (claudeHistoryCache.size <= 8) break;
        if (oldKey !== key && !entry.pending) claudeHistoryCache.delete(oldKey);
      }
    });
    return cache.pending;
  }

  async function openClaudeHistory(wsp, entry, trigger) {
    if (!entry || entry.type === 'browser') return;
    const cwd = entry.cwd;
    let history = cachedClaudeHistory(cwd);
    window.openSessionDrawer({ host:entry.el, trigger, initialData:history, cwd: 'Claude Code · All projects', project: cwd, currentId: entry.claudeSessionId,
      load: async (force = false) => (history = await loadClaudeHistory(cwd,force)),
      canReplace: async () => {
        if (entry.locked) return false;
        const process = await checkTerminalRunning(entry.id);
        return process === null || /^(claude|claude-code)(\.exe)?$/i.test(process || '');
      },
      start: async (session, mode) => {
        if (!history?.executable) throw new Error('Claude executable not found. Install Claude Code or add it to the backend PATH.');
        if (findTermById(entry.id)?.term !== entry) throw new Error('The original terminal was closed. Reopen session history from another tab.');
        const id = session?.id || uuid();
        const argv = [session ? '--resume' : '--session-id', id];
        const sessionCwd = session ? session.cwd : history.cwd;
        if (!sessionCwd) throw new Error('This conversation has no saved working directory and cannot be resumed here.');
        let target;
        if (mode === 'here') {
          const process = await checkTerminalRunning(entry.id);
          if (entry.locked || (process !== null && !/^(claude|claude-code)(\.exe)?$/i.test(process || ''))) throw new Error('This terminal is running another process. Stop it before resuming a conversation here.');
          const started = await createAgentTerminal({ id:entry.id, ...getSlotDimensions(entry), cwd:sessionCwd,
            executable:history.executable, argv, returnToShell:true, replaceIdle:true, replaceClaude:true });
          if (!started) {
            if (await checkTerminalRunning(entry.id) === null) {
              const restored = await createAgentTerminal({ id:entry.id, ...getSlotDimensions(entry), cwd:cwd || history.cwd });
              if (restored) { entry.dead=false; entry.term.options.disableStdin=false; }
            }
            throw new Error('Could not start Claude here. The terminal may have become busy or the executable failed; inspect the terminal and try a split.');
          }
          target = entry; target.dead = false; target.term.options.disableStdin = false;
          target.term.write('\r\n[Claude session started]\r\n');
        } else {
          const result = await handleAgentRequest({ method:'launch', params:{ workspaceId:wsp.id, anchorPaneId:entry.id,
            placement:{split:'row',compact:false}, layout:{ name:session?.title || 'Claude', cwd:sessionCwd, argv:[history.executable,...argv], returnToShell:true } } });
          target = findTermById(result.launches[0].id)?.term;
          if (!result.launches[0].started) throw new Error('Claude failed to start. Inspect the new terminal for details.');
        }
        target.cwd = sessionCwd; target.toolProvider = 'claude'; target.claudeSessionId = id;
        target._claudeRunning = true; target._atShellPrompt = false;
        target._historyRevision = (target._historyRevision || 0) + 1;
        claudeHistoryCache.forEach(cache => {cache.loadedAt = -Infinity;});
        saveState(); renderPaneArea();
      }
    });
  }
  async function openSavedSessionTab(sessionId, wsp, anchorPaneId) {
    // If TerminalVibe already owns this live session, select it instead of
    // starting another Claude process against the same conversation log.
    const existing = workspaces.flatMap(ws => getWorkspaceTerminals(ws).map(term => ({ws,term})))
      .find(({term}) => term.claudeSessionId === sessionId && !term.dead && term._claudeRunning === true);
    if (existing) { activateWorkspace(existing.ws.id); activateTerminal(existing.ws.id,existing.term.id); return; }
    const anchor = findTermById(anchorPaneId);
    if (!anchor || anchor.ws !== wsp) throw new Error('The destination tab group is no longer available');
    const group = findGroupContainingTerm(wsp.layout,anchorPaneId);
    let history = await loadClaudeHistory(anchor.term.cwd);
    let session = history.sessions.find(item => item.id === sessionId);
    if (!session) {
      history = await loadClaudeHistory(anchor.term.cwd,true);
      session = history.sessions.find(item => item.id === sessionId);
    }
    if (!session) throw new Error('This conversation is no longer in session history. Reopen history and try again.');
    if (!history.executable) throw new Error('Claude executable not found');
    if (!session.cwd) throw new Error('This conversation has no saved working directory');
    if (findTermById(anchorPaneId)?.ws !== wsp || findGroupContainingTerm(wsp.layout,anchorPaneId) !== group) throw new Error('The destination tab group changed. Drop again.');
    const result = await handleAgentRequest({method:'launch',params:{workspaceId:wsp.id,anchorPaneId,
      placement:{mode:'tab'},layout:{name:session.title || 'Claude',cwd:session.cwd,
        argv:[history.executable,'--resume',session.id],returnToShell:true}}});
    const launch = result.launches[0];
    if (!launch?.started) throw new Error('Could not resume Claude. Inspect the new tab for details.');
    const target = findTermById(launch.id)?.term;
    if (!target) return;
    target.toolProvider='claude';target.claudeSessionId=session.id;
    target._claudeRunning=true;target._atShellPrompt=false;
    activateTerminal(wsp.id,target.id);
    syncClaudeHistoryButton(target);
    saveState();
  }

  function setupSessionTabDrops() {
    const pending = new Set();
    const clear = () => document.querySelectorAll('.session-tab-drop-target').forEach(el => el.classList.remove('session-tab-drop-target'));
    const destination = e => {
      if (!e.dataTransfer?.types.includes('application/x-terminalvibe-session')) return null;
      const header = e.target.closest?.('.term-group-header');
      if (!header) return null;
      const groupId = header.closest('.term-group')?.dataset.groupId;
      for (const wsp of workspaces) {
        const group = findGroupById(wsp.layout,groupId);
        if (group?.terminals.length) return {header,wsp,anchorPaneId:group.activeTermId || group.terminals[0].id};
      }
      return null;
    };
    for (const type of ['dragenter','dragover']) document.addEventListener(type,e => {
      const target = destination(e); if (!target) return;
      e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';
      clear();target.header.classList.add('session-tab-drop-target');
    },true);
    document.addEventListener('dragleave',e => {
      const header=e.target.closest?.('.session-tab-drop-target');
      if (header && !header.contains(e.relatedTarget)) header.classList.remove('session-tab-drop-target');
    },true);
    document.addEventListener('dragend',clear,true);
    document.addEventListener('drop',e => {
      clear();
      const target = destination(e);if (!target) return;
      e.preventDefault();e.stopPropagation();
      const id=e.dataTransfer.getData('application/x-terminalvibe-session');
      if (!id || pending.has(id)) return;
      pending.add(id);
      const host=target.header.closest('.term-group');
      const notice=document.createElement('div');notice.className='session-drop-feedback is-pending';
      notice.setAttribute('role','status');notice.textContent='Opening conversation…';host.append(notice);
      openSavedSessionTab(id,target.wsp,target.anchorPaneId).then(()=>notice.remove(),error=>{
        const currentHost=document.getElementById(host.id) || host;
        if (!notice.isConnected && currentHost.isConnected) currentHost.append(notice);
        notice.className='session-drop-feedback is-error';notice.textContent=error.message;
        setTimeout(()=>notice.remove(),4000);
      }).finally(()=>pending.delete(id));
    },true);
  }

  function addTabSessionHistory(tab, wsp, entry) {
    if (entry.type === 'browser') return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-history-trigger';
    button.dataset.claudeHistory = entry.id;
    button.title = 'Claude session history';
    button.setAttribute('aria-label', 'Claude session history');
    button.innerHTML = '<i class="ph ph-clock-counter-clockwise"></i>';
    button.hidden = !hasClaudeHistory(entry);
    button.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    button.addEventListener('dblclick', e => e.stopPropagation());
    button.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
    button.addEventListener('click', e => {
      e.stopPropagation();
      openClaudeHistory(wsp, entry, button);
    });
    tab.prepend(button);
    syncClaudeHistoryButton(entry);
    scheduleClaudeHistoryRefresh(entry);
  }

  setInterval(() => {
    if (document.hidden) return;
    const wsp = activeWs(); if (!wsp) return;
    for (const button of document.querySelectorAll('[data-claude-history]')) {
      const entry = getWorkspaceTerminals(wsp).find(t => t.id === button.dataset.claudeHistory);
      if (!entry || entry.type === 'browser') { button.hidden=true; continue; }
      void refreshClaudeHistoryButton(entry);
    }
  }, 1000);

  setupSessionTabDrops();

  function createAgentTerminal(spec) {
    if (nativePtyReady) return window.electronAPI.terminalCreate(spec);
    if (!wsReady) return Promise.reject(new Error('Terminal backend is not connected'));
    return new Promise((resolve, reject) => {
      const requestId = uuid();
      const timer = setTimeout(() => { agentCreates.delete(requestId); reject(new Error('Terminal creation timed out; inspect list before retrying')); }, 10000);
      agentCreates.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ ...spec, type: 'create', requestId }));
    });
  }

  function agentNodeSize(size, previous = {}) {
    if (!size || typeof size !== 'object' || Array.isArray(size)) throw new Error('size must contain width and/or height');
    const result = { ...previous };
    for (const axis of Object.keys(size)) {
      const value = size[axis];
      if (!['width', 'height'].includes(axis) || (value !== 'min' && value !== 'auto' && (!Number.isFinite(value) || value <= 0))) throw new Error('Use positive pixel sizes, min, or auto');
      if (value === 'auto') delete result[axis];
      else result[axis] = value;
    }
    return Object.keys(result).length ? result : undefined;
  }

  function agentBrowserUrl(value) {
    let url;
    try { url = typeof value === 'string' && new URL(value); } catch {}
    if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('Browser url must be an absolute http(s) URL');
    return url.href;
  }

  async function handleAgentRequest({ method, params: p = {} }) {
    const describe = wsp => ({ id: wsp.id, name: wsp.label, layout: serializeLayout(wsp.layout),
      panes: getWorkspaceTerminals(wsp).map(t => {
        const group = findGroupContainingTerm(wsp.layout, t.id);
        const rect = document.getElementById('group-' + group?.id)?.getBoundingClientRect();
        return { id: t.id, name: t.label, cwd: t.cwd, dead: !!t.dead, type: t.type || 'terminal',
          ...(t.type === 'browser' ? { url: t.url } : {}),
          agentManaged: !!t.agentManaged, groupId: group?.id, size: group?.size,
          bounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null };
      }) });
    if (method === 'list') return {
      capabilities: { launchAsTab: true, launchIntoWorkspace: true, launchBesidePane: true, paneSizing: true, panePlacement: true, compactPanes: true, browserRead: true, browserLaunch: true, browserNavigate: true },
      minimumPaneSize: { width: SPLIT_MIN_PX, height: SPLIT_MIN_PX },
      activeWorkspaceId: activeWsId,
      activePaneId: findWs(activeWsId)?.activeTermId || null,
      workspaces: workspaces.map(describe)
    };
    if (method === 'launch') {
      const needsPty = node => node.split ? node.children.some(needsPty) : node.type !== 'browser' && node.url === undefined;
      if (needsPty(p.layout) && !nativePtyReady && !wsReady) throw new Error('Terminal backend is not ready');
      const existing = p.workspaceId !== undefined || p.anchorPaneId !== undefined;
      const anchor = p.anchorPaneId !== undefined ? findTermById(p.anchorPaneId) : null;
      if (p.anchorPaneId !== undefined && !anchor) throw new Error('Unknown anchorPaneId');
      const wsp = existing
        ? (p.workspaceId !== undefined ? findWs(p.workspaceId === 'current' ? activeWsId : p.workspaceId) : anchor.ws)
        : { id: uuid(), label: p.name, layout: null, activeTermId: null };
      if (!wsp) throw new Error('Unknown workspaceId; list workspaces before retrying');
      if (anchor && anchor.ws !== wsp) throw new Error('anchorPaneId does not belong to the target workspace');
      const placement = p.placement || {};
      const asTab = placement.mode === 'tab';
      if (asTab && (!existing || p.layout.split || ['split', 'sizes', 'before', 'compact'].some(key => placement[key] !== undefined))) throw new Error('Tab placement requires an existing workspace, one leaf and no split sizing options');
      const anchorGroup = anchor ? findGroupContainingTerm(wsp.layout, p.anchorPaneId)
        : asTab ? findGroupContainingTerm(wsp.layout, wsp.activeTermId) : null;
      if (asTab && !anchorGroup) throw new Error('No target tab group; specify anchorPaneId');
      // Resolve the destination before the first await so focus changes cannot
      // redirect a launch. Existing terminal entries and PTYs are reused.
      const specs = new Map();
      const terms = [];
      const build = node => {
        if (node.split) return { type: 'split', id: uuid(), direction: node.split, sizes: node.sizes || [50, 50], children: node.children.map(build) };
        const id = uuid();
        specs.set(id, node);
        const entry = node.type === 'browser' || node.url !== undefined
          ? { id, label: node.name, type: 'browser', url: agentBrowserUrl(node.url), iframe: null, el: null, opened: false }
          : _createTermEntry(wsp, id, node.name);
        entry.cwd = node.cwd;
        entry.pinLabel = true;
        entry.agentManaged = true;
        terms.push(entry);
        return { type: 'group', id: uuid(), activeTermId: id, terminals: [entry] };
      };
      const additions = build(p.layout);
      if (existing && !asTab && (placement.compact ?? !placement.sizes)) additions.size = { [placement.split === 'column' ? 'height' : 'width']: 'min' };
      const dock = node => ({ type: 'split', id: uuid(), direction: placement.split || 'row',
        sizes: placement.sizes || [50, 50], children: placement.before ? [additions, node] : [node, additions] });
      if (asTab) {
        anchorGroup.terminals.push(...terms);
      } else if (existing && wsp.layout) {
        const insert = node => node === anchorGroup ? dock(node) : node.type === 'split' ? { ...node, children: node.children.map(insert) } : node;
        wsp.layout = anchorGroup ? insert(wsp.layout) : dock(wsp.layout);
      } else wsp.layout = additions;
      if (!wsp.activeTermId) wsp.activeTermId = terms[0].id;
      delete wsp._maximizedGroupId;
      if (!existing) {
        workspaces.push(wsp);
        sideOrder.push({ type: 'ws', id: wsp.id });
      }
      renderSidebar();
      activateWorkspace(wsp.id);
      // activateWorkspace is a no-op when already current: rebuild its splits.
      if (existing) renderPaneArea();
      const launches = [];
      for (const t of terms) {
        if (t.type === 'browser') {
          launches.push({ id: t.id, name: t.label, type: 'browser', url: t.url, started: true });
          continue;
        }
        const spec = specs.get(t.id);
        // A background tab has no visible rectangle yet; use its selected sibling.
        const slot = getSlotDimensions(asTab ? findTermById(anchorGroup.activeTermId)?.term || t : t);
        const started = await createAgentTerminal({ id: t.id, ...slot, cwd: spec.cwd, executable: spec.argv[0], argv: spec.argv.slice(1), returnToShell: spec.returnToShell !== false });
        if (!started) {
          t.dead = true;
          t.term.write('\r\n[Could not launch agent. Check executable and cwd.]\r\n');
          t.term.options.disableStdin = true;
        }
        launches.push({ id: t.id, name: t.label, started });
      }
      renderPaneArea();
      saveState();
      return { workspace: describe(wsp), launches };
    }
    if (method === 'arrange') {
      const wsp = findWs(p.workspaceId);
      if (!wsp) throw new Error('Unknown workspaceId');
      const entries = new Map(getWorkspaceTerminals(wsp).map(t => [t.id, t]));
      const used = new Set();
      const build = (node, depth = 0) => {
        if (!node || depth > 8) throw new Error('Invalid layout');
        if (node.split) {
          if (!['row', 'column'].includes(node.split) || !Array.isArray(node.children) || node.children.length !== 2) throw new Error('Invalid split');
          const sizes = node.sizes || [50, 50];
          if (!Array.isArray(sizes) || sizes.length !== 2 || sizes.some(n => !Number.isFinite(n) || n <= 0) || Math.abs(sizes[0] + sizes[1] - 100) > 0.01) throw new Error('Invalid sizes');
          return { type: 'split', id: uuid(), direction: node.split, sizes,
            ...(node.size ? { size: agentNodeSize(node.size) } : {}), children: node.children.map(n => build(n, depth + 1)) };
        }
        if (!entries.has(node.paneId) || used.has(node.paneId)) throw new Error('Unknown or repeated paneId');
        used.add(node.paneId);
        return { type: 'group', id: uuid(), activeTermId: node.paneId, terminals: [entries.get(node.paneId)],
          ...(node.size ? { size: agentNodeSize(node.size) } : {}) };
      };
      const layout = build(p.layout);
      if (used.size !== entries.size) throw new Error('Include every workspace pane exactly once');
      wsp.layout = layout;
      delete wsp._maximizedGroupId;
      activateWorkspace(wsp.id);
      renderPaneArea();
      saveState();
      return describe(wsp);
    }
    const found = findTermById(p.paneId);
    if (!found) throw new Error('Unknown paneId');
    const t = found.term;
    const wsp = workspaces.find(w => getWorkspaceTerminals(w).some(entry => entry.id === t.id));
    if (method === 'resize' || method === 'place') {
      const group = findGroupContainingTerm(wsp.layout, t.id);
      const requested = Object.fromEntries(['width', 'height'].filter(axis => p[axis] !== undefined).map(axis => [axis, p[axis]]));
      if (method === 'resize') {
        if (!Object.keys(requested).length) throw new Error('resize needs width and/or height');
        group.size = agentNodeSize(requested, group.size);
      } else {
        if (!['left', 'right', 'top', 'bottom'].includes(p.side)) throw new Error('side must be left, right, top, or bottom');
        if (p.compact !== undefined && typeof p.compact !== 'boolean') throw new Error('compact must be boolean');
        const anchor = findTermById(p.anchorPaneId);
        if (!anchor || anchor.ws !== wsp || p.anchorPaneId === t.id) throw new Error('Use a different anchorPaneId in the same workspace');
        const size = agentNodeSize(requested, p.compact === false ? {} : { [['left', 'right'].includes(p.side) ? 'width' : 'height']: 'min' });
        // Build a new tree before committing. Entries/PTYs and sibling tabs survive.
        const detach = node => {
          if (node.type === 'group') {
            const terminals = node.terminals.filter(entry => entry.id !== t.id);
            return terminals.length ? { ...node, terminals,
              activeTermId: terminals.some(entry => entry.id === node.activeTermId) ? node.activeTermId : terminals[0].id } : null;
          }
          const survivors = node.children.map((child, i) => ({ node: detach(child), weight: node.sizes[i] })).filter(child => child.node);
          if (survivors.length === 1) return { ...survivors[0].node,
            ...(node.size ? { size: { ...node.size, ...survivors[0].node.size } } : {}) };
          const total = survivors.reduce((sum, child) => sum + child.weight, 0);
          return { ...node, children: survivors.map(child => child.node), sizes: survivors.map(child => child.weight * 100 / total) };
        };
        const remaining = detach(wsp.layout);
        const anchorGroup = findGroupContainingTerm(remaining, p.anchorPaneId);
        const moved = { type: 'group', id: uuid(), activeTermId: t.id, terminals: [t], ...(size ? { size } : {}) };
        const before = p.side === 'left' || p.side === 'top';
        const insert = node => node.id === anchorGroup.id
          ? { type: 'split', id: uuid(), direction: ['left', 'right'].includes(p.side) ? 'row' : 'column',
            sizes: [50, 50], children: before ? [moved, node] : [node, moved] }
          : node.type === 'split' ? { ...node, children: node.children.map(insert) } : node;
        wsp.layout = insert(remaining);
      }
      delete wsp._maximizedGroupId;
      activateWorkspace(wsp.id);
      renderPaneArea();
      saveState();
      return describe(wsp);
    }
    if (method === 'focus') {
      activateWorkspace(wsp.id);
      activateTerminal(wsp.id, t.id);
      return { paneId: t.id };
    }
    if (method === 'navigate') {
      if (t.type !== 'browser') throw new Error('Expected a browser pane');
      const url = agentBrowserUrl(p.url);
      if (t._loadUrl) await t._loadUrl(url);
      else t.url = url; // A lazy, unopened tab loads this URL on first display.
      saveState();
      return { paneId: t.id, type: 'browser', url, navigated: true,
        note: 'Navigation requested; page load success is not confirmed.' };
    }
    if (t.type === 'browser' && method === 'read') {
      const options = { maxChars: p.maxChars ?? 20000, offset: p.offset ?? 0, ...(p.full === true ? {full:true} : {}) };
      if (!Number.isInteger(options.maxChars) || options.maxChars < 1 || options.maxChars > 100000 ||
          !Number.isInteger(options.offset) || options.offset < 0) throw new Error('Use maxChars 1–100000 and a nonnegative integer offset');
      const metadata = { paneId: t.id, type: 'browser', storedUrl: t.url };
      try {
        const surface = t.browserContainer?.querySelector('.browser-surface');
        let snapshot;
        if (surface?.tagName?.toLowerCase() === 'webview') {
          snapshot = await surface.executeJavaScript(`(${snapshotBrowserPage.toString()})(document, ${JSON.stringify(options)})`);
        } else if (t._viewCreated && window.electronAPI?.browserRead) {
          snapshot = await window.electronAPI.browserRead(t.id, options);
        } else if (surface) {
          const doc = surface.contentDocument;
          if (!doc) throw new Error('Cross-origin iframe content is inaccessible');
          snapshot = snapshotBrowserPage(doc, options);
        } else throw new Error('Browser page has not been opened or loaded');
        return { ...metadata, accessible: true, ...snapshot };
      } catch (error) {
        return { ...metadata, accessible: false, reason: error.message,
          note: 'Only stored metadata is available; do not infer page content or search terms from it.' };
      }
    }
    if (t.type === 'browser') throw new Error('Expected a terminal pane');
    if (method === 'send') {
      if (t.locked || t.dead) throw new Error('Pane is locked or exited');
      if (typeof p.text !== 'string' || (p.enter !== undefined && typeof p.enter !== 'boolean')) throw new Error('text must be a string; enter must be boolean');
      _sendStdinRaw(t.id, new TextEncoder().encode(p.text + (p.enter ? '\r' : '')));
      return { paneId: t.id, sent: true };
    }
    if (method === 'read') {
      const lines = p.lines === undefined ? 100 : p.lines;
      if (!Number.isInteger(lines) || lines < 1 || lines > 2000) throw new Error('lines must be 1–2000');
      const buffer = t.term.buffer.active, output = [];
      for (let i = Math.max(0, buffer.length - lines); i < buffer.length; i++) output.push(buffer.getLine(i)?.translateToString(true) || '');
      return { paneId: t.id, dead: !!t.dead, text: output.join('\n') };
    }
    throw new Error('Unknown method');
  }

  const AR_KEY = 'terminalvibe.autorunWorkspaces';
  const loadAutoRuns = () => { try { const a = JSON.parse(localStorage.getItem(AR_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  const saveAutoRuns = list => { try { localStorage.setItem(AR_KEY, JSON.stringify(list)); } catch { } };

  function autoRunFromWorkspace(wsp) {
    const strip = node => node.type === 'split'
      ? { type: 'split', direction: node.direction, sizes: node.sizes, children: node.children.map(strip) }
      : { type: 'group', terminals: node.terminals.map(t => t.type === 'browser'
          ? { label: t.label, type: 'browser', url: t.url }
          : { label: t.label, cwd: t.cwd || '', cmd: '' }) };
    return { id: uuid(), name: wsp.label, layout: strip(serializeLayout(wsp.layout)) };
  }

  function launchAutoRun(tpl) {
    const withIds = node => {
      if (node.type === 'split') return { ...node, id: 'split-' + uuid(), children: node.children.map(withIds) };
      const terminals = node.terminals.map(t => ({ ...t, id: uuid(), pinLabel: true }));
      return { type: 'group', id: 'group-' + uuid(), activeTermId: terminals[0] && terminals[0].id, terminals };
    };
    const wsp = { id: uuid(), label: tpl.name, layout: null, activeTermId: null };
    wsp.layout = deserializeLayout(withIds(tpl.layout), wsp);
    const terms = getWorkspaceTerminals(wsp);
    if (!terms.length) return;
    wsp.activeTermId = terms[0].id;
    workspaces.push(wsp);
    sideOrder.push({ type: 'ws', id: wsp.id });
    renderSidebar();
    activateWorkspace(wsp.id);
    for (const t of terms) {
      if (!t.pending) continue;
      const slot = getSlotDimensions(t);
      sendControl({ type: 'create', id: t.id, cols: slot.cols, rows: slot.rows, cwd: t.cwd || null });
      t.pending = false;
    }
  }

  const arPage = document.getElementById('sbr-autorun');
  const arList = document.getElementById('sbr-autorun-list');
  if (arPage && arList && sbrMain) {
    let arOpenId = null; // template whose editor is expanded
    const arField = (placeholder, value, onChange, cls) => {
      const i = document.createElement('input');
      i.className = 'ar-input' + (cls ? ' ' + cls : '');
      i.placeholder = placeholder;
      i.value = value || '';
      i.spellcheck = false;
      i.autocomplete = 'off';
      i.addEventListener('change', () => onChange(i.value.trim()));
      return i;
    };
    const renderAutoRuns = () => {
      const list = loadAutoRuns();
      const save = () => saveAutoRuns(list);
      arList.textContent = '';
      if (!list.length) {
        const canSave = !!activeWs()?.layout;
        arList.innerHTML = '<div class="sbr-empty ar-empty"><h3>No saved workspaces</h3><p>Save your tabs and splits, then choose a startup command for each terminal.</p><button type="button" class="ar-empty-save">Save current workspace</button></div>';
        const saveButton = arList.querySelector('.ar-empty-save');
        saveButton.disabled = !canSave;
        saveButton.addEventListener('click', () => document.getElementById('sbr-autorun-add').click());
        if (!canSave) {
          const hint = document.createElement('p');
          hint.className = 'ar-empty-hint';
          hint.textContent = 'Open a workspace to save its layout.';
          arList.firstElementChild.appendChild(hint);
        }
        return;
      }
      for (const tpl of list) {
        const card = document.createElement('div');
        card.className = 'ar-card' + (tpl.id === arOpenId ? ' open' : '');
        const head = document.createElement('div');
        head.className = 'ar-head';
        head.innerHTML = '<i class="ph ph-caret-right ar-caret"></i><span class="ar-name"></span>'
          + '<button class="sbr-btn" data-act="run" title="Launch"><i class="ph ph-play"></i></button>'
          + '<button class="sbr-btn" data-act="del" title="Delete"><i class="ph ph-trash"></i></button>';
        const nameEl = head.querySelector('.ar-name');
        nameEl.textContent = nameEl.title = tpl.name;
        head.addEventListener('click', e => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'run') launchAutoRun(tpl);
          else if (act === 'del') showConfirm(`Delete auto-run workspace "${tpl.name}"?`, () => {
            list.splice(list.indexOf(tpl), 1); save(); renderAutoRuns();
          });
          else { arOpenId = arOpenId === tpl.id ? null : tpl.id; renderAutoRuns(); }
        });

        const editor = document.createElement('div');
        editor.className = 'ar-editor';
        editor.appendChild(arField('Workspace name', tpl.name, v => {
          tpl.name = v || tpl.name; save(); nameEl.textContent = nameEl.title = tpl.name;
        }));
        let pane = 0;
        const walk = node => {
          if (node.type === 'split') { node.children.forEach(walk); return; }
          pane++;
          for (const t of node.terminals) {
            const box = document.createElement('div');
            box.className = 'ar-tab';
            const title = document.createElement('div');
            title.className = 'ar-tab-title';
            title.innerHTML = `<i class="ph ${t.type === 'browser' ? 'ph-globe-hemisphere-west' : 'ph-terminal-window'}"></i>Split ${pane}`;
            box.appendChild(title);
            box.appendChild(arField('Tab name', t.label, v => { t.label = v || t.label; save(); }));
            if (t.type === 'browser') {
              box.appendChild(arField('URL', t.url === 'about:blank' ? '' : t.url, v => { t.url = v || 'about:blank'; save(); }));
            } else {
              box.appendChild(arField('Directory (default: home)', t.cwd, v => { t.cwd = v; save(); }));
              box.appendChild(arField('Command to run, e.g. npm run dev', t.cmd, v => { t.cmd = v; save(); }, 'ar-cmd'));
            }
            editor.appendChild(box);
          }
        };
        walk(tpl.layout);
        card.appendChild(head);
        card.appendChild(editor);
        arList.appendChild(card);
      }
    };
    document.getElementById('sbr-open-autorun').addEventListener('click', () => {
      sbrMain.style.display = 'none';
      arPage.style.display = 'flex';
      renderAutoRuns();
    });
    document.getElementById('sbr-autorun-back').addEventListener('click', () => {
      arPage.style.display = 'none';
      sbrMain.style.display = 'flex';
    });
    document.getElementById('sbr-autorun-add').addEventListener('click', () => {
      const wsp = activeWs();
      if (!wsp || !wsp.layout) return;
      const list = loadAutoRuns();
      const tpl = autoRunFromWorkspace(wsp);
      list.push(tpl);
      saveAutoRuns(list);
      arOpenId = tpl.id;
      renderAutoRuns();
    });
  }
  document.getElementById('settings-nav-search').addEventListener('input', e => {
    const query = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.settings-cat-btn').forEach(btn => { btn.hidden = !btn.textContent.toLowerCase().includes(query); });
  });
  document.querySelectorAll('.settings-cat-btn').forEach(btn => {
    btn.setAttribute('role', 'button'); btn.tabIndex = 0;
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });
  });
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const controls = [...settingsOverlay.querySelectorAll('button,input,select,textarea,[tabindex="0"],a[href]')]
      .filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === settingsOverlay)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === settingsOverlay)) { e.preventDefault(); first.focus(); }
  });
  settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsOverlay.classList.contains('open')) { closeSettings(); e.stopPropagation(); }
    if (e.ctrlKey && e.key === ',' && !e.metaKey && !e.altKey) { e.preventDefault(); openSettingsGlobal(); }
  });
  // Deep-link API: e.g. openSettings('appearance')
  window.openSettings = openSettingsGlobal;
  window.closeSettings = closeSettings;

  // Plugins: open the plugins directory in the OS file manager
  const pluginsOpenDir = document.getElementById('plugins-open-dir');
  if (pluginsOpenDir) {
    pluginsOpenDir.addEventListener('click', () => {
      const api = configApi();
      if (api && api.configOpenPluginsDir) api.configOpenPluginsDir();
    });
  }

  systemColorScheme.addEventListener('change', () => {
    if (currentColorScheme !== 'system') return;
    applyTheme(currentThemeName);
  });
  document.querySelectorAll('.scheme-choice').forEach(card => {
    card.addEventListener('click', () => {
      currentColorScheme = card.dataset.scheme;
      applyTheme(currentThemeName);
      saveState();
    });
  });

  document.getElementById('theme-gallery-import').addEventListener('click', () => {
    document.getElementById('theme-import-input').click();
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

  // Font family preset
  document.getElementById('set-fontpreset').addEventListener('change', e => {
    const v = e.target.value;
    const customRow = document.getElementById('fontfamily-custom-row');
    if (v === '__custom__') {
      customRow.classList.remove('hidden');
      customRow.classList.add('flex');
      return;
    }
    currentFontFamily = v;
    customRow.classList.add('hidden');
    customRow.classList.remove('flex');
    applySettings();
  });

  // Font family (custom CSS stack)
  document.getElementById('set-fontfamily').addEventListener('change', e => {
    currentFontFamily = e.target.value;
    applySettings();
  });

  // Font import
  document.getElementById('font-import-btn').addEventListener('click', () => {
    document.getElementById('font-import-input').click();
  });
  document.getElementById('font-import-input').addEventListener('change', e => {
    importFontFiles(e.target.files);
    e.target.value = '';
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

  // Scrollback
  document.getElementById('set-scrollback').addEventListener('input', e => {
    currentScrollback = parseInt(e.target.value);
    document.getElementById('set-scrollback-val').textContent = currentScrollback.toLocaleString();
    applySettings();
  });

  // Default working directory
  const defaultPathInput = document.getElementById('set-default-path');
  if (defaultPathInput) {
    defaultPathInput.addEventListener('input', e => {
      defaultTerminalPath = e.target.value.trim().replace(/^["']|["']$/g, '');
      saveState();
    });
  }
  const defaultPathBrowse = document.getElementById('set-default-path-browse');
  if (defaultPathBrowse) {
    defaultPathBrowse.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.selectDirectory) {
        const chosen = await window.electronAPI.selectDirectory(defaultTerminalPath || undefined);
        if (chosen) {
          defaultTerminalPath = chosen;
          if (defaultPathInput) defaultPathInput.value = chosen;
          saveState();
        }
      }
    });
  }

  document.getElementById('set-link-target').addEventListener('change', e => {
    terminalLinkTarget = e.target.value === 'external' ? 'external' : 'tab';
    saveState();
  });

  // Search engine
  document.getElementById('set-search-engine').addEventListener('change', e => {
    searchEngine = e.target.value;
    const row = document.getElementById('set-custom-search-row');
    row.classList.toggle('hidden', searchEngine !== 'custom');
    row.classList.toggle('flex', searchEngine === 'custom');
    saveState();
  });
  document.getElementById('set-custom-search-url').addEventListener('input', e => {
    customSearchUrl = e.target.value;
    saveState();
  });

  // ── CLI doc fuzzy search ──
  const cliPre = document.getElementById('cli-doc-pre');
  const cliLines = cliPre ? cliPre.textContent.split('\n') : [];
  document.getElementById('cli-doc-search')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { cliPre.textContent = cliLines.join('\n'); return; }
    cliPre.textContent = cliLines.map(line => {
      const l = line.toLowerCase();
      let qi = 0;
      for (let i = 0; i < l.length && qi < q.length; i++) {
        if (l[i] === q[qi]) qi++;
      }
      return qi === q.length ? line : '';
    }).join('\n');
  });

  // ── Background Image Settings ──
  function updateBgUploadPreview() {
    const hasImage = backgroundMode === 'global' && !!globalBackgroundImage;
    bgUploadArea.classList.toggle('has-image', hasImage);
    if (hasImage) {
      bgPreview.src = globalBackgroundImage;
    }
  }

  function refreshBgSettingsUI() {
    bgModeSelect.value = backgroundMode;
    const dd = document.querySelector('.custom-dropdown[data-for="set-bg-mode"]');
    if (dd) initCustomDropdown(dd);

    bgControlsRow.style.display = backgroundMode === 'none' ? 'none' : '';
    bgUploadArea.style.display = backgroundMode === 'global' ? '' : 'none';
    bgPerTabNote.style.display = (backgroundMode === 'per-tab' || backgroundMode === 'per-workspace') ? '' : 'none';
    bgOpacitySlider.value = Math.round(backgroundOpacity * 100);
    bgOpacityVal.textContent = Math.round(backgroundOpacity * 100) + '%';
    updateBgUploadPreview();
  }

  // Background mode change
  bgModeSelect.addEventListener('change', () => {
    backgroundMode = bgModeSelect.value;
    refreshBgSettingsUI();
    applyBackground();
    saveState();
  });

  // Opacity
  bgOpacitySlider.addEventListener('input', () => {
    backgroundOpacity = parseInt(bgOpacitySlider.value) / 100;
    bgOpacityVal.textContent = Math.round(backgroundOpacity * 100) + '%';
    applyBackground();
    saveState();
  });

  // File upload
  bgUploadArea.addEventListener('click', (e) => {
    if (e.target.closest('.bg-clear-btn')) return;
    if (backgroundMode === 'none') return;
    bgFileInput.click();
  });

  bgFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadBgImageFromFile(file, (dataUrl) => {
      if (backgroundMode === 'global') {
        setGlobalBackgroundImage(dataUrl);
      }
      refreshBgSettingsUI();
    });
    e.target.value = '';
  });

  bgClearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (backgroundMode === 'global') {
      setGlobalBackgroundImage('');
    }
    refreshBgSettingsUI();
  });

  // Import directly into the gallery; selection follows the same path as built-ins.
  document.getElementById('theme-import-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const button = document.getElementById('theme-gallery-import');
    const status = document.getElementById('theme-import-status');
    button.disabled = true;
    status.hidden = false;
    status.textContent = 'Importing theme…';
    status.classList.remove('is-error');
    try {
      const data = JSON.parse(await file.text());
      const color = value => typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
      if (!data || !color(data.bg) || !color(data.fg) || !Array.isArray(data.palette) || data.palette.length !== 16 || !data.palette.every(color)) {
        throw new Error('Use a theme JSON with bg, fg, and 16 palette colors in hex format (#RRGGBB).');
      }
      for (const key of ['cursor', 'selection']) {
        if (data[key] != null && !color(data[key])) throw new Error(`Invalid ${key} color. Use hex format (#RRGGBB).`);
      }
      const ui = {};
      for (const key of ['accent', 'border', 'multiSelect', 'tabActiveBg', 'tabHoverBg', 'dimText', 'mutedText', 'sidebarBg', 'surfaceBg', 'hoverBg', 'activeBg']) {
        if (data.ui?.[key] != null) {
          if (!color(data.ui[key])) throw new Error(`Invalid ${key} color. Use hex format (#RRGGBB).`);
          ui[key] = data.ui[key];
        }
      }
      const base = (typeof data.name === 'string' && data.name.trim()) || (typeof data.label === 'string' && data.label.trim()) || file.name.replace(/\.json$/i, '') || 'Imported theme';
      // Keep existing themes intact when names collide.
      let name = base;
      for (let suffix = 2; Object.hasOwn(THEMES, name) || ['__proto__', 'constructor', 'prototype'].includes(name); suffix++) name = `${base} (${suffix})`;
      const theme = { label: name, bg: data.bg, fg: data.fg, cursor: data.cursor || data.fg,
        selection: data.selection || data.bg, palette: [...data.palette], ui,
        swatches: [data.bg, data.fg, ui.accent || data.palette[4]], _custom: true };
      const customs = await getCustomThemes();
      customs[name] = theme;
      await saveCustomThemes(customs);
      applyTheme(name);
      saveState();
      refreshThemeDropdown();
      status.textContent = `“${name}” imported and selected.`;
    } catch (error) {
      status.classList.add('is-error');
      status.textContent = error instanceof SyntaxError ? 'This file is not valid JSON. Choose a theme JSON file.' : (error.message || 'Could not import this theme. Try another file.');
    } finally {
      button.disabled = false;
    }
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
    renderThemeCards();
  }

  // Prevent sidebar from stealing terminal focus
  document.getElementById('sidebar').addEventListener('mousedown', e => {
    if (e.target.closest('[draggable="true"]')) return;
    if (!e.target.closest('input, textarea, select, [contenteditable]')) e.preventDefault();
  });

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
        // Remember the resized width so collapse/expand restores it
        if (sb.classList.contains('expanded')) {
          const containerW = document.getElementById('app').offsetWidth;
          const sidebarPx = containerW * sizes[0] / 100;
          if (sidebarPx < SB_EXPANDED_MIN) {
            savedSidebarWidth = SB_EXPANDED_MIN;
            const pct = (SB_EXPANDED_MIN / containerW) * 100;
            sidebarSplit.setSizes([pct, 100 - pct]);
          } else {
            savedSidebarWidth = Math.min(sidebarPx, SB_MAX);
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

  // ── Right sidebar resize (custom sash, like terminal splits) ──
  (function initRightSidebarResize() {
    const sash = document.getElementById('sash-right');
    if (!sash) return;
    const panel = document.getElementById('sidebar-right');
    const MIN = 160, MAX = 260;
    sash.addEventListener('mousedown', e => {
      e.preventDefault();
      sash.classList.add('dragging');
      const startX = e.clientX;
      const startW = panel.offsetWidth;
      _suppressResize = true;
      startResizing();
      const onMove = ev => {
        panel.style.width = Math.max(MIN, Math.min(startW + (startX - ev.clientX), MAX)) + 'px';
      };
      const onUp = () => {
        sash.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        _suppressResize = false;
        const wsp = activeWs();
        if (wsp) for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
        saveState();
        stopResizing();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

  // ── Sidebar display modes: 'normal' | 'hover' | 'hidden' ──
  let hoverPinned = false;   // expanded via toggle button while in hover mode
  let sbTempVisible = false; // temporarily shown via toggle button while in hidden mode

  function sbExpand() {
    const sb = document.getElementById('sidebar');
    sb.classList.add('expanded');
    const px = savedSidebarWidth || Math.max(sb.offsetWidth || 0, SB_EXPANDED_MIN);
    savedSidebarWidth = Math.max(px, SB_EXPANDED_MIN);
    const pct = Math.max(5, (savedSidebarWidth / document.getElementById('app').offsetWidth) * 100);
    sidebarSplit.setSizes([pct, 100 - pct]);
  }
  function sbCollapse() {
    const sb = document.getElementById('sidebar');
    sb.classList.remove('expanded', 'hover-expanded');
    sidebarSplit.setSizes([0, 100]);
  }
  function sbFit() {
    document.getElementById('sidebar').inert = document.body.classList.contains('sb-hidden');
    const wsp = activeWs();
    if (wsp) for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
  }

  const sbEl = document.getElementById('sidebar');
  sbEl.addEventListener('transitionend', e => {
    if (e.target !== sbEl || e.propertyName !== 'flex-basis') return;
    sbFit();
    syncBrowserSlots();
  });

  window.__sidebarCtl = {
    apply(mode) {
      hoverPinned = false;
      sbTempVisible = false;
      sbEl.classList.remove('hover-overlay', 'hover-expanded');
      if (mode === 'hidden') sbCollapse();
      sbFit();
    },
  };

  sbEl.addEventListener('mouseenter', () => {
    if (sidebarMode !== 'hover' || hoverPinned) return;
    if (sbEl.classList.contains('expanded')) return;
    // Overlay expand: floats above the content (no layout shift, Brave-like)
    sbEl.style.setProperty('--sb-overlay-w', (savedSidebarWidth || 220) + 'px');
    sbEl.classList.add('expanded', 'hover-expanded', 'hover-overlay');
  });
  sbEl.addEventListener('mouseleave', () => {
    if (sidebarMode !== 'hover' || hoverPinned) return;
    if (!sbEl.classList.contains('hover-expanded')) return;
    sbEl.classList.remove('expanded', 'hover-expanded', 'hover-overlay');
  });

  applySidebarMode();

  document.getElementById('btn-sidebar-toggle').addEventListener('click', toggleSidebar);

  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    if (sidebarMode === 'hidden') {
      sbTempVisible = !sbTempVisible;
      document.body.classList.toggle('sb-hidden', !sbTempVisible);
      if (sbTempVisible) sbExpand(); else sbCollapse();
      sbFit();
      saveState();
      return;
    }
    const wasHover = sb.classList.contains('hover-expanded');
    if (wasHover) {
      // Pin the hover overlay into a real (layout) expanded state
      sb.classList.remove('hover-overlay', 'hover-expanded');
      hoverPinned = sidebarMode === 'hover';
      sbExpand();
    } else {
      const expanded = sb.classList.toggle('expanded');
      hoverPinned = sidebarMode === 'hover' && expanded;
      if (expanded) {
        sbExpand();
      } else {
        sbCollapse();
      }
    }
    sbFit();
    saveState();
  }

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
        case 'left': valid = dx < -10; primary = -dx; secondary = Math.abs(dy); break;
        case 'right': valid = dx > 10; primary = dx; secondary = Math.abs(dy); break;
        case 'up': valid = dy < -10; primary = -dy; secondary = Math.abs(dx); break;
        case 'down': valid = dy > 10; primary = dy; secondary = Math.abs(dx); break;
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
      if (wsId && !e.target.closest('.ws-proc')) removeWorkspace(wsId);
    }
  }
  document.addEventListener('mousedown', e => {
    if (e.button === 1) {
      _handleTabMiddleClick(e); _handleWsMiddleClick(e);
      // Middle-click anywhere outside a terminal would paste into the focused one
      if (!e.defaultPrevented && !e.target.closest('.term-slot')) {
        e.preventDefault(); e.stopPropagation();
        _suppressPasteUntil = Date.now() + 200;
      }
    }
  }, true);
  document.addEventListener('auxclick', e => {
    if (e.button === 1) { _handleTabMiddleClick(e); _handleWsMiddleClick(e); }
  }, true);

  // Horizontal scroll on tab bar with mouse wheel.
  // Only intercept when the bar actually overflows, otherwise let the
  // page scroll vertically (prevents swallowing wheel over a short bar).
  document.addEventListener('wheel', e => {
    const tabs = e.target.closest('.term-group-tabs');
    if (!tabs) return;
    if (tabs.scrollWidth <= tabs.clientWidth + 1) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      tabs.scrollLeft += e.deltaY;
      updateTabBarOverflow(tabs.closest('.term-group'));
    }
  }, { passive: false });

  /* ═══════════════════════════════════════════════════════════════
   R E*SIZE OBSERVER
   ═══════════════════════════════════════════════════════════════ */
  /* ── Resizing overlay controllers ── */
  // dragTab=true: a tab is being dragged. Native browser views paint above the
  // DOM and swallow drag events (no split highlight / drop), so detach them for
  // the duration of the drag and restore them afterwards.
  function startResizing(dragTab) {
    document.body.classList.add('resizing');
    if (dragTab && !document.body.classList.contains('tab-dragging')) {
      document.body.classList.add('tab-dragging');
      syncBrowserSlots();
    }
  }

  function stopResizing() {
    document.body.classList.remove('resizing');
    if (document.body.classList.contains('tab-dragging')) {
      document.body.classList.remove('tab-dragging');
    }
    syncBrowserSlots();
    settleBrowserSurfaces();
  }

  let resizeRaf = null;
  let _suppressResize = false;
  let _suppressPasteUntil = 0;
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
      document.querySelectorAll('.term-group').forEach(updateTabBarOverflow);
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
        syncBrowserSlots();
      }
    }, 150);
  });

  /* ═══════════════════════════════════════════════════════════════
   U T*IL
   ═══════════════════════════════════════════════════════════════ */
  // Coerces: workspace icons/labels loaded from disk can be non-strings
  // (e.g. { phosphor: 'name' } icon refs from older states). Rendering must
  // never throw on them — a throw inside renderSidebar aborts the whole
  // sidebar/pane render and leaves the app blank.
  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════════════════════════
   B O*OT
   ═══════════════════════════════════════════════════════════════ */
  (async () => {
    // Show titlebar immediately on desktop so window control overlay does not overlap tabs
    if (isDesktop() && !SETTINGS_ONLY && !DETACHED_ONLY) {
      const tb = document.getElementById('titlebar');
      if (tb) tb.classList.add('active');
    }

    let restored = false;
    try {
      if (!SETTINGS_ONLY && !DETACHED_ONLY) {
        await profileGate();
      }
      await loadCustomThemes();
      restored = await restoreState();
      applyTheme(currentThemeName);
      applySidebarMode();
      applyWsProcsSetting();
    } catch (bootErr) {
      console.error('[BOOT-ERROR]', bootErr);
    } finally {
      const splash = document.getElementById('splash');
      if (splash) splash.classList.add('hide');
    }
    if (!SETTINGS_ONLY) loadPlugins(); // deferred, non-blocking

    // Apply initial background & opacity
    applyBackground();

    // Settings live in a separate Electron window; re-apply on any change
    if (isDesktop() && window.electronAPI && window.electronAPI.onSettingsChanged) {
      window.electronAPI.onSettingsChanged(() => {
        restoreSettingsOnly().then(() => {
          applyTheme(currentThemeName);
          applyBackground();
          applySettings();
          applyWsProcsSetting();
          renderSidebar();
          syncBrowserSlots();
          syncPlugins();
        });
      });
    }

    // While the settings window is open, detach native browser views so they
    // can never paint above it; re-show them (alive, no reload) on close.
    if (isDesktop() && window.electronAPI && window.electronAPI.onSettingsWindowState) {
      window.electronAPI.onSettingsWindowState(({ open }) => {
        settingsWindowOpen = open;
        if (open) {
          for (const ws of workspaces) {
            for (const t of getWorkspaceTerminals(ws)) {
              if (t.type === 'browser' && t._viewCreated) window.electronAPI.browserHide(t.id);
            }
          }
        } else {
          syncBrowserSlots();
        }
      });
    }

    // OS close button ("X") → run the same quit-confirmation modal as the
    // Ctrl+Shift+Q shortcut. Main holds the window open until we confirm.
    if (isDesktop() && window.electronAPI && window.electronAPI.onAppCloseRequest) {
      window.electronAPI.onAppCloseRequest(() => confirmQuitApp());
    }

    if (restored) {
      renderSidebar();
      renderPaneArea();
    }

    // In the desktop shell use the native PTY backend; otherwise plain WebSocket
    if (isDesktop()) {
      setTimeout(() => { try { connectNativePTY(); } catch (e) { console.error('connectNativePTY failed:', e); } }, 100);
    } else {
      try { connectWS(); } catch (e) { console.error('connectWS failed:', e); }
    }

    // Desktop shell: show the native-overlay titlebar strip (drag region + label)
    if (isDesktop()) {
      const tb = document.getElementById('titlebar');
      if (tb) tb.classList.add('active');
    }

    // Listen for navigation and focus messages from browser tab iframes
    window.addEventListener('message', function (e) {
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
          if (navUrl !== active.url) active._syncUrl(navUrl);
        }
      }
    });

    // Auto-save every 30 seconds
    setInterval(saveState, 30000);

    // Keep the workspace buttons' running-process lists up to date
    setInterval(() => { if (!document.hidden) refreshAllWorkspaceProcs(); }, 1000);

    // Save on close (browser)
    window.addEventListener('beforeunload', (e) => {
      if (_profileSwitching) return;
      saveState();
      if (!isDesktop()) {
        const hasLiveTerms = workspaces.some(ws => getWorkspaceTerminals(ws).some(t => !t.dead));
        if (hasLiveTerms) { e.preventDefault(); e.returnValue = ''; }
      }
    });

    // Save on window close (Electron)
    if (isDesktop() && window.electronAPI) {
      window.addEventListener('beforeunload', () => { if (_profileSwitching) return; saveState(); });
    }

    // Robust Cross-Origin & Local Asset Iframe Focus Tracker. Also watches the
    // <webview> tag: its guest holds focus while clicking a browser tab, so
    // the slot must be highlighted even though the host DOM sees no mousedown.
    let _lastActiveIframe = null;
    setInterval(() => {
      if (document.hidden) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'IFRAME' || ae.tagName === 'WEBVIEW')) {
        if (ae !== _lastActiveIframe) {
          _lastActiveIframe = ae;
          const bc = ae.closest('.browser-slot');
          if (bc) bc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
      } else {
        _lastActiveIframe = null;
      }
    }, 100);

    // Keep blur for instant reaction and Electron native child webviews
    window.addEventListener('blur', () => {
      setTimeout(() => {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'IFRAME' || ae.tagName === 'WEBVIEW')) {
          const bc = ae.closest('.browser-slot');
          if (bc) bc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        } else {
          const active = activeTerminal();
          if (active && active.type === 'browser' && active.browserContainer) {
            active.browserContainer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          }
        }
      }, 50);
    });

    if (!DETACHED_ONLY && !SETTINGS_ONLY && window.electronAPI?.onAgentRequest) {
      window.electronAPI.onAgentRequest(handleAgentRequest);
    } else if (!isDesktop() && !DETACHED_ONLY && !SETTINGS_ONLY) {
      agentBrowserReady = true;
      if (wsReady) ws.send(JSON.stringify({ type: 'agent:ready' }));
    }
  })(); // async boot
})();
