(function () {
  'use strict';

  // Liveness flag for the index.html boot watchdog: if app.js fails to even
  // parse/execute (e.g. a missing vendor <script> in a packaged build), this
  // never gets set and the watchdog releases the splash screen with an error
  // instead of leaving the app stuck forever.
  window.__tvAppJsRan = true;

  setupAppTooltips();

  // Declared up front: sidebar toggles run during boot, before the resize section.
  let _suppressResize = false, _sbAnimTimer = null;
  // Sidebar width animations: refit terminals once when they settle, not every
  // frame (each refit resizes the PTY and the TUI redraws, which flickers).
  function holdTermFits() {
    _suppressResize = true;
    clearTimeout(_sbAnimTimer);
    _sbAnimTimer = setTimeout(releaseTermFits, 400); // no transition (reduced motion / no change)
  }
  function releaseTermFits() {
    if (!_sbAnimTimer) return;
    clearTimeout(_sbAnimTimer); _sbAnimTimer = null;
    _suppressResize = false;
    const wsp = activeWs();
    if (wsp) for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
    syncBrowserSlots();
  }

  // Permanently remove native tooltip sources before any settings boot.
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
      // data-tip-rows: a heading (data-tip) over rows [{ icon: 'ph-…' | proc: '<process name>', text }].
      const rows = target.dataset.tipRows ? JSON.parse(target.dataset.tipRows) : null;
      tip.classList.toggle('ws-process-tooltip', !!(processes || rows));
      tip.classList.toggle('ui-tooltip-wrap', target.hasAttribute('data-tip-wrap'));
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
      if (rows) {
        const heading = document.createElement('div');
        heading.className = 'ws-process-tooltip-heading'; heading.textContent = target.dataset.tip;
        tip.replaceChildren(heading);
        for (const r of rows) {
          const row = document.createElement('div'); row.className = 'ws-process-tooltip-row';
          row.innerHTML = r.proc ? procIconHtml(r.proc, 'ph-robot') : `<i class="ph ${/^ph-[\w-]+$/.test(r.icon || '') ? r.icon : 'ph-dot'}" aria-hidden="true"></i>`;
          const text = document.createElement('span'); text.textContent = r.text; row.append(text);
          tip.append(row);
        }
      }
      const workspaceButton = target.closest('.ws-btn');
      const sideTarget = workspaceButton;
      // Threads sidebar cards sit at the right edge: their tooltip opens to the left, top-aligned.
      const leftTarget = target.matches('#threads-sidebar .ts-card') && target;
      if (leftTarget) {
        const lr = leftTarget.getBoundingClientRect(), lw = tip.offsetWidth, lh = tip.offsetHeight;
        const lx = lr.left - lw - 8 >= 4 ? lr.left - lw - 8 : lr.right + 8;
        tip.style.transform = `translate(${Math.round(lx)}px, ${Math.round(Math.max(4, Math.min(lr.top, innerHeight - lh - 4)))}px)`;
        tip.classList.add('show');
        target.setAttribute('aria-describedby', tip.id);
        return;
      }
      const r = (sideTarget || target).getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      // Above the target by default; below only when there is no room above (side tooltips stay beside).
      let top = sideTarget ? r.top : r.top - h - 6;
      if (sideTarget && top + h > innerHeight - 4) top = innerHeight - h - 4;
      else if (!sideTarget) {
        // Never over the titlebar (window controls) for something below it: then it goes below the target.
        const floor = target.closest('#titlebar') ? 4 : (document.getElementById('titlebar')?.getBoundingClientRect().bottom || 0) + 4;
        if (top < floor) top = r.bottom + 6;
      }
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
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'data-tip', 'data-tip-processes', 'data-tip-rows'] });
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
      // Icon-only buttons with just an aria-label get that label as their tooltip.
      const labelled = el.closest?.('button[aria-label]');
      if (labelled && !labelled.textContent.trim() && (!labelled.dataset.tip || labelled.dataset.tipAria)) {
        labelled.dataset.tip = labelled.getAttribute('aria-label'); labelled.dataset.tipAria = '1';
      }
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
    refreshShortcutHints();
    window.electronAPI?.browserSetShortcuts?.([
      ...Object.values(customShortcuts),
      { ctrl: true, key: 'Tab' }, { ctrl: true, shift: true, key: 'Tab' }, { ctrl: true, key: ',' },
    ]);
  }

  // "New terminal (Ctrl+Shift+T)" — tooltip text carrying the live binding.
  function withKey(text, action) {
    const s = customShortcuts[action];
    return s && s.key ? `${text} (${formatKeyCombo(s)})` : text;
  }

  // Keep tooltips in step with rebinds.
  function refreshShortcutHints() {
    const tips = { 'btn-sidebar-toggle': ['Toggle sidebar', 'toggleSidebar'], 'btn-profiles': ['Profiles', 'profiles'] };
    for (const [id, [text, action]] of Object.entries(tips)) {
      const el = document.getElementById(id), tip = withKey(text, action);
      if (el && el.dataset.tip !== tip) el.title = tip;
    }
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

  // Terminal links open with Ctrl/Cmd+click, like the image previews; a plain click stays a
  // terminal click (selection). They follow Settings → General: a browser tab beside the
  // terminal they were clicked in, or the system browser. Ctrl+Shift+click picks the other
  // one. Non-web URLs and unavailable panes always go external.
  function openTerminalLink(termId, uri, event) {
    if (!event?.ctrlKey && !event?.metaKey) return;
    let url = null;
    try { url = new URL(uri); } catch { }
    const found = findTermById(termId);
    const inTab = (terminalLinkTarget !== 'external') !== !!event?.shiftKey;
    if (!url || !['http:', 'https:'].includes(url.protocol) || !inTab || !found?.ws) { openExternalUrl(uri); return; }
    addBrowserTab(found.ws.id, findGroupContainingTerm(found.ws.layout, termId)?.id, url.href);
  }

  function hoverWebLink(term, termId, uri) { claudeRefHovered = { el: term.element, term, open: e => openTerminalLink(termId, uri, e) }; }

  // A web link in the chat follows the same setting as terminal links (default: a TerminalVibe browser tab in the
  // chat's workspace); Shift+click, or other=true, picks the other place.
  function openChatWebLink(href, other = false) {
    const inTab = (terminalLinkTarget !== 'external') !== !!other, ws = wsOf(curChat()) || activeWs();
    if (inTab && ws) addBrowserTab(ws.id, null, href); else openExternalUrl(href);
  }

  function openExternalUrl(url) {
    if (isDesktop() && window.electronAPI) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  // Quote a path for pasting into a shell (POSIX '…'\''…', PowerShell '…''…').
  function shellQuote(p, force = false) {
    if (!force && /^[\w@%+=:,./~-]+$/.test(p)) return p;
    return (window.electronAPI?.platform || terminalBackendPlatform) === 'win32'
      ? `'${p.replace(/'/g, "''")}'`
      : `'${p.replace(/'/g, "'\\''")}'`;
  }

  // Dropped files (e.g. an image from the file manager or a web page) →
  // paste their quoted paths into the terminal, like other terminals do.
  // Files without a disk path (dragged out of a browser) are saved to temp.
  const isImagePath = path => /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);
  const isCodexProcess = name => /^codex(?:[-.\s]|$)/i.test(name || '');
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

  // Images this pane handed a CLI (pasted or dropped), oldest first: they back the previews of
  // unsent "[Image #N]" chips and tell this pane's sent Codex images from other sessions'.
  function trackPaneImage(entry, path) {
    (entry._claudeImageFiles ||= []).push(path);
    if (entry._claudeImageFiles.length > 20) entry._claudeImageFiles.shift();
  }

  // A dropped, picked or pasted File as a path the terminal's machine can read: its own path
  // (desktop), else a temp copy (pasted data), or an upload to the backend (browser mode).
  async function localPathForFile(entry, file) {
    const api = window.electronAPI;
    if (api?.getPathForFile) return api.getPathForFile(file) || await api.saveTempFile(file.name, new Uint8Array(await file.arrayBuffer()));
    return saveBrowserDroppedFile(entry, file);
  }

  async function dropFilesIntoTerminal(entry, files) {
    if (!entry?.term || entry.type === 'browser' || entry.locked || entry.dead || !files.length) return;
    const target=entry.term;
    const available=()=>!entry.locked && !entry.dead && entry.term===target && findTermById(entry.id)?.term===entry;
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    const icon = document.createElement('i');
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    notice.append(icon, label);
    const show = (state, glyph, text) => {
      notice.className = 'app-toast session-drop-feedback is-' + state;
      icon.className = 'ph ' + glyph;
      label.textContent = text;
    };
    show('pending', 'ph-circle-notch', 'Adding files…');
    entry.el?.append(notice);
    try {
      const paths=[];
      for (const file of files) {
        if (!available()) throw new Error('The target terminal changed while adding files');
        const path=await localPathForFile(entry,file);
        if (!path) throw new Error('Could not transfer '+file.name);
        paths.push(path);
      }
      const codexImages = paths.some(isImagePath) && isCodexProcess(await checkTerminalRunning(entry.id, true));
      if (!available()) throw new Error('The target terminal changed while adding files');
      // Codex recognizes a quoted image path when it is the entire paste.
      const plainPaths = [];
      for (const path of paths) {
        if (codexImages && isImagePath(path)) target.paste(shellQuote(path, true));
        else plainPaths.push(shellQuote(path));
      }
      if (plainPaths.length) target.paste(plainPaths.join(' ') + ' ');
      target.focus();
      show('success', 'ph-check-circle', files.length === 1 ? 'File added to draft' : files.length + ' files added to draft');
    } catch(error) {
      show('error', 'ph-warning-circle', error.message);
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
        // payloads reach terminal split, browser or native paste paths.
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
      // Same image the CLI gets (Claude via its clipboard, Codex via this path);
      // lets an unsent "[Image #N]" chip be previewed.
      if (/^claude(?:[-.\s]|$)/i.test(process || '')) {
        trackPaneImage(entry, path); // other CLIs get the path as a paste, tracked by setupClaudeImageLinks
        // Send the key, not a bracketed-paste string. Claude reads the local
        // clipboard itself; do not also insert a filename or submit the draft.
        const shortcut = window.electronAPI?.platform === 'win32' ? '\x1bv' : '\x16';
        sendStdin(entry.id, new TextEncoder().encode(shortcut));
      } else {
        pasteText(shellQuote(path, isCodexProcess(process)));
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
    const field = el instanceof Element && el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
    return !!field && !field.classList.contains('xterm-helper-textarea');
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
        // The right panel was removed: plugins that still call this keep working, without a page.
        addPanel: () => console.warn(`[plugin] ${manifest.id}: ui.addPanel is no longer supported (the right panel was removed)`),
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

  function _removeWidgetDom(w) {
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
  let defaultShell = '';             // id from electron/shells.js; '' = system default
  let shellList = [];                // detected shells, for the tab bar's "new tab with shell" menu
  window.electronAPI?.listShells?.().then(l => { shellList = Array.isArray(l) ? l : []; }, () => {});
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
  let closedThreads = [];    // saved chats whose terminal tabs have been closed (profile-scoped)
  let folders = [];          // [{id, label, color?, collapsed?}]  — workspace folders/groups
  let sideOrder = [];        // top-level sidebar flow: [{type:'ws'|'folder', id}] in visual order
  let pinnedCollapsed = false; // "Pinned" section collapsed state
  let sidebarMode = 'normal'; // 'normal' | 'hover' | 'hidden'
  let showWsProcs = true;     // show running processes in workspace buttons
  let hideEmails = true;      // blur email addresses in terminal output (blurTermEmails)
  let notifyOnCommandFinish = true; // notify when a command / agent response finishes
  let notificationSound = true;     // play the chime for finish notifications and agent questions
  let terminalLinkTarget = 'tab';     // 'tab' (browser tab beside the terminal) | 'external'
  // New threads: harness ('' = last used), folder ('scratch' = No project | 'workspace'), titles ('agent' | 'claude' | 'codex' | 'off').
  let threadSettings = { harness: '', folder: 'scratch', titles: 'agent', usageWindow: 'weekly', usageDisplay: 'consumed', markdown: 'on', usernames: 'show' };
  const _workUsernameRecords = new Map(), _workUsernameMarkup = new WeakMap();
  const loadThreadSettings = s => {
    if (s && typeof s === 'object') threadSettings = { ...threadSettings, ...s };
    if (threadSettings.usageWindow === 'mostUsed') threadSettings.usageWindow = 'weekly';
    document.body.classList.toggle('blur-work-usernames', threadSettings.usernames === 'blur');
    applyWorkUsernamePrivacy(document);
    applyComposerParts();
  };
  // Composer controls the user hid from its right-click menu (attach, mode, ctx).
  const COMPOSER_PARTS = [['attach', 'File upload', 'ph-paperclip'], ['mode', 'Access mode', 'ph-shield'], ['ctx', 'Context usage', 'ph-circle-half']];
  function applyComposerParts() {
    const hidden = threadSettings.composerHidden || [];
    for (const [k] of COMPOSER_PARTS) document.body.classList.toggle('thr-hide-' + k, hidden.includes(k));
  }
  let activeWsId = null;
  let settingsWindowOpen = false; // separate Electron settings window is up
  let _wsDomCache = {};      // wsId -> DOM element wrapping that workspace's layout
  let focusedSlotId = null;  // DOM id of focused .term-slot
  let _multiSelected = new Set(); // terminal IDs selected via Ctrl+Alt+RightClick
  // Tab double-click detection state. Declared here (IIFE scope) because the
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
      syncThreadSelection();
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
  let browserDevToolsHeight = 0; // Last dragged DevTools drawer height, shared by tabs; 0 = 40% of the tab
  if (isDesktop() && window.electronAPI) {
    window.electronAPI.onBrowserEvent(d => browserEventHooks.get(d && d.id)?.(d));
    window.electronAPI.onBrowserKey?.(d => document.dispatchEvent(new KeyboardEvent('keydown', { ...d, bubbles: true, cancelable: true })));
    // The key came from a tab's page, or from its DevTools (main sends the page's id for both).
    window.electronAPI.onBrowserDevToolsToggle?.(id => {
      const ownsGuest = view => { try { return view.getWebContentsId() === id; } catch { return false; } };
      workspaces.flatMap(getWorkspaceTerminals).find(t => t.type === 'browser' &&
        [...(t.browserContainer?.querySelectorAll('webview.browser-surface') || [])].some(ownsGuest))?._toggleDevTools?.();
    });
    syncBrowserShortcuts();
  }
  // ResizeObserver fires after layout, before paint: syncing here moves the
  // overlay in the same frame as its slot (a RAF would lag one frame behind).
  // No settle mid-drag: its 1px nudge re-lays out every guest page whenever the
  // pointer pauses, which made dragging stutter. stopResizing() settles once.
  const browserSlotRo = new ResizeObserver(() => {
    syncBrowserSlots();
    if (!document.body.classList.contains('resizing')) settleBrowserSurfaces();
  });

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
        syncDevToolsViews(false);
      }
      return;
    }

    // PHASE 1: Batch READ (Prevents Layout Thrashing)
    let paneRect;
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
            paneRect ??= paneArea.getBoundingClientRect();
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
      syncDevToolsViews(true);
    }
  }

  // Open DevTools drawers are native views (they paint above the DOM) laid over
  // their .browser-devtools placeholder; hide them with their tab or under overlays.
  function syncDevToolsViews(show) {
    for (const ws of workspaces) {
      for (const t of getWorkspaceTerminals(ws)) {
        const dt = t._devtools;
        if (!dt) continue;
        const r = show && ws.id === activeWsId && t.browserContainer?.style.visibility !== 'hidden' ? dt.el.getBoundingClientRect() : null;
        window.electronAPI.browserDevToolsBounds?.(dt.pageId, r && r.width && r.height ? { x: r.left, y: r.top, width: r.width, height: r.height } : null);
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
          result.term._lastOut = Date.now(); // same as writePtyData (Electron)
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
    return _extractOSC7CwdStr(new TextDecoder().decode(uint8Data));
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
        // Windows paths arrive as /C:\dir or /\\server\share: drop the URI's leading slash.
        return decodeURIComponent(pathPart).replace(/^\/(?=[A-Za-z]:|\\\\)/, '');
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
      if (obj.type === 'create') api.terminalCreate({ id: obj.id, cols: obj.cols, rows: obj.rows, cwd: obj.cwd || null, inheritFromId: obj.inheritFromId, shell: entry?.shell || null }).then(typeCmd);
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
  // Write PTY output, then tell main once xterm has parsed it. Main pauses a
  // PTY that floods faster than we parse (electron/pty-flow.js), so output
  // we cannot show must be acked too or its PTY would stall. A hidden window
  // parses on throttled timers, which would slow a background build down to
  // that pace, so there we ack at once (no flow control, as before).
  // A TUI redraw (clear, then the whole screen) reaches us split across PTY reads, and xterm
  // paints between the pieces: a blank or half-drawn frame on every redraw, which is the
  // flicker when zooming or resizing a pane. Output inside a synchronized update (DEC mode
  // 2026: Codex, and Claude in terminals it knows) or right after a PTY resize is held and
  // written as one chunk, which xterm parses and paints at once.
  const SYNC_MAX_MS = 150, REDRAW_QUIET_MS = 24;
  function writePtyData(result, id, data, flush) {
    const entry = result?.term;
    if (entry) entry._lastOut = Date.now(); // lets a thread wait for an agent to settle
    const xterm = entry?.type !== 'browser' && entry?.term;
    if (xterm) {
      data = (entry._held || '') + data;
      entry._held = '';
      clearTimeout(entry._heldTimer);
      const now = Date.now();
      const inSync = data.lastIndexOf('\x1b[?2026h') > data.lastIndexOf('\x1b[?2026l');
      entry._syncSince = inSync ? (entry._syncSince ?? now) : null;
      const until = (inSync ? entry._syncSince : (entry._resizedAt ?? -Infinity)) + SYNC_MAX_MS;
      if (!flush && now < until) {
        entry._held = data;
        const wait = inSync ? until - now : Math.min(REDRAW_QUIET_MS, until - now);
        entry._heldTimer = setTimeout(() => writePtyData(result, id, '', true), wait);
        return;
      }
      if (!data) return;
    }
    const ack = () => window.electronAPI.terminalAck?.(id, data.length);
    if (xterm && !document.hidden) xterm.write(data, ack);
    else { xterm?.write(data); ack(); }
  }

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
        }
        writePtyData(result, id, data);
      });
      api.onTerminalExit(({ id, code }) => handleExit(id, code));
      if (api.onTerminalFinished) api.onTerminalFinished(onTerminalFinished);
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
      // Never start on an empty workspace: give it its terminal now that the backend is up.
      if (!workspaces.length) { try { createWorkspace('Main'); } catch (e) { console.error('createWorkspace failed:', e); } }
      else if (!getWorkspaceTerminals(activeWs() || {}).length) renderPaneArea();
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
      const child = terms.find(x => x._bottomTerminal?.id === id)?._bottomTerminal;
      if (child) return { ws, term: child };
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
    // The terminal theme's bright colors, for syntax highlighting in the chat.
    ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'].forEach((c, i) => r.setProperty('--ansi-' + c, theme.palette[9 + i] || theme.palette[1 + i] || theme.fg));

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
  function serializeChat(chat) {
    const files = list => (list || []).map(({ preview, ...file }) => file);
    return { ...chat,
      ...(chat.draftFiles ? { draftFiles: files(chat.draftFiles) } : {}),
      ...(Array.isArray(chat.queuedMessages) ? { queuedMessages: chat.queuedMessages.map(message => ({ ...message, files: files(message.files) })) } : {}) };
  }
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
          if (t.keepOnExit) o.keepOnExit = true;
          if (t.locked) o.locked = true;
          if (t.pinLabel) o.pinLabel = true;
          if (t.threadHistory) o.threadHistory = true;
          if (t.chat) o.chat = serializeChat(t.chat);
          if (t.toolProvider) o.toolProvider = t.toolProvider;
          if (t.shell) o.shell = t.shell;
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
        if (typeof tData.shell === 'string') entry.shell = tData.shell;
        if (tData.cmd) entry.runCmd = tData.cmd; // auto-run launch only; never serialized
        if (tData.bgImage) entry.bgImage = tData.bgImage;
        if (tData.dead) entry.dead = true;
        if (tData.agentManaged) entry.agentManaged = true;
        if (tData.keepOnExit) entry.keepOnExit = true;
        if (tData.locked) entry.locked = true;
        if (tData.pinLabel) entry.pinLabel = true;
        if (tData.threadHistory) entry.threadHistory = true;
        if (tData.chat && typeof tData.chat === 'object') entry.chat = tData.chat;
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
      const write = (api && api.configWriteState)
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
        hideEmails,
        notifyOnCommandFinish,
        notificationSound,
        terminalLinkTarget,
        threadSettings,
        backgroundMode,
        globalBackgroundImage,
        backgroundOpacity,
        shortcuts: customShortcuts,
        searchEngine,
        customSearchUrl,
        defaultTerminalPath,
        defaultShell,
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
    const key = STATE_KEY;
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
      hideEmails,
      notifyOnCommandFinish,
      notificationSound,
      terminalLinkTarget,
      threadSettings,
      backgroundMode,
      globalBackgroundImage,
      backgroundOpacity,
      searchEngine,
      customSearchUrl,
      defaultTerminalPath,
      defaultShell,
      sidebarExpanded: document.getElementById('sidebar').classList.contains('expanded'),
      sidebarWidth: document.getElementById('sidebar').offsetWidth || null,
      shortcuts: customShortcuts,
      pluginStates: Object.fromEntries(_pluginStates),
      pluginConfigs: Object.fromEntries(_pluginConfigs),
      activeWsId,
      closedThreads: closedThreads.map(({ _files, _flowHtml, _open, ...saved }) => ({ ...saved, chat: serializeChat(saved.chat) })),
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
        if (ws.chat) o.chat = serializeChat(ws.chat);
        if (ws.cwd) o.cwd = ws.cwd;
        return o;
      }),
    };
    return persistStateToStorage(state, key);
  }

  async function restoreState() {
    try {
      const key = STATE_KEY;
      let raw = null;
      {
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
      if (state.hideEmails !== undefined) hideEmails = !!state.hideEmails;
      document.body.classList.toggle('show-emails', !hideEmails);
      if (state.notifyOnCommandFinish !== undefined) notifyOnCommandFinish = !!state.notifyOnCommandFinish;
      if (state.notificationSound !== undefined) notificationSound = !!state.notificationSound;
      if (['tab', 'external'].includes(state.terminalLinkTarget)) terminalLinkTarget = state.terminalLinkTarget;
      loadThreadSettings(state.threadSettings);
      if (state.backgroundMode) backgroundMode = state.backgroundMode;
      if (state.globalBackgroundImage) globalBackgroundImage = state.globalBackgroundImage;
      if (state.backgroundOpacity !== undefined) backgroundOpacity = state.backgroundOpacity;
      if (state.searchEngine) searchEngine = state.searchEngine;
      if (state.customSearchUrl) customSearchUrl = state.customSearchUrl;
      if (state.defaultTerminalPath !== undefined) defaultTerminalPath = state.defaultTerminalPath;
      if (state.defaultShell !== undefined) { defaultShell = state.defaultShell; window.electronAPI?.setDefaultShell?.(defaultShell); }
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

      closedThreads = Array.isArray(state.closedThreads) ? state.closedThreads.filter(t => t && typeof t.id === 'string' && t.chat && typeof t.chat === 'object').map(t => ({ ...t, _closed: true, threadHistory: true })) : [];
      if (!state.workspaces?.length) return false;
      if (typeof state.sidebarExpanded === 'boolean') document.getElementById('sidebar').classList.toggle('expanded', state.sidebarExpanded);
      if (state.sidebarWidth) {
        savedSidebarWidth = Math.max(state.sidebarWidth, SB_EXPANDED_MIN);
        if (state.sidebarExpanded && sidebarSplit) {
          const pct = Math.max(5, (savedSidebarWidth / sbPairWidth()) * 100);
          sidebarSplit.setSizes([pct, 100 - pct]);
        }
      }

      // Only Scratch has no path (older saves dropped its flag).
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
        // Threads were workspaces with ws.thread: they come back as plain workspaces with their chat.
        const chat = wsData.chat || wsData.thread;
        if (chat && typeof chat === 'object') ws.chat = chat;
        if (wsData.cwd) ws.cwd = wsData.cwd;

        ws.layout = deserializeLayout(wsData.layout, ws);
        // Older saves kept one chat per workspace: it becomes its first Chat tab's chat (same history folder).
        const firstChat = ws.chat && getWorkspaceTerminals(ws).find(t => t.threadHistory && !t.chat);
        if (firstChat) {
          firstChat.chat = { ...ws.chat, storeId: ws.chat.storeId || ws.id };
          if (ws.chat.title) firstChat.label = ws.chat.title.replace(/\s+/g, ' ').slice(0, 28);
          delete ws.chat;
        }
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

      activeWsId = findWs(state.activeWsId) ? state.activeWsId : workspaces[0]?.id;
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
    workspaces = []; closedThreads = []; folders = []; sideOrder = []; activeWsId = null; _wsDomCache = {};
    _pluginStates.clear(); _pluginConfigs.clear(); // restoreState only adds keys; drop stale ones
  }

  function apiProfilesSwitch(p) {
    applyProfileKey(p);
    _profileSwitching = true; // block any accidental saveState flush mid-transition
    // Cover the old profile synchronously so it doesn't flash during the swap.
    const splash = document.getElementById('splash');
    splash?.classList.remove('hide');
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
  const nextWorkspaceName = () => {
    const used = new Set(workspaces.map(w => w.label));
    let n = 1;
    while (used.has('Workspace ' + n)) n++;
    return 'Workspace ' + n;
  };

  function createWorkspace(label, folderId, details) {
    wsCount++;
    const id = uuid();
    const ws = { id, label: label || nextWorkspaceName(), layout: null, activeTermId: null, folderId: folderId || undefined };
    if (details && details.color) ws.color = details.color;
    if (details && details.icon) ws.icon = details.icon;
    workspaces.push(ws);
    if (!folderId) sideOrder.push({ type: 'ws', id });
    else rebuildWorkspaces();
    activateWorkspace(id);
    // Activating an empty workspace already opens its terminal once the backend is up; only add one if it didn't.
    if (!ws.layout) addTerminal(id);
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
    const wsp = activeWs();

    // Hide all cached workspace containers
    Object.values(_wsDomCache).forEach(el => { el.style.display = 'none'; });

    // Closing the last tab can leave an empty tab group behind: that is "nothing open".
    if (wsp && wsp.layout && !getWorkspaceTerminals(wsp).length) {
      wsp.layout = null;
      wsp.activeTermId = null;
      _wsDomCache[wsp.id]?.remove();
      delete _wsDomCache[wsp.id];
    }
    syncThreadPanel();
    // A workspace is never left empty: it gets a fresh terminal tab (main window only,
    // and not while a profile switch is tearing workspaces down).
    if (wsp && !wsp.layout && !SETTINGS_ONLY && !_profileSwitching && (nativePtyReady || wsReady)) { addTerminal(wsp.id); return; }
    if (!wsp || !wsp.layout) return;

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
    syncThreadPanel(); // restore chat surfaces after their slots have been reattached

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
    // Closing a workspace preserves its chats in the threads sidebar too.

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
  }

  // Strip "user@host:" prefix and turn "/a/b/c" into "c" (~ stays "~")
  function shortTitle(title) {
    const path = title.includes('@') && title.includes(':') ? title.slice(title.indexOf(':') + 1) : title;
    if (!path || path === '~') return path;
    return path.split(/[\\/]/).filter(Boolean).pop() || path;
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
    // The chat hides its shell. Promoting that shell to WebGL can block the
    // tab switch and evict a renderer that is in use by a visible terminal.
    visible = visible && (!entry.threadHistory || entry._cliView);
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
      entry._atShellPrompt = false;
      if (/claude/i.test(title)) entry._claudeRunning = true;
      // Claude Code titles: "◐◓◑◒ <topic>" while working, "✳ <topic>" when idle.
      if (/^[\u25D0-\u25D3]/.test(title)) { if (!entry._agentWorking) entry._workSince = Date.now(); entry._agentWorking = true; }
      else if (/^\u2733/.test(title)) entry._idleAt = Date.now();
      if (/^\u2733/.test(title) && entry._agentWorking) {
        entry._agentWorking = false;
        chatAgentIdle(entry);
        onTerminalFinished({ id: entry.id, kind: 'agent', name: 'claude' });
      }
      setAutomaticTerminalTitle(entry, title);
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
        setAutomaticTerminalTitle(entry, entry.cwd || 'Terminal');
      }
      return true;
    });
  }

  // Claude Code prints pasted images as "[Image #N]" and long pastes as "[Pasted text #N +M lines]".
  // Hover previews them, Ctrl/Cmd+click opens them full size. Desktop only.
  let claudeRefPop = null, claudeRefHoverToken = 0, claudeRefHovered = null;
  function hideClaudeRefPop() { claudeRefHoverToken++; claudeRefHovered = null; if (claudeRefPop) claudeRefPop.hidden = true; }
  // Every terminal link (web URLs, OSC 8, previews) opens with Ctrl/Cmd+click; a plain press stays
  // a terminal press (text selection) and only drops the preview. Links open here on mousedown,
  // never through xterm's activate: a click in Claude's input box redraws that line and xterm drops
  // the link before mouseup, and the swallowed press never reaches a CLI that captures the mouse
  // (Claude Code opens a clicked URL itself, which made links open twice: tab + external browser).
  // claudeRefHovered = { el: terminal element, term, open(event) } for the link under the mouse.
  const claudeRefHint = `${window.electronAPI?.platform === 'darwin' ? '⌘' : 'Ctrl'}+click to open`;
  // Links only open with the modifier held, so show xterm's pointer cursor only then (workspace.css).
  const syncLinkMod = e => document.body.classList.toggle('link-mod-held', e.ctrlKey || e.metaKey);
  for (const type of ['keydown', 'keyup', 'mousemove']) window.addEventListener(type, syncLinkMod, true);
  window.addEventListener('blur', () => document.body.classList.remove('link-mod-held'));
  document.addEventListener('mousedown', e => {
    const hit = claudeRefHovered;
    if (!hit || !hit.el?.contains(e.target)) return;
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault(); e.stopPropagation();
      hit.open(e); // Shift picks the other target for web links
      return;
    }
    claudeRefHoverToken++; if (claudeRefPop) claudeRefPop.hidden = true; // keep the hit: Ctrl+click may follow
    // A CLI that captures the mouse (Claude Code, Codex) opens a clicked URL in the system
    // browser itself; links only open on Ctrl/Cmd+click, so it never gets presses on a link.
    // Shift+press is xterm's forced selection and still goes through.
    if (!e.shiftKey && hit.term?.modes.mouseTrackingMode !== 'none') { e.preventDefault(); e.stopPropagation(); hit.term.focus(); }
  }, true);
  const claudeRefCache = new Map();
  const lineBreaks = text => (text.match(/\n/g) || []).length;
  const IMAGE_FILE_ERRORS = { missing: 'File not found', denied: 'Permission denied', 'not-image': 'Not an image file',
    invalid: 'Only absolute or ~/ paths can be previewed' };
  async function loadClaudeRef(entry, ref, prompt) {
    if (ref.kind === 'citation') return { text: ref.text };
    if (ref.kind === 'text-file') return window.electronAPI.readAttachmentPreview(ref.path);
    if (ref.kind === 'file') {
      // Read on every hover, no cache: screenshots get overwritten at the same path.
      const r = await window.electronAPI.readImageFile(ref.path);
      if (r?.data) return { src: `data:${r.mediaType};base64,${r.data}` };
      return { error: r?.error === 'too-large' ? `Too large to preview (${Math.round(r.size / 1048576)} MB)` : IMAGE_FILE_ERRORS[r?.error] || 'Couldn’t read this file' };
    }
    if (ref.kind === 'paste') {
      // Unsent pastes exist only in this pane; Claude's "+M lines" counts line breaks.
      const local = entry._claudePastes?.findLast(t => lineBreaks(t) === ref.lines);
      if (local != null) return { text: local };
    }
    const files = entry._claudeImageFiles;
    if (ref.kind === 'image' && ref.draft && files?.length) {
      // Unsent images: the draft's chips, in number order, are the latest images pasted here.
      const nums = [...prompt.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1])).sort((a, b) => a - b);
      const i = nums.indexOf(ref.n);
      const file = i >= 0 && nums.length <= files.length ? files[files.length - nums.length + i] : files[files.length - 1];
      const r = await window.electronAPI.readImageFile(file);
      if (r?.data) return { src: `data:${r.mediaType};base64,${r.data}` };
    }
    // Not Claude (Codex, …): never fall back to Claude's transcripts, they'd show another session's content.
    const other = entry._claudeRunning === false;
    if (other && ref.kind !== 'image') return null;
    // Cache hits only: a miss may be something the CLI hasn't written to disk yet.
    // `later` counts from the newest message, so it shifts when a new one is sent; the prompt's
    // buffer line pins which message this is.
    const key = `${entry.id}\n${other}\n${ref.kind}\n${ref.n}\n${ref.later}\n${ref.at}\n${prompt}`;
    if (claudeRefCache.has(key)) return claudeRefCache.get(key);
    let found = null;
    if (other) {
      const img = await window.electronAPI.codexImage({ n: ref.n, prompt, files: files || [], later: ref.later });
      // Only cache a match on this pane's own file; a bare prompt match may be replaced by
      // the right session once Codex writes it.
      if (img) { const src = { src: `data:${img.mediaType};base64,${img.data}` }; if (!img.own) return src; found = src; }
    } else if (ref.kind === 'image') {
      const img = await window.electronAPI.claudeImage({ sessionId: entry.claudeSessionId, cwd: entry.cwd, n: ref.n, prompt });
      if (img) found = { src: `data:${img.mediaType};base64,${img.data}` };
    } else {
      const text = await window.electronAPI.claudePaste({ n: ref.n, lines: ref.lines, prompt });
      if (text != null) found = { text: text.replace(/\r\n?/g, '\n') };
    }
    if (found) { claudeRefCache.set(key, found); if (claudeRefCache.size > 40) claudeRefCache.delete(claudeRefCache.keys().next().value); }
    return found;
  }
  function claudeRefPre(text, maxLines) {
    const pre = document.createElement('pre'); pre.className = 'claude-paste-text';
    const lines = text.split('\n');
    pre.textContent = maxLines && lines.length > maxLines ? lines.slice(0, maxLines).join('\n') + '\n…' : text;
    return pre;
  }
  async function showClaudeRefPop(entry, ref, prompt, event) {
    const token = ++claudeRefHoverToken;
    if (!claudeRefPop) {
      claudeRefPop = document.createElement('div'); claudeRefPop.className = 'claude-image-pop'; claudeRefPop.hidden = true;
      document.body.appendChild(claudeRefPop);
    }
    const place = () => {
      const r = claudeRefPop.getBoundingClientRect();
      let top = event.clientY + 14;
      if (top + r.height > innerHeight - 8) top = Math.max(8, event.clientY - r.height - 10);
      claudeRefPop.style.left = Math.max(8, Math.min(event.clientX - 12, innerWidth - r.width - 8)) + 'px';
      claudeRefPop.style.top = top + 'px';
    };
    const meta = document.createElement('div'); meta.className = 'claude-image-meta';
    const label = document.createElement('span'); label.className = 'claude-image-title'; label.textContent = ref.label;
    meta.innerHTML = '<i class="ph ph-circle-notch"></i>'; meta.append(label);
    claudeRefPop.replaceChildren(meta);
    claudeRefPop.hidden = false; place();
    let found = null;
    try { found = await loadClaudeRef(entry, ref, prompt); } catch (err) { console.error('[claude-ref]', err); }
    if (token !== claudeRefHoverToken) return;
    const info = document.createElement('span');
    meta.replaceChildren(label, info);
    if (found?.src || found?.text != null) meta.append(Object.assign(document.createElement('span'), { className: 'claude-image-hint', textContent: claudeRefHint }));
    if (found?.src) {
      const img = document.createElement('img'); img.alt = ref.label; img.src = found.src;
      img.onload = () => { if (token === claudeRefHoverToken) { info.textContent = `${img.naturalWidth}×${img.naturalHeight}`; place(); } };
      claudeRefPop.replaceChildren(img, meta);
    } else if (found?.text != null) {
      info.textContent = `${lineBreaks(found.text) + 1} lines · ${found.text.length.toLocaleString()} chars`;
      claudeRefPop.replaceChildren(claudeRefPre(found.text, 18), meta);
    } else {
      label.textContent = found?.error || `${ref.label} wasn't found in this pane or Claude's history`;
      meta.replaceChildren(Object.assign(document.createElement('i'), { className: 'ph ph-warning-circle' }), label);
    }
    place();
  }
  async function openClaudeRefViewer(entry, ref, prompt, previewSrc) {
    hideClaudeRefPop();
    const found = previewSrc ? { src: previewSrc } : await loadClaudeRef(entry, ref, prompt).catch(() => null);
    if (!found?.src && found?.text == null) { zoomBadge(found?.error || 'Preview unavailable'); return; }
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div'); overlay.className = 'claude-image-viewer';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', ref.label); overlay.tabIndex = -1;
    let keys = null; // image viewer shortcuts
    if (found.src) {
      const img = document.createElement('img'); img.src = found.src; img.alt = ref.label; img.draggable = false;
      // Wheel zooms at the cursor, drag pans, toolbar/keys rotate and flip.
      const v = { s: 1, x: 0, y: 0, r: 0, f: 1 };
      const pct = document.createElement('span'); pct.className = 'civ-zoom';
      const apply = () => {
        img.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.s}) rotate(${v.r}deg) scaleX(${v.f})`;
        pct.textContent = `${Math.round(v.s * 100)}%`;
      };
      // Quarter turns swap width and height, so shrink to keep the whole image on screen.
      const fitScale = () => v.r % 180 ? Math.min(1, innerWidth * .92 / img.offsetHeight, innerHeight * .84 / img.offsetWidth) : 1;
      const fit = () => { Object.assign(v, { s: fitScale(), x: 0, y: 0 }); apply(); };
      const zoomAt = (s2, cx = innerWidth / 2, cy = innerHeight / 2) => {
        s2 = Math.max(.1, Math.min(20, s2));
        const r = overlay.getBoundingClientRect(), px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
        v.x = px - (s2 / v.s) * (px - v.x); v.y = py - (s2 / v.s) * (py - v.y); v.s = s2; apply();
      };
      const rotate = d => { v.r = (v.r + d + 360) % 360; fit(); };
      const flip = () => { v.f *= -1; apply(); };
      overlay.addEventListener('wheel', e => { e.preventDefault(); zoomAt(v.s * Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
      let drag = null, dragged = false;
      img.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); img.setPointerCapture(e.pointerId);
        drag = { x: e.clientX - v.x, y: e.clientY - v.y, sx: e.clientX, sy: e.clientY }; dragged = false;
      });
      img.addEventListener('pointermove', e => {
        if (!drag) return;
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) dragged = true;
        v.x = e.clientX - drag.x; v.y = e.clientY - drag.y; apply();
      });
      img.addEventListener('pointerup', () => { drag = null; });
      // A click on the image never closes; a double click toggles fit / 2x at the cursor.
      img.addEventListener('click', e => { e.stopPropagation(); });
      img.addEventListener('dblclick', e => { if (dragged) return; v.s > fitScale() + .01 ? fit() : zoomAt(2 * fitScale(), e.clientX, e.clientY); });

      const bar = document.createElement('div'); bar.className = 'civ-bar'; bar.setAttribute('role', 'toolbar');
      bar.onclick = e => e.stopPropagation();
      const btn = (icon, title, fn) => {
        const b = document.createElement('button'); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
        b.innerHTML = `<i class="ph ph-${icon}"></i>`; b.onclick = fn; bar.appendChild(b);
      };
      const sep = () => bar.appendChild(Object.assign(document.createElement('span'), { className: 'civ-sep' }));
      btn('magnifying-glass-minus', 'Zoom out (−)', () => zoomAt(v.s / 1.25));
      bar.appendChild(pct);
      btn('magnifying-glass-plus', 'Zoom in (+)', () => zoomAt(v.s * 1.25));
      btn('corners-in', 'Fit to screen (0)', fit);
      sep();
      btn('arrow-counter-clockwise', 'Rotate left (Shift+R)', () => rotate(-90));
      btn('arrow-clockwise', 'Rotate right (R)', () => rotate(90));
      btn('flip-horizontal', 'Flip (F)', flip);
      sep();
      btn('x', 'Close (Esc)', () => close());
      keys = { '+': () => zoomAt(v.s * 1.25), '=': () => zoomAt(v.s * 1.25), '-': () => zoomAt(v.s / 1.25), '0': fit,
        r: () => rotate(90), R: () => rotate(-90), f: flip, F: flip };
      apply();
      // The zoomed image stays inside a frame (at most 92vw x 84vh, centered like the overlay, so the
      // zoom math is unchanged); past it, the image is cropped and panned inside.
      const stage = document.createElement('div'); stage.className = 'civ-stage';
      stage.appendChild(img);
      overlay.append(stage, bar);
    } else {
      const pre = claudeRefPre(found.text);
      pre.onclick = e => e.stopPropagation(); // keep text selectable; the backdrop closes
      overlay.appendChild(pre);
    }
    // Capture on document: xterm refocuses itself after the click, and a stray Esc would interrupt Claude.
    const onKey = e => {
      const k = e.key === 'Escape' ? close : !e.ctrlKey && !e.metaKey && !e.altKey && keys?.[e.key];
      if (k) { e.preventDefault(); e.stopPropagation(); k(); }
    };
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (entry?.term) entry.term.focus(); else previousFocus?.focus(); };
    overlay.onclick = close;
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
  }
  function setupClaudeImageLinks(entry) {
    if (!window.electronAPI?.claudeImage) return;
    const term = entry.term;
    entry._claudePastes = [];
    term.onData(data => {
      // Bracketed paste (Claude turns it on) marks every paste, whichever path sent it.
      if (!data.startsWith('\x1b[200~')) return;
      const text = data.slice(6, data.endsWith('\x1b[201~') ? -6 : undefined).replace(/\r\n?/g, '\n');
      entry._claudePastes.push(text);
      // A pasted or dropped image path becomes an "[Image #N]" chip in Claude/Codex.
      for (const m of text.matchAll(IMAGE_PATH_RE)) trackPaneImage(entry, m[2] || m[3]);
      if (entry._claudePastes.length > 20) entry._claudePastes.shift();
    });
    term.registerLinkProvider({
      provideLinks(y, callback) {
        const buf = term.buffer.active;
        if (!buf.getLine(y - 1)) return callback(undefined);
        // A chip can wrap: soft-wrapped mid-word, or Claude/Codex break it at a space ("[Image" / "#2]").
        // Claude pads its input box to the edge, so that break can also be a soft wrap full of spaces.
        // Join nearby rows, any whitespace or hard break as one space, keeping a cell position per char.
        let text = '', pos = [];
        for (let r = Math.max(0, y - 3); r < Math.min(buf.length, y + 2); r++) {
          let row = termRow(buf.getLine(r), r);
          const keep = text.trimEnd().length, lead = row.text.length - row.text.trimStart().length;
          if (text && (!row.wrapped || keep < text.length || lead)) {
            text = text.slice(0, keep) + ' '; pos = pos.slice(0, keep); pos.push(null);
            row = { text: row.text.slice(lead), pos: row.pos.slice(lead) };
          }
          text += row.text; pos.push(...row.pos);
        }
        const links = [];
        let prompt, draft, later = 0, at = -1;
        for (const m of text.matchAll(/\[(?:Image #(\d+)|Pasted text #(\d+)(?: \+(\d+) lines?)?)\]/g)) {
          // Only this row's cells: a wrapped chip is one link piece per row.
          const cells = pos.slice(m.index, m.index + m[0].length).filter(c => c?.y === y);
          if (!cells.length) continue;
          // The sent message is the nearest "❯ " prompt line at or above; it identifies the session.
          // No "❯" line below means this is Claude's input box: an unsent draft.
          if (prompt === undefined) {
            const buf = term.buffer.active, lineText = i => buf.getLine(i)?.translateToString(true) || '';
            prompt = '';
            for (let i = y - 1; i >= Math.max(0, y - 40); i--) {
              const p = /^\s*[❯›>]\s+(.*\S)/.exec(lineText(i)); // Claude ❯, Codex ›
              if (p) { prompt = p[1]; at = i; break; }
            }
            // Prompt lines below; the last one is the input box. Identical sent prompts after this
            // one tell which repeat of e.g. "[Image #1]" this is.
            const below = [];
            for (let i = Math.max(at, y - 1) + 1; i < buf.length; i++) if (/^\s*[❯›](\s|$)/.test(lineText(i))) below.push(i);
            draft = !below.length;
            later = below.slice(0, -1).filter(i => /^\s*[❯›>]\s+(.*\S)/.exec(lineText(i))?.[1] === prompt).length;
          }
          const ref = m[1] ? { kind: 'image', n: Number(m[1]), draft, later, at, label: `Image #${m[1]}` }
            : { kind: 'paste', n: Number(m[2]), lines: Number(m[3] || 0), label: `Pasted text #${m[2]}` };
          links.push({
            text: m[0], decorations: { underline: true, pointerCursor: true },
            range: { start: cells[0], end: cells[cells.length - 1] },
            activate: () => {}, // opened by the mousedown listener above
            hover: e => { if (e.buttons) return; showClaudeRefPop(entry, ref, prompt, e); claudeRefHovered = { el: term.element, term, open: () => openClaudeRefViewer(entry, ref, prompt) }; }, // not mid-selection
            leave: hideClaudeRefPop,
          });
        }
        callback(links.length ? links : undefined);
      },
    });
    // Image paths in output (absolute, ~/ or C:\, optionally quoted): hover previews, Ctrl/Cmd+click
    // opens the viewer. A plain click stays a terminal click, so the path can still be selected.
    if (!window.electronAPI.readImageFile) return;
    term.registerLinkProvider({
      provideLinks(y, callback) {
        const buf = term.buffer.active, rows = [];
        // A few rows around y: long paths soft-wrap (terminal) or get hard-wrapped by CLIs.
        for (let r = Math.max(0, y - 9); r < Math.min(buf.length, y + 8); r++) rows.push(termRow(buf.getLine(r), r));
        const { text, pos, glues } = joinTermRows(rows);
        const found = [];
        for (const m of text.matchAll(IMAGE_PATH_RE)) {
          const [s, e] = m.indices[2] || m.indices[3];
          // Only this row's cells: a hard-wrapped path is one link piece per row, so the
          // underline skips the continuation's indent.
          const cells = pos.slice(s, e).filter(c => c?.y === y);
          if (!cells.length) continue;
          found.push({ p: m[2] || m[3], glued: glues.some(g => g > s && g < e),
            range: { start: cells[0], end: cells[cells.length - 1] } });
        }
        if (!found.length) return callback(undefined);
        // A rejoined path may be two unrelated words; link it only if the file exists.
        Promise.all(found.map(f => f.glued ? window.electronAPI.readImageFile(f.p, { probe: true }).then(r => r?.ok) : true)).then(oks => {
          const links = found.filter((_, i) => oks[i]).map(({ p, range }) => {
            const ref = { kind: 'file', path: p, label: p.split(/[\\/]/).pop() };
            return {
              text: p, range, decorations: { underline: true, pointerCursor: true },
              activate: () => {}, // opened by the mousedown listener above
              hover: ev => { if (ev.buttons) return; showClaudeRefPop(entry, ref, '', ev); claudeRefHovered = { el: term.element, term, open: () => openClaudeRefViewer(entry, ref, '') }; }, // not mid-selection
              leave: hideClaudeRefPop,
            };
          });
          callback(links.length ? links : undefined);
        }, () => callback(undefined));
        return;
      },
    });
  }
  // A buffer row's text with a 1-based cell position per char, so wide glyphs don't shift matches.
  function termRow(line, r) {
    const row = { text: '', pos: [], wrapped: !!line.isWrapped };
    for (let x = 0; x < line.length; x++) {
      const c = line.getCell(x);
      if (c && c.getWidth() === 0) continue;
      const ch = c?.getChars() || ' ';
      row.text += ch; for (let k = 0; k < ch.length; k++) row.pos.push({ x: x + 1, y: r + 1 });
    }
    return row;
  }
  // Join terminal rows into one string with a cell position per char. Soft-wrapped rows
  // continue directly. A hard break is glued (indent dropped) only when the row above ends
  // in an unfinished path, as when Claude/Codex wrap a long path themselves; `glues` marks
  // those joins so callers can double-check matches across them.
  function joinTermRows(rows) {
    let text = '', pos = [];
    const glues = [];
    rows.forEach((row, i) => {
      if (i && !row.wrapped) {
        const tail = /(\S+)\s*$/.exec(text)?.[1] || '';
        const lead = row.text.length - row.text.trimStart().length;
        const pathStart = /^['"(]?(?:~|[A-Za-z]:)?[\\/][^\s'"`()<>[\]{}|]*$/.test(tail) && !/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(tail);
        if (pathStart && /^[^\s'"`()<>[\]{}|]/.test(row.text.slice(lead))) {
          const keep = text.trimEnd().length;
          text = text.slice(0, keep); pos = pos.slice(0, keep);
          glues.push(text.length);
          text += row.text.slice(lead); pos.push(...row.pos.slice(lead));
          return;
        }
        text += '\n'; pos.push(null);
      }
      text += row.text; pos.push(...row.pos);
    });
    return { text, pos, glues };
  }
  // Quoted (may contain spaces) or bare. A bare path must not continue a word or URL
  // ("https://x/a.png", "a~/b.png"); trailing sentence punctuation is not part of it.
  const IMAGE_PATH_RE = /(['"])((?:~|[A-Za-z]:)?[\\/][^'"\n]*?\.(?:png|jpe?g|gif|webp|bmp))\1|(?<![\w.:/~\\-])((?:~|[A-Za-z]:)?[\\/][^\s'"`()<>[\]{}|]*\.(?:png|jpe?g|gif|webp|bmp))(?=[.,:;!?]?(?:$|[\s'"`)\]}>]))/dgi;
  const ATTACHMENT_PATH_RE = /(['"])((?:~|[A-Za-z]:)?[\\/][^'"\n]+)\1|(?<![\w.:/~\\-])((?:~|[A-Za-z]:)?[\\/][^\s'"`()<>[\]{}|]*\.[a-z0-9]+)(?=[.,:;!?]?(?:$|[\s'"`)\]}>]))/gi;

  function setupTerminalWheel(entry) {
    let remainder = 0;
    const handleWheel = event => {
      const term = entry.term;
      if (event.ctrlKey || event.metaKey || !event.deltaY || (entry.threadHistory && !entry._cliView)) return true;
      // TUIs with mouse tracking own their wheel reports; alternate screens have no scrollback.
      if (term.modes.mouseTrackingMode !== 'none' || term.buffer.active.type !== 'normal') return true;
      const pixelsPerLine = (term.options.fontSize || currentFontSize) * (term.options.lineHeight || 1);
      const lines = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * term.rows : event.deltaY / pixelsPerLine;
      remainder += lines;
      const whole = Math.trunc(remainder);
      if (whole) { remainder -= whole; term.scrollLines(whole); }
      event.preventDefault();
      return false;
    };
    entry.term.element.addEventListener('wheel', event => {
      if (!handleWheel(event)) event.stopImmediatePropagation();
    }, { capture: true, passive: false });
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
      // OSC 8 hyperlinks (Claude, ls --hyperlink, …): same routing as plain URLs, opened by the
      // Ctrl/Cmd+mousedown listener (see claudeRefHovered), not by xterm's activate.
      linkHandler: { activate: () => {}, hover: (_e, uri) => hoverWebLink(term, id, uri), leave: () => { claudeRefHovered = null; } },
    });

    const fitAddon = new FitAddon.FitAddon();
    const searchAddon = new SearchAddon.SearchAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon(() => {}, { hover: (_e, uri) => hoverWebLink(term, id, uri), leave: () => { claudeRefHovered = null; } });
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
      if (entry.threadHistory && !entry._cliView) return; // a Chat tab's terminal is typed into only while it shows
      if (wsReady) sendStdin(id, new TextEncoder().encode(data));
      if (/[\r\x03\x04]/.test(data)) {
        refreshWorkspaceProcsSoon();
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
    setupClaudeImageLinks(entry);
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
    blurTermEmails(term);
    return entry;
  }

  // Email addresses have a clickable blur overlay; each occurrence toggles independently.
  // ponytail: one row at a time, so an address soft-wrapped across two rows isn't blurred.
  const EMAIL_RE = /[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  function randomPrivateUsername() {
    const bytes = new Uint8Array(6);
    try { crypto.getRandomValues(bytes); } catch { return 'xxxxxxxxxxxx'; }
    return [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  async function privateCopyToken(value, type) {
    if (type === 'user') return `[user-${randomPrivateUsername()}]`;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
      return `[${type}-${[...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 12)}]`;
    } catch { return `[${type}-hidden]`; } // Never fall back to revealing a hidden value.
  }
  async function privateClipboardText(text, terminal = false) {
    text = String(text ?? '');
    const replacements = [];
    if (threadSettings.usernames === 'blur') {
      for (const m of text.matchAll(/(?:[A-Za-z]:[\\/]+Users[\\/]+|[\\/](?:home|Users)[\\/]+)([^\\/\s"'<>]+)/gi)) {
        replacements.push({ at: m.index + m[0].length - m[1].length, length: m[1].length, value: m[1], type: 'user' });
      }
    }
    if (terminal && hideEmails) for (const m of text.matchAll(new RegExp(EMAIL_RE.source, 'g'))) {
      replacements.push({ at: m.index, length: m[0].length, value: m[0], type: 'email' });
    }
    // Resolve hashes first, then replace right-to-left so offsets stay stable.
    const values = await Promise.all(replacements.map(async r => ({ ...r, token: await privateCopyToken(r.value, r.type) })));
    let boundary = text.length;
    for (const r of values.sort((a, b) => b.at - a.at)) {
      if (r.at + r.length > boundary) continue;
      text = text.slice(0, r.at) + r.token + text.slice(r.at + r.length); boundary = r.at;
    }
    return text;
  }
  // The terminal keys act on: a chat's Ctrl+J shell when it has focus, else the active tab.
  function keyTerminal() {
    const active = activeTerminal(), bottom = active?._bottomTerminal;
    return bottom && !bottom.el.hidden && bottom.el.contains(document.activeElement) ? bottom : active;
  }
  async function copyPrivateText(text, terminal = false) {
    const safe = await privateClipboardText(text, terminal);
    if (window.electronAPI?.clipboardWrite) return window.electronAPI.clipboardWrite(safe);
    return navigator.clipboard.writeText(safe);
  }
  async function copyPrivateTerminal(term) {
    const text = term.getSelection();
    return copyPrivateText(term._privateSelectionText ? await term._privateSelectionText(text) : text, true);
  }
  function copyPrivateWorkSelection(e) {
    if (threadSettings.usernames !== 'blur') return;
    if (e.target?.closest?.('.xterm') || e.target?.matches?.('input, textarea, [contenteditable="true"]')) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0), fragment = range.cloneContents();
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const inside = start?.closest('.thr-work-username');
    if (!inside && !fragment.querySelector('.thr-work-username')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const text = selection.toString();
    void (async () => {
      if (inside && inside.contains(range.endContainer)) return copyPrivateText(await privateCopyToken(text, 'user'));
      for (const span of fragment.querySelectorAll('.thr-work-username')) span.textContent = await privateCopyToken(span.textContent, 'user');
      await copyPrivateText(mdFromDom(fragment).trim());
    })().catch(() => {});
  }
  document.addEventListener('copy', copyPrivateWorkSelection, true);
  function blurTermEmails(term) {
    const privateCopy = e => {
      const text = term.getSelection();
      if (!text || (!hideEmails && threadSettings.usernames !== 'blur')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      void copyPrivateTerminal(term).catch(() => {});
    };
    let copyBound = false;
    const bindPrivateCopy = () => {
      if (!copyBound && term.element) { term.element.addEventListener('copy', privateCopy, true); copyBound = true; }
    };
    bindPrivateCopy(); term.onRender(bindPrivateCopy); // This terminal may not be opened yet.
    let decos = [], timer = false;
    term._privateSelectionText = text => {
      if (hideEmails) {
        const position = term.getSelectionPosition?.();
        if (position && decos.some(d => {
          const y = d.marker.line;
          return y >= position.start.y && y <= position.end.y
            && (y !== position.start.y || position.start.x < d.x + d.w)
            && (y !== position.end.y || position.end.x > d.x)
            && !text.includes(d.text);
        })) return privateCopyToken(text, 'email');
      }
      return text;
    };
    const cellsText = (y, x, w) => {
      const line = term.buffer.active.getLine(y);
      if (!line) return '';
      const r = termRow(line, y);
      let s = '';
      for (let k = 0; k < r.text.length; k++) if (r.pos[k].x - 1 >= x && r.pos[k].x - 1 < x + w) s += r.text[k];
      return s;
    };
    const clear = () => { decos.forEach(d => d.marker.dispose()); decos = []; };
    const scan = () => {
      timer = false;
      if (!term.element) return;
      const buf = term.buffer.active, top = buf.viewportY, bottom = top + term.rows;
      // Drop blurs that were trimmed, or whose cells now hold other text (redraws, reflow).
      // A revealed one is kept while stale: TUIs erase and rewrite lines, so the same address
      // usually comes back at the same cells, or a row or two away.
      decos = decos.filter(d => {
        const y = d.marker.line;
        if (d.marker.isDisposed || y < 0) { d.marker.dispose(); return false; }
        if (y < top || y >= bottom) return true;
        d.stale = cellsText(y, d.x, d.w) !== d.text;
        if (d.stale && !d.shown) { d.marker.dispose(); return false; }
        return true;
      });
      const drop = d => { d.marker.dispose(); decos.splice(decos.indexOf(d), 1); };
      for (let y = top; y < bottom; y++) {
        const line = buf.getLine(y);
        if (!line || !line.translateToString(true).includes('@')) continue;
        const row = termRow(line, y);
        for (const m of row.text.matchAll(EMAIL_RE)) {
          const x = row.pos[m.index].x - 1, w = row.pos[m.index + m[0].length - 1].x - x;
          const at = decos.find(d => d.marker.line === y && d.x === x);
          if (at?.text === m[0]) { at.stale = false; continue; }
          if (at) drop(at);
          // Redrawn on another row: a revealed copy that lost its cells hands over its state.
          const moved = decos.find(d => d.shown && d.stale && d.text === m[0]);
          if (moved) drop(moved);
          const marker = term.registerMarker(y - (buf.baseY + buf.cursorY));
          if (!marker) continue;
          const deco = term.registerDecoration({ marker, x, width: w, layer: 'top' });
          if (!deco) { marker.dispose(); continue; }
          const d = { marker, x, w, text: m[0], shown: !!moved, stale: false };
          deco.onRender(el => {
            el.classList.toggle('shown', d.shown);
            if (el._emailBlur) return;
            el._emailBlur = true;
            el.classList.add('term-email-blur');
            el.title = d.shown ? 'Click to hide' : 'Click to show';
            el.addEventListener('mousedown', e => {
              e.preventDefault(); e.stopPropagation();
              d.shown = !d.shown; el.classList.toggle('shown', d.shown);
              el.title = d.shown ? 'Click to hide' : 'Click to show';
            });
          });
          decos.push(d);
        }
      }
    };
    // A microtask, not a timeout: it runs after the write is parsed and before xterm's next
    // animation-frame render, so an address is never painted unblurred.
    const soon = () => { if (!timer) { timer = true; queueMicrotask(scan); } };
    term.onWriteParsed(soon);
    term.onScroll(soon);
    term.onResize(soon);
    term.buffer.onBufferChange(() => { clear(); soon(); }); // markers belong to one buffer
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
    const cwd = opts.cwd || wsp.cwd || previous?.cwd || ((defaultTerminalPath && defaultTerminalPath.trim())
      ? defaultTerminalPath.trim().replace(/^["']|["']$/g, '') : null);
    const id = uuid();
    const label = opts.label || (cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Terminal';
    const entry = _createTermEntry(wsp, id, label);
    entry.cwd = cwd;
    if (opts.cmd) entry.runCmd = opts.cmd;
    if (opts.label) entry.pinLabel = true;
    if (opts.shell) entry.shell = opts.shell;
    if (opts.threadHistory) entry.threadHistory = true;

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
            tab.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-terminalvibe-tab', entry.id); e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(true); });
            tab.addEventListener('dragend', e => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); });
            tab.addEventListener('dragover', e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
              const r = tab.getBoundingClientRect();
              const isLeft = e.clientX < r.left + r.width / 2;
              tab.classList.add(isLeft ? 'drop-left' : 'drop-right');

            });
            tab.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !tab.contains(e.relatedTarget)) { tab.classList.remove('drop-left', 'drop-right'); } });
            tab.addEventListener('drop', e => {
              e.preventDefault();
              const draggedId = window.draggedTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));

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
                entry.term.focus(); // a Chat tab routes this to its message box
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

  function syncBrowserTabIcon(entry, tab) {
    const icon = tab.querySelector('.tg-tab-icon');
    if (!icon) return;
    icon.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><ellipse cx="8" cy="8" rx="3" ry="6.5"/><line x1="1.5" y1="8" x2="14.5" y2="8"/></svg>';
    if (!entry._favicon) return;
    const src = entry._favicon, img = document.createElement('img');
    img.className = 'tg-tab-favicon'; img.alt = ''; img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      if (entry._favicon === src) setBrowserTabFavicon(entry, []);
    }, { once: true });
    icon.replaceChildren(img);
    img.src = src;
  }
  function setBrowserTabFavicon(entry, favicons) {
    entry._favicon = (Array.isArray(favicons) ? favicons : []).find(url =>
      typeof url === 'string' && /^(https?:\/\/|data:image\/)/i.test(url)) || null;
    document.querySelectorAll('.tg-tab[data-termid]').forEach(tab => {
      if (tab.dataset.termid === entry.id) syncBrowserTabIcon(entry, tab);
    });
  }
  function addBrowserTab(wsId, targetGroupId, url, title) {
    const wsp = findWs(wsId || activeWsId);
    if (!wsp) return;

    const id = uuid();
    const allTerms = getWorkspaceTerminals(wsp);
    const label = title || `browser ${allTerms.length + 1}`;
    const entry = { id, label, type: 'browser', url: url || 'about:blank', iframe: null, el: null, opened: false, _focusUrlOnActivate: true };
    if (title) entry.pinLabel = true;

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
            syncBrowserTabIcon(entry, tab);
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
            tab.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-terminalvibe-tab', entry.id); e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(true); });
            tab.addEventListener('dragend', e => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); });
            tab.addEventListener('dragover', e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));
              const r = tab.getBoundingClientRect();
              const isLeft = e.clientX < r.left + r.width / 2;
              tab.classList.add(isLeft ? 'drop-left' : 'drop-right');

            });
            tab.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !tab.contains(e.relatedTarget)) { tab.classList.remove('drop-left', 'drop-right'); } });
            tab.addEventListener('drop', e => {
              e.preventDefault();
              const draggedId = window.draggedTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));

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
    const target = getWorkspaceTerminals(wsp).find(t => t.id === termId);
    if (target?._closePending) return;
    wsp.activeTermId = termId;
    pluginEmit('terminal:activate', { wsId, termId });
    const chatEntry = target?.threadHistory && target;
    if (chatEntry) queueMicrotask(() => {
      if (activeWsId !== wsId || wsp.activeTermId !== termId || (curChat() === chatEntry && thrPage.parentElement === chatEntry.el)) return;
      _preferChat = chatEntry;
      syncThreadPanel();
    });

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
      if (!target?.el) clearSlotFocus();

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
      const t = target;
      if (t && t.el) {
        focusSlot(t);
        if (t.type === 'browser') {
          // handled after syncBrowserSlots positions the container
        } else {
          // Use double RAF to let flex layout settle, then fit.
          // The 20ms timeout was too short for nested splits; RAF waits for paint.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (activeWsId !== wsId || wsp.activeTermId !== termId) return;
              if (t.term && !t.dead && t.el && t.el.offsetParent !== null) {
                t.term.focus();
                if (!t.threadHistory || t._cliView) fitTerm(t);
              }
            });
          });
        }
      }
    }
    // Double-RAF + trailing resync — same fix as switchWorkspacePane, single RAF
    // can still read a pre-settle size on a busy frame right after display toggle.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (activeWsId !== wsId || wsp.activeTermId !== termId) return;
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
      if (activeWsId !== wsId || wsp.activeTermId !== termId) return;
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

  const _processCheckPending = new Set(); // termIds with an in-flight running-process check
  const _closeLockConfirmed = new Set();  // locked termIds whose close was already confirmed

  // Keep the tab and selection intact until all close confirmations succeed.
  // Pending state only prevents duplicate requests while the process scan runs.
  function beginTabClose(wsp, entry) {
    entry._closePending = true;
    const restore = () => {
      delete entry._closePending;
      delete entry._cancelClose;
    };
    entry._cancelClose = restore;
    return restore;
  }

  // Yield a frame before disposing canvases/WebGL and other expensive resources.
  function afterTabClosePaint(cleanup) {
    let done = false;
    const run = () => { if (done) return; done = true; clearTimeout(fallback); cleanup(); };
    const fallback = setTimeout(run, 100);
    requestAnimationFrame(() => setTimeout(run, 0));
  }

  // Close several tabs with one confirmation, only when one of them is busy (running, locked, or a page).
  async function runningTabProcess(tab) {
    if (tab?._sdk?.alive) return harnessOf(tab._sdk.harness)?.name || 'Agent';
    if (tab && _chatStarting.has(tab.id)) return 'Starting agent';
    if (isLiveTerminal(tab) && !tab._agentExited && _tabAgent.get(tab.id)) return harnessOf(_tabAgent.get(tab.id))?.name || 'Agent';
    // A new chat's hidden shell has never accepted terminal input. Avoid a
    // fresh system process scan (slow on Windows) just to close that chat.
    if (tab?.threadHistory && tab._chatShellUnused && !tab._cliView) return null;
    return isLiveTerminal(tab) ? checkTerminalRunning(tab.id, true) : null;
  }
  async function closeTabs(wsId, ids) {
    const wsp = findWs(wsId);
    if (!wsp || !ids.length) return;
    const entries = getWorkspaceTerminals(wsp).filter(t => ids.includes(t.id));
    const running = await Promise.all(entries.map(t => runningTabProcess(t).catch(() => 'unknown')));
    const busy = entries.filter((t, i) => running[i] || t.locked || browserHasContent(t));
    const go = () => {
      // A workspace is never left without tabs: closing them all opens a fresh terminal first.
      if (getWorkspaceTerminals(wsp).every(t => ids.includes(t.id))) addTerminal(wsId, findGroupContainingTerm(wsp.layout, ids[0])?.id);
      for (const id of ids) removeTerminal(wsId, id, false, false, true, true);
    };
    if (!busy.length) return go();
    showDangerConfirm(`Close ${ids.length} tab${ids.length > 1 ? 's' : ''}?`,
      `${busy.map(t => `<span class="cc-label">${escHtml(t.label || 'Tab')}</span>`).join(', ')} ${busy.length > 1 ? 'are' : 'is'} still running, locked or showing a page.`,
      'Close Tabs', go);
  }

  function removeTerminal(wsId, termId, skipRender, skipPtyClose, confirmed, checked) {
    const wsp = findWs(wsId);
    if (!wsp || !wsp.layout) return;
    if (_multiSelected.has(termId)) { _multiSelected.delete(termId); document.getElementById('slot-' + termId)?.classList.remove('multi-selected'); }

    // Confirm before closing a tab that has a process running inside it
    // (something other than the idle shell), or a browser tab showing content.
    // Skipped for dead terminals, blank browser tabs and internal
    // teardowns.
    if (!confirmed && !checked && !skipRender && !skipPtyClose) {
      const entry = getWorkspaceTerminals(wsp).find(t => t.id === termId);
      if (!entry || entry._closePending) return;
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

      if (entry?._sdk?.alive || _chatStarting.has(termId) || isLiveTerminal(entry)) {
        if (_processCheckPending.has(termId)) return;
        _processCheckPending.add(termId);
        const restore = beginTabClose(wsp, entry);
        runningTabProcess(entry).catch(() => 'unknown').then(running => {
          _processCheckPending.delete(termId);
          if (!getWorkspaceTerminals(wsp).includes(entry)) { restore(); return; }
          if (running) {
            const closesWorkspace = getWorkspaceTerminals(wsp).length <= 1;
            showCloseConfirm(entry.label, closesWorkspace,
              () => removeTerminal(wsId, termId, skipRender, skipPtyClose, true, true),
              () => { restore(); _closeLockConfirmed.delete(termId); });
          } else {
            removeTerminal(wsId, termId, skipRender, skipPtyClose, false, true);
          }
        });
        return;
      }
    }

    // Last tab in workspace — remove the workspace with confirmation
    // Skip confirmation when preserving the PTY (skipPtyClose) — just remove silently
    if (!skipRender && !skipPtyClose && getWorkspaceTerminals(wsp).length <= 1) {
      {
        // Closing the last tab closes the workspace. The app never has zero workspaces,
        // so closing the only one opens a fresh workspace in its place.
        const closeWs = () => { _removeWorkspace(wsId); if (!workspaces.length) createWorkspace(); };
        if (_closingWs.has(wsId)) return;
        if (confirmed) { closeWs(); return; }
        _closingWs.add(wsId);
        const label = wsp.label;
        showConfirm(`Close "${label}"?`,
          () => { try { closeWs(); } finally { _closingWs.delete(wsId); } },
          () => { _closingWs.delete(wsId); getWorkspaceTerminals(wsp).find(t => t.id === termId)?._cancelClose?.(); });
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
    delete entry._cancelClose;
    entry._closePending = true;
    if (!skipPtyClose) rememberClosedThread(entry, wsp);
    afterTabClosePaint(() => disposeChatBottomTerminal(entry));
    if (entry.type !== 'browser') {
      if (!skipPtyClose) {
        sendControl({ type: 'close', id: termId });
        afterTabClosePaint(() => {
          try {
            if (entry.term) { _disposeTermRenderers(entry.term); entry.term.dispose(); }
          } catch { }
        });
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
    // No tab left: re-render so the empty page (or a thread's agent picker) shows.
    const structureChanged = countGroups(wsp.layout) !== groupCountBefore || !getWorkspaceTerminals(wsp).length;

    // Fallback: if the split was destroyed, pass focus to the next available terminal
    const remainingTerms = getWorkspaceTerminals(wsp);
    if (remainingTerms.length > 0 && !remainingTerms.some(t => t.id === wsp.activeTermId)) {
      // Keep the fallback group's selected tab; its first tab may be hidden.
      const fallbackGroup = findGroupContainingTerm(wsp.layout, remainingTerms[0].id);
      wsp.activeTermId = fallbackGroup?.activeTermId || remainingTerms[0].id;
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
    // If this was the last terminal (PTY-preserving move), remove the now-empty workspace —
    // unless it is the last workspace, which must always be kept.
    if (skipPtyClose && getWorkspaceTerminals(wsp).length === 0 && workspaces.length > 1) {
      _removeWorkspace(wsId);
    }
    pluginEmit('terminal:remove', { wsId, termId, type: entry?.type });
    if (!skipRender) {
      syncThreadPanel();
      afterTabClosePaint(() => { renderSidebar(); renderThreadsSidebar(); saveState(); });
    }
    // Workspace teardown renders and saves once after all its tabs are removed.
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
    if (t._chatOwner) { disposeChatBottomTerminal(t._chatOwner); return; }
    pluginEmit('terminal:exit', { termId: id, code });
    // Other agent panes returned to a shell when the agent ended, so this exit is the user's: close like any tab.
    if (t.agentManaged && t.keepOnExit) {
      t.term.write(`\r\n[Agent process exited: ${code}]\r\n`);
      t.term.options.disableStdin = true;
      renderPaneArea();
      saveState();
      return;
    }
    if (getWorkspaceTerminals(ws).length <= 1) {
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
    if (cols > 0 && rows > 0) {
      entry._resizedAt = Date.now(); // writePtyData holds the redraw that follows
      sendControl({ type: 'resize', id: entry.id, cols, rows });
    }
  }

  function fitTerm(entry, immediate = false) {
    if (!entry || !entry.el || entry.type === 'browser') return;
    if (entry.dead || entry._draggingBottomTerminal) return;
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
      if (!found || !found.term || found.term.type === 'browser' || found.term._draggingBottomTerminal) continue;
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

    const cwd = wsp.cwd || _getFocusedCwd() || ((defaultTerminalPath && defaultTerminalPath.trim()) ? defaultTerminalPath.trim().replace(/^["']|["']$/g, '') : null);

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

    // Horizontal puts the new pane on the right, vertical at the bottom.
    wsp.layout = splitGroupNodeInTree(wsp.layout, groupId, newGroup, direction, false);

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
        maxBtn.title = withKey(isNowMax ? 'Restore' : 'Maximize', 'maximizeTab');
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
        const hasExternal = (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
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

      };

      const handleTabBarDrop = (e) => {
        tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right'));

        if (!window.draggedTermId) return;

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
        tab.className = 'tg-tab' + (isActive ? ' active' : '') + (t.dead ? ' dead' : '') + (t._closePending ? ' tab-close-pending' : '');
        tab.dataset.termid = t.id;
        tab.draggable = true;

        tab.innerHTML = `
        <span class="tg-tab-dot${t.type === 'browser' ? ' tg-tab-icon' : ''}">${t.type === 'browser' ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.5"/><ellipse cx="8" cy="8" rx="3" ry="6.5"/><line x1="1.5" y1="8" x2="14.5" y2="8"/></svg>' : ''}</span>
        ${t.locked ? '<i class="ph ph-lock-simple tg-tab-lock"></i>' : ''}<span class="tg-tab-name">${escHtml(t.label)}</span>
        <span class="tg-tab-close" title="Close">✕</span>
        `;
        tab.title = (t.threadHistory && t.chat?.title) || t.label;
        if (t.threadHistory) tab.dataset.tipWrap = '';
        if (t.type === 'browser') syncBrowserTabIcon(t, tab);
        syncTabAgentIcon(t, tab);
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
        });

        tab.addEventListener('dragover', e => {
          const hasExternal = (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
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
        if (!window.draggedTermId) return;
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
      // Right-click the empty tab bar: new tab with a chosen shell.
      tabsWrap.addEventListener('contextmenu', e => {
        if (e.target.closest('.tg-tab')) return;
        e.preventDefault();
        showCtxMenu(e, 'tabbar', { wsId: wsp.id, groupId: node.id });
      });

      header.appendChild(tabsWrap);

      const actions = document.createElement('div');
      actions.className = 'term-group-actions';
      actions.addEventListener('mousedown', e => e.preventDefault());

      const addTabBtn = document.createElement('div');
      addTabBtn.className = 'tg-btn';
      addTabBtn.title = withKey('New terminal in this group', 'newTerminal');
      addTabBtn.innerHTML = '<i class="ph ph-plus"></i>';
      addTabBtn.addEventListener('click', () => addTerminal(wsp.id, node.id));
      addTabBtn.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'tabbar', { wsId: wsp.id, groupId: node.id }); });

      const splitH = document.createElement('div');
      splitH.className = 'tg-btn';
      splitH.title = withKey('Split horizontal', 'splitH');
      splitH.innerHTML = '<i class="ph ph-square-split-horizontal"></i>';
      splitH.onclick = () => splitGroupDirectly(wsp.id, node.id, 'row');

      const splitV = document.createElement('div');
      splitV.className = 'tg-btn';
      splitV.title = withKey('Split vertical', 'splitV');
      splitV.innerHTML = '<i class="ph ph-square-split-vertical"></i>';
      splitV.onclick = () => splitGroupDirectly(wsp.id, node.id, 'column');

      const addBrowserBtn = document.createElement('div');
      addBrowserBtn.className = 'tg-btn';
      addBrowserBtn.title = withKey('New browser tab', 'browserTab');
      addBrowserBtn.innerHTML = '<i class="ph ph-globe"></i>';
      addBrowserBtn.onclick = () => addBrowserTab(wsp.id, node.id);

      const isMax = wsp._maximizedGroupId === node.id;
      const maxBtn = document.createElement('div');
      maxBtn.className = 'tg-btn';
      maxBtn.dataset.action = 'maximize';
      maxBtn.title = withKey(isMax ? 'Restore' : 'Maximize', 'maximizeTab');
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
      // Shown (by CSS) while this group's active tab is a Chat tab: switches it between the chat and
      // the terminal its agent runs in (terminal icon in the chat, chat icon in the terminal).
      const chatBackBtn = document.createElement('div');
      chatBackBtn.className = 'tg-btn tg-chat-back';
      chatBackBtn.title = 'Switch between chat and terminal';
      chatBackBtn.setAttribute('role', 'button');
      chatBackBtn.setAttribute('aria-label', 'Switch between chat and terminal');
      chatBackBtn.innerHTML = '<i class="ph ph-terminal-window tg-chat-to-cli"></i><i class="ph ph-chats-circle tg-cli-to-chat"></i>';
      chatBackBtn.onclick = () => {
        const t = node.terminals.find(x => x.id === node.activeTermId);
        if (!t || viewSwitchBlocked(t)) return;
        if (t.threadHistory) setChatView(t, !t._cliView);
        else if (t && harnessOf(_tabAgent.get(t.id))) openTerminalAsChat(t); // a terminal running an agent
      };
      actions.appendChild(chatBackBtn);

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
      dropdown.appendChild(makeDropdownItem('New chat', '<i class="ph ph-chats-circle"></i>', () => newChatTab(wsp, node.id)));
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
          syncThreadSelection();
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
        toolbar.appendChild(btnOpenExt);
        // DevTools dock in a drawer under the page, as in Chrome. Desktop only: browser mode's iframe has none,
        // so there History stays a plain button instead of the ⋮ menu.
        if (!(isDesktop() && window.electronAPI?.browserDevTools)) {
          toolbar.insertBefore(btnHistory, btnOpenExt);
        } else {
          const btnMore = document.createElement('button');
          btnMore.className = 'browser-btn browser-more-btn';
          btnMore.title = 'More';
          btnMore.setAttribute('aria-label', 'More');
          btnMore.setAttribute('aria-haspopup', 'menu');
          btnMore.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';
          btnMore.addEventListener('click', e => {
            e.stopPropagation(); // The document click handler would close the menu right away.
            if (ctxEl.classList.contains('open') && ctxEl._owner === btnMore) return hideCtxMenu();
            const r = btnMore.getBoundingClientRect();
            showCtxMenu({ pageX: r.right, pageY: r.bottom + 6, alignRight: true }, 'browser-more',
              { entry, history: () => toggleBrowserHistoryDrawer(entry, contentWrap) });
            ctxEl._owner = btnMore;
          });
          const page = () => {
            const surface = contentWrap.querySelector('webview.browser-surface');
            return surface?._guestReady ? surface : null; // The webview API throws before dom-ready.
          };
          entry._closeDevTools = () => {
            const dt = entry._devtools;
            if (!dt) return;
            entry._devtools = null;
            window.electronAPI.browserDevTools(dt.pageId, false).catch(() => {});
            dt.sash.remove(); dt.el.remove();
            settleBrowserSurfaces();
          };
          entry._toggleDevTools = () => {
            if (entry._devtools) return entry._closeDevTools();
            const surface = page();
            if (!surface) return;
            const sash = document.createElement('div');
            sash.className = 'browser-devtools-sash';
            sash.setAttribute('role', 'separator');
            // Placeholder only: main lays a native DevTools view over it (see syncDevToolsViews).
            const el = document.createElement('div');
            el.className = 'browser-devtools';
            sash.setAttribute('aria-orientation', 'horizontal');
            const clamp = h => Math.max(80, Math.min(bc.clientHeight - 120, h));
            el.style.height = `${clamp(browserDevToolsHeight || Math.round(bc.clientHeight * 0.4))}px`;
            bc.append(sash, el);
            const dt = entry._devtools = { sash, el, pageId: surface.getWebContentsId() };

            window.electronAPI.browserDevTools(dt.pageId, true)
              .then(() => { if (entry._devtools === dt) syncBrowserSlots(); })
              .catch(() => { if (entry._devtools === dt) entry._closeDevTools(); });
            sash.addEventListener('pointerdown', e => {
              e.preventDefault();
              sash.setPointerCapture(e.pointerId); // Keep the drag when the pointer crosses the native view.
              startResizing();
              const bottom = bc.getBoundingClientRect().bottom;
              const move = ev => { browserDevToolsHeight = clamp(Math.round(bottom - ev.clientY)); el.style.height = `${browserDevToolsHeight}px`; syncBrowserSlots(); };
              const up = () => { sash.removeEventListener('pointermove', move); sash.removeEventListener('pointerup', up); sash.removeEventListener('pointercancel', up); stopResizing(); };
              sash.addEventListener('pointermove', move);
              sash.addEventListener('pointerup', up);
              sash.addEventListener('pointercancel', up);
            });
            settleBrowserSurfaces();
          };
          toolbar.appendChild(btnMore);
        }

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
              // The DevTools' own close button ends them without the toolbar button.
              surface.addEventListener('devtools-closed', () => entry._closeDevTools?.());
              surface.addEventListener('did-start-loading', () => showLoading(true));
              surface.addEventListener('did-stop-loading', () => {
                entry._retryCount = 0;
                clearTimeout(entry._loadTimer);
                showLoading(false);
                resumeBrowserTab(entry);
              });
              surface.addEventListener('did-navigate', e => { setBrowserTabFavicon(entry, []); syncUrl(e.url); });
              surface.addEventListener('did-navigate-in-page', e => syncUrl(e.url));
              surface.addEventListener('page-favicon-updated', e => setBrowserTabFavicon(entry, e.favicons));
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
                try { setBrowserTabFavicon(entry, [new URL('/favicon.ico', entry.url).href]); } catch {}
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
          setBrowserTabFavicon(entry, []);
          entry.url = url;

          if (entry._history[entry._historyIdx] !== url) {
            entry._history = entry._history.slice(0, entry._historyIdx + 1);
            entry._history.push(url);
            entry._historyIdx = entry._history.length - 1;
          }
          // Electron records the final (post-redirect) URL via did-navigate → syncUrl.
          if (!(isDesktop() && window.electronAPI)) recordBrowserHistory(url);
          updateNavButtons();
          if (!entry.pinLabel) entry.label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 28) || 'browser';
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
          if (!entry.pinLabel) entry.label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 28) || 'browser';
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
        btnHistory.addEventListener('click', () => toggleBrowserHistoryDrawer(entry, contentWrap));
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
    setupTerminalWheel(entry);
    entry.opened = true;
    if (entry.threadHistory) queueMicrotask(() => syncThreadPanel()); // the history page moves into its tab
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
      entry.term.focus(); // a Chat tab routes this to its message box
    });

    // Right-click on terminal body area
    slot.addEventListener('contextmenu', (e) => {
      if (entry.threadHistory && !entry._cliView) return; // no terminal menu over the chat page
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
    const isSessionDrag = isWorkspaceDrag;
    const isAttachmentDrag = e => isSessionDrag(e) || isFileDrag(e);
    let sessionDropProcess=null, sessionDropProbe=null, lastSessionHover=null;
    const inSessionDropArea = e => {
      const terminal=dropTarget();
      if(!terminal?.el || terminal.type==='browser' || terminal.locked || terminal.dead) return false;
      const r=terminal.el.getBoundingClientRect();
      return e.clientX>=r.left && e.clientX<r.right && e.clientY>=r.top && e.clientY<r.bottom;
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
      sessionDropEffect.querySelector('span').textContent = isFileDrag(lastSessionHover || {}) ? 'Drop files to attach' : 'Drop workspace to attach';
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
        if(lastSessionHover && dropTarget()===terminal && (isFileDrag(lastSessionHover) || (isWorkspaceDrag(lastSessionHover) && window.draggedWsId)) && acceptsSessionDrop(lastSessionHover)) showSessionDropEffect();
        else clearSessionDropEffect();
      }).catch(()=>{sessionDropProbe=null;sessionDropProcess=null;clearSessionDropEffect();});
    };
    // Capture context drags before the terminal's textarea/default drop handlers.
    bodyEl.addEventListener('dragenter', e => {
      if(!isAttachmentDrag(e) || e.target.closest?.('#sbr-thread')) return; // the chat page takes its own drops
      probeSessionDropTarget(e);
      e.stopPropagation();
      if(isFileDrag(e) && inSessionDropArea(e)) e.preventDefault();
      if(acceptsSessionDrop(e)) {e.preventDefault();showSessionDropEffect();}else clearSessionDropEffect();
    }, true);
    bodyEl.addEventListener('dragover', e => {
      if(!isAttachmentDrag(e) || e.target.closest?.('#sbr-thread')) return; // the chat page takes its own drops
      probeSessionDropTarget(e);
      e.stopPropagation();
      const accepted = isFileDrag(e) ? inSessionDropArea(e) : acceptsSessionDrop(e);
      if(accepted) {e.preventDefault();e.dataTransfer.dropEffect='copy';}
      else e.dataTransfer.dropEffect='none';
      if(acceptsSessionDrop(e)) showSessionDropEffect(); else clearSessionDropEffect();
    }, true);
    bodyEl.addEventListener('dragleave', e => {
      if(!isAttachmentDrag(e) || e.target.closest?.('#sbr-thread')) return; // the chat page takes its own drops
      e.stopPropagation();
      if(!e.relatedTarget || !bodyEl.contains(e.relatedTarget)) {lastSessionHover=null;clearSessionDropEffect();}
    }, true);
    bodyEl.addEventListener('drop', e => {
      if(!isAttachmentDrag(e) || e.target.closest?.('#sbr-thread')) return; // the chat page takes its own drops
      e.preventDefault();e.stopPropagation();
      lastSessionHover=null;
      clearSessionDropEffect();
      if(isFileDrag(e)) {
        if(inSessionDropArea(e)) dropFilesIntoTerminal(dropTarget(), [...e.dataTransfer.files]).catch(err => console.error('[drop] failed:', err));
        return;
      }
      if(!acceptsSessionDrop(e)) return;
      const source=findWs(e.dataTransfer.getData('application/x-terminalvibe-workspace'));
      if(source) attachContextToChat(dropTarget(),null,() => buildWorkspaceContext(source));
    }, true);
    // Plain text dragged in (a selection from the history panel, a page, another app): pasted like Ctrl+V, no Enter.
    const isTextDrag = e => {
      const t = e.dataTransfer?.types || [];
      return !window.draggedTermId && !t.includes('Files') && !t.includes('application/x-terminalvibe-tab')
        && (t.includes('text/plain') || t.includes('text/uri-list'));
    };
    const textTarget = () => { const t = dropTarget(); return t?.term && t.type !== 'browser' && !t.locked && !t.dead ? t : null; };
    bodyEl.addEventListener('dragenter', e => {
      if (isFileDrag(e)) { e.preventDefault(); return; }
      if (isTextDrag(e)) { if (textTarget()) e.preventDefault(); return; }
      const hasExternal = (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
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
      if (isTextDrag(e)) { if (textTarget()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } return; }
      const hasExternal = (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('application/x-terminalvibe-tab'));
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

    });

    bodyEl.addEventListener('dragleave', (e) => {
      dragDepth--;
      if (dragDepth <= 0 || !e.relatedTarget || !bodyEl.contains(e.relatedTarget)) {
        dragDepth = 0;
        overlay.classList.remove('active');

      }
    });

    bodyEl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (isFileDrag(e)) { dropFilesIntoTerminal(dropTarget(), [...e.dataTransfer.files]).catch(err => console.error('[drop] failed:', err)); return; }
      if (isTextDrag(e)) {
        const t = textTarget();
        // A drop inserts, it never submits: no trailing newline, and without bracketed paste
        // (PowerShell, cmd) every line break would act as Enter, so they become spaces.
        let text = (e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list')).replace(/\s+$/, '');
        if (t && !t.term.modes?.bracketedPasteMode) text = text.replace(/[ \t]*\r?\n\s*/g, ' ');
        if (t && text) { t.term.paste(text); t.term.focus(); }
        return;
      }
      dragDepth = 0;
      overlay.classList.remove('active');

      const draggedId = window.draggedTermId || (e.dataTransfer?.types.includes('application/x-terminalvibe-tab') && (e.dataTransfer.getData('application/x-terminalvibe-tab') || e.dataTransfer.getData('text/plain')));
      if (!draggedId) return;

      const zone = getZoneFromPoint(e.clientX, e.clientY);

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
  function moveTabToWorkspace(termId, targetWsId, { keepSource = false } = {}) {
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
        const fallbackGroup = findGroupContainingTerm(srcWs.layout, remaining[0].id);
        srcWs.activeTermId = fallbackGroup?.activeTermId || remaining[0].id;
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
    if (!keepSource && !getWorkspaceTerminals(srcWs).length) {
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

    // Tab being dragged.
    // Workspace/folder drags set draggedWsId/draggedFolderId instead, so those
    // are excluded here — this helper only reports tab drags.
    const getSidebarTabDragId = () => {
      if (window.draggedWsId || window.draggedFolderId) return null;
      return window.draggedTermId || null;
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
      showPrompt('New workspace', nextWorkspaceName(), { color: '', icon: '' }, (value, color, icon) => {
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
        if (e.dataTransfer.types.includes(THREAD_DRAG)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          clearDropMarks();
          btn.classList.add('drop-into');
          return;
        }
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
        if (e.dataTransfer.types.includes(THREAD_DRAG)) {
          e.preventDefault();
          e.stopPropagation();
          clearDropMarks();
          const tab = findChatThread(e.dataTransfer.getData(THREAD_DRAG));
          if (!tab) return;
          // Move the thread into this workspace without switching to it.
          if (!tab._closed) { if (moveTabToWorkspace(tab.id, wsp.id, { keepSource: true })) { saveState(); renderThreadsSidebar(); } return; }
          const back = activeWsId;
          openChatTab(tab, wsp);
          if (back && back !== activeWsId && findWs(back)) activateWorkspace(back);
          return;
        }
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

  /* ── Chat tabs ──
     Each Chat tab is its own thread: its chat (tab.chat: agent sessions, picks, title) and the
     agent it runs in its own terminal. Its page shows the sessions' transcripts and sends
     messages to that agent. A workspace can hold any number of Chat tabs. */
  const THREAD_HARNESSES = [
    // color: the brand color of the logo; none = a black/white logo, drawn in the text color.
    { id: 'claude', name: 'Claude Code', bin: 'claude', color: '#D97757' },
    { id: 'codex', name: 'Codex', bin: 'codex' },
    { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', color: '#8E75B2', retired: true },
    { id: 'antigravity', name: 'Antigravity CLI', bin: 'agy' },
    { id: 'opencode', name: 'OpenCode', bin: 'opencode' },
    { id: 'cursor-agent', name: 'Cursor Agent', bin: 'cursor-agent' },
    { id: 'copilot', name: 'Copilot CLI', bin: 'copilot' },
    { id: 'amp', name: 'Amp', bin: 'amp' },
    { id: 'qwen', name: 'Qwen Code', bin: 'qwen', color: '#6950EF' },
    { id: 'aider', name: 'Aider', bin: 'aider' },
  ];
  const harnessOf = id => THREAD_HARNESSES.find(h => h.id === id);
  const _tabAgent = new Map(); // termId -> harness running there at the last check

  let _watching = false;
  async function watchThreadAgents() {
    if (_watching) return;
    _watching = true;
    try {
      // Every terminal is asked at once (one at a time, a tab's logo lagged behind the others).
      const tabs = workspaces.flatMap(ws => getWorkspaceTerminals(ws).filter(isLiveTerminal).map(t => ({ ws, t })));
      const names = await Promise.all(tabs.map(async ({ t }) => {
        const info = window.electronAPI?.terminalHasRunningProcess
          ? await window.electronAPI.terminalHasRunningProcess(t.id).catch(() => null)
          : { name: await checkTerminalRunning(t.id) };
        // The Windows process table can list an agent for ~3s after it exited: confirm with the OS.
        const dead = info?.pid && window.electronAPI?.processAlive && !(await window.electronAPI.processAlive(info.pid).catch(() => true));
        return dead ? '' : String(info?.name || '').toLowerCase().replace(/\.(exe|cmd)$/, '');
      }));
      for (const [i, { ws, t }] of tabs.entries()) {
        if (!isLiveTerminal(t)) continue;
        if (t._sdk?.alive) {
          delete t._terminalQuestionKey;
          syncTabAgentIcon(t);
          continue; // structured sessions report questions through their own events
        }
        const h = THREAD_HARNESSES.find(x => x.bin === names[i]);
        // An agent the chat just launched may not be the terminal's foreground process yet: keep its logo.
        if (!h && t._agentSince && Date.now() - t._agentSince < 8000) continue;
        const before = _tabAgent.get(t.id);
        _tabAgent.set(t.id, h?.id || null);
        trackTerminalQuestion(t, h ? agentQuestion(t) : null);
        t._agentExited = !h && (!!before || !!t._agentExited); // an agent quit here: its logo goes too
        syncTabAgentIcon(t); // also catches agents the chat started itself
        if (h && before !== h.id && t.threadHistory) await adoptThreadAgent(t, h, ws); // typed into the Chat tab's own terminal
        // The permission mode can change inside Claude Code (Shift+Tab, leaving plan mode): the picker follows it.
        // Only a change seen in the footer is taken, so a pick waiting for the next message isn't overwritten.
        const mode = h?.id === 'claude' && t.threadHistory && t._chatCfg && !t._modeSwitching ? claudeFooterMode(t) : null;
        if (mode && mode !== t._footerMode) {
          t._footerMode = mode;
          if (t._chatCfg.access !== mode) { t._chatCfg.access = mode; setChatOpts(t, { access: mode }); }
        }
      }
    } finally { _watching = false; }
  }
  setInterval(() => { if (!SETTINGS_ONLY) watchThreadAgents(); }, 1500);
  // Claude Code's permission mode, read from its footer: "⏵⏵ auto mode on", "⏸ plan mode on", "⏸ manual mode on"
  // (asks first). The footer is the last mode line on the screen: it sits mid-screen while the conversation is
  // short, so the whole screen is read. null when no footer is showing (a dialog covers it).
  const CLAUDE_FOOTER_MODES = { 'auto mode': 'auto', 'accept edits': 'acceptEdits', 'plan mode': 'plan', 'bypass permissions': 'bypassPermissions', 'manual mode': 'default' };
  function claudeFooterMode(t) {
    const b = t.term?.buffer?.active, rows = t.term?.rows;
    if (!b || !rows) return null;
    for (let y = b.baseY + rows - 1; y >= b.baseY; y--) {
      const m = /^\s*(?:⏵⏵|⏸)\s*(auto mode|accept edits|plan mode|bypass permissions|manual mode) on\b/i.exec(b.getLine(y)?.translateToString(true) || '');
      if (m) return CLAUDE_FOOTER_MODES[m[1].toLowerCase()];
    }
    return null;
  }

  // ── Threads sidebar footer: one quota window per agent, with a shared display preference;
  // the tooltip lists every window. Read through the agents' own CLIs (main process, cached 1 min). ──
  const fmtLeft = ms => { const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };
  let _usageAt = 0, _usageLimits = null, _usageRequestId = 0;
  async function refreshUsageLimits(force = false, fresh = false) {
    const api = window.electronAPI;
    if (!api?.usageLimits || SETTINGS_ONLY || (!force && Date.now() - _usageAt < 60000)) return _usageLimits;
    const requestId = ++_usageRequestId;
    const limits = await api.usageLimits(fresh).catch(() => null);
    if (requestId !== _usageRequestId) return _usageLimits;
    _usageAt = limits ? Date.now() : 0;
    _usageLimits = limits;
    if (_usageModal) renderUsageModal();
    renderUsageSidebar();
    return limits;
  }
  const usageRemaining = () => threadSettings.usageDisplay === 'remaining';
  const usagePercent = used => usageRemaining() ? 100 - Math.min(100, Math.max(0, used)) : Math.min(100, Math.max(0, used));
  const usageWindows = { weekly: 'Weekly', session: 'Session', monthly: 'Monthly' };
  const usageProviderIds = ['claude', 'codex', 'antigravity'];
  const hiddenUsageProviders = () => new Set(Array.isArray(threadSettings.hiddenUsageProviders) ? threadSettings.hiddenUsageProviders : []);
  const usageChartIcon = '<i class="ph ph-chart-bar sb-usage-open" aria-hidden="true"></i>';
  const monthlyUsage = w => w.mins === 43200 || /^monthly$/i.test(w.label);
  function sidebarUsageWindow(windows, preferred) {
    const weekly = windows.find(w => w.mins === 10080 && /^weekly$/i.test(w.label))
      || windows.find(w => /^weekly$/i.test(w.label))
      || windows.find(w => w.mins === 10080 || /^weekly\b/i.test(w.label));
    if (preferred === 'session') {
      const session = windows.find(w => w.mins === 300 || /^session$/i.test(w.label));
      if (session) return session;
    }
    if (preferred === 'monthly') {
      const monthly = windows.find(monthlyUsage);
      if (monthly) return monthly;
    }
    return weekly || windows.reduce((a, b) => b.used > a.used ? b : a);
  }
  function renderUsageSidebar(animate = false) {
    const left = document.getElementById('ts-usage');
    if (!left) return;
    const previous = new Map();
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const ring of left.querySelectorAll('.sb-usage-item[data-usage-agent]')) {
        previous.set(ring.dataset.usageAgent, getComputedStyle(ring).getPropertyValue('--p'));
      }
    }
    const label = usageRemaining() ? 'remaining' : 'consumed';
    const windowLabel = usageWindows[threadSettings.usageWindow] || usageWindows.weekly;
    left.setAttribute('aria-label', `Usage limits, ${windowLabel.toLowerCase()}, ${label}`);
    const ids = Object.entries(_usageLimits || {}).filter(([id, u]) => harnessOf(id) && u.windows?.length).map(([id]) => id);
    if (_usageLimits) try { localStorage.setItem('tv-usage-agents', JSON.stringify(ids)); } catch {}
    // The first reading after the startup placeholders fades in (rings sweep from empty); later refreshes don't.
    const reveal = left.classList.contains('loading');
    left.classList.remove('loading');
    left.classList.toggle('reveal', reveal);
    const hidden = hiddenUsageProviders();
    const items = ids.filter(id => !hidden.has(id)).map(id => {
      const h = harnessOf(id), u = _usageLimits[id];
      const top = sidebarUsageWindow(u.windows, threadSettings.usageWindow);
      const rows = u.windows.map(w => ({ icon: 'ph-clock', text: `${w.label}: ${usagePercent(w.used)}% ${label}${w.resetsAt ? ` · resets in ${fmtLeft(w.resetsAt - Date.now())}` : ''}` }));
      const plan = u.plan ? ' · ' + u.plan[0].toUpperCase() + u.plan.slice(1) : '';
      // Gauge and percentage use the selected mode; warnings always reflect consumed quota.
      return `<span class="sb-usage-item${top.used >= 90 ? ' full' : top.used >= 75 ? ' high' : ''}" style="--p:${usagePercent(top.used)}" data-usage-agent="${escHtml(id)}" data-tip="${escHtml(h.name + plan + ' · ' + top.label + ': ' + usagePercent(top.used) + '% ' + label)}" data-tip-rows="${escHtml(JSON.stringify(rows))}">`
        + `<span class="sb-usage-ring"><span class="sb-usage-logo"${h.color ? ` style="color:${h.color}"` : ''}>${procIconHtml(h.bin, 'ph-robot')}</span></span>`
        + `<span class="sb-usage-pct">${usagePercent(top.used)}%</span></span>`;
    }).join('');
    // Keep the menu reachable even when every provider is hidden.
    left.hidden = !ids.length && !hidden.size;
    left.innerHTML = left.hidden ? '' : items + usageChartIcon;
    if (previous.size) {
      for (const ring of left.querySelectorAll('.sb-usage-item[data-usage-agent]')) {
        const from = previous.get(ring.dataset.usageAgent);
        const to = ring.style.getPropertyValue('--p');
        if (from !== undefined && Number(from) !== Number(to)) {
          ring.animate([{ '--p': from }, { '--p': to }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      }
    }
  }
  // Usage modal: every agent's limit windows, shown in the selected display mode,
  // with an even-pace marker, reset time, and trend based on the remaining quota.
  let _usageModal = null, _usageReturnFocus = null, _usageLoading = false;
  function renderUsageModal() {
    const body = _usageModal?.querySelector('.um-body');
    if (!body) return;
    const sections = Object.entries(_usageLimits || {}).map(([id, u]) => {
      const h = harnessOf(id);
      if (!h || !u.windows?.length) return '';
      const cards = u.windows.map(w => {
        const left = 100 - Math.min(100, Math.max(0, w.used));
        const value = usagePercent(w.used), label = usageRemaining() ? 'remaining' : 'consumed';
        const pace = w.resetsAt && w.mins ? Math.max(0, Math.min(100, (w.resetsAt - Date.now()) / (w.mins * 60000) * 100)) : null;
        const [trend, trendTip] = pace == null ? ['ph-gauge', ''] : left < pace - 5 ? ['ph-trend-down', 'Using it faster than it resets'] : left > pace + 5 ? ['ph-trend-up', 'Under pace: it lasts until the reset'] : ['ph-gauge', 'On pace'];
        return `<div class="um-card"><div class="um-stat"><div class="um-label">${escHtml(w.label)}</div>`
          + `<div class="um-big"><span class="um-num">${value}%</span><span class="um-left">${label}</span><i class="ph ${trend} um-trend" aria-hidden="true"${trendTip ? ` title="${trendTip}"` : ''}></i></div></div>`
          + `<div class="um-bar" role="img" aria-label="${value}% ${label}${w.resetsAt ? `, resets in ${fmtLeft(w.resetsAt - Date.now())}` : ''}"><div class="um-fill" style="width:${value}%"></div>`
          + (pace != null ? `<div class="um-pace" style="left:${usageRemaining() ? pace : 100 - pace}%" title="Even pace: ${Math.round(usageRemaining() ? pace : 100 - pace)}% ${label} now"></div>` : '')
          + (w.resetsAt ? `<span class="um-reset"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i>${fmtLeft(w.resetsAt - Date.now())}</span>` : '') + '</div></div>';
      }).join('');
      const plan = u.plan ? `<span class="um-plan">${escHtml(u.plan[0].toUpperCase() + u.plan.slice(1))}</span>` : '';
      // Antigravity has no brand color of its own (its logo is an image): a lavender whose bar fill is #39334f.
      return `<section class="um-agent" style="--um-agent:${h.color || (id === 'antigravity' ? '#9784db' : 'var(--fg)')}"><div class="um-agent-head"><span class="um-logo">${procIconHtml(h.bin, 'ph-robot')}</span><span>${escHtml(h.name)}</span>${plan}</div>${cards}</section>`;
    }).join('');
    body.innerHTML = sections || (_usageLoading
      ? '<div class="um-empty"><i class="ph ph-circle-notch um-spin" aria-hidden="true"></i>Reading usage…</div>'
      : '<div class="um-empty"><i class="ph ph-chart-bar" aria-hidden="true"></i>No usage limits to show. Claude Code, Codex and Antigravity CLI report them when signed in.</div>');
    _usageModal.querySelector('[data-act="refresh"]')?.classList.toggle('busy', _usageLoading);
  }
  async function loadUsageModal(fresh) {
    _usageLoading = true; renderUsageModal();
    try { await refreshUsageLimits(true, fresh); } finally { _usageLoading = false; renderUsageModal(); }
  }
  function closeUsageModal() {
    if (!_usageModal) return;
    const el = _usageModal; _usageModal = null;
    el.classList.add('closing'); // fades out when UI animations are on; 0s otherwise
    setTimeout(() => el.remove(), parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0);
    _usageReturnFocus?.focus?.(); _usageReturnFocus = null;
  }
  function openUsageModal() {
    if (_usageModal) { closeUsageModal(); return; }
    if (!window.electronAPI?.usageLimits) { zoomBadge('Usage limits need the desktop app'); return; }
    _usageReturnFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = 'usage-overlay';
    overlay.innerHTML = `<div id="usage-modal" role="dialog" aria-modal="true" aria-labelledby="usage-title">
      <div class="um-head"><span class="um-crumb" id="usage-title">Usage</span><span class="um-sep" aria-hidden="true">/</span><span class="um-crumb current">Limits</span>
        <button type="button" class="um-icon" data-act="refresh" title="Refresh" aria-label="Refresh"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i></button>
        <button type="button" class="um-icon" data-act="close" title="Close (Esc)" aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button></div>
      <div class="um-body"></div></div>`;
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeUsageModal(); });
    overlay.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') closeUsageModal();
      else if (act === 'refresh' && !_usageLoading) void loadUsageModal(true);
    });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeUsageModal(); } });
    document.body.appendChild(overlay);
    _usageModal = overlay;
    overlay.querySelector('[data-act="close"]').focus();
    void loadUsageModal(true); // opening the details always checks the providers again
  }
  const usageButton = document.getElementById('ts-usage');
  usageButton?.addEventListener('click', openUsageModal);
  function openUsageMenu(e) {
    e.preventDefault();
    usageButton.focus({ preventScroll: true });
    const rect = usageButton.getBoundingClientRect();
    const keyboard = e.type === 'keydown' || (!e.pageX && !e.pageY);
    showCtxMenu({ pageX: keyboard ? rect.right : e.pageX, pageY: keyboard ? rect.top : e.pageY, above: true, alignRight: true }, 'usage');
    ctxEl.querySelector('.ctx-item')?.focus();
  }
  usageButton?.addEventListener('contextmenu', openUsageMenu);
  usageButton?.addEventListener('keydown', e => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) openUsageMenu(e);
  });
  // From startup: the agents seen last time, as logos in empty rings, until the first reading arrives.
  function renderUsagePlaceholders() {
    if (!usageButton) return;
    let ids = null;
    try { ids = JSON.parse(localStorage.getItem('tv-usage-agents')); } catch {}
    const hidden = hiddenUsageProviders();
    const known = (Array.isArray(ids) ? ids : usageProviderIds).map(harnessOf).filter(Boolean);
    if (known.length || hidden.size) {
      usageButton.innerHTML = known.filter(h => !hidden.has(h.id)).map(h => `<span class="sb-usage-item" style="--p:0" data-tip="${escHtml(h.name)}: loading usage…">`
        + `<span class="sb-usage-ring"><span class="sb-usage-logo"${h.color ? ` style="color:${h.color}"` : ''}>${procIconHtml(h.bin, 'ph-robot')}</span></span>`
        + '<span class="sb-usage-pct">&nbsp;</span></span>').join('') + usageChartIcon;
      usageButton.classList.add('loading');
      usageButton.hidden = false;
    }
  }
  if (!SETTINGS_ONLY && window.electronAPI?.usageLimits) renderUsagePlaceholders();
  if (!SETTINGS_ONLY) { setTimeout(() => refreshUsageLimits(true), 3000); setInterval(() => refreshUsageLimits(false), 60000); }

  // A terminal running an agent becomes a Chat tab over that agent (the chat button in its tab bar).
  function openTerminalAsChat(t) {
    const h = harnessOf(_tabAgent.get(t.id));
    if (!h || t.threadHistory) return;
    t.threadHistory = true;
    t.el?.classList.remove('agent-tab');
    adoptThreadAgent(t, h, wsOf(t)).then(() => { _preferChat = t; syncThreadPanel(true); setChatView(t, false); });
  }
  // An agent started by hand in a Chat tab's terminal. The chat follows the session it opened:
  // one of this chat's (or --continue / --last of its latest) continues the thread; any other
  // (a new session, or one from elsewhere) starts a new thread, the old one stays in the threads list.
  async function adoptThreadAgent(term, h, ws) {
    const r = await window.electronAPI?.agentSettings?.(term.id, h.id).catch(() => null) || {};
    if (_tabAgent.get(term.id) !== h.id || findTermById(term.id)?.term !== term) return; // that agent is gone
    term.chat ||= { createdAt: Date.now() };
    const segs = threadSegments(term), latest = segs.findLast(x => x.used) || segs.at(-1);
    const own = (r.sessionId && segs.find(x => x.harness === h.id && x.sessionId === r.sessionId))
      || (r.resumeLast && latest?.harness === h.id ? latest : null);
    if (!own && threadHasMessages(term) && ws) splitChatThread(term, ws);
    if (own) term._chatSeg = own;
    else {
      // The tab's own folder: Claude/Codex transcripts are looked up by it.
      term._chatSeg = { harness: h.id, sessionId: r.sessionId || null, cwd: term.cwd || wsOf(term)?.cwd, since: Date.now() - 5000 };
      threadSegments(term).push(term._chatSeg);
    }
    term.toolProvider = h.id;
    // The chip shows what the agent really runs (unknown: its default); a message then goes to it, no restart.
    setChatOpts(term, { harness: h.id, model: r.model || 'default', effort: r.effort || 'default' });
    if (r.model) term._chatSeg.model = r.model;
    if (r.effort) term._chatSeg.effort = r.effort;
    term._chatCfg = { harness: h.id, ...chatOpts(term) };
    saveState();
    syncThreadPanel(true);
  }

  const wsOf = tab => tab && findTermById(tab.id)?.ws;
  // A chat's history is a list of agent sessions ("segments"), oldest first. `ws` here (and in the
  // chat functions below) is the Chat tab: it carries the chat, its folder (cwd) and its label.
  function threadSegments(ws) {
    const t = ws.chat;
    if (!t) return [];
    if (!Array.isArray(t.segments)) t.segments = t.harness ? [{ harness: t.harness, sessionId: t.sessionId, cwd: ws.cwd, since: t.since || t.createdAt, model: t.model, effort: t.effort }] : [];
    return t.segments;
  }

  const threadMeta = ws => ({ id: ws.chat?.storeId || ws.id, title: ws.chat?.title || ws.label, projectId: null, cwd: ws.cwd, createdAt: ws.chat?.createdAt,
    segments: threadSegments(ws).map(x => ({ harness: x.harness, sessionId: x.sessionId, cwd: x.cwd || ws.cwd, since: x.since, model: x.model, effort: x.effort, handoff: x.handoff,
      ...(x.frozen ? { frozen: true } : {}), ...(x.unsupported ? { unsupported: true } : {}) })) });

  // ── Right panel: thread flow ──
  let _threadPoll = null, _flowSig = '';
  // A prompt's image paths (attached or pasted) become link chips "image.png 18 KB" in its text;
  // the images themselves show above the bubble. Both open the image viewer.
  const _thrImgSize = new Map(); // attachment path -> bytes
  const _chatAttachmentStats = new Map();
  const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  function chatImageLinkHtml(file, attrs = '', extraClass = '') {
    const icon = file.image ? 'ph-image' : typeof linkFileIcon === 'function' ? linkFileIcon(file.name || file.path || '') : 'ph-file';
    return `<a href="#" class="thr-image-ref ${extraClass}" data-path="${escHtml(file.path || '')}" ${attrs} title="${escHtml(file.path || file.name)}"><span class="thr-inline-image-icon">${file.image && file.preview ? `<img src="${escHtml(file.preview)}" alt="">` : `<i class="ph ${icon}" aria-hidden="true"></i>`}</span><span>${escHtml(file.name)}</span><small class="thr-img-size" data-size-path="${escHtml(file.path || '')}">${file.size ? escHtml(fmtBytes(file.size).replace(' ', '')) : ''}</small></a>`;
  }
  function queuedMessageTextHtml(message) {
    let text = message.typed || '';
    const links = [];
    for (const [i, file] of (message.files || []).entries()) {
      const attachment = !!file.path && !file.cite && !file.at && !file.thread;
      const replacement = attachment ? `\u0000I${links.length}\u0000` : file.cite ? '“' + file.cite.replace(/\s+/g, ' ').slice(0, 80) + '”' : file.name;
      if (attachment) links.push(chatImageLinkHtml(file, `data-queue-act="preview" data-file-i="${i}"`));
      if (file.mention && text.includes(file.mention)) text = text.split(file.mention).join(replacement);
      else if (attachment) text += (text ? ' ' : '') + replacement;
    }
    if (!text) text = message.files?.map(f => f.name || f.cite).join(', ') || message.text || '';
    return escHtml(text).replace(/\u0000I(\d+)\u0000/g, (_, i) => links[i] || '');
  }
  function userTextHtml(text, threads = []) {
    // Threads dropped in as context: from the transcript (threads) or a pending message's own notes.
    const refs = [...threads, ...[...String(text).matchAll(/<terminalvibe_context thread="([^"]*)">“([^”]*)”/g)].map(m => ({ path: m[1], title: m[2] }))];
    text = String(text).replace(/\s*<terminalvibe_context\b[\s\S]*?<\/terminalvibe_context>\s*$/, '');
    // Leading "> " blocks are citations (quoted from the chat): truncated chips above the prompt.
    const lines = String(text).split('\n'), quotes = [];
    while (lines.length && lines[0].startsWith('>')) {
      const block = [];
      while (lines.length && lines[0].startsWith('>')) block.push(lines.shift().replace(/^> ?/, ''));
      quotes.push(block.join('\n'));
      while (lines.length && !lines[0].trim()) lines.shift();
    }
    text = lines.join('\n');
    const cites = quotes.map(q => `<span class="thr-cite" title="${escHtml(q)}"><i class="ph ph-quotes" aria-hidden="true"></i><span>${escHtml(q.replace(/\s+/g, ' '))}</span></span>`).join('');
    const paths = [], attachments = [];
    const marked = String(text).replace(new RegExp(ATTACHMENT_PATH_RE.source, 'gi'), (m, q, quoted, bare) => {
      const path = quoted || bare;
      attachments.push(path);
      if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(path)) paths.push(path);
      return `\u0000I${attachments.length - 1}\u0000`;
    });
    // Each “title” of a dropped thread shows as a link to it (its history file sits in the thread's folder).
    const markedRefs = refs.reduce((out, r, n) => out.split(`“${r.title}”`).join(`\u0000T${n}\u0000`), marked);
    const html = mdLite(markedRefs).replace(/\u0000T(\d+)\u0000/g, (_, n) => {
      const r = refs[n], key = r.path.split(/[\\/]/).slice(-2, -1)[0] || '';
      return `<a href="#" class="thr-thread-mention" data-thread-key="${escHtml(key)}" title="Thread: ${escHtml(r.title)}"><i class="ph ph-chats-circle" aria-hidden="true"></i><span>${escHtml(r.title)}</span></a>`;
    }).replace(/\u0000I(\d+)\u0000/g, (_, n) => {
      return `<span class="thr-inline-ref">${chatImageReferenceHtml({ path: attachments[n] })}</span>`;
    }).trim();
    return { html: (cites ? `<div class="thr-cites">${cites}</div>` : '') + html, paths };
  }
  const _pendingMsgs = new Map(); // chat tab id -> { text, at }: sent, not in the transcript yet
  const _chatSending = new Set();
  const _queueDraining = new Set();
  const _turns = new Map(); // chat tab id -> { since, sawBusy }: a sent message whose answer is still coming
  const fmtSecs = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  // Is the workspace's agent working on a turn? Claude Code says so in its terminal title;
  // Codex is judged by its output during a turn sent from the chat.
  function chatWorking(ws) {
    if (!ws || ws._closed) return null;
    let turn = _turns.get(ws.id);
    const lockedBy = liveThreadAgent(ws) || ws;
    if (agentLocked(lockedBy)) return { label: `${harnessOf(_tabAgent.get(lockedBy.id))?.name || 'The agent'} has this conversation open in another app`, wait: true, lock: true, since: turn?.since || Date.now() };
    // A question waiting in the agent's terminal shows in the chat, with its choices.
    const ask = agentQuestion(liveThreadAgent(ws));
    if (ask) return { ask, label: 'Waiting for your answer', wait: true, since: turn?.since || Date.now() };
    const starting = _chatStarting.get(ws.id);
    if (turn && starting) return { label: starting.text, wait: starting.wait, since: turn.since };
    const t = liveThreadAgent(ws), sdk = t?._sdk?.alive ? t._sdk : null;
    const codex = t && _tabAgent.get(t.id) === 'codex', status = ws._chatTurnState;
    const busy = sdk ? sdk.busy : !!t && (t._agentWorking || (codex && status?.status === 'working') || (!!turn && _tabAgent.get(t.id) !== 'claude' && Date.now() - (t._lastOut || 0) < 2000));
    // A sent turn ends when the agent, seen working, is idle again (or, never seen working,
    // once the message is in the transcript).
    if (turn && busy) turn.sawBusy = true;
    // (A turn too quick for the 1s checks shows as Claude's title going idle after the message was typed in.)
    const finished = sdk ? (sdk.idleAt || 0) >= (turn?.sentAt || turn?.since || 0)
      : codex ? status && status.status !== 'working' && status.at >= (turn?.sentAt || turn?.since || 0)
      : turn && (turn.sawBusy || (turn.sentAt && t?._idleAt > turn.sentAt + 300) || (!_pendingMsgs.has(ws.id) && Date.now() - turn.since > 1500));
    if (turn && !busy && finished) { _turns.delete(ws.id); turn = null; }
    if (!busy && !turn) return null;
    return { label: 'Thinking', since: turn ? turn.since : (t._workSince || Date.now()) };
  }
  // The user can't switch chat ⇄ terminal mid-turn (a question or lock waiting on them still can).
  function viewSwitchBlocked(tab) {
    const w = tab.threadHistory ? chatWorking(tab) : tab._agentWorking && {};
    if (!w || w.wait) return false;
    zoomBadge(`${harnessOf(_tabAgent.get(tab.id))?.name || 'The agent'} is working, switch once it finishes`);
    return true;
  }
  // A Chat tab shows the chat, or (the footer button) the terminal its agent runs in.
  // The tab bar's chat button brings the chat back.
  function setChatView(tab, cli) {
    if (!tab?.threadHistory) return;
    if (cli) delete tab._chatShellUnused;
    if (cli && curChat() === tab) rememberThreadScroll(tab);
    tab._cliView = !!cli;
    tab.el?.classList.toggle('chat-cli', !!cli);
    if (thrPage.parentElement === tab.el) thrPage.style.display = cli ? 'none' : 'flex';
    if (cli) {
      requestAnimationFrame(() => {
        if (!tab._cliView || !tab.el?.offsetParent) return;
        _syncWebgl(tab, true);
        fitTerm(tab); tab.term.refresh(0, tab.term.rows - 1); tab.term.focus();
      });
      void ensureChatTerminalSession(tab);
    }
    else { if (curChat() === tab) { restoreThreadScroll(tab); refreshThreadFlow(tab); syncThreadComposer(tab); } thrInput.focus(); }
  }
  function disposeChatBottomTerminal(owner) {
    const entry = owner?._bottomTerminal;
    if (!entry) return;
    delete owner._bottomTerminal;
    entry._finishBottomResize?.(false);
    sendControl({ type: 'close', id: entry.id });
    clearTimeout(entry._resizeTimeout);
    cancelAnimationFrame(entry._fitObserverRaf);
    _termFitObserver.unobserve(entry.el);
    _disposeTermRenderers(entry.term);
    entry.term.dispose();
    entry.el.remove();
    owner.el?.classList.remove('chat-bottom-open');
  }
  function bindChatBottomResize(owner, entry) {
    const panel = entry.el;
    const sash = panel.querySelector('.chat-bottom-sash');
    const body = panel.querySelector('.chat-bottom-body');
    const screen = panel.querySelector('.chat-bottom-screen');
    const min = 10, max = 75;
    let height = Number.parseFloat(owner.el.style.getPropertyValue('--chat-terminal-height')) || 35;
    let drag = null, frame = 0, pendingHeight;
    const setHeight = value => {
      const next = Math.max(min, Math.min(max, Math.round(value * 100) / 100));
      if (next === height && sash.hasAttribute('aria-valuenow')) return;
      height = next;
      owner.el.style.setProperty('--chat-terminal-height', height + '%');
      sash.setAttribute('aria-valuenow', String(Math.round(height)));
      if (drag) {
        const visibleHeight = drag.bodyHeight + (height - drag.height) * drag.paneHeight / 100;
        const offset = Math.max(0, drag.cursorBottom - visibleHeight);
        panel.style.setProperty('--chat-terminal-grid-offset', -offset + 'px');
      }
    };
    sash.setAttribute('aria-valuemin', String(min));
    sash.setAttribute('aria-valuemax', String(max));
    setHeight(height);
    sash.addEventListener('pointerdown', e => {
      if (drag || e.button !== 0) return;
      const paneHeight = owner.el.clientHeight;
      if (!paneHeight) return;
      e.preventDefault();
      sash.setPointerCapture(e.pointerId);
      const bodyHeight = body.clientHeight;
      const buffer = entry.term.buffer?.active;
      const gridHeight = screen.querySelector('.xterm-screen')?.offsetHeight || bodyHeight;
      // Keep the top row steady. Only shift the frozen grid if shrinking would clip the live cursor.
      const cursorBottom = buffer && buffer.viewportY === buffer.baseY
        ? (buffer.cursorY + 1) * gridHeight / entry.term.rows : 0;
      drag = { id: e.pointerId, y: e.clientY, height, paneHeight, bodyHeight, cursorBottom };
      pendingHeight = height;
      // Keep xterm's grid and canvas intact while the surrounding viewport moves.
      panel.style.setProperty('--chat-terminal-grid-height', bodyHeight + 'px');
      entry._draggingBottomTerminal = true;
      panel.classList.add('resizing');
      sash.classList.add('dragging');
    });
    sash.addEventListener('pointermove', e => {
      if (drag?.id !== e.pointerId) return;
      pendingHeight = drag.height + (drag.y - e.clientY) * 100 / drag.paneHeight;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        setHeight(pendingHeight);
      });
    });
    const finish = entry._finishBottomResize = (fit = true) => {
      if (!drag) return;
      const pointerId = drag.id;
      drag = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setHeight(pendingHeight);
      delete entry._draggingBottomTerminal;
      panel.classList.remove('resizing');
      panel.style.removeProperty('--chat-terminal-grid-height');
      panel.style.removeProperty('--chat-terminal-grid-offset');
      sash.classList.remove('dragging');
      if (sash.hasPointerCapture(pointerId)) sash.releasePointerCapture(pointerId);
      if (fit) fitTerm(entry, true);
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      sash.addEventListener(event, e => {
        if (drag?.id === e.pointerId) finish();
      });
    }
    sash.addEventListener('keydown', e => {
      const next = { ArrowUp: height + 5, ArrowDown: height - 5, Home: min, End: max }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      setHeight(next);
    });
  }
  function toggleChatBottomTerminal(owner) {
    if (!owner?.threadHistory || owner._cliView || !wsReady) return;
    let entry = owner._bottomTerminal;
    if (!entry) {
      const wsp = findTermById(owner.id)?.ws;
      if (!wsp) return;
      entry = _createTermEntry(wsp, uuid(), 'Terminal');
      entry._chatOwner = owner;
      entry.cwd = chatCwd(owner) || null;
      owner._bottomTerminal = entry;
      const panel = document.createElement('section');
      panel.className = 'chat-bottom-terminal';
      panel.id = 'slot-' + entry.id;
      panel.setAttribute('aria-label', 'Project terminal');
      panel.innerHTML = '<div class="chat-bottom-sash" role="separator" tabindex="0" aria-label="Resize project terminal" aria-orientation="horizontal"></div>'
        + '<div class="chat-bottom-header"><span>Terminal</span><button type="button" aria-label="Hide terminal (Ctrl+J)" title="Hide terminal (Ctrl+J)"><i class="ph ph-x" aria-hidden="true"></i></button></div><div class="chat-bottom-body"><div class="chat-bottom-screen"></div></div>';
      owner.el.append(panel);
      entry.el = panel;
      bindChatBottomResize(owner, entry);
      entry.term.open(panel.querySelector('.chat-bottom-screen'));
      setupTerminalWheel(entry);
      entry.opened = true;
      // Keep the chat as the active tab when its shell receives focus.
      panel.addEventListener('mousedown', e => { e.stopPropagation(); focusSlot(owner); });
      panel.querySelector('button').addEventListener('click', () => toggleChatBottomTerminal(owner));
      panel.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation(); // not the chat's or the tab's menu
        showCtxMenu(e, 'chat-terminal', { entry, owner });
      });
      owner.el.classList.add('chat-bottom-open');
      _termFitObserver.observe(panel);
      fitTerm(entry, true);
      sendControl({ type: 'create', id: entry.id, cols: entry.term.cols, rows: entry.term.rows, cwd: entry.cwd });
    } else {
      entry.el.hidden = !entry.el.hidden;
      if (entry.el.hidden) entry._finishBottomResize(false);
      owner.el.classList.toggle('chat-bottom-open', !entry.el.hidden);
    }
    if (entry.el.hidden) { owner.term.focus(); return; }
    requestAnimationFrame(() => { fitTerm(entry, true); entry.term.focus(); });
  }
  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.key.toLowerCase() !== 'j') return;
    const owner = activeTerminal();
    if (!owner?.threadHistory || owner._cliView || !owner.el?.offsetParent) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) toggleChatBottomTerminal(owner);
  }, true);
  // An agent finished its turn: update the chat now, not on the next poll.
  function chatAgentIdle(entry) {
    void refreshUsageLimits();
    if (curChat() !== entry || !thrPage.offsetParent) return;
    _flowSig = '';
    refreshThreadFlow(entry);
    syncWorking(entry);
  }
  // The "Thinking · 4s" row at the end of the chat (kept out of the history render so it can tick).
  function syncWorking(ws, surface = thrPage) {
    const flow = surface.querySelector('.thr-flow');
    const w = chatWorking(ws);
    // The agent's question: a tray on the composer's top edge (like the side chats tray), one row per choice.
    const askEl = threadPart(surface, 'ask');
    if (askEl) {
      // Header row (the question's short header, e.g. "Task"; the caret folds the tray), the question, then one row per
      // choice: a radio (checkbox for multi-select), the label with its description below, the number key at the right.
      const a = w?.ask;
      const head = a && (a.header || (/^allow\b/i.test(a.question) ? 'Permission' : 'Question'));
      const askHtml = a ? `<button type="button" class="thr-ask-head" aria-expanded="true"><span>${escHtml(head)}</span><i class="ph ph-caret-down" aria-hidden="true"></i></button>`
        + `<div class="thr-ask-q">${escHtml(a.question)}</div>`
        + (a.detail.length ? `<div class="thr-ask-detail">${a.detail.map(escHtml).join('<br>')}</div>` : '')
        + a.options.map((o, i) => o.submit
          ? `<button type="button" class="thr-ask-submit" data-ask-i="${i}"><i class="ph ph-check" aria-hidden="true"></i><span>Submit</span></button>`
          : o.input
          ? `<label class="thr-ask-opt thr-ask-field"><span class="thr-ask-radio" aria-hidden="true"></span><input type="text" data-ask-i="${i}" placeholder="Type something" aria-label="Your answer" spellcheck="false"><span class="thr-ask-key">${o.key}</span></label>`
          : `<button type="button" class="thr-ask-opt" data-ask-i="${i}"${o.checked !== undefined ? ` role="checkbox" aria-checked="${o.checked}"` : ''}>`
            + (o.checked !== undefined ? `<span class="thr-ask-box${o.checked ? ' on' : ''}"><i class="ph ph-check" aria-hidden="true"></i></span>` : '<span class="thr-ask-radio" aria-hidden="true"></span>')
            + `<span class="thr-ask-text"><span class="thr-ask-label">${escHtml(o.label)}</span>${o.desc ? `<span class="thr-ask-desc">${escHtml(o.desc)}</span>` : ''}</span>`
            + (o.key != null && o.checked === undefined ? `<span class="thr-ask-key">${o.key}</span>` : '') + '</button>').join('') : '';
      if (askEl._q !== a?.question) askEl.classList.remove('folded'); // a new question opens unfolded
      // A redraw while typing an answer would wipe it: the tray keeps its field until the question changes.
      const typing = askEl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && askEl._q === a?.question;
      askEl.hidden = !askHtml;
      if (askEl._html !== askHtml && !typing) { askEl._html = askHtml; askEl._q = a?.question; askEl.innerHTML = askHtml; }
    }
    let el = flow.querySelector('.thr-working');
    if (!w) { el?.remove(); renderChatQueue(ws, surface); renderChatResume(ws, surface); return; }
    const atBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1;
    if (!el) { el = document.createElement('div'); el.className = 'thr-working'; el.setAttribute('role', 'status'); }
    const queue = threadPart(surface, 'queue');
    if (queue) { if (el.nextElementSibling !== queue) flow.insertBefore(el, queue); }
    else if (el !== flow.lastElementChild) flow.appendChild(el);
    el.classList.toggle('wait', !!w.wait);
    el.classList.toggle('lock', !!w.lock);
    const html = w.lock ? `<i class="ph ph-lock-simple" aria-hidden="true"></i><span>${escHtml(w.label)}</span>`
        + `<span class="thr-lock-actions">${window.electronAPI?.releaseAgentSession ? '<button type="button" class="thr-lock-btn primary" data-lock-act="take">Take over</button>' : ''}`
        + `<button type="button" class="thr-lock-btn" data-lock-act="retry">Retry</button></span>`
      : w.wait ? `<i class="ph ph-hand-pointing" aria-hidden="true"></i><span>${escHtml(w.label)}</span>`
      : `<span class="thr-shimmer">${escHtml(w.label)}</span><span class="thr-working-time">${fmtSecs(Math.max(0, Math.round((Date.now() - w.since) / 1000)))}</span>`;
    if (el._html !== html) { el._html = html; el.innerHTML = html; }
    if (atBottom) flow.scrollTop = flow.scrollHeight;
    renderChatQueue(ws, surface);
    renderChatResume(ws, surface);
  }
  const pendingMessages = ws => { const p = _pendingMsgs.get(ws.id); return p ? (Array.isArray(p) ? p : [p]) : []; };
  function threadImagesHtml(paths) {
    return paths.length ? `<div class="thr-images">${[...new Set(paths)].map(path =>
      `<div class="thr-img-wrap"><img class="thr-img" data-path="${escHtml(path)}" alt="Pasted image"></div>`).join('')}</div>` : '';
  }
  const pendingHtml = ws => pendingMessages(ws).map(p => {
    const user = userTextHtml(p.text);
    const images = threadImagesHtml([...(p.imagePaths || []), ...user.paths]);
    return `<div class="thr-msg user thr-pending" data-ts="${p.at}">${p.steer ? '<span class="thr-pending-kind">Steered</span>' : ''}${images}${user.html ? `<div class="thr-bubble"><div class="thr-msg-text">${user.html}</div></div>` : ''}</div>`;
  }).join('');
  const _thrImgCache = new Map(); // saved image path -> data URL, so a re-render doesn't re-read files
  // A chat is a tab (its history + a message box); a workspace can hold any number of them.
  // ponytail: it is a terminal tab whose shell sits under the page until the chat starts its agent
  // there; a real non-terminal tab type if the idle shell ever matters.
  function newChatTab(ws, groupId, harness, project) {
    if (!ws) return;
    if (activeWsId !== ws.id) activateWorkspace(ws.id);
    const tab = addTerminal(ws.id, groupId, { label: 'Chat', threadHistory: true, cwd: project });
    if (!tab) return;
    tab._chatShellUnused = true;
    const scratch = project === null || (project === undefined && threadSettings.folder !== 'workspace');
    tab.chat = { createdAt: Date.now(), ...(project ? { cwd: project } : scratch ? { scratch: true } : {}) };
    harness ||= CHAT_AGENTS[threadSettings.harness] && !harnessOf(threadSettings.harness)?.retired ? threadSettings.harness : '';
    if (harness) setChatOpts(tab, { harness });
    _preferChat = tab;
    syncThreadPanel(true);
    if (project !== undefined) saveState();
    thrInput.focus();
    return tab;
  }
  // A thread belongs to no workspace: it opens in the current one (an open tab moves here, agent and all).
  function openChatTab(tab, destination) {
    if (tab?._closed) {
      const ws = destination || activeWs() || findWs(tab.workspaceId) || workspaces.find(w => w.cwd && w.cwd === tab.cwd);
      if (!ws) return;
      if (activeWsId !== ws.id) activateWorkspace(ws.id);
      const reopened = addTerminal(ws.id, null, { label: tab.label || 'Chat', cwd: tab.cwd, threadHistory: true });
      if (!reopened) return;
      reopened.chat = { ...tab.chat, storeId: tab.chat.storeId || tab.id };
      reopened._draft = tab._draft ?? tab.chat?.draft ?? ''; reopened._files = tab._files || tab.chat?.draftFiles || [];
      reopened._scrollState = tab._scrollState;
      closedThreads = closedThreads.filter(t => t !== tab);
      openChatTab(reopened, destination);
      thrInput.value = reopened._draft; _chatFiles = reopened._files;
      autosizeThreadInput(); renderChatFiles(); restoreThreadScroll(reopened);
      saveState();
      renderThreadsSidebar();
      return;
    }
    let ws = wsOf(tab);
    if (!ws) return;
    const here = destination || activeWs();
    if (here && here.id !== ws.id && moveTabToWorkspace(tab.id, here.id, { keepSource: !!destination })) ws = here;
    if (activeWsId !== ws.id) activateWorkspace(ws.id);
    activateTerminal(ws.id, tab.id);
    if (tab._cliView) setChatView(tab, false); // opened from the threads list: show the chat, not its shell
    _preferChat = tab;
    syncThreadPanel();
  }
  function rememberClosedThread(tab, ws) {
    if (_profileSwitching || !tab.threadHistory || !tab.chat) return;
    if (curChat() === tab) tab.chat.draft = thrInput.value;
    if (!threadHasMessages(tab) && !threadDraft(tab)) return; // an empty chat isn't a thread
    if (curChat() === tab) {
      rememberThreadScroll(tab);
      tab._draft = thrInput.value; tab._files = _chatFiles;
    }
    tab.chat.storeId ||= tab.id;
    if (tab.chat.queuedMessages?.some(message => !message.sendAt)) tab.chat.queuePaused = true;
    const saved = { id: tab.id, label: tab.label, cwd: tab.cwd || ws.cwd, workspaceId: ws.id, workspaceLabel: ws.label,
      threadHistory: true, _closed: true, chat: tab.chat, _draft: tab._draft || '',
      _files: tab._files || [], _scrollState: tab._scrollState };
    closedThreads = closedThreads.filter(t => (t.chat.storeId || t.id) !== saved.chat.storeId);
    closedThreads.push(saved);
  }
  // The Chat tab starts a fresh thread; its old one is kept like a closed tab's (own id and store).
  function splitChatThread(tab, ws) {
    rememberClosedThread(tab, ws);
    const saved = closedThreads[closedThreads.length - 1];
    if (saved?.chat === tab.chat) saved.id = uuid(); // the live tab keeps its id
    tab.chat = { createdAt: Date.now(), storeId: uuid(), ...(tab.chat.scratch ? { scratch: true } : {}) }; // the old thread keeps its scratch folder
    tab._chatSeg = null; tab._scrollState = null;
    _pendingMsgs.delete(tab.id); _turns.delete(tab.id);
    clearChatDraft(tab);
    setChatTabLabel(tab);
    if (curChat() === tab) _flowSig = '';
    saveState(); renderThreadsSidebar();
  }
  // Side chat (T3 Code's /side, /btw): a question about a thread without adding to it. It opens as a
  // chat tab next to the thread, forks the thread's agent session and starts with its picks; the
  // thread keeps working meanwhile. "Bring back" hands its history to the thread's next message.
  // ponytail: a tab in the same pane, not a side panel; split it off by dragging if wanted.
  async function openSideChat(parent, question, files = []) {
    const ws = wsOf(parent) || findWs(parent.workspaceId) || activeWs();
    if (!ws) return;
    const seg = threadSegments(parent).findLast(x => x.used && x.sessionId);
    const opts = chatOpts(parent);
    const tab = newChatTab(ws, findGroupContainingTerm(ws.layout, parent.id)?.id, opts.harness);
    if (!tab) return;
    const cwd = seg?.cwd || chatCwd(parent); // Claude keeps sessions per folder: fork in the thread's
    if (cwd) { tab.chat.cwd = cwd; delete tab.chat.scratch; } // shares the thread's folder, never owns it
    tab.chat.side = { parentId: threadKey(parent), harness: seg?.harness || null, sessionId: seg?.sessionId || null };
    setChatOpts(tab, opts);
    setChatTabLabel(tab);
    const text = chatMessageText(question, files);
    if (text) await deliverChatMessage(tab, { id: uuid(), text, typed: question, files, after: Date.now() });
  }
  // Fork a thread from a reply: a new Chat tab beside it holding the history up to that reply. TerminalVibe owns the
  // copy (frozen sessions in the fork's own thread folder, so deleting the parent never breaks it); the fork's first
  // message starts a new session that gets that history as a handoff, with any agent.
  async function forkChatAt(parent, seg, item) {
    const api = window.electronAPI, ws = wsOf(parent) || activeWs();
    if (!api?.threadFork || !ws || !parent?.chat || !Number.isInteger(seg) || !Number.isInteger(item)) return;
    const id = uuid(), title = ('Fork: ' + (parent.chat.title || parent.label || 'Chat')).slice(0, 80);
    let segments;
    try { segments = await api.threadFork({ meta: threadMeta(parent), seg, item, id, title }); }
    catch { zoomBadge('Could not fork this thread'); return; }
    const opts = chatOpts(parent), cwd = chatCwd(parent);
    const tab = newChatTab(ws, findGroupContainingTerm(ws.layout, parent.id)?.id, opts.harness);
    if (!tab) return;
    // The copied sessions count as said (so the first message hands them over), but are never resumed (frozen).
    Object.assign(tab.chat, { storeId: id, title, segments: segments.map(s => ({ ...s, used: true })), forkOf: threadKey(parent) });
    if (cwd) { tab.chat.cwd = tab.cwd = cwd; delete tab.chat.scratch; } // the parent's folder: shared, never owned
    setChatOpts(tab, opts);
    setChatTabLabel(tab);
    saveState();
    _flowSig = '';
    syncThreadPanel(true);
    renderThreadsSidebar();
  }
  async function bringBackSideChat(tab) {
    const parent = findThreadByKey(tab.chat?.side?.parentId);
    if (!parent) { zoomBadge('The main thread was deleted'); return; }
    let file = null;
    try { file = await window.electronAPI?.threadHandoff?.({ ...threadMeta(tab), names: Object.fromEntries(THREAD_HARNESSES.map(x => [x.id, x.name])) }); } catch {}
    if (!file) { zoomBadge('Could not write the side chat for the main thread'); return; }
    parent.chat ||= { createdAt: Date.now() };
    parent.chat.bringBack = file;
    saveState();
    openChatTab(parent);
    zoomBadge('The main thread gets this side chat with your next message there');
  }
  function findChatThread(id) {
    return findTermById(id)?.term || closedThreads.find(t => t.id === id);
  }
  // A chat's tab is named after its first prompt.
  // The agent running in a tab, as a logo before its name.
  function syncTabAgentIcon(t, el = document.querySelector(`.tg-tab[data-termid="${t.id}"]`)) {
    if (!el) return;
    // A plain terminal running an agent shows the tab bar's chat button (see openTerminalAsChat).
    t.el?.classList.toggle('agent-tab', !t.threadHistory && !!harnessOf(_tabAgent.get(t.id)));
    // A Chat tab whose agent quit while its terminal shows: no chat button there (it's a plain shell now).
    t.el?.classList.toggle('no-agent', !!t.threadHistory && !harnessOf(_tabAgent.get(t.id)));
    // The agent running there; a Chat tab with none running yet (e.g. right after startup, before it
    // resumes) shows its thread's latest agent, as the threads sidebar does.
    const h = (isLiveTerminal(t) ? harnessOf(_tabAgent.get(t.id)) : null)
      || (t.threadHistory && !t._agentExited ? harnessOf(threadSegments(t).findLast(x => x.used)?.harness || chatOpts(t).harness) : null); // a new chat: the agent it will start
    const key = h?.id || '';
    let icon = el.querySelector('.tg-tab-agent');
    if ((icon?.dataset.agent || '') !== key) {
      icon?.remove(); icon = null;
      if (!h) return;
      icon = document.createElement('span');
      icon.className = 'tg-tab-agent'; icon.dataset.agent = key; icon.setAttribute('aria-hidden', 'true');
      if (h.color) icon.style.color = h.color;
      icon.innerHTML = procIconHtml(h.bin, 'ph-robot');
      el.insertBefore(icon, el.querySelector('.tg-tab-name'));
    }
    // Gray until the agent is actually running in the tab (a new chat, or one not resumed yet).
    icon?.classList.toggle('idle', !(isLiveTerminal(t) && harnessOf(_tabAgent.get(t.id))));
    if (icon) {
      const status = t.threadHistory ? chatWorking(t) : t._agentWorking && !agentQuestion(t) && !agentLocked(t);
      icon.classList.toggle('working', !!status && !status.wait);
    }
    // The whole tab shimmers in the agent's color while it works (see .tg-tab.agent-working).
    el.classList.toggle('agent-working', !!icon?.classList.contains('working'));
    if (h?.color) el.style.setProperty('--agent-color', h.color);
  }
  function setChatTabLabel(tab) {
    const title = (tab.chat?.title || 'Chat').replace(/\s+/g, ' ');
    const el = document.querySelector(`.tg-tab[data-termid="${tab.id}"]`);
    if (el) el.dataset.tip = title;
    const label = title.slice(0, 28);
    if (tab.label === label) return;
    tab.label = label;
    const name = el?.querySelector('.tg-tab-name');
    if (name) name.textContent = label;
    saveState();
  }
  // The chat page is a single element: it moves into the Chat tab in view (the focused one, or
  // the one just opened), and is looked up through thrPage (a restored tab can hold it before the
  // tab is in the document). Another Chat tab in view at the same time (a split) keeps a
  // snapshot of its chat; clicking it brings the live page over and forwards the action.
  // With no Chat tab in view the page
  // is parked (hidden) at the end of the body.
  const thrPage = document.getElementById('sbr-thread');
  let _curChat = null, _preferChat = null;
  // Safety net (startup restores and starts tabs in an order that can miss the move): a Chat tab in view
  // that doesn't hold the page gets it.
  setInterval(() => {
    const ws = activeWs();
    if (!ws?.layout || SETTINGS_ONLY) return;
    const shown = getWorkspaceTerminals(ws).find(t => t.threadHistory && t.el?.offsetParent && findGroupContainingTerm(ws.layout, t.id)?.activeTermId === t.id);
    if (shown && thrPage.parentElement !== shown.el && !(_curChat && thrPage.parentElement === _curChat.el && _curChat.el.offsetParent)) { _preferChat = shown; syncThreadPanel(); }
  }, 500);
  const curChat = () => _curChat;
  function syncThreadPanel(force) {
    const page = thrPage;
    if (!page) return;
    const refreshToken = page._threadRefreshToken = {};
    const ws = activeWs();
    clearInterval(_threadPoll); _threadPoll = null;
    const chats = ws ? getWorkspaceTerminals(ws).filter(t => t.threadHistory && t.el) : [];
    for (const t of chats) {
      t.el.classList.add('chat-tab');
      // Every "focus this tab" path (tab clicks, pane clicks, activation) lands on its chat's message
      // box (bringing the page over), never on the shell underneath; in terminal view, on the terminal.
      if (t.term._chatFocus) continue;
      t.term._chatFocus = true;
      t.term.focus = () => {
        if (t._cliView) return Object.getPrototypeOf(t.term).focus.call(t.term);
        if (_curChat !== t) { _preferChat = t; syncThreadPanel(); }
        if (!page.contains(document.activeElement)) thrInput.focus({ preventScroll: true });
      };
    }
    const shown = chats.filter(t => !t._closePending && findGroupContainingTerm(ws.layout, t.id)?.activeTermId === t.id);
    const tab = shown.find(t => t === _preferChat) || shown.find(t => t.id === ws.activeTermId) || shown.find(t => t === _curChat) || shown[0];
    _preferChat = null;
    const prev = _curChat;
    if (prev !== tab) clearCitationFlash();
    if (prev && prev !== tab) {
      rememberThreadScroll(prev);
      prev._draft = thrInput.value; prev._files = _chatFiles;
    }
    // Keep a chat surface even when its workspace was hidden before this call. Its slot may
    // become visible again without taking focus (for example, above a terminal in a split).
    if (prev && prev !== tab && !prev._closePending && prev.el) {
      const snap = createThreadSnapshot(prev);
      const hidden = !shown.includes(prev);
      moveThreadHistory(page, snap, hidden);
      if (!hidden) restoreThreadScroll(prev, snap);
    }
    if (!tab) {
      _curChat = null;
      syncThreadSelection();
      page.style.display = 'none';
      if (page.parentElement !== document.body) document.body.append(page); // parked until a Chat tab takes it
      return;
    }
    const snapshot = prev !== tab ? tab.el.querySelector(':scope > .thr-snapshot') : null;
    if (page.parentElement !== tab.el) tab.el.appendChild(page);
    // Each chat keeps its own unsent draft and attachments.
    if (prev !== tab) {
      thrInput.value = (tab._draft ?? tab.chat?.draft) || ''; _chatFiles = tab._files || tab.chat?.draftFiles || [];
    }
    _curChat = tab;
    if (prev !== tab) { autosizeThreadInput(); renderChatFiles(); }
    syncThreadSelection();
    page.style.display = tab._cliView ? 'none' : 'flex';
    if (prev !== tab) {
      if (snapshot) {
        moveThreadHistory(snapshot, page);
        snapshot.remove();
      } else {
        const flow = threadPart(page, 'flow');
        flow.replaceChildren();
        delete flow.dataset.seen;
        flow._texts = undefined;
        flow._historyChunks = undefined;
        flow._historyPreviewTried = false;
        flow._showingHistoryPreview = false;
        _flowSig = '';
      }
      if (thrFind.q) thrFindRun(true);
    }
    page.dataset.chat = tab.id;
    if (force) _flowSig = '';
    // Restore only after replacing the previous chat's markup, which can reset/clamp scrollTop.
    if (page.querySelector('.thr-flow').dataset.seen) restoreThreadScroll(tab);
    if (snapshot && _flowSig) {
      // Let the switch paint first; re-reading the transcript waits for idle time so rapid
      // tab switching stays smooth (a working chat still refreshes within 150ms).
      const later = window.requestIdleCallback || (fn => setTimeout(fn, 50));
      later(() => {
        if (page._threadRefreshToken === refreshToken && page.parentElement === tab.el) refreshThreadFlow(tab);
      }, { timeout: chatWorking(tab) ? 150 : 600 });
    } else refreshThreadFlow(tab);
    syncThreadComposer(tab);
    // On startup, sibling Chat panes have never owned the shared page. Give each its own
    // initialized surface and load its history without moving focus or borrowing another chat.
    for (const sibling of shown) {
      if (sibling === tab || sibling._cliView) continue;
      const existing = sibling.el.querySelector(':scope > .thr-snapshot');
      if (existing) {
        const flow = threadPart(existing, 'flow');
        if (flow.inert) {
          disableSnapshotHistoryFocus(flow);
          flow.inert = false;
          restoreThreadScroll(sibling, existing);
        }
        continue;
      }
      const snap = createThreadSnapshot(sibling);
      const flow = snap.querySelector('.thr-flow');
      delete flow.dataset.seen;
      delete flow.dataset.signature;
      threadPart(snap, 'input').value = (sibling._draft ?? sibling.chat?.draft) || '';
      renderChatFiles(sibling._files || sibling.chat?.draftFiles || [], snap);
      syncThreadComposer(sibling, snap);
      refreshThreadFlow(sibling, snap);
    }
    _threadPoll = setInterval(() => {
      if (!page.isConnected || page.parentElement !== tab.el) { syncThreadPanel(); return; } // tab closed or moved
      if (_curChat === tab && !document.hidden && page.offsetParent) { refreshThreadFlow(tab); syncThreadComposer(tab); }
    }, 1000);
  }

  function syncThreadSelection() {
    const ws = activeWs();
    const tabs = ws ? getWorkspaceTerminals(ws) : [];
    if (ws && document.hasFocus()) {
      let changed = false;
      for (const tab of tabs) {
        if (!tab.chat?.unseenCompletion || !isTermOnScreen(ws, tab.id)) continue;
        delete tab.chat.unseenCompletion;
        changed = true;
      }
      if (changed) { saveState(); renderThreadsSidebar(); }
    }
    const activeId = ws?.activeTermId;
    document.querySelectorAll('#ts-list .ts-card').forEach(button => {
      const selected = button.dataset.tab === activeId;
      button.classList.toggle('active', selected);
      if (button.getAttribute('aria-current') !== String(selected)) button.setAttribute('aria-current', String(selected));
    });
    const tabsById = new Map(tabs.map(tab => [tab.id, tab]));
    document.querySelectorAll('.tg-tab[data-termid]').forEach(button => {
      const id = button.dataset.termid;
      const tab = tabsById.get(id) || findTermById(id)?.term;
      button.classList.toggle('unsent', !!(tab?.threadHistory && tab.id !== activeId && tab.chat?.draft?.trim()));
    });
  }

  function rememberThreadScroll(tab, surface = thrPage) {
    const flow = surface.querySelector('.thr-flow');
    // Hiding or detaching a tab can report zero geometry; keep its last visible position.
    if (!tab || !flow.dataset.seen || !flow.clientHeight || !flow.getClientRects().length) return;
    tab._scrollState = { top: flow.scrollTop, bottom: flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1 };
  }
  function restoreThreadScroll(tab, surface = thrPage) {
    const flow = surface.querySelector('.thr-flow'), state = tab._scrollState;
    flow.scrollTop = !state || state.bottom ? flow.scrollHeight : state.top;
  }

  function threadPart(surface, id) {
    return surface.querySelector('#sbr-thread-' + id) || surface.querySelector('[data-thr-id="sbr-thread-' + id + '"]');
  }
  function moveThreadHistory(fromSurface, toSurface, hiddenSnapshot = false) {
    const from = threadPart(fromSurface, 'flow'), to = threadPart(toSurface, 'flow');
    const live = toSurface === thrPage;
    // Keep the transcript, its indexes, and its rendered turns together when
    // switching surfaces. The empty flow just fills the slot it leaves behind.
    const next = to.nextSibling;
    from.replaceWith(to);
    toSurface.insertBefore(from, next);
    if (live) {
      to.removeAttribute('id');
      to.dataset.thrId = 'sbr-thread-flow';
      from.id = 'sbr-thread-flow';
      delete from.dataset.thrId;
    } else {
      from.removeAttribute('id');
      from.dataset.thrId = 'sbr-thread-flow';
      to.id = 'sbr-thread-flow';
      delete to.dataset.thrId;
    }
    if (live && from._snapshotTabIndexes) {
      for (const [el, tabindex] of from._snapshotTabIndexes) {
        if (tabindex === null) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', tabindex);
      }
      from._snapshotTabIndexes = undefined;
    }
    if (live) {
      _flowSig = from.dataset.signature || '';
      from.inert = false;
      bindThreadCopy(from);
    } else {
      from.dataset.signature = _flowSig;
      if (hiddenSnapshot) from.inert = true;
      else disableSnapshotHistoryFocus(from);
    }
    const queue = from.querySelector(':scope > .thr-queue');
    if (queue) {
      queue.id = live ? 'sbr-thread-queue' : '';
      if (live) delete queue.dataset.thrId; else queue.dataset.thrId = 'sbr-thread-queue';
    }
  }
  function disableSnapshotHistoryFocus(flow) {
    const previous = flow._snapshotTabIndexes;
    const indices = flow._snapshotTabIndexes = new Map();
    for (const el of flow.querySelectorAll('button, a[href], input, textarea, summary, [tabindex]')) {
      indices.set(el, previous?.has(el) ? previous.get(el) : el.getAttribute('tabindex'));
      el.tabIndex = -1;
    }
  }
  function createThreadSnapshot(owner) {
    const snap = thrPage.cloneNode(false);
    for (const part of thrPage.children) snap.append(part.cloneNode(!part.classList.contains('thr-flow')));
    snap.querySelectorAll('[id]').forEach(el => { el.dataset.thrId = el.id; el.removeAttribute('id'); });
    snap.classList.add('thr-snapshot');
    snap.style.display = 'flex';
    snap.setAttribute('aria-hidden', 'true');
    snap.querySelectorAll('textarea, input, button, a[href], [tabindex]').forEach(el => { el.tabIndex = -1; });
    snap.querySelectorAll('[contenteditable]').forEach(el => { el.contentEditable = 'false'; el.tabIndex = -1; });
    // Keep the pressed element in place until click. Moving the shared page on mousedown
    // removes the target before mouseup, so the browser drops the intended action.
    snap.addEventListener('mousedown', e => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); } }, true);
    snap.addEventListener('click', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const action = e.target.closest('button, summary, a, img, textarea, input, [data-thr-id="sbr-thread-input-links"]');
      const anchor = action?.closest('[data-thr-id], [data-key], [data-queue-id]') || snap;
      const route = [];
      for (let el = action; el && el !== anchor; el = el.parentElement) route.unshift([...el.parentElement.children].indexOf(el));
      const id = anchor.dataset.thrId, key = anchor.dataset.key, queueId = anchor.dataset.queueId;
      const inHistory = !!action?.closest('.thr-flow') && !action.closest('.thr-queue');
      rememberThreadScroll(owner, snap);
      focusSlot(owner);
      owner.term.focus();
      const run = () => {
        if (!action || curChat() !== owner || thrPage.parentElement !== owner.el) return;
        let target = action;
        if (!thrPage.contains(action)) {
          target = id ? threadPart(thrPage, id.replace(/^sbr-thread-/, ''))
            : queueId ? [...thrPage.querySelectorAll('[data-queue-id]')].find(el => el.dataset.queueId === queueId)
            : key ? [...thrPage.querySelectorAll('[data-key]')].find(el => el.dataset.key === key) : thrPage;
          for (const index of route) target = target?.children[index];
        }
        if (!target || target.tagName !== action.tagName) return;
        if (target.matches('textarea, input, [contenteditable="true"]')) {
          target.focus({ preventScroll: true });
          if (target.isContentEditable && e.detail) {
            const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY);
            if (caret && target.contains(caret.startContainer)) {
              const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(caret);
              rememberChatEditorSelection(target);
            }
          }
        }
        else target.click();
      };
      // A rendered snapshot keeps its history controls when promoted to the live page.
      if (inHistory && !_flowSig) refreshThreadFlow(owner).then(run);
      else run();
    }, true);
    snap.addEventListener('scroll', e => {
      if (e.target.matches?.('.thr-flow')) rememberThreadScroll(owner, snap);
    }, { capture: true, passive: true });
    owner.el.querySelectorAll(':scope > .thr-snapshot').forEach(el => el.remove());
    owner.el.appendChild(snap);
    return snap;
  }

  // Small popover list (the chat composer's agent / model / effort / access pickers).
  let _pickMenu = null;
  function closePickMenu() { _pickMenu?.remove(); _pickMenu = null; }
  function openPickMenu(trigger, items, onPick, alignRight = false, focusFirst = true) {
    const reopen = _pickMenu?._trigger === trigger;
    closePickMenu();
    if (reopen) return;
    const menu = document.createElement('div');
    menu.className = 'tv-pick-menu';
    menu.setAttribute('role', 'menu');
    menu._trigger = trigger;
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tv-pick-item' + (it.selected ? ' selected' : '');
      b.setAttribute('role', 'menuitem');
      if (it.title) {
        b.dataset.tip = it.title;
        b.dataset.tipWrap = '';
      }
      b.innerHTML = `${it.icon || ''}<span class="tv-pick-label">${escHtml(it.label)}</span>${it.hint ? `<span class="tv-pick-hint">${escHtml(it.hint)}</span>` : ''}`;
      b.addEventListener('click', () => { closePickMenu(); onPick(it.value); });
      if (it.action) {
        const row = document.createElement('div');
        row.className = 'tv-pick-row';
        row.setAttribute('role', 'presentation');
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'tv-pick-action';
        action.setAttribute('role', 'menuitem');
        action.setAttribute('aria-label', it.action.label);
        action.textContent = it.action.text;
        action.addEventListener('click', () => { closePickMenu(); it.action.run(); });
        row.append(b, action);
        menu.appendChild(row);
      } else menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = trigger.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = Math.max(8, Math.min(alignRight ? r.right - w : r.left, innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + 6 + menu.offsetHeight > innerHeight ? Math.max(8, r.top - 6 - menu.offsetHeight) : r.bottom + 6) + 'px';
    _pickMenu = menu;
    if (focusFirst) (menu.querySelector('.selected') || menu.querySelector('[role="menuitem"]'))?.focus();
    else {
      menu.tabIndex = -1;
      menu.focus({ preventScroll: true });
    }
    menu.addEventListener('keydown', e => {
      const all = [...menu.querySelectorAll('[role="menuitem"]')], i = all.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.stopPropagation(); closePickMenu(); trigger.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const down = e.key === 'ArrowDown';
        const next = i < 0 ? (down ? 0 : all.length - 1) : (i + (down ? 1 : all.length - 1)) % all.length;
        all[next]?.focus();
      }
    });
  }
  document.addEventListener('mousedown', e => { if (_pickMenu && !_pickMenu.contains(e.target) && !_pickMenu._trigger.contains(e.target)) closePickMenu(); }, true);

  // ── Chat tab composer ──
  // A message goes to the agent running in one of the workspace's tabs, through the same input
  // path as typing there. The model picker always works: a pick that differs from the running
  // agent restarts it (same agent: resumes its session with the new flags) or starts the other
  // agent in a new background tab next to the chat, then types the message in.
  const EFFORT_NAMES = { default: 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra' };
  const CHAT_AGENTS = {
    claude: {
      // CLI aliases: each always means that family's latest model.
      models: [{ id: 'opus', name: 'Claude Opus' }, { id: 'sonnet', name: 'Claude Sonnet' }, { id: 'haiku', name: 'Claude Haiku' }, { id: 'fable', name: 'Claude Fable' }]
        .map(m => ({ ...m, efforts: ['default', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'default' })),
      // --permission-mode values (Claude Code 2.1.325); "auto" lets a classifier approve safe actions.
      access: [['default', 'Ask first', 'ph-shield'], ['auto', 'Auto', 'ph-magic-wand'], ['acceptEdits', 'Accept edits', 'ph-pencil-simple'], ['plan', 'Plan only', 'ph-list-checks'], ['bypassPermissions', 'Full access', 'ph-shield-slash']],
      argv: (o, sid, resume, fork, threadsDir) => [...(o.model !== 'default' ? ['--model', o.model] : []), ...(o.effort !== 'default' ? ['--effort', o.effort] : []),
        // The history files the chat points it to live there: reading them never asks for permission.
        ...(threadsDir ? ['--add-dir', threadsDir] : []),
        // Always explicit: with no flag Claude Code starts in its own default, which can be auto mode,
        // so "Ask first" is its "manual" mode.
        '--permission-mode', o.access === 'default' ? 'manual' : o.access,
        // Fast mode and Ultracode are Claude Code settings. So is skipping Full access's startup warning, whose
        // default answer ("No, exit") the chat's Enter would pick: choosing Full access in the chat is the consent.
        ...(o.fast || o.ultra || o.access === 'bypassPermissions' ? ['--settings', JSON.stringify({ ...(o.fast ? { fastMode: true } : {}), ...(o.ultra ? { ultracode: true } : {}),
          ...(o.access === 'bypassPermissions' ? { skipDangerousModePermissionPrompt: true } : {}) })] : []),
        ...(fork ? ['--resume', fork, '--fork-session'] : []), resume ? '--resume' : '--session-id', sid],
    },
    codex: {
      models: [], // filled from Codex's own model list (~/.codex/models_cache.json) in the desktop app
      access: [['default', 'Ask first', 'ph-shield'], ['read-only', 'Read only', 'ph-eye'], ['workspace-write', 'Workspace write', 'ph-pencil-simple'], ['full', 'Full access', 'ph-shield-slash']],
      // No update prompt at startup: the chat's first Enter would answer it ("Update now") instead of sending.
      argv: (o, sid, resume, fork) => [...(resume && sid ? ['resume', sid] : fork ? ['fork', fork] : []), '-c', 'check_for_update_on_startup=false', ...(o.model !== 'default' ? ['-m', o.model] : []),
        ...(o.effort !== 'default' ? ['-c', `model_reasoning_effort="${o.effort}"`] : []),
        ...(o.access === 'full' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-a', 'on-request', '-s', o.access === 'workspace-write' ? 'workspace-write' : 'read-only']),
        ...(o.fast && CHAT_AGENTS.codex.models.find(m => m.id === o.model)?.fastTier ? ['-c', `service_tier="${CHAT_AGENTS.codex.models.find(m => m.id === o.model).fastTier}"`] : [])],
    },
    // Antigravity CLI: chats run over its Agent Client Protocol server (`agy acp`, electron/chat-sdk.js), which
    // lists the models (each with its thinking levels) and the permission modes; Full access is its start flag.
    antigravity: {
      models: (() => { try { return JSON.parse(localStorage.getItem('tv-agy-models')) || []; } catch { return []; } })(),
      access: [['default', 'Ask first', 'ph-shield'], ['auto', 'Auto', 'ph-magic-wand'], ['accept-edits', 'Accept edits', 'ph-pencil-simple'], ['plan', 'Plan only', 'ph-list-checks'], ['full', 'Full access', 'ph-shield-slash']],
      // The terminal view runs the real CLI on the same conversation.
      argv: (o, sid, resume) => [...(o.model !== 'default' ? ['--model', o.model] : []), ...(o.effort !== 'default' ? ['--effort', o.effort] : []),
        ...(o.access === 'full' ? ['--dangerously-skip-permissions'] : o.access !== 'default' ? ['--mode', o.access] : []), ...(resume && sid ? ['--conversation', sid] : [])],
    },
    opencode: {
      models: [],
      access: [['default', 'OpenCode settings', 'ph-shield']],
      argv: o => o.model !== 'default' ? ['--model', o.model] : [],
    },
  };
  const setAgyModels = models => {
    if (!models?.length) return;
    CHAT_AGENTS.antigravity.models = models;
    try { localStorage.setItem('tv-agy-models', JSON.stringify(models)); } catch {}
  };
  // The other agent CLIs TerminalVibe knows start plain (their own default model and permissions);
  // their transcripts aren't read yet, so their chats show the messages sent, not a history.
  for (const h of THREAD_HARNESSES) CHAT_AGENTS[h.id] ||= { models: [], efforts: ['default'], access: [['default', 'Default', 'ph-shield']], argv: () => [] };
  // An agent with no known models still gets one row: its own default.
  const openCodeCatalogs = new Map();
  const chatModels = (harness, ws) => harness === 'opencode'
    ? [{ id: 'default', name: 'OpenCode default', efforts: ['default'], defaultEffort: 'default' },
      ...(openCodeCatalogs.get(chatCwd(ws)) || [])]
    : CHAT_AGENTS[harness].models.length ? CHAT_AGENTS[harness].models
    : [{ id: 'default', name: harnessOf(harness).name, efforts: CHAT_AGENTS[harness].efforts || ['default', 'low', 'medium', 'high'], defaultEffort: 'default' }];
  // Offer supported agents until the PATH check narrows the list to installed agents.
  const chatAgentIds = () => Object.keys(CHAT_AGENTS).filter(id => {
    const h = harnessOf(id);
    return !h.retired && (!_chatAgentsFound || _chatAgentsFound[h.bin]);
  });
  window.electronAPI?.chatModels?.().then(r => { if (r?.codex?.length) CHAT_AGENTS.codex.models = r.codex; syncThreadComposer(curChat()); }).catch(() => {});
  let _chatAgents = null; // { found: {bin: path|null} }
  let _chatAgentsFound = null; // the resolved `found`, for synchronous menus
  function loadChatAgents() {
    const api = window.electronAPI;
    // Browser mode can't look at PATH: offer every agent and let the PTY report a missing one.
    _chatAgents ||= (api?.threadAgents ? api.threadAgents(THREAD_HARNESSES.map(h => h.bin)) : Promise.resolve({ found: Object.fromEntries(THREAD_HARNESSES.map(h => [h.bin, h.bin])) }))
      .catch(() => ({ found: {} }));
    _chatAgents.then(r => { _chatAgentsFound = r?.found || {}; });
    return _chatAgents;
  }
  if (!SETTINGS_ONLY) loadChatAgents();
  // Antigravity's models come from a session (opened and closed at once in the background): fresh once per run.
  // (After loadChatAgents' state above: calling it earlier throws during startup and the app never leaves its splash.)
  if (!SETTINGS_ONLY && window.electronAPI?.chatSdkModels) loadChatAgents().then(({ found = {} }) => found.agy
    && window.electronAPI.chatSdkModels('antigravity', found.agy).then(m => { setAgyModels(m); syncThreadComposer(curChat()); })).catch(() => {});
  // A workspace keeps its own picks; one that has none starts from the last picks made anywhere.
  const lastChatOpts = () => {
    try {
      const opts = JSON.parse(localStorage.getItem('tv-chat-opts'));
      return harnessOf(opts?.harness)?.retired ? {} : opts || {};
    } catch { return {}; }
  };
  const chatOpts = ws => {
    const seg = threadSegments(ws || {}).findLast(x => x.used);
    const own = ws?.chat?.opts || (seg ? { harness: seg.harness, model: seg.model, effort: seg.effort } : lastChatOpts());
    const o = { harness: 'claude', model: 'default', effort: 'default', access: 'default', ...Object.fromEntries(Object.entries(own).filter(([, v]) => v != null)) };
    if (!CHAT_AGENTS[o.harness]) o.harness = 'claude';
    const models = chatModels(o.harness, ws);
    // Always a real model when the agent lists some (shown on the chip, ticked in the picker, passed on start):
    // an unset or unknown pick takes its first one.
    // Keep an explicit OpenCode model across app restarts and while the project catalog loads.
    if (!models.some(x => x.id === o.model) && !(o.harness === 'opencode' && /^[^/]+\/.+$/.test(o.model))) o.model = models[0].id;
    const m = models.find(x => x.id === o.model);
    // A model with a known default effort lists real levels only; an unknown one has a "Default" row.
    const mm = m || models[0];
    if (!mm.efforts.includes(o.effort)) o.effort = mm.efforts.includes(mm.defaultEffort) ? mm.defaultEffort : 'default';
    if (!CHAT_AGENTS[o.harness].access.some(a => a[0] === o.access)) o.access = 'default';
    // Fast / Ultracode only where the agent and model have them.
    const caps = chatCaps(o);
    o.fast = !!o.fast && caps.fast; o.ultra = !!o.ultra && caps.ultra;
    return o;
  };
  // Fast: every Claude model (Claude Code's fast mode), a Codex model with a fast service tier. Ultracode: Claude.
  function chatCaps(o) {
    return { fast: o.harness === 'claude' || !!CHAT_AGENTS[o.harness]?.models.find(m => m.id === o.model)?.fastTier, ultra: o.harness === 'claude' };
  }
  function setChatOpts(ws, changes) {
    ws.chat ||= { createdAt: Date.now() };
    ws.chat.opts = { ...chatOpts(ws), ...changes };
    ws.chat.opts = chatOpts(ws); // drop an effort/access the new model doesn't have
    try { localStorage.setItem('tv-chat-opts', JSON.stringify(ws.chat.opts)); } catch {}
    saveState();
    syncThreadComposer(ws);
  }
  // A chat's agent runs in its own tab: a structured session (ws._sdk) or the tab's terminal.
  const liveThreadAgent = ws => ws && _tabAgent.get(ws.id) && (ws._sdk?.alive || isLiveTerminal(ws)) ? ws : null;
  // ── Structured sessions (electron/chat-sdk.js) ──
  // In the desktop app, Claude Code and Codex chats run through their own protocols, not a terminal: Claude Code in
  // headless stream-json mode, Codex through `codex app-server`. Messages, permission prompts, questions, stop and
  // permission changes go through them; the history is still read from their transcripts. Other agents (and
  // browser mode) still run in the tab's terminal, and the terminal view resumes the same session in the real CLI.
  const sdkHarness = h => (h === 'claude' || h === 'codex' || h === 'antigravity') && !!window.electronAPI?.chatSdkStart;
  // Agents that take model, effort and permissions on every turn (no restart): Codex, and Antigravity except
  // for Full access, which is a start flag.
  const sdkPerTurn = (h, from, to) => h === 'codex' || (h === 'antigravity' && (from === 'full') === (to === 'full'));
  // What a turn needs to know (Codex takes these on every turn; Claude Code takes the permission mode live).
  const sdkTurnOptions = o => ({ model: o.model, effort: o.effort, access: o.access,
    ...(o.harness === 'codex' && o.fast ? { serviceTier: CHAT_AGENTS.codex.models.find(m => m.id === o.model)?.fastTier } : {}) });
  // A session's question in the answer tray's shape (agentQuestion's).
  const sdkTrayAsk = a => ({ sdk: true, id: a.id, question: a.question, detail: a.detail || [], multi: !!a.multi,
    options: a.options.map((o, i) => ({ key: o.submit ? '' : String(i + 1), label: o.label, desc: o.desc || '', selected: false, submit: !!o.submit, input: !!o.input,
      ...(a.multi && !o.submit && !o.input ? { checked: false } : {}) })) });
  if (!SETTINGS_ONLY) window.electronAPI?.onChatSdkEvent?.(ev => {
    const t = findTermById(ev.key)?.term, s = t?._sdk;
    if (!s?.alive) return;
    const name = harnessOf(s.harness)?.name || 'The agent';
    if (ev.type === 'session') {
      s.sessionId = ev.sessionId;
      if (t._chatSeg && !t._chatSeg.sessionId) { t._chatSeg.sessionId = ev.sessionId; saveState(); }
    } else if (ev.type === 'busy') { s.busy = true; t._agentWorking = true; }
    else if (ev.type === 'idle') {
      s.busy = false; s.idleAt = t._idleAt = Date.now(); t._agentWorking = false;
      if (ev.error) noteChatError(t, `${name}: ${ev.error}`);
      onTerminalFinished({ id: t.id, kind: 'agent', name: s.harness, completed: !ev.error && _turns.has(t.id) });
      chatAgentIdle(t);
    } else if (ev.type === 'ask') {
      if (s.lastQuestionId !== ev.ask.id) {
        s.lastQuestionId = ev.ask.id;
        s.ask = sdkTrayAsk(ev.ask);
        notifyAgentQuestion();
      }
    }
    else if (ev.type === 'ask-done') { if (s.ask?.id === ev.id) s.ask = null; }
    else if (ev.type === 'mode') { if (t._chatCfg) t._chatCfg.access = ev.mode; setChatOpts(t, { access: ev.mode }); }
    else if (ev.type === 'models' && s.harness === 'antigravity') setAgyModels(ev.models);
    else if (ev.type === 'exit') {
      s.alive = s.busy = false; s.ask = null; t._agentWorking = false;
      _tabAgent.set(t.id, null);
      refreshWorkspaceProcsSoon();
      if (ev.error) noteChatError(t, `${name}: ${ev.error}`);
      syncTabAgentIcon(t);
      // Died mid-turn (a crash): the turn is over; redraw so its "Interrupted" line shows, and the next message restarts it.
      if (ev.midTurn) { t.chat ||= {}; t.chat.interruptedAt = Date.now(); saveState(); _turns.delete(t.id); _pendingMsgs.delete(t.id); _flowSig = ''; if (curChat() === t) refreshThreadFlow(t); }
    }
    if (curChat() === t) { syncWorking(t); syncThreadComposer(t); syncSendBtn(); }
    else syncTabAgentIcon(t);
    renderThreadsSidebar();
  });
  // Display names: "Opus" for the chip, "Claude Opus" in the list.
  const modelName = (o, short, ws) => {
    const m = chatModels(o.harness, ws).find(x => x.id === o.model);
    const name = m && o.model !== 'default' ? m.name : o.harness === 'opencode' && o.model !== 'default' ? o.model : harnessOf(o.harness).name;
    return short && o.harness === 'claude' && o.model !== 'default' ? name.replace(/^Claude /, '') : name;
  };
  // The floating composer covers the bottom of the history: pad the history by its height so
  // the last message can always scroll clear of it (it grows with the text and attachments).
  {
    const wrap = thrPage.querySelector('.thr-composer-wrap'), flow = thrPage.querySelector('#sbr-thread-flow');
    new ResizeObserver(() => {
      const atBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1;
      flow.style.paddingBottom = wrap.offsetHeight + 12 + 'px';
      if (atBottom) flow.scrollTop = flow.scrollHeight;
      syncScrollEnd();
    }).observe(wrap);
  }
  thrPage.querySelector('#sbr-thread-ask').addEventListener('click', e => {
    const headBtn = e.target.closest('.thr-ask-head');
    if (headBtn) { const folded = e.currentTarget.classList.toggle('folded'); headBtn.setAttribute('aria-expanded', String(!folded)); return; }
    const askBtn = e.target.closest('button[data-ask-i]');
    if (askBtn) answerAgentQuestion(e.currentTarget, +askBtn.dataset.askI);
  });
  thrPage.querySelector('#sbr-thread-ask').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.matches('input[data-ask-i]') || !e.target.value.trim()) return;
    e.preventDefault();
    answerAgentQuestion(e.currentTarget, +e.target.dataset.askI, e.target.value.trim());
  });
  // Answer the agent's question in its terminal. A single-choice pick presses its number. Everything else
  // moves the agent's pointer there with the arrows and presses Enter: a multi-select box toggles (the tray
  // stays and redraws with the new ticks), Submit sends, and a typed answer is typed into its row first.
  async function answerAgentQuestion(tray, i, text) {
    const t = liveThreadAgent(curChat()), ask = t && agentQuestion(t), o = ask?.options[i];
    // Gone or changed meanwhile (answered in the terminal): nothing is pressed.
    if (!o || ask.question !== tray._q || tray._busy) { tray._html = ''; return; }
    const toggle = o.checked !== undefined && text == null;
    if (ask.sdk) { // a structured session: the pick goes back over its protocol (multi-select ticks stay here until Submit)
      if (toggle) { o.checked = !o.checked; tray._html = ''; syncWorking(curChat()); return; }
      const answer = o.submit ? { indices: ask.options.flatMap((x, k) => x.checked ? [k] : []) } : text != null ? { text } : { index: i };
      t._sdk.ask = null; tray._html = ''; tray._q = '';
      await window.electronAPI.chatSdkRespond(t.id, ask.id, answer);
      syncWorking(curChat());
      return;
    }
    tray._busy = true;
    if (!toggle) tray.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
    const enc = x => new TextEncoder().encode(x);
    try {
      if (!ask.multi && !o.input && !ask.nav) { sendStdin(t.id, enc(o.key)); return; }
      const from = ask.options.findIndex(x => x.selected);
      if (i !== from) { sendStdin(t.id, enc((i > from ? '\x1b[B' : '\x1b[A').repeat(Math.abs(i - from)))); await sleep(80); }
      if (text != null) { sendStdin(t.id, enc(text)); await sleep(80); }
      sendStdin(t.id, enc('\r'));
      await sleep(150); // the agent redraws before the next click reads its pointer
    } finally {
      tray._busy = false;
      tray._html = ''; // the next sync redraws it, even for an identical next question
      if (!toggle) tray._q = '';
    }
  }
  thrPage.addEventListener('click', e => {
    if (!e.target.closest('#sbr-thread-flow')) return;
    const mention = e.target.closest('.thr-thread-mention');
    if (mention) {
      e.preventDefault();
      const t = findThreadByKey(mention.dataset.threadKey);
      if (t) openChatTab(t); else zoomBadge('That thread was deleted');
      return;
    }
    const lockBtn = e.target.closest('[data-lock-act]');
    if (lockBtn) {
      const ws = curChat(), t = ws && (liveThreadAgent(ws) || ws);
      if (lockBtn.dataset.lockAct === 'take') void takeOverChatSession(ws);
      else if (agentLocked(t) && !t._takingOverSession) sendStdin(t.id, new TextEncoder().encode('r'));
      return;
    }
    const b = e.target.closest('.thr-img-link');
    if (b) {
      e.preventDefault();
      openChatAttachment({ path: b.dataset.path });
    }
    const href = e.target.closest('button.thr-link')?.dataset.href;
    if (!href) return;
    if (/^https?:/i.test(href)) { openChatWebLink(href, e.shiftKey); return; }
    const { path } = chatLinkPath(href);
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(path)) openClaudeRefViewer(null, { kind: 'file', path, label: path.split(/[\\/]/).pop() }, '');
    else if (/\.(html?|svg)$/i.test(path)) addBrowserTab(wsOf(curChat())?.id, null, path);
    else window.electronAPI?.showInFolder?.(path);
  });
  // Right-click in the chat: a link, an image, or a message (its text).
  thrPage.addEventListener('contextmenu', e => {
    if (!e.target.closest('#sbr-thread-flow')) return;
    citeBtn.hidden = true; // the menu takes over (its "Cite selection" does the same)
    const img = e.target.closest('img.thr-img');
    if (img?.dataset.path) { e.preventDefault(); showCtxMenu(e, 'chat-image', img); return; }
    const href = e.target.closest('button.thr-link')?.dataset.href;
    if (href) { e.preventDefault(); showCtxMenu(e, 'chat-link', href); return; }
    const msg = e.target.closest('.thr-msg[data-key]');
    if (msg) { e.preventDefault(); showCtxMenu(e, 'chat-msg', msg); }
  });
  // An image in the chat to the clipboard (as PNG); the copy button and the right-click menu share it.
  async function copyChatImage(img) {
    const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
  // A chat link's file: absolute path (relative ones are from the chat's folder), its folder-relative
  // path and the line it points at (#L12 or :12:3).
  function chatLinkPath(href) {
    const line = (href.match(/#L(\d+)|:(\d+)(?::\d+)?$/) || []).slice(1).find(Boolean) || '';
    let path = href.replace(/#.*$/, '').replace(/:\d+(:\d+)?$/, '');
    // Tool transcripts may encode Windows paths with a URI-style leading slash.
    path = path.replace(/^\/(?=[A-Za-z]:[\\/]|\\\\)/, '');
    const cwd = chatCwd(curChat()).replace(/[\\/]$/, '');
    if (!/^([\\/]|[A-Za-z]:)/.test(path)) path = `${cwd}/${path.replace(/^\.\//, '')}`;
    const rel = cwd && path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path;
    return { path, rel, line };
  }
  const thrInput = thrPage.querySelector('#sbr-thread-input');
  const thrSend = thrPage.querySelector('#sbr-thread-send');
  const thrChip = id => thrPage.querySelector('#sbr-thread-' + id);
  const _chatStarting = new Map(); // chat tab id -> { text, wait } while its agent boots (shown in the working row)
  const _gitBranch = new Map(); // cwd -> branch | null
  const _gitBranchChecked = new Map(), _gitBranchPending = new Map();
  const _chatBranchSwitches = new Set();
  const _chatPullRequests = new Map();
  function refreshChatPullRequests(cwd) {
    if (!window.electronAPI?.gitPullRequests) return;
    const cached = _chatPullRequests.get(cwd);
    if (cached && (cached.pending || Date.now() - cached.checked < 30000)) return;
    const entry = { pending: true, pulls: cached?.pulls || [] };
    _chatPullRequests.set(cwd, entry);
    window.electronAPI.gitPullRequests(cwd).then(({ pulls }) => {
      entry.pulls = pulls || [];
    }).catch(() => {
      entry.pulls = [];
    }).finally(() => {
      entry.checked = Date.now();
      entry.pending = false;
      const tab = curChat();
      if (chatCwd(tab) === cwd) syncThreadComposer(tab);
    });
  }
  function refreshChatGitBranch(cwd) {
    if (!cwd || !window.electronAPI?.gitBranch) return Promise.resolve();
    if (_gitBranchPending.has(cwd)) return _gitBranchPending.get(cwd);
    if (_gitBranch.has(cwd) && Date.now() - (_gitBranchChecked.get(cwd) ?? -Infinity) < 2000) return Promise.resolve();
    _gitBranchChecked.set(cwd, Date.now());
    const request = Promise.resolve().then(() => window.electronAPI.gitBranch(cwd)).then(value => {
      const branch = value || null, changed = _gitBranch.get(cwd) !== branch;
      _gitBranch.set(cwd, branch);
      if (changed) { syncThreadComposer(curChat()); renderThreadsSidebar(); }
    }).catch(() => {}).finally(() => _gitBranchPending.delete(cwd));
    _gitBranchPending.set(cwd, request);
    return request;
  }
  // A "No project" thread (chat.scratch) has no folder until its agent first starts in its own scratch folder.
  const chatCwd = tab => tab?.chat?.scratch ? tab.chat.cwd || '' : tab?.chat?.cwd || tab?.cwd || wsOf(tab)?.cwd || getWorkspaceTerminals(wsOf(tab) || {}).find(t => t.cwd)?.cwd || '';
  const isScratchDir = d => /[\\/]\.terminalvibe[\\/]scratch[\\/][^\\/]+[\\/]?$/.test(d || '');
  const chatFolderName = cwd => !cwd || isScratchDir(cwd) ? 'No project' : cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
  async function ensureThreadBranch(tab, cwd = chatCwd(tab)) {
    if (!cwd || !window.electronAPI?.gitBranch) return;
    if (_chatBranchSwitches.has(cwd)) throw Error('Wait for the project branch switch to finish.');
    const current = await window.electronAPI.gitBranch(cwd);
    const saved = tab.chat?.branch;
    if (saved && saved !== current) {
      throw Error(`This thread uses ${saved}. ${current ? `The project is on ${current}.` : 'The current branch could not be read.'} Switch to ${saved} before continuing.`);
    }
    if (current && !saved) {
      tab.chat ||= { createdAt: Date.now() };
      tab.chat.branch = current;
      saveState();
      renderThreadsSidebar();
    }
  }
  function chatProjectDirs(current) {
    const windows = (window.electronAPI?.platform || terminalBackendPlatform) === 'win32';
    const trailingSeparators = windows ? /[\\/]+$/ : /\/+$/;
    const projects = new Map();
    for (const dir of [current, ...workspaces.map(w => w.cwd), ...allChatTabs().map(chatCwd)]) {
      if (!dir || isScratchDir(dir)) continue;
      const trimmed = dir.replace(trailingSeparators, '');
      const key = windows && /^[a-z]:$/i.test(trimmed) && trimmed !== dir
        ? trimmed + '\\'
        : trimmed || dir[0];
      if (!projects.has(key)) projects.set(key, dir);
    }
    return [...projects.values()];
  }
  function syncThreadComposer(ws, surface = thrPage) {
    if (!ws) return;
    const thrChip = id => threadPart(surface, id), thrInput = threadPart(surface, 'input');
    const t = liveThreadAgent(ws), h = t && harnessOf(_tabAgent.get(t.id));
    const o = chatOpts(ws), ho = harnessOf(o.harness);
    const effort = o.effort !== 'default' ? EFFORT_NAMES[o.effort] || o.effort : '';
    const sig = [o.harness, o.model, o.effort, o.fast, o.ultra].join('|');
    const chip = thrChip('model');
    if (chip.dataset.sig !== sig) {
      chip.dataset.sig = sig;
      const model = modelName(o, true, ws);
      chip.title = [model, effort, o.fast && 'Fast', o.ultra && 'Ultracode'].filter(Boolean).join(' · ');
      chip.setAttribute('aria-label', `Agent, model and reasoning: ${chip.title}`);
      chip.innerHTML = `<span class="thr-chip-logo"${ho.color ? ` style="color:${ho.color}"` : ''}>${procIconHtml(ho.bin, 'ph-robot')}</span><span>${escHtml(model)}</span>${effort ? `<span class="thr-chip-sub">${escHtml(effort)}</span>` : ''}`
        + (o.fast ? '<i class="ph ph-lightning thr-chip-mode" aria-label="Fast"></i>' : '') + (o.ultra ? '<i class="ph ph-infinity thr-chip-mode" aria-label="Ultracode"></i>' : '');
    }
    // The permission mode, beside the model picker (the same choices as the picker's mode menu).
    const modeEl = thrChip('mode'), acc = CHAT_AGENTS[o.harness]?.access?.find(x => x[0] === o.access);
    if (modeEl) {
      modeEl.hidden = !acc;
      if (acc && modeEl.dataset.sig !== o.harness + o.access) {
        modeEl.dataset.sig = o.harness + o.access;
        modeEl.innerHTML = `<i class="ph ${acc[2]}" aria-hidden="true"></i><span>${escHtml(acc[1])}</span>`;
        modeEl.classList.toggle('danger', /full|bypass/i.test(o.access));
        modeEl.setAttribute('aria-label', `Permission mode: ${acc[1]}`);
        modeEl.title = `Permission mode: ${acc[1]}`;
      }
    }
    syncTabAgentIcon(ws);
    // Footer: folder, the agent's tab (its permission prompts show there), branch, permissions.
    const cwd = chatCwd(ws);
    const cwdEl = thrChip('cwd');
    // A new chat (nothing said yet) centers its composer, and its folder can still be picked.
    const fresh = !threadHasMessages(ws);
    surface.classList.toggle('thr-new', fresh);
    cwdEl.disabled = !fresh;
    const folderName = chatFolderName(cwd);
    cwdEl.dataset.projectCwd = folderName === 'No project' ? '' : cwd;
    const icon = projectIconHtml(cwd, 'ph-selection');
    cwdEl.innerHTML = `${folderName === 'No project' || icon.startsWith('<img') ? icon : chatFolderIcon(cwd)}<span>${escHtml(folderName)}</span>${fresh ? '<i class="ph ph-caret-down thr-caret" aria-hidden="true"></i>' : ''}`;
    cwdEl.title = fresh ? `Working folder: ${cwd || 'a new scratch folder'}` : cwd;
    // Above the composer: a thread's side chats, or (in a side chat) the thread it belongs to.
    const sidesEl = thrChip('sides');
    if (sidesEl) {
      const chip = (x, icon, i = 0) => `<button type="button" class="thr-side-chip" style="--i:${i}" data-side="${escHtml(x.id)}" title="${escHtml(x.chat?.title || x.label)}">`
        + `<i class="ph ${icon}" aria-hidden="true"></i><span>${escHtml(x.chat?.title || x.label || 'Side chat')}</span>`
        + `${chatWorking(x) ? '<i class="ph ph-circle-notch thr-side-spin" aria-hidden="true"></i>' : ''}</button>`;
      const parent = findThreadByKey(ws.chat?.side?.parentId), sides = ws.chat?.side ? [] : sideChatsOf(ws);
      // A thread's side chats: a header (label + caret) over one row per chat; collapsed, the whole tray
      // goes and a bubble on the composer's edge brings it back. A side chat's thread: always shown.
      let collapsed = !parent; // collapsed by default; opening it is remembered
      if (!parent) try { collapsed = !localStorage.getItem('tv-side-chats-expanded'); } catch {}
      const what = `${sides.length} side chat${sides.length > 1 ? 's' : ''}`;
      const useAsContext = parent && threadSegments(ws).some(x => x.used)
        ? `<button type="button" class="thr-side-chip thr-bring-back" title="Include this side chat with your next message in ${escHtml(parent.chat?.title || parent.label)}"><i class="ph ph-arrow-bend-up-left" aria-hidden="true"></i><span>Use as context</span></button>`
        : '';
      const html = parent ? `<span class="thr-sides-label">Side chat of</span>${useAsContext}${chip(parent, 'ph-chats-circle')}`
        : !sides.length ? ''
        : collapsed ? `<button type="button" class="thr-sides-toggle thr-sides-bubble" aria-expanded="false" aria-label="Show ${what}" data-tip="Side chats">`
          + `<i class="ph ph-chat-circle-dots" aria-hidden="true"></i><span class="thr-sides-count">${sides.length}</span><i class="ph ph-caret-up" aria-hidden="true"></i></button>`
        : `<span class="thr-sides-label">Side chats</span>${sides.map((x, i) => `<div class="thr-side-row" style="--i:${i}">${chip(x, 'ph-chat-circle-dots', i)}`
          + `<button type="button" class="thr-side-del" data-del-side="${escHtml(x.id)}" aria-label="Delete side chat “${escHtml(x.chat?.title || x.label || 'Side chat')}”" data-tip="Delete side chat"><i class="ph ph-trash" aria-hidden="true"></i></button></div>`).join('')}`
          + `<button type="button" class="thr-sides-toggle" aria-expanded="true" aria-label="Hide ${what}"><i class="ph ph-caret-down" aria-hidden="true"></i></button>`;
      sidesEl.hidden = !html;
      sidesEl.classList.toggle('collapsed', collapsed);
      if (sidesEl._html !== html) { sidesEl._html = html; sidesEl.innerHTML = html; }
    }
    const branch = thrChip('branch');
    void refreshChatGitBranch(cwd);
    const b = _gitBranch.get(cwd);
    const savedBranch = ws.chat?.branch;
    const shownBranch = savedBranch || b;
    const branchMismatch = !!savedBranch && _gitBranch.has(cwd) && savedBranch !== b;
    branch.hidden = !shownBranch;
    branch.dataset.tip = branchMismatch ? `Thread branch: ${savedBranch}. Project branch: ${b || 'unavailable'}.` : 'Switch branch';
    const pr = thrChip('pr');
    if (b) refreshChatPullRequests(cwd);
    const pulls = b ? _chatPullRequests.get(cwd)?.pulls : undefined;
    const pullCount = pulls?.length || 0;
    pr.hidden = pullCount === 0;
    if (pullCount) {
      const label = pullCount === 1 ? `PR #${pulls[0].number}` : `${pullCount} PRs`;
      pr.querySelector('span').textContent = label;
      pr.title = pullCount === 1 ? `Open ${label}` : `${pullCount} open pull requests`;
      pr.setAttribute('aria-label', pr.title);
    }
    if (shownBranch) branch.innerHTML = `<i class="ph ${branchMismatch ? 'ph-warning' : 'ph-git-branch'}" aria-hidden="true"></i><span>${escHtml(shownBranch)}</span>`;
    thrInput.placeholder = h && h.id === o.harness ? `Message ${h.name}` : 'Ask anything';
    const editor = threadPart(surface, 'input-links');
    if (editor) editor.dataset.placeholder = thrInput.placeholder;
    syncWorking(ws, surface);
    if (surface === thrPage) syncSendBtn();
  }

  thrChip('sides')?.addEventListener('click', e => {
    const back = e.target.closest('.thr-bring-back');
    if (back) {
      const chat = curChat();
      if (!chat) return;
      back.disabled = true;
      void bringBackSideChat(chat).finally(() => { back.disabled = false; });
      return;
    }
    // The caret, or anywhere on the open tray's "Side chats" header row.
    if (e.target.closest('.thr-sides-toggle, .thr-sides:not(.collapsed):has(> .thr-sides-toggle) > .thr-sides-label')) {
      const el = e.currentTarget;
      if (el.classList.contains('leaving')) return;
      let done = false;
      const flip = () => {
        if (done) return; done = true;
        try { localStorage.getItem('tv-side-chats-expanded') ? localStorage.removeItem('tv-side-chats-expanded') : localStorage.setItem('tv-side-chats-expanded', '1'); } catch {}
        el.classList.remove('leaving', 'anim');
        syncThreadComposer(curChat());
        void el.offsetWidth; // restart the entry animation
        el.classList.add('anim');
        clearTimeout(el._animEnd); el._animEnd = setTimeout(() => el.classList.remove('anim'), 500); // later re-renders don't replay it
      };
      const animate = document.body.classList.contains('ui-animations') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Collapsing: the tray sinks behind the composer first, then the bubble rises.
      if (animate && !el.classList.contains('collapsed')) { el.classList.add('leaving'); setTimeout(flip, 170); }
      else flip();
      return;
    }
    const del = e.target.closest('.thr-side-del');
    if (del) { const t = findChatThread(del.dataset.delSide); if (t) confirmDeleteThread(t, undefined, 'side chat'); return; }
    const t = findChatThread(e.target.closest('.thr-side-chip')?.dataset.side); if (t) openChatTab(t);
  });
  // Mode chip: the permission modes menu (same as in the model picker); a change applies live where the agent allows it.
  thrChip('mode')?.addEventListener('click', e => {
    const ws = curChat();
    if (!ws) return;
    const o = chatOpts(ws), btn = e.currentTarget;
    openPickMenu(btn, CHAT_AGENTS[o.harness].access.map(([v, label, icon]) => ({ value: v, label, selected: v === o.access, icon: `<i class="ph ${icon}"></i>` })),
      v => { setChatOpts(ws, { access: v }); syncThreadComposer(ws); btn.focus(); void applyClaudeMode(ws, v); }, true);
  });
  thrChip('cwd')?.addEventListener('click', e => {
    e.stopPropagation(); // the document click handler would close the menu right away
    const chip = e.currentTarget;
    if (ctxEl.classList.contains('open') && ctxEl._owner === chip) { hideCtxMenu(); return; } // a toggle
    const r = chip.getBoundingClientRect();
    showCtxMenu({ pageX: r.left, pageY: r.top - 6, above: true }, 'chat-cwd', curChat());
    ctxEl._owner = chip;
  });
  thrChip('branch')?.addEventListener('click', async e => {
    e.stopPropagation();
    const chip = e.currentTarget;
    if (ctxEl.classList.contains('open') && ctxEl._owner === chip) { hideCtxMenu(); return; } // a toggle
    const tab = curChat(), cwd = chatCwd(tab), r = chip.getBoundingClientRect();
    const branches = await window.electronAPI?.gitBranches?.(cwd) || [];
    // The chip sits at the composer's right end: the menu grows leftward from it (right edges aligned).
    showCtxMenu({ pageX: r.right, pageY: r.top - 6, above: true, alignRight: true }, 'chat-branch', { tab, cwd, branches });
    ctxEl._owner = chip;
  });
  thrChip('pr').addEventListener('click', e => {
    const chip = e.currentTarget, tab = curChat(), cwd = chatCwd(tab), ws = wsOf(tab);
    const pulls = _chatPullRequests.get(cwd)?.pulls;
    if (!ws || !pulls?.length) return;
    const open = pr => {
      if (curChat() === tab && chatCwd(tab) === cwd) {
        addBrowserTab(ws.id, findGroupContainingTerm(ws.layout, tab.id)?.id, pr.url, `PR #${pr.number}`);
      }
    };
    const merge = async pr => {
      if (curChat() !== tab || chatCwd(tab) !== cwd) return;
      const text = `Please merge GitHub PR #${pr.number} (${pr.url}). If GitHub blocks the merge, tell me why.`;
      const message = { id: uuid(), text, typed: text, files: [], after: _turns.get(tab.id)?.sentAt || Date.now() };
      const busy = chatWorking(tab) || _chatStarting.has(tab.id) || _chatSending.has(tab.id);
      if (!busy && await deliverChatMessage(tab, message)) return;
      if (!findTermById(tab.id)) return;
      tab.chat ||= { createdAt: Date.now() };
      (tab.chat.queuedMessages ||= []).push(message);
      if (!busy) tab.chat.queuePaused = true;
      renderChatQueue(tab);
      saveState();
    };
    openPickMenu(chip, pulls.map(pr => ({
      value: pr,
      label: `#${pr.number} ${pr.draft ? 'Draft · ' : ''}${pr.title}`,
      title: `#${pr.number} ${pr.draft ? 'Draft · ' : ''}${pr.title}`,
      icon: '<i class="ph ph-git-pull-request" aria-hidden="true"></i>',
      action: { text: 'Merge', label: `Ask the agent to merge PR #${pr.number}`, run: () => void merge(pr) },
    })), open, true, false);
  });
  async function setChatBranch(tab, cwd, branch) {
    if (!tab || !cwd || _chatBranchSwitches.has(cwd)) return;
    if (allChatTabs().some(t => chatCwd(t) === cwd && (chatWorking(t) || _chatSending.has(t.id) || _chatStarting.has(t.id) || t._terminalSessionOpening))) {
      zoomBadge('Wait for the active thread in this folder to finish before switching branches.');
      return;
    }
    _chatBranchSwitches.add(cwd);
    try {
      const current = await window.electronAPI.gitBranch(cwd);
      if (current !== branch) {
        const result = await window.electronAPI.gitCheckout(cwd, branch);
        if (!result.ok) { zoomBadge(result.error || 'Could not switch branch'); return; }
      }
      if (chatCwd(tab) === cwd) {
        tab.chat ||= { createdAt: Date.now() };
        tab.chat.branch = branch;
        saveState();
      }
    } catch (err) {
      zoomBadge(err.message || 'Could not switch branch');
    } finally {
      _chatBranchSwitches.delete(cwd);
      await _gitBranchPending.get(cwd);
      _gitBranch.delete(cwd);
      syncThreadComposer(curChat());
      renderThreadsSidebar();
    }
  }
  function chatFolderIcon(path, open = false) {
    // Both Windows UNC spellings identify WSL folders; ordinary Linux paths do not.
    if (/^[\\/]{2}wsl(?:\.localhost|\$)[\\/]/i.test(path || '')) {
      return '<i class="ph ph-linux-logo" aria-hidden="true"></i>';
    }
    return `<i class="ph ph-folder${open ? '-open' : ''}" aria-hidden="true"></i>`;
  }
  function setChatCwd(tab, dir, scratch = false) {
    if (!tab || (!dir && !scratch) || threadHasMessages(tab)) return;
    if (scratch) { if (tab.chat.scratch) return; tab.chat.scratch = true; delete tab.chat.cwd; }
    else { delete tab.chat.scratch; tab.chat.cwd = tab.cwd = dir; }
    delete tab.chat.branch;
    saveState(); syncThreadComposer(tab); renderThreadsSidebar();
  }
  // ── Model picker: agents at left, their models in the middle, reasoning effort at right ──
  let _modelPicker = null;
  function closeModelPicker(refocus) {
    if (!_modelPicker) return;
    const pop = _modelPicker;
    _modelPicker = null;
    pop._modelResize?.disconnect();
    if (document.body.classList.contains('ui-animations') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pop.inert = true;
      pop.classList.add('closing');
      pop.addEventListener('animationend', e => { if (e.target === pop) pop.remove(); });
      setTimeout(() => pop.remove(), 180); // cleanup if animations are disabled while closing
    } else pop.remove();
    thrChip('model').setAttribute('aria-expanded', 'false');
    if (refocus) thrInput.focus();
  }
  function openModelPicker() {
    if (_modelPicker) { closeModelPicker(true); return; }
    const ws = curChat(), trigger = thrChip('model');
    let found = _chatAgentsFound;
    const favs = new Set((() => { try { return JSON.parse(localStorage.getItem('tv-model-favs')) || []; } catch { return []; } })());
    const favKey = (h, m) => `${h}:${m}`;
    const currentHarness = chatOpts(ws).harness;
    let filter = favs.size || !chatAgentIds().includes(currentHarness) ? 'fav' : currentHarness, query = '';
    const openCodeCwd = chatCwd(ws);
    let openCodeRequested = false, openCodeLoading = false, openCodeStatus = '';
    const pop = document.createElement('div');
    pop.className = 'tv-model-picker';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Choose a model');
    pop.innerHTML = `<div class="mp-rail" role="tablist" aria-label="Agents"></div>
      <div class="mp-main"><label class="mp-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input type="text" placeholder="Search models…" aria-label="Search models" spellcheck="false" autocomplete="off"></label><div class="mp-list" role="listbox" aria-label="Models"><div class="mp-model-rows"></div><div class="mp-empty mp-status" role="status" hidden></div></div></div>
      <div class="mp-side"><div class="mp-side-head"><span>Reasoning</span><span class="mp-side-model"></span></div><div class="mp-efforts" role="listbox" aria-label="Reasoning effort"></div></div>
      <div class="mp-foot">
        <div class="mp-speed" role="radiogroup" aria-label="Speed"><button type="button" role="radio" data-fast="0">Standard</button><button type="button" role="radio" data-fast="1"><i class="ph ph-lightning" aria-hidden="true"></i>Fast</button></div>
        <button type="button" class="mp-ultra" aria-pressed="false" title="Ultracode: Claude Code's deepest coding mode"><i class="ph ph-infinity" aria-hidden="true"></i>Ultracode</button>
        <button type="button" class="mp-access" aria-haspopup="menu" title="Permissions for the next agent the chat starts"></button>
      </div>`;
    const rail = pop.querySelector('.mp-rail'), list = pop.querySelector('.mp-list'), side = pop.querySelector('.mp-efforts'), search = pop.querySelector('input');
    const modelRows = list.querySelector('.mp-model-rows'), status = list.querySelector('.mp-status');
    const STAR_FILLED = '<svg class="mp-star-fill" viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M234.3 114.1l-45.1 39.4 13.5 58.6a16 16 0 0 1-23.8 17.3L128 198.3l-50.8 30.8a16 16 0 0 1-23.9-17.3l13.5-58.5-45.1-39.4a16 16 0 0 1 9.1-28.1l59.5-5.1 23.2-55.3a16 16 0 0 1 29.5 0l23.3 55.3 59.4 5.1a16 16 0 0 1 9.1 28.1z"/></svg>';
    // Favorites in list order; the first nine get Ctrl+1…9 while the picker is open.
    const favList = () => favs.size ? chatAgentIds().flatMap(id => chatModels(id, ws).filter(m => favs.has(favKey(id, m.id))).map(m => ({ h: harnessOf(id), m }))) : [];
    // Each row occupies 36px including its gap. Keep a few more mounted on either side of the viewport.
    const rowHeight = 36, overscan = 4;
    let rows = [], renderModel = null, firstRendered = -1, lastRendered = -1;
    function renderModelRows() {
      const first = Math.min(rows.length, Math.max(0, Math.floor(list.scrollTop / rowHeight) - overscan));
      const last = Math.min(rows.length, Math.ceil((list.scrollTop + list.clientHeight) / rowHeight) + overscan);
      if (first === firstRendered && last === lastRendered) return;
      const focused = modelRows.contains(document.activeElement) ? Number(document.activeElement.dataset.index) : -1;
      firstRendered = first;
      lastRendered = last;
      modelRows.style.paddingTop = Math.min(first, rows.length) * rowHeight + 'px';
      modelRows.style.paddingBottom = (rows.length - last) * rowHeight + 'px';
      modelRows.innerHTML = rows.slice(first, last).map((row, i) => renderModel(row, first + i)).join('');
      if (focused >= 0) {
        const target = modelRows.querySelector(`[data-index="${focused}"]`);
        (target || search).focus({ preventScroll: true });
      }
    }
    function focusModel(index) {
      const top = index * rowHeight, bottom = top + rowHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      renderModelRows();
      modelRows.querySelector(`[data-index="${index}"]`)?.focus({ preventScroll: true });
    }
    list.addEventListener('scroll', renderModelRows, { passive: true });
    function requestOpenCode() {
      if (openCodeRequested || !found?.opencode || !window.electronAPI?.chatSdkModels) return;
      openCodeRequested = true;
      openCodeLoading = !openCodeCatalogs.has(openCodeCwd);
      window.electronAPI.chatSdkModels('opencode', found.opencode, openCodeCwd).catch(() => null).then(models => {
        openCodeLoading = false;
        if (Array.isArray(models)) {
          openCodeCatalogs.set(openCodeCwd, models);
          openCodeStatus = models.length ? '' : 'No models from connected OpenCode providers';
          if (curChat() === ws) syncThreadComposer(ws);
        } else openCodeStatus = 'Could not load OpenCode models';
        if (_modelPicker === pop) render();
      });
    }
    const render = () => {
      const o = chatOpts(ws), favorites = favList();
      const favOrder = new Map(favorites.slice(0, 9).map(({ h, m }, i) => [favKey(h.id, m.id), i + 1]));
      const ids = chatAgentIds(), logos = new Map(ids.map(id => {
        const h = harnessOf(id);
        return [id, procIconHtml(h.bin, 'ph-robot')];
      }));
      rail.innerHTML = [['fav', filter === 'fav' ? STAR_FILLED : '<i class="ph ph-star" aria-hidden="true"></i>', 'Favorites'],
        ...ids.map(id => { const h = harnessOf(id); return [id, `<span${h.color ? ` style="color:${h.color}"` : ''}>${logos.get(id)}</span>`, h.name]; })]
        .map(([id, icon, label]) => `<button type="button" role="tab" class="mp-rail-btn${(filter || '') === id ? ' active' : ''}" data-f="${id}" title="${escHtml(label)}" aria-label="${escHtml(label)}" aria-selected="${(filter || '') === id}">${icon}</button>`).join('');
      const q = query.toLowerCase();
      if (q || filter === 'opencode' || (filter === 'fav' && [...favs].some(key => key.startsWith('opencode:')))) requestOpenCode();
      // Search looks through every agent; otherwise the rail picks favorites or one agent.
      rows = !q && filter === 'fav' ? favorites : ids.filter(id => q || id === filter).flatMap(id => {
        const h = harnessOf(id);
        return chatModels(id, ws).filter(m => !q || `${m.name} ${h.name} ${m.id}`.toLowerCase().includes(q)).map(m => ({ h, m }));
      });
      renderModel = ({ h, m }, index) => {
        const key = favKey(h.id, m.id), n = favOrder.get(key), favorite = favs.has(key);
        const sel = o.harness === h.id && (o.model === m.id || (m.id === 'default' && o.model === 'default'));
        return `<button type="button" role="option" class="mp-row${sel ? ' selected' : ''}" data-index="${index}" data-h="${h.id}" data-m="${escHtml(m.id)}" aria-selected="${sel}" aria-posinset="${index + 1}" aria-setsize="${rows.length}">`
          + `<span class="mp-logo"${h.color ? ` style="color:${h.color}"` : ''}>${logos.get(h.id)}</span><span class="mp-name">${escHtml(m.name)}</span>`
          + (sel ? '<i class="ph ph-check mp-check" aria-hidden="true"></i>' : '') + (!found || found[h.bin] ? '' : '<span class="mp-hint">not installed</span>')
          + `<span class="mp-fav${favorite ? ' on' : ''}" title="${favorite ? 'Remove from favorites' : 'Add to favorites'}">${favorite ? STAR_FILLED : '<i class="ph ph-star" aria-hidden="true"></i>'}</span>`
          + (n ? `<kbd class="mp-kbd">Ctrl+${n}</kbd>` : '') + '</button>';
      };
      firstRendered = lastRendered = -1;
      if (list.scrollTop > rows.length * rowHeight) list.scrollTop = 0;
      renderModelRows();
      const showLoading = openCodeLoading && (filter === 'opencode' || (q && !rows.length));
      status.textContent = (!q && filter === 'opencode' && openCodeStatus)
        || (rows.length ? '' : !q && filter === 'fav' ? 'Star a model to add it here' : 'No models match');
      if (showLoading) status.innerHTML = '<span class="tv-loading-spinner" aria-hidden="true"></span>Loading OpenCode models…';
      status.hidden = !status.textContent;
      const cur = chatModels(o.harness, ws).find(x => x.id === o.model) || chatModels(o.harness, ws)[0];
      pop.querySelector('.mp-side-model').textContent = modelName(o, true, ws);
      side.innerHTML = cur.efforts.map(e => `<button type="button" role="option" class="mp-row mp-effort${o.effort === e ? ' selected' : ''}" data-e="${e}" aria-selected="${o.effort === e}">`
        + `<span class="mp-name">${escHtml(EFFORT_NAMES[e] || e)}</span>${e !== 'default' && e === cur.defaultEffort ? '<span class="mp-hint">Default</span>' : ''}`
        + (o.effort === e ? '<i class="ph ph-check mp-check" aria-hidden="true"></i>' : '') + '</button>').join('');
      const caps = chatCaps(o), speed = pop.querySelector('.mp-speed'), ultra = pop.querySelector('.mp-ultra');
      speed.hidden = !caps.fast; ultra.hidden = !caps.ultra;
      speed.querySelectorAll('button').forEach(b => { const on = (b.dataset.fast === '1') === !!o.fast; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      ultra.classList.toggle('on', !!o.ultra); ultra.setAttribute('aria-pressed', String(!!o.ultra));
      const [, aLabel, aIcon] = CHAT_AGENTS[o.harness].access.find(a => a[0] === o.access);
      const acc = pop.querySelector('.mp-access');
      acc.classList.toggle('danger', /full|bypass/i.test(o.access));
      acc.innerHTML = `<i class="ph ${aIcon}" aria-hidden="true"></i><span>${escHtml(aLabel)}</span><i class="ph ph-caret-up mp-caret" aria-hidden="true"></i>`;
    };
    pop.querySelector('.mp-access').addEventListener('click', e => {
      const o = chatOpts(ws);
      openPickMenu(e.currentTarget, CHAT_AGENTS[o.harness].access.map(([v, label, icon]) => ({ value: v, label, selected: v === o.access, icon: `<i class="ph ${icon}"></i>` })),
        v => { setChatOpts(ws, { access: v }); render(); pop.querySelector('.mp-access').focus(); void applyClaudeMode(ws, v); }, true);
    });
    pop.querySelector('.mp-speed').addEventListener('click', e => { const b = e.target.closest('[data-fast]'); if (b) { setChatOpts(ws, { fast: b.dataset.fast === '1' }); render(); } });
    pop.querySelector('.mp-ultra').addEventListener('click', () => { setChatOpts(ws, { ultra: !chatOpts(ws).ultra }); render(); });
    rail.addEventListener('click', e => { const b = e.target.closest('.mp-rail-btn'); if (b) { filter = b.dataset.f; query = search.value = ''; list.scrollTop = 0; render(); search.focus(); } });
    list.addEventListener('click', e => {
      const r = e.target.closest('.mp-row'); if (!r) return;
      if (e.target.closest('.mp-fav')) {
        const k = favKey(r.dataset.h, r.dataset.m);
        favs.has(k) ? favs.delete(k) : favs.add(k);
        try { localStorage.setItem('tv-model-favs', JSON.stringify([...favs])); } catch {}
        render(); return;
      }
      setChatOpts(ws, { harness: r.dataset.h, model: r.dataset.m });
      render(); // stays open: pick the effort next, or click away
    });
    side.addEventListener('click', e => { const r = e.target.closest('.mp-row'); if (r) { setChatOpts(ws, { effort: r.dataset.e }); render(); } }); // stays open: Esc or click away closes
    search.addEventListener('input', () => { query = search.value; list.scrollTop = 0; render(); });
    pop.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModelPicker(true); return; }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const f = favList()[+e.key - 1];
        if (f) { e.preventDefault(); e.stopPropagation(); setChatOpts(ws, { harness: f.h.id, model: f.m.id }); render(); }
        return;
      }
      if (!rows.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = modelRows.contains(document.activeElement) ? Number(document.activeElement.dataset.index) : -1;
        focusModel(i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
      } else if (e.key === 'Enter' && e.target === search) {
        e.preventDefault();
        list.scrollTop = 0;
        renderModelRows();
        modelRows.querySelector('[data-index="0"]')?.click();
      }
    });
    document.body.appendChild(pop);
    _modelPicker = pop;
    render();
    pop._modelResize = new ResizeObserver(renderModelRows);
    pop._modelResize.observe(list);
    // Above the chip, right edges aligned (the composer sits at the bottom of the pane).
    const r = trigger.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, r.top - 8 - pop.offsetHeight) + 'px';
    trigger.setAttribute('aria-expanded', 'true');
    search.focus();
    if (!found) loadChatAgents().then(result => {
      if (_modelPicker !== pop) return;
      found = result.found || {};
      if (filter !== 'fav' && !chatAgentIds().includes(filter)) filter = 'fav';
      render();
    });
  }
  thrChip('model')?.addEventListener('click', openModelPicker);
  document.addEventListener('mousedown', e => { if (_modelPicker && !_modelPicker.contains(e.target) && !thrChip('model').contains(e.target) && !e.target.closest?.('.tv-pick-menu')) closeModelPicker(false); }, true);

  // Paste-style write, then Enter on its own: sent together, Codex treats the text as a paste and Enter as a newline.
  function sendToAgent(t, text, steer = false, files = []) {
    // The history note rides on the first real message: after a slash command it would become its argument.
    if (t._handoff && !/^\s*\//.test(text)) { text += _handoffNote(t._handoff); t._handoff = null; }
    if (t._sideNote && !/^\s*\//.test(text)) { text += SIDE_NOTE; t._sideNote = false; }
    if (t._sdk?.alive) {
      t._chatSent = true;
      if (t._chatSeg) t._chatSeg.used = true;
      const turn = _turns.get(t.id);
      if (turn) turn.sentAt = Date.now();
      const o = chatOpts(t);
      window.electronAPI.chatSdkSetAccess(t.id, o.access);
      if (t._chatCfg) t._chatCfg.access = o.access;
      // Codex and Antigravity take model and effort per turn: the session (and its history label) follows the picks.
      if (['codex', 'antigravity'].includes(_tabAgent.get(t.id))) {
        if (t._chatCfg) Object.assign(t._chatCfg, { model: o.model, effort: o.effort, fast: o.fast });
        if (t._chatSeg) Object.assign(t._chatSeg, { model: o.model, effort: o.effort });
      }
      return (async () => {
        const images = files.filter(file => file.image && file.path);
        let attachments = [];
        if (t._sdk.harness === 'codex') {
          attachments = images.map(file => file.path);
        } else if (t._sdk.harness === 'claude') {
          for (const file of images) {
            const image = await window.electronAPI.readImageFile(file.path);
            if (!image?.data) throw Error('Could not attach image ' + file.name);
            if (image.mediaType !== 'image/bmp') attachments.push({ mediaType: image.mediaType, data: image.data });
          }
        }
        const r = await window.electronAPI.chatSdkSend(t.id, text, {
          steer, options: sdkTurnOptions(o), ...(attachments.length ? { images: attachments } : {}),
        });
        if (!r?.ok) throw Error(r?.error || 'The agent did not take the message');
        return true;
      })();
    }
    if (_tabAgent.get(t.id) === 'opencode' && /(?:^|[\s([{])\$[\w:.-]/.test(text)) {
      return openCodeSkillText(t, text).then(text =>
        _tabAgent.get(t.id) === 'opencode' && isLiveTerminal(t) && sendToTerminalAgent(t, text, steer));
    }
    return sendToTerminalAgent(t, text, steer);
  }
  function sendToTerminalAgent(t, text, steer) {
    const enc = str => new TextEncoder().encode(str), body = text.replace(/\r?\n/g, '\r');
    sendStdin(t.id, enc(t.term.modes?.bracketedPasteMode ? `\x1b[200~${body}\x1b[201~` : body));
    t._chatSent = true;
    if (t._chatSeg) t._chatSeg.used = true;
    const turn = _turns.get(t.id);
    if (turn) turn.sentAt = Date.now();
    return new Promise(resolve => setTimeout(() => {
      if (!isLiveTerminal(t)) { resolve(false); return; }
      sendStdin(t.id, enc(steer && _tabAgent.get(t.id) === 'claude' ? '\x18\x13' : '\r'));
      resolve(true);
    }, _tabAgent.get(t.id) === 'codex' ? 300 : 50));
  }
  // A permission mode picked in the chat applies to the running Claude Code right away: Shift+Tab cycles its
  // modes until its footer shows the pick. A mode outside the cycle (Full access needs a start flag) or a
  // hidden footer (a dialog is open) leaves it to the next message, which restarts the agent with the pick.
  async function applyClaudeMode(tab, target) {
    const t = liveThreadAgent(tab);
    if (t?._sdk?.alive) { // structured: Claude Code switches at once, Codex / Antigravity from their next turn
      // Antigravity's Full access is a start flag: the next message restarts it (its config keeps the old pick until then).
      if (t._sdk.harness === 'antigravity' && (target === 'full') !== (t._chatCfg?.access === 'full')) return;
      window.electronAPI.chatSdkSetAccess(t.id, target);
      if (t._chatCfg) t._chatCfg.access = target;
      return;
    }
    if (!t || _tabAgent.get(t.id) !== 'claude' || !t._chatCfg || t._modeSwitching) return;
    // Full access joins the cycle only when the agent was started with it: an idle agent restarts with it now
    // (same session); a busy one keeps working and takes it with the next message.
    if (target === 'bypassPermissions' && t._chatCfg.access !== target) {
      if (!chatWorking(tab) && !_chatStarting.has(tab.id)) await startChatAgent(tab, tab, null, t).catch(err => zoomBadge(err.message));
      return;
    }
    t._modeSwitching = true; // the footer watcher leaves the pick alone meanwhile
    try {
      for (let i = 0; i < 6 && isLiveTerminal(t) && chatOpts(tab).access === target; i++) {
        const cur = claudeFooterMode(t);
        if (!cur) return;
        if (cur === target) { t._chatCfg.access = t._footerMode = target; return; }
        sendStdin(t.id, new TextEncoder().encode('\x1b[Z')); // Shift+Tab
        for (let w = 0; w < 10 && claudeFooterMode(t) === cur; w++) await new Promise(r => setTimeout(r, 100));
      }
    } finally {
      t._modeSwitching = false;
      // Not reached: the mode it stopped on isn't taken as a new pick (the next message restarts with the pick).
      if (t._footerMode !== target) t._footerMode = claudeFooterMode(t) || t._footerMode;
    }
  }
  // What the agent shows right now: the visible screen only, not the scrollback
  // (a background tab's buffer fills without a renderer).
  function screenText(entry) {
    const b = entry.term.buffer.active, out = [];
    for (let i = b.baseY; i < b.baseY + entry.term.rows; i++) out.push(b.getLine(i)?.translateToString(true) || '');
    return out.join('\n');
  }
  // A question the agent asks before it takes prompts (trust this folder? update now?). Only the user answers
  // it: the chat shows the agent's terminal and sends once it is gone.
  const TRUST_RE = /trust this folder|trust the (files|contents) in this|Do you trust|Update available|Update now|new version (is )?available/i;
  // A question the agent asks in its terminal (a permission prompt, a multiple-choice question): the question,
  // the lines above it (what it wants to run) and its numbered choices. Only a list with the selection pointer
  // (Claude Code ❯, Codex ›) counts, so a numbered list in a reply never does.
  // A choice's next lines are its label wrapped (the line above reached the screen's edge) or its description.
  // "Type something." (Claude Code's free-text choice) shows as a text field. A multi-select question
  // ("[ ]" boxes) has a "Submit" row after its choices and may say "Select all that apply." instead of asking.
  const ASK_OPT_RE = /^\s*([❯›]\s*)?(\d)\.\s+(.+)$/, ASK_SUBMIT_RE = /^\s*([❯›]\s*)?Submit$/;
  const ASK_RULE_RE = /^[─━╌┄═-]{8,}$/, ASK_BOX_RE = /^\[([ x✔✓])\]\s*/;
  function agentQuestion(t) {
    if (t?._sdk?.alive) return t._sdk.ask || null; // a structured session asks through its protocol
    if (!t?.term || !isLiveTerminal(t)) return null;
    return parseAgentQuestion(screenText(t), t.term.cols);
  }
  function trackTerminalQuestion(t, ask) {
    if (!ask) {
      delete t._terminalQuestionKey;
      return;
    }
    // Moving the selection or toggling a checkbox leaves the question unchanged.
    const key = JSON.stringify([ask.question, ask.options.map(o => o.label)]);
    if (key === t._terminalQuestionKey) return;
    t._terminalQuestionKey = key;
    notifyAgentQuestion();
  }
  function parseAgentQuestion(screen, cols = 80) {
    const lines = screen.split('\n').map(l => l.trimEnd());
    let first = lines.findLastIndex((l, i) => ASK_OPT_RE.exec(l)?.[2] === '1' && !ASK_OPT_RE.test(lines[i - 1] || '')), nav = false;
    // Claude Code's trust question has no numbers ("❯ No, exit" over "  Yes, I trust this folder"): its rows are
    // numbered here, and answered with the arrows and Enter (nav).
    if (first < 0 && TRUST_RE.test(screen)) {
      const at = lines.findLastIndex(l => /^\s*[❯›]\s+\S/.test(l)), row = l => /^\s{2,}\S/.test(l);
      if (at < 0) return null;
      let s = at, e = at;
      while (s > 0 && row(lines[s - 1])) s--;
      while (e + 1 < lines.length && row(lines[e + 1])) e++;
      for (let i = s; i <= e; i++) lines[i] = lines[i].replace(/^(\s*)([❯›]\s*)?/, (_, sp, ptr) => `${sp}${ptr || ''}${i - s + 1}. `);
      first = s; nav = true;
    }
    if (first < 0) return null;
    const options = [];
    for (let i = first; i < lines.length; i++) {
      const raw = lines[i], l = raw.trim(), m = ASK_OPT_RE.exec(raw), sub = ASK_SUBMIT_RE.exec(raw);
      if (m) options.push({ key: m[2], label: m[3].trim(), desc: '', selected: !!m[1] });
      else if (sub) options.push({ key: '', label: 'Submit', desc: '', selected: !!sub[1], submit: true });
      else if (!l || ASK_RULE_RE.test(l)) continue; // gaps, and the divider before "Chat about this"
      else if (/^(Esc|Press|Enter)\b/.test(l) || !/^\s/.test(raw)) break;
      else {
        const o = options[options.length - 1];
        if (!o.desc && lines[i - 1].length >= cols - 20) o.label += ' ' + l; else o.desc += (o.desc ? ' ' : '') + l;
      }
    }
    for (const o of options) {
      const box = ASK_BOX_RE.exec(o.label);
      if (box) { o.checked = box[1] !== ' '; o.label = o.label.slice(box[0].length); }
    }
    if (options.filter(o => o.key).length < 2 || !options.some(o => o.selected)) return null;
    // The question: the nearest line ending in "?" inside the dialog, else the nearest line above the choices.
    let q = -1, near = -1;
    for (let i = first - 1; i >= 0 && first - i < 12; i--) {
      const l = lines[i].trim();
      if (ASK_RULE_RE.test(l) || /^[╭╰│]/.test(l)) break; // the dialog's top border
      if (/\?$/.test(l)) { q = i; break; }
      if (near < 0 && l) near = i;
    }
    if (q < 0) q = near;
    let question = lines[q]?.trim() || '', detail = [];
    // A trust/update screen (drawn on a fresh screen): its question is the first line that asks one; the folder
    // and warning around it are the detail.
    const top = Math.max(0, first - 20);
    if (TRUST_RE.test(lines.slice(top).join('\n'))) {
      const body = lines.slice(top, first).map(l => l.trim()).filter(l => l && !ASK_RULE_RE.test(l) && !/^[╭╰│]/.test(l));
      const qi = Math.max(0, body.findIndex(l => l.includes('?') || TRUST_RE.test(l)));
      if (!body.length) return null;
      question = body[qi].replace(/^(.*?\?).*$/, '$1');
      const rest = body[qi].slice(question.length).trim();
      detail = [...body.slice(0, qi), ...(rest ? [rest] : []), ...body.slice(qi + 1)].slice(0, 4);
    } else {
      if (q < 0) return null;
      for (let i = q - 1; i >= 0 && detail.length < 4; i--) {
        const l = lines[i].trim().replace(/^←\s*|\s*→$/g, ''); // a multi-question tab bar: ← ☐ Topic ✔ Submit →
        if (ASK_RULE_RE.test(l) || /^[╭╰│]/.test(l)) break;
        if (l) detail.unshift(l);
      }
    }
    return { question, detail, nav, multi: options.some(o => o.checked !== undefined),
      options: options.map(o => ({ ...o, input: !o.submit && /^Type something\.?$/i.test(o.label) })) };
  }
  // Codex runs a conversation in one process at a time: while another copy holds it (often an orphan
  // from an earlier run) it shows a lock screen waiting for R. Typing there would press its keys
  // (r retry, f fork), so nothing is sent until the lock is gone.
  const LOCK_RE = /open in another app[\s\S]*(press R\b|to retry)/i;
  function agentLocked(t) { return !t?._sdk?.alive && !!t?.term && isLiveTerminal(t) && LOCK_RE.test(screenText(t)); }
  async function waitUnlocked(t, maxMs = 300000) {
    const t0 = Date.now();
    while (agentLocked(t) && Date.now() - t0 < maxMs) await sleep(500);
    return isLiveTerminal(t) && !agentLocked(t);
  }
  async function takeOverChatSession(ws) {
    const t = liveThreadAgent(ws) || ws;
    if (!agentLocked(t) || t._takingOverSession) return;
    const segment = t._chatSeg;
    const sid = segment?.sessionId;
    t._takingOverSession = true;
    try {
      const released = await window.electronAPI.releaseAgentSession(sid, t.id);
      if (findTermById(t.id)?.term !== t || t._chatSeg !== segment || !agentLocked(t)) return;
      sendStdin(t.id, new TextEncoder().encode('r'));
      if (await waitUnlocked(t, 5000) || !agentLocked(t)) return;
      zoomBadge(released ? 'Codex still has this conversation open. Close it in the other app, then retry.'
        : 'Could not identify the session owner safely. Close this conversation in the other app, then retry.');
    } catch (error) {
      zoomBadge(error.message || 'Could not release the conversation');
    } finally {
      delete t._takingOverSession;
    }
  }
  // The process really running in the tab right now (the watcher's view can be 1.5s old).
  async function agentRunning(entry, h) {
    if (entry._sdk?.alive) return true;
    const name = String(await checkTerminalRunning(entry.id, true) || '').toLowerCase().replace(/\.(exe|cmd)$/, '');
    return name === h.bin || name === 'unknown';
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // A fresh agent is ready once its screen has drawn and stopped changing (TUIs repaint
  // constantly, so output silence never comes). A trust question returns at once.
  async function waitAgentReady(entry, maxMs = 20000) {
    const t0 = Date.now();
    let last = '', since = t0;
    while (Date.now() - t0 < maxMs && isLiveTerminal(entry)) {
      await sleep(120);
      const txt = screenText(entry);
      if (TRUST_RE.test(txt)) return 'trust';
      if (LOCK_RE.test(txt)) return 'lock';
      if (txt !== last) { last = txt; since = Date.now(); }
      else if (txt.trim() && Date.now() - since > 500) return 'ready';
    }
    return 'timeout';
  }
  // Quit the agent running in a tab (Ctrl+C until it is back at its shell). Anything that is not
  // an agent is left alone.
  async function stopTabAgent(entry) {
    if (entry._sdk?.alive) { // a structured session: end it (it holds no terminal)
      entry._sdk.alive = entry._sdk.busy = false; entry._sdk.ask = null; entry._agentWorking = false;
      _tabAgent.set(entry.id, null);
      refreshWorkspaceProcsSoon();
      await window.electronAPI.chatSdkStop(entry.id);
      syncTabAgentIcon(entry);
    }
    const norm = n => String(n || '').toLowerCase().replace(/\.(exe|cmd)$/, '');
    let name = await checkTerminalRunning(entry.id);
    if (name === null) return true;
    if (!THREAD_HARNESSES.some(x => x.bin === norm(name))) return false;
    for (let i = 0; i < 12 && name !== null; i++) {
      if (i % 3 === 0) sendStdin(entry.id, new TextEncoder().encode('\x03'));
      await sleep(150);
      name = await checkTerminalRunning(entry.id);
    }
    // The quick reads can still list an agent that already quit (Windows): confirm before giving up.
    if (name !== null) name = await checkTerminalRunning(entry.id, true);
    _tabAgent.set(entry.id, null);
    return name === null;
  }
  // Appended to the first message a new agent gets when the chat already has history
  // (the transcript reader strips it from the history again).
  // T3 Code's side chat framing.
  const SIDE_NOTE = ' <terminalvibe_context side="true">You are in a side chat beside the main thread. The main thread may still be running in the same folder. Answer my questions; do not continue or redo the main thread\'s task. Never mention this context.</terminalvibe_context>';
  // "Bring back": the main thread gets the side chat's history with the next message sent there.
  const _bringBackNote = file => ` <terminalvibe_context side-chat="${file}">I asked side questions in a side chat; its history is in that file. Read it only if my message depends on it. Never mention this context or the file.</terminalvibe_context>`;
  const _handoffNote = file => ` <terminalvibe_context history="${file}">Read the history only if my message depends on earlier work. Never mention this context or the file and never summarize it; reply only to my message.</terminalvibe_context>`;
  // Start the picked agent and type the message in. `replace`: the chat's running agent of the
  // same kind, started with other flags.
  // Context is never dropped:
  //  - the same agent continues its session (resumed with the new flags, context kept): the one
  //    being replaced, or with nothing running, the chat's latest conversation if it was this agent's;
  //  - otherwise a new session starts and gets the whole chat so far as a handoff file.
  function ensureChatTerminalSession(tab) {
    delete tab._chatShellUnused;
    if (tab._terminalSessionOpening) return tab._terminalSessionOpening;
    tab._terminalSessionOpening = (async () => {
      try {
        if (!findTermById(tab.id) || _chatStarting.has(tab.id) || _chatSending.has(tab.id)) return true;
        // The terminal view resumes the session in the real CLI: the structured session hands it over first
        // (one process per session). A turn in progress is never cut off for it.
        if (tab._sdk?.alive) {
          if (tab._sdk.busy || tab._sdk.ask) throw Error(`${harnessOf(tab._sdk.harness)?.name || 'The agent'} is working: stop it or wait for it to finish first.`);
          tab._sdk.alive = false; _tabAgent.set(tab.id, null);
          await window.electronAPI.chatSdkStop(tab.id);
        }
        const segs = threadSegments(tab);
        let latest = [...segs].reverse().find(s => s.used || s.sessionId || s === tab._chatSeg) || segs[segs.length - 1];
        const process = await checkTerminalRunning(tab.id);
        const running = THREAD_HARNESSES.find(h => h.bin === String(process || '').toLowerCase().replace(/\.exe$/, ''));
        if (running && (!latest || (running.id === latest.harness && (tab._chatSeg === latest || tab._chatSeg?.sessionId === latest.sessionId && latest.sessionId)))) {
          _tabAgent.set(tab.id, running.id);
          return true; // Keep the process that already owns this chat session.
        }
        if (process !== null) throw Error('This terminal is already running another process. Stop it before resuming this chat.');
        // Codex session ids may not have been discovered before the tab closed or the app quit.
        if (latest && !latest.sessionId && window.electronAPI?.threadHistory) {
          const history = await window.electronAPI.threadHistory(threadMeta(tab));
          history.forEach((result, i) => {
            if (segs[i] && result.sessionId) segs[i].sessionId = result.sessionId;
            if (segs[i] && result.items?.length) segs[i].used = true;
          });
          latest = [...segs].reverse().find(s => s.used || s.sessionId) || latest;
        }
        if (!findTermById(tab.id)) return false;
        if (latest?.frozen) throw Error('Send a message in this fork first to create its own agent session.');
        if (latest?.used && !latest.sessionId) throw Error('The saved session could not be found. Send a message in chat to continue with its saved history.');
        const current = chatOpts(tab);
        const options = latest ? { harness: latest.harness, model: latest.model || 'default', effort: latest.effort || 'default',
          access: current.harness === latest.harness ? current.access : 'default' } : current;
        if (!harnessOf(options.harness) || !CHAT_AGENTS[options.harness]) throw Error('This chat’s agent harness is unavailable.');
        if (latest?.sessionId && !['claude', 'codex', 'antigravity'].includes(options.harness)) throw Error(`Session resume is not supported for ${harnessOf(options.harness).name} yet.`);
        return await startChatAgent(tab, tab, null, null, { terminalOnly: true, resumeSegment: latest?.sessionId ? latest : null, options });
      } catch (err) { zoomBadge(err.message || 'Could not resume this chat session'); return false; }
    })().finally(() => { delete tab._terminalSessionOpening; });
    return tab._terminalSessionOpening;
  }
  async function startChatAgent(ws, chatTab, text, replace, launch = {}) {
    const o = launch.options || chatOpts(ws), h = harnessOf(o.harness);
    const { found = {}, threadsDir } = await loadChatAgents();
    if (!found[h.bin]) { zoomBadge(`${h.name} was not found on PATH`); return false; }
    const segs = threadSegments(ws);
    const oldSeg = replace?._chatSeg;
    const lastUsed = [...segs].reverse().find(x => x.used);
    const resumeSeg = launch.resumeSegment || (replace ? ((replace._chatSent || oldSeg?.used) ? oldSeg : null)
      : lastUsed?.harness === o.harness && !lastUsed.frozen ? lastUsed : null);
    const resumeSid = resumeSeg?.sessionId || null;
    const sid = resumeSid || (o.harness === 'claude' ? uuid() : null);
    // A side chat's first session forks the main thread's: it starts with what the thread knows.
    const side = ws.chat?.side, firstSide = !!side && !resumeSid && !segs.some(x => x.used);
    const forkSid = firstSide && side.harness === o.harness ? side.sessionId : null;
    // A new session after earlier ones: hand it everything said so far.
    let handoff = null;
    if (!resumeSid && lastUsed && window.electronAPI?.threadHandoff) {
      try { handoff = await window.electronAPI.threadHandoff({ ...threadMeta(ws), names: Object.fromEntries(THREAD_HARNESSES.map(x => [x.id, x.name])) }); }
      catch { zoomBadge('Could not write the history for the new agent'); }
    }
    // Any other tab still running the session being resumed goes too: one process per session.
    const holders = resumeSeg ? getWorkspaceTerminals(wsOf(ws) || {}).filter(x => x !== replace && x._chatSeg === resumeSeg) : [];
    // Transcripts are found by folder: always launch in a known one.
    // (and a resumed session in its own folder: Claude keeps sessions per project folder).
    if (ws.chat?.scratch && !ws.chat.cwd && window.electronAPI?.threadScratch) { ws.chat.cwd = ws.cwd = await window.electronAPI.threadScratch(); saveState(); }
    const cwd = resumeSeg?.cwd || replace?.cwd || chatCwd(ws) || undefined;
    await ensureThreadBranch(ws, cwd);
    // The PTY spawn falls back to ~ for a missing folder: never run a thread's agent somewhere else.
    if (cwd && !cwd.startsWith('~') && window.electronAPI?.resolveLocalPath && !await window.electronAPI.resolveLocalPath(cwd))
      throw Error(`The project folder no longer exists: ${cwd}`);
    _chatStarting.set(ws.id, { text: `${resumeSid ? 'Resuming' : 'Starting'} ${modelName(o, false, ws)}` }); syncThreadComposer(ws);
    try {
      // The agent runs in the Chat tab's own terminal (the chat page sits over it; the footer
      // button shows it). Whatever agent runs there now quits first: one agent per Chat tab.
      const entry = chatTab;
      if (launch.terminalOnly) {
        if (findTermById(entry.id)?.term !== entry) return false;
        if (await checkTerminalRunning(entry.id) !== null) throw Error('The terminal became busy before the session could resume.');
        if (findTermById(entry.id)?.term !== entry) return false;
      }
      if (!await stopTabAgent(entry)) { zoomBadge('The agent in this tab did not quit; stop it in its terminal first'); return false; }
      if (launch.terminalOnly && findTermById(entry.id)?.term !== entry) return false;
      // Claude Code / Codex chats run as structured sessions (not in the terminal); the terminal view runs the real CLI.
      const viaSdk = !launch.terminalOnly && sdkHarness(o.harness);
      if (viaSdk) {
        const r = await window.electronAPI.chatSdkStart(entry.id, { harness: o.harness, bin: found[h.bin], cwd, access: o.access,
          argv: o.harness === 'claude' ? CHAT_AGENTS.claude.argv(o, sid, !!resumeSid, forkSid, threadsDir) : [],
          options: sdkTurnOptions(o), resume: o.harness !== 'claude' ? resumeSid : null, fork: o.harness === 'codex' ? forkSid : null });
        if (!r?.ok) throw Error(r?.error || `Could not start ${h.name}`);
        if (findTermById(entry.id)?.term !== entry) { window.electronAPI.chatSdkStop(entry.id); return false; }
        entry._sdk = { alive: true, harness: o.harness, busy: false, ask: null, sessionId: r.sessionId || sid };
      } else {
        if (entry._sdk?.alive) { entry._sdk.alive = false; await window.electronAPI.chatSdkStop(entry.id); }
        entry.term.reset(); // the agent draws on a clean screen (and readiness never reads the old one)
        const started = await createAgentTerminal({ id: entry.id, ...getSlotDimensions(entry), cwd, executable: found[h.bin],
          argv: CHAT_AGENTS[o.harness].argv(o, sid, !!resumeSid, forkSid, threadsDir), returnToShell: true, replaceIdle: true });
        if (!started) { noteChatError(chatTab, `Could not start ${h.name}`); return false; }
        entry.dead = false;
        entry.term.options.disableStdin = false;
      }
      if (cwd) entry.cwd = cwd;
      entry.toolProvider = h.id;
      if (o.harness === 'claude') entry.claudeSessionId = sid;
      entry._chatCfg = { harness: o.harness, model: o.model, effort: o.effort, access: o.access, fast: o.fast, ultra: o.ultra };
      _tabAgent.set(entry.id, h.id); // the process watcher won't adopt it a second time
      refreshWorkspaceProcsSoon();
      entry._agentSince = Date.now();
      syncTabAgentIcon(entry);
      ws.chat ||= { createdAt: Date.now() };
      // Keep inherited picks once the first message makes a session segment the history fallback.
      if (!launch.terminalOnly) ws.chat.opts ??= o;
      ws.chat.agentTermId = entry.id;
      if (resumeSid) { entry._chatSeg = resumeSeg; Object.assign(resumeSeg, { model: o.model, effort: o.effort, used: true }); entry._chatSent = true; }
      else {
        // A replaced agent that never got a message leaves nothing in the history.
        if (oldSeg && !replace._chatSent && !oldSeg.used) segs.splice(segs.indexOf(oldSeg) >>> 0, 1);
        // A Codex session that never wrote a transcript (no id found for it) goes: Codex sessions are matched
        // by folder and start time, so it would otherwise claim the new session's transcript.
        while (window.electronAPI?.threadHistory && segs.length && segs[segs.length - 1].harness === 'codex' && !segs[segs.length - 1].sessionId) segs.pop();
        entry._chatSent = false;
        entry._chatSeg = { harness: h.id, sessionId: sid || (viaSdk && entry._sdk?.sessionId) || null, cwd: entry.cwd, since: Date.now() - 5000, model: o.model, effort: o.effort, ...(handoff ? { handoff: true } : {}) };
        segs.push(entry._chatSeg);
      }
      // Set at launch: if this send fails after the start, the next message (sent straight to the running agent) carries them.
      entry._handoff = handoff;
      entry._sideNote = firstSide;
      // One process per session: another tab still on the replaced/resumed session closes.
      for (const old of [replace, ...holders].filter(x => x && x !== entry)) { _tabAgent.set(old.id, null); removeTerminal(ws.id, old.id, false, false, true, true); }
      saveState();
      // Switching views only starts/resumes the TUI. Never submit an empty message or
      // consume trust/permission prompts; the terminal is already visible for the user.
      if (launch.terminalOnly) return true;
      // A structured session takes messages at once: no screen to wait for, no trust or lock screen.
      if (viaSdk) return text == null ? true : await sendToAgent(entry, text, false, launch.files);
      if (await waitAgentReady(entry) === 'trust') {
        // The question shows in the chat's answer tray (chatWorking → ask); a screen it can't read shows the terminal.
        // Send once it is answered (or the agent quits, or 5 minutes pass).
        const inUi = !!agentQuestion(entry);
        _chatStarting.set(ws.id, { text: inUi ? `Answer ${h.name}'s question` : `Answer ${h.name}'s question in its terminal`, wait: true }); syncThreadComposer(ws);
        if (inUi) { if (curChat() === ws) syncWorking(ws); } else setChatView(entry, true);
        const t0 = Date.now();
        while (isLiveTerminal(entry) && TRUST_RE.test(screenText(entry)) && Date.now() - t0 < 300000) {
          await sleep(500);
          if (!await agentRunning(entry, h)) break;
        }
        if (await agentRunning(entry, h)) await waitAgentReady(entry, 10000);
        setChatView(entry, false);
      }
      if (agentLocked(entry)) {
        if (!await waitUnlocked(entry)) { zoomBadge(`${h.name}: the conversation is still open in another app`); return false; }
        await waitAgentReady(entry, 10000);
      }
      // Never type the message into the shell left behind by an agent that quit.
      if (!isLiveTerminal(entry) || !await agentRunning(entry, h)) { zoomBadge(`${h.name} exited before the message was sent`); return false; }
      if (text == null) return true; // a restart with new flags only: the notes ride on the next message
      return await sendToAgent(entry, text);
    } catch (err) { noteChatError(chatTab, err.message || `Could not start ${h.name}`); return false; }
    finally { _chatStarting.delete(ws.id); if (curChat() === ws) syncThreadPanel(true); }
  }
  // ── Attachments: picked, dropped or pasted. Keep file references in the draft and transcript.
  let _chatFiles = []; // [{ name, path, image, preview }]
  const _chatPreviewLoads = new WeakSet();
  function hydrateChatFiles(files, refresh) {
    if (!window.electronAPI?.readImageFile) return;
    for (const file of files) {
      if (!file.image || file.preview || !file.path || _chatPreviewLoads.has(file)) continue;
      _chatPreviewLoads.add(file);
      window.electronAPI.readImageFile(file.path).then(result => {
        if (!result?.data) return;
        file.preview = `data:${result.mediaType};base64,${result.data}`;
        file.size ||= result.size || Math.floor(result.data.length * 3 / 4) - (result.data.endsWith('==') ? 2 : result.data.endsWith('=') ? 1 : 0);
        refresh();
      }).catch(() => {});
    }
  }
  const thrFiles = thrPage.querySelector('#sbr-thread-attachments');
  // The textarea is the serialized draft; the visible editor keeps references atomic and clickable.
  function chatEditorText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    if (node.dataset?.mention) return node.dataset.mention;
    if (node.nodeName === 'BR') return node.parentNode?.childNodes.length === 1 ? '' : '\n';
    let text = '';
    for (const child of node.childNodes) {
      if (['DIV', 'P'].includes(child.nodeName) && text && !text.endsWith('\n')) text += '\n';
      text += chatEditorText(child);
    }
    return text;
  }
  function prepareChatPastedText(text) {
    const files = _chatFiles.map(file => ({ ...file }));
    const allocator = document.createElement('textarea'); allocator.value = thrInput.value;
    const value = text.replace(new RegExp(ATTACHMENT_PATH_RE.source, 'gi'), (match, quote, quoted, bare) => {
      const path = quoted || bare;
      let file = files.find(file => !file.cite && !file.at && !file.thread && file.path === path);
      if (!file) {
        file = { path, name: path.split(/[\\/]/).pop(), image: /\.(png|jpe?g|gif|webp|bmp)$/i.test(path), size: _thrImgSize.get(path) || 0 };
        files.push(file);
      }
      if (!file.mention) {
        allocator.setSelectionRange(allocator.value.length, allocator.value.length);
        insertChatMention(file, allocator, files);
      }
      return file.mention;
    });
    return { text: value, files };
  }
  function copyChatInputSelection(event, editor) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
    const selected = range.cloneRange();
    // References are atomic: copy their source, not thumbnail/name/size decoration.
    const startRef = (selected.startContainer.parentElement)?.closest('[data-mention]');
    const endRef = (selected.endContainer.parentElement)?.closest('[data-mention]');
    if (startRef && editor.contains(startRef)) selected.setStartBefore(startRef);
    if (endRef && editor.contains(endRef)) selected.setEndAfter(endRef);
    const typed = chatEditorText(selected.cloneContents());
    const files = _chatFiles.filter(file => file.mention && typed.includes(file.mention));
    event.preventDefault();
    event.clipboardData.setData('text/plain', chatMessageText(typed, files));
  }
  function rememberChatEditorSelection(editor, input = thrInput) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const selected = selection.getRangeAt(0);
    if (!editor.contains(selected.startContainer) || !editor.contains(selected.endContainer)) return;
    const prefix = document.createRange(); prefix.selectNodeContents(editor);
    prefix.setEnd(selected.startContainer, selected.startOffset);
    const start = chatEditorText(prefix.cloneContents()).length;
    prefix.setEnd(selected.endContainer, selected.endOffset);
    input.setSelectionRange(start, chatEditorText(prefix.cloneContents()).length);
  }
  function restoreChatEditorSelection(editor, input = thrInput) {
    const point = (offset, parent = editor) => {
      let index = 0;
      for (const child of parent.childNodes) {
        const length = chatEditorText(child).length;
        if (offset <= length) {
          if (child.nodeType === Node.TEXT_NODE) return [child, Math.min(offset, child.data.length)];
          // Markdown styling spans hold plain text: step inside them; references stay atomic.
          if (child.nodeType === Node.ELEMENT_NODE && !child.dataset.mention && child.firstChild) return point(offset, child);
          return [parent, index + (offset > 0 ? 1 : 0)];
        }
        offset -= length; index++;
      }
      return [parent, parent.childNodes.length];
    };
    const range = document.createRange();
    range.setStart(...point(input.selectionStart)); range.setEnd(...point(input.selectionEnd));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
  // Live markdown in the composer: styles the text but keeps every character (markers dimmed),
  // so the draft, caret offsets and what is sent stay exactly as typed.
  function mdInputHtml(s, lineStart = true) {
    const mark = t => `<span class="md-mark">${escHtml(t)}</span>`;
    const inline = t => {
      const re = /(`+)([^`\n]+?)\1|(\*\*|__)(?=\S)([^\n]*?\S)\3|~~(?=\S)([^\n]*?\S)~~|(?<![\w*])(\*|_)(?=[^\s*_])([^\n*_]*?[^\s*_])\6(?![\w*])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
      let out = '', last = 0;
      for (const x of t.matchAll(re)) {
        out += escHtml(t.slice(last, x.index)); last = x.index + x[0].length;
        if (x[1]) out += `<span class="md-code">${mark(x[1])}${escHtml(x[2])}${mark(x[1])}</span>`;
        else if (x[3]) out += `<span class="md-strong">${mark(x[3])}${inline(x[4])}${mark(x[3])}</span>`;
        else if (x[5]) out += `<span class="md-del">${mark('~~')}${inline(x[5])}${mark('~~')}</span>`;
        else if (x[6]) out += `<span class="md-em">${mark(x[6])}${inline(x[7])}${mark(x[6])}</span>`;
        else out += `<span class="md-link">${mark('[')}${escHtml(x[8])}${mark('](')}<span class="md-url">${escHtml(x[9])}</span>${mark(')')}</span>`;
      }
      return out + escHtml(t.slice(last));
    };
    let fence = false;
    return s.split('\n').map((line, i) => {
      const start = i > 0 || lineStart;
      if (start && /^\s*```/.test(line)) { fence = !fence; return `<span class="md-code-block">${mark(line)}</span>`; }
      if (fence) return `<span class="md-code-block">${escHtml(line)}</span>`;
      if (!start) return inline(line);
      let m = line.match(/^(#{1,6} )(.*)$/);
      if (m) return `<span class="md-h md-h${m[1].length - 1}">${mark(m[1])}${inline(m[2])}</span>`;
      if ((m = line.match(/^(\s*>\s?)(.*)$/))) return `<span class="md-quote">${mark(m[1])}${inline(m[2])}</span>`;
      // List items: indent (widened when rendered) + marker; a bullet's dash is drawn as • / ◦ by depth.
      if ((m = line.match(/^(\s*)([-*+]|\d+[.)])(\s)(.*)$/))) {
        const bullet = /^[-*+]$/.test(m[2]), sub = Math.floor(m[1].replace(/\t/g, '  ').length / 2) % 2;
        return (m[1] ? `<span class="md-indent">${escHtml(m[1])}</span>` : '')
          + `<span class="md-mark md-list${bullet ? ' md-bullet' + (sub ? ' md-bullet-sub' : '') : ''}">${escHtml(m[2] + m[3])}</span>` + inline(m[4]);
      }
      return inline(line);
    }).join('\n');
  }
  // Rendered mode hides the markers; the token(s) at the caret show theirs (class md-open), so editing them is predictable.
  function openMdTokens(editor) {
    editor.querySelectorAll('.md-open').forEach(x => x.classList.remove('md-open'));
    const sel = window.getSelection();
    if (!editor.classList.contains('md-render') || !sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.startContainer)) return;
    const open = n => { for (let x = n; x && x !== editor; x = x.parentNode) if (x.nodeType === Node.ELEMENT_NODE && /\bmd-(?!mark|url)/.test(x.className)) x.classList.add('md-open'); };
    for (const [c, o] of [[r.startContainer, r.startOffset], [r.endContainer, r.endOffset]]) {
      open(c);
      // At a token's edge (caret just before or after it): open that neighbour too.
      const text = c.nodeType === Node.TEXT_NODE;
      open(text ? (o === 0 ? c.previousSibling : null) : c.childNodes[o - 1]);
      open(text ? (o === c.data.length ? c.nextSibling : null) : c.childNodes[o]);
    }
  }
  function cacheThreadImage(path, preview) {
    _thrImgCache.set(path, preview);
    if (_thrImgCache.size > 30) _thrImgCache.delete(_thrImgCache.keys().next().value);
  }
  function chatImageReferenceHtml(file, tabIndex = 0) {
    const path = file.path || '', name = file.name || path.split(/[\\/]/).pop();
    const image = file.image ?? /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);
    if (file.preview) cacheThreadImage(path, file.preview);
    if (file.size) _thrImgSize.set(path, file.size);
    const preview = file.preview || _thrImgCache.get(path), size = file.size || _thrImgSize.get(path);
    const icon = image ? 'ph-image' : linkFileIcon(path);
    return `<a href="#" class="thr-image-ref thr-img-link" tabindex="${tabIndex}" data-path="${escHtml(path)}" title="${escHtml(path)}"><span class="thr-inline-image-icon">${image && preview ? `<img src="${escHtml(preview)}" alt="">` : `<i class="ph ${icon}" aria-hidden="true"></i>`}</span><span class="thr-img-link-name">${escHtml(name)}</span><small class="thr-img-size" data-size-path="${escHtml(path)}">${size ? escHtml(fmtBytes(size).replace(' ', '')) : ''}</small></a>`;
  }
  function openChatAttachment(file) {
    if (!file?.path) return;
    const image = file.image ?? /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.path);
    if (image) openClaudeRefViewer(null, { kind: 'file', path: file.path, label: file.name || file.path.split(/[\\/]/).pop() }, '', file.preview);
    else openClaudeRefViewer(null, { kind: 'text-file', path: file.path, label: file.name || file.path }, '');
  }
  function hydrateChatAttachmentSizes(surface) {
    if (!window.electronAPI?.attachmentInfo) return;
    for (const label of surface.querySelectorAll('.thr-img-size[data-size-path]')) {
      const path = label.dataset.sizePath;
      if (!path) continue;
      if (_thrImgSize.has(path)) { label.textContent = fmtBytes(_thrImgSize.get(path)).replace(' ', ''); continue; }
      if (!_chatAttachmentStats.has(path)) {
        const request = window.electronAPI.attachmentInfo(path).then(info => {
          if (info && Number.isFinite(info.size) && info.size >= 0) _thrImgSize.set(path, info.size);
          return info;
        }).catch(() => null);
        _chatAttachmentStats.set(path, request);
        if (_chatAttachmentStats.size > 200) _chatAttachmentStats.delete(_chatAttachmentStats.keys().next().value);
      }
      _chatAttachmentStats.get(path).then(info => { if (info && label.isConnected) label.textContent = fmtBytes(info.size).replace(' ', ''); });
    }
  }
  function syncChatInputLinks(surface = thrPage, files = _chatFiles) {
    const input = threadPart(surface, 'input'), editor = threadPart(surface, 'input-links');
    if (!input || !editor) return;
    const references = new Map(files.filter(f => f.mention).map(f => [f.mention, f]));
    const signature = JSON.stringify([...references].map(([key, f]) => [key, f.cite, f.name, f.size, !!f.preview]));
    editor.contentEditable = surface === thrPage && !input.disabled ? 'true' : 'false';
    editor.dataset.placeholder = input.placeholder || 'Ask anything';
    editor.dataset.empty = String(!input.value);
    editor.setAttribute('aria-disabled', String(input.disabled));
    const md = threadSettings.markdown !== 'off';
    editor.classList.toggle('md-render', threadSettings.markdown === 'on');
    if (editor._draftValue === input.value && editor._draftReferences === signature && editor._draftMd === md) return;
    const tabIndex = surface === thrPage ? 0 : -1;
    const tokens = [...references.keys()].sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    let at = 0;
    const markup = (tokens.length ? input.value.split(new RegExp(`(${tokens.join('|')})`, 'g')) : [input.value]).map(part => {
      const file = references.get(part), lineStart = !at || input.value[at - 1] === '\n';
      at += part.length;
      if (!file) return md ? mdInputHtml(part, lineStart) : escHtml(part);
      // An @ mention: the file or folder's icon and name; sent as typed (@path), the agents resolve it.
      if (file.at) return `<span class="thr-inline-ref" contenteditable="false" data-mention="${escHtml(part)}"><a href="#" class="thr-at-ref" tabindex="${tabIndex}" title="${escHtml(file.path)}">`
        + `<i class="ph ${file.dir ? 'ph-folder' : linkFileIcon(file.name)}" aria-hidden="true"></i><span>${escHtml(file.name)}</span></a></span>`;
      if (file.thread) return `<span class="thr-inline-ref" contenteditable="false" data-mention="${escHtml(part)}"><a href="#" class="thr-cite-ref thr-thread-ref" tabindex="${tabIndex}" title="Thread: ${escHtml(file.name)}">`
        + `<i class="ph ph-chats-circle" aria-hidden="true"></i><span>${escHtml(file.name)}</span></a></span>`;
      const label = file.cite ? file.cite.replace(/\s+/g, ' ').slice(0, 42) + (file.cite.replace(/\s+/g, ' ').length > 42 ? '…' : '') : file.name;
      const link = file.cite
        ? `<a href="#" class="thr-cite-ref" tabindex="${tabIndex}" title="${escHtml(file.cite)}"><i class="ph ph-quotes" aria-hidden="true"></i><span>${escHtml(label)}</span></a>`
        : chatImageReferenceHtml(file, tabIndex);
      return `<span class="thr-inline-ref" contenteditable="false" data-mention="${escHtml(part)}">${link}</span>`;
    }).join('');
    // Keep native spellcheck ranges when typing leaves the rendered markup unchanged.
    if (editor.innerHTML !== markup) editor.innerHTML = markup;
    editor._draftValue = input.value; editor._draftReferences = signature; editor._draftMd = md;
    if (surface === thrPage && document.activeElement === editor) restoreChatEditorSelection(editor, input);
    openMdTokens(editor); // now, not on the async selectionchange: no frame with the caret's markers hidden
  }
  function insertChatMention(file, input = thrInput, files = _chatFiles) {
    const kind = file.cite ? 'Citation' : file.thread ? 'Thread' : file.image === false ? 'File' : 'Image';
    const expression = new RegExp('\\[' + kind + ' (\\d+)\\]', 'g');
    const used = [...input.value.matchAll(expression)].map(m => +m[1]);
    file.mention = `[${kind} ${Math.max(0, ...used, ...files.filter(f => f.mention?.startsWith(`[${kind} `)).map(f => +(f.mention?.match(/\d+/)?.[0] || 0))) + 1}]`;
    const start = input.selectionStart, end = input.selectionEnd;
    const before = input.value.slice(0, start), after = input.value.slice(end);
    const insert = (before && !/\s$/.test(before) ? ' ' : '') + file.mention + (!after || !/^\s/.test(after) ? ' ' : '');
    input.setRangeText(insert, start, end, 'end');
  }
  const THREAD_DRAG = 'application/x-terminalvibe-thread';
  // A thread dropped on the composer: its history is written to a file (as for a handoff) and the
  // message links it by title; the path rides in a trailing note the chat never shows.
  async function addChatThreadRef(id) {
    const src = findChatThread(id), cur = curChat();
    if (!src || !cur) return;
    if (threadKey(src) === threadKey(cur)) { zoomBadge('That is this thread'); return; }
    if (_chatFiles.some(f => f.thread === threadKey(src))) return;
    let path = null;
    try { path = await window.electronAPI?.threadHandoff?.({ ...threadMeta(src), names: Object.fromEntries(THREAD_HARNESSES.map(x => [x.id, x.name])) }); } catch {}
    if (!path) { zoomBadge(window.electronAPI?.threadHandoff ? 'Could not write that thread\'s history' : 'Thread context needs the desktop app'); return; }
    const ref = { thread: threadKey(src), name: src.chat?.title || src.label || 'Thread', path };
    insertChatMention(ref); _chatFiles.push(ref);
    renderChatFiles(); autosizeThreadInput();
    thrInput.focus();
  }
  function chatMessageText(typed, files) {
    const quoted = [], trailing = [], notes = [];
    let body = typed;
    for (const file of files) {
      if (file.at) continue; // @path stays in the text as typed
      if (file.thread) {
        const title = `“${file.name}”`;
        if (file.mention && body.includes(file.mention)) body = body.split(file.mention).join(title); else trailing.push(title);
        notes.push(` <terminalvibe_context thread="${file.path}">${title} is another chat thread; its full history is in that file. Read it for the context of my message. Never mention this context or the file.</terminalvibe_context>`);
        continue;
      }
      if (file.cite) {
        const quote = file.cite.split('\n').map(line => '> ' + line).join('\n');
        if (file.mention && body.includes(file.mention)) body = body.split(file.mention).join('\n' + quote + '\n');
        else quoted.push(quote);
      } else if (file.path) {
        if (file.mention && body.includes(file.mention)) body = body.split(file.mention).join(shellQuote(file.path));
        else trailing.push(shellQuote(file.path));
      }
    }
    return [...quoted, [body, trailing.join(' ')].filter(Boolean).join(' ')].filter(Boolean).join('\n\n') + notes.join('');
  }
  function renderChatFiles(files = _chatFiles, surface = thrPage) {
    const tab = curChat();
    if (surface === thrPage && tab) {
      tab._files = files;
      if (!tab._editingQueued) {
        tab.chat ||= { createdAt: Date.now() };
        tab.chat.draftFiles = files;
        tab.chat.draft = thrInput.value;
        tab._draft = thrInput.value;
      }
    }
    hydrateChatFiles(files, () => {
      if (surface !== thrPage || (curChat() === tab && _chatFiles === files)) renderChatFiles(files, surface);
    });
    const thrFiles = threadPart(surface, 'attachments');
    thrFiles.hidden = !files.some(f => !f.cite && !f.at && !f.thread);
    thrFiles.innerHTML = files.map((f, i) => {
      if (f.cite || f.at || f.thread) return '';
      const preview = f.image && f.preview;
      return `<span class="thr-file${f.cite ? ' cite' : preview ? ' image' : ' document'}" title="${escHtml(f.cite || f.path)}">`
        + (f.cite ? `<i class="ph ph-quotes" aria-hidden="true"></i><button type="button" class="thr-cite-link" data-i="${i}" aria-label="View citation">${escHtml(f.cite.replace(/\s+/g, ' '))}</button>`
          : preview ? `<button type="button" class="thr-file-open" data-i="${i}" aria-label="Open ${escHtml(f.name)} fullscreen"><img class="thr-file-preview" src="${escHtml(f.preview)}" alt="" decoding="async"></button>`
          : `<button type="button" class="thr-file-open thr-document-open" data-i="${i}" aria-label="Preview ${escHtml(f.name)}"><span class="thr-file-symbol"><i class="ph ${f.image ? 'ph-image ft-image' : linkFileIcon(f.name || f.path || '')}" aria-hidden="true"></i></span>${f.image ? '' : `<span class="thr-file-name">${escHtml(f.name)}</span>`}</button>`)
        + `<button type="button" class="thr-file-x" data-i="${i}" aria-label="Remove ${escHtml(f.cite ? 'citation' : f.name)}"><i class="ph ph-x" aria-hidden="true"></i></button></span>`;
    }).join('');
    syncChatInputLinks(surface, files);
    hydrateChatAttachmentSizes(surface);
    if (surface === thrPage) syncSendBtn();
  }
  const _chatFileAdds = new WeakMap();
  function addChatFiles(files) {
    const tab = curChat();
    if (!tab) return Promise.resolve();
    const pending = (_chatFileAdds.get(tab) || Promise.resolve()).catch(() => {}).then(() => addChatFilesToTab(tab, files));
    _chatFileAdds.set(tab, pending);
    return pending;
  }
  async function findChatImageDuplicate(files, attachment) {
    if (!attachment.image) return files.find(file => !file.image && !file.cite && !file.at && !file.thread && file.path === attachment.path) || null;
    const data = attachment.preview?.split(',')[1];
    for (const file of files) {
      if (!file.image) continue;
      if (file.path === attachment.path) return file;
      let existing = file.preview?.split(',')[1];
      // Restored drafts have metadata only until their preview has loaded.
      if (!existing && data && window.electronAPI?.readImageFile) {
        const result = await window.electronAPI.readImageFile(file.path).catch(() => null);
        existing = result?.data;
      }
      if (data && existing === data) return file;
    }
    return null;
  }
  async function addChatFilesToTab(tab, files) {
    for (const file of files) {
      try {
        const image = /^image\/(png|jpeg|gif|webp|bmp)$/i.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
        const saveAttachment = window.electronAPI?.saveThreadAttachment;
        const persistImage = image && saveAttachment;
        const path = persistImage ? null : await localPathForFile(tab, file);
        if (!path && !persistImage) throw new Error('Could not read ' + file.name);
        const preview = image ? await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reader.onabort = () => resolve('');
          reader.readAsDataURL(file);
        }) : '';
        const attachment = { name: file.name || path?.split(/[\\/]/).pop(), path, image, preview, size: file.size || 0 };
        const attached = curChat() === tab ? _chatFiles : (tab._files ||= tab.chat?.draftFiles || []);
        const duplicate = await findChatImageDuplicate(attached, attachment);
        if (!duplicate && persistImage) {
          const name = isImagePath(file.name) ? file.name : `${file.name || 'image'}.${file.type.split('/')[1]}`;
          attachment.path = await saveAttachment(threadKey(tab), name, new Uint8Array(await file.arrayBuffer()));
          if (!attachment.path) throw new Error('Could not save ' + name);
          attachment.name ||= name;
        }
        if (curChat() === tab && (!duplicate || !duplicate.mention || !thrInput.value.includes(duplicate.mention))) {
          threadPart(thrPage, 'input-links')?._recordDraftUndo?.();
        }
        if (duplicate) {
          duplicate.preview ||= preview;
          duplicate.size ||= attachment.size;
          // Removing an inline link keeps its preview; repasting restores that link.
          if (curChat() === tab) {
            if (!duplicate.mention || !thrInput.value.includes(duplicate.mention)) insertChatMention(duplicate);
          } else {
            const input = document.createElement('textarea'); input.value = tab._draft ?? tab.chat?.draft ?? '';
            input.setSelectionRange(input.value.length, input.value.length);
            if (!duplicate.mention || !input.value.includes(duplicate.mention)) insertChatMention(duplicate, input, attached);
            tab._draft = input.value;
            if (!tab._editingQueued) { tab.chat ||= {}; tab.chat.draft = input.value; tab.chat.draftFiles = attached; }
          }
          continue;
        }
        if (curChat() === tab) {
          insertChatMention(attachment);
          _chatFiles.push(attachment);
        } else {
          (tab._files ||= []).push(attachment);
          // The user switched away while the file was loading; keep it in its original draft.
          const input = document.createElement('textarea'); input.value = tab._draft || ''; input.setSelectionRange(input.value.length, input.value.length);
          insertChatMention(attachment, input, tab._files); tab._draft = input.value;
          tab.chat ||= { createdAt: Date.now() };
          if (!tab._editingQueued) { tab.chat.draft = tab._draft || ''; tab.chat.draftFiles = tab._files; }
        }
      } catch (err) { zoomBadge(err.message || 'Could not attach ' + file.name); }
    }
    renderChatFiles();
    autosizeThreadInput();
    saveState();
    if (curChat() === tab) thrInput.focus({ preventScroll: true });
  }
  thrFiles?.addEventListener('click', e => {
    const remove = e.target.closest('.thr-file-x');
    if (remove) {
      threadPart(thrPage, 'input-links')?._recordDraftUndo?.();
      const [file] = _chatFiles.splice(+remove.dataset.i, 1);
      if (file?.mention) {
        const caret = thrInput.value.slice(0, thrInput.selectionStart).split(file.mention).join('').length;
        thrInput.value = thrInput.value.split(file.mention).join(''); thrInput.setSelectionRange(caret, caret);
      }
      renderChatFiles(); autosizeThreadInput(); saveState(); thrInput.focus({ preventScroll: true }); return;
    }
    const cite = e.target.closest('.thr-cite-link'), citation = cite && _chatFiles[+cite.dataset.i];
    if (citation?.cite) { jumpToCitation(citation); return; }
    const open = e.target.closest('.thr-file-open'), file = open && _chatFiles[+open.dataset.i];
    if (file) openChatAttachment(file);
  });
  const thrFileInput = thrPage.querySelector('#sbr-thread-file');
  thrPage.querySelector('#sbr-thread-attach')?.addEventListener('click', () => thrFileInput.click());
  thrFileInput?.addEventListener('change', () => { addChatFiles([...thrFileInput.files]); thrFileInput.value = ''; });
  thrInput?.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addChatFiles(files); }
  });
  threadPart(thrPage, 'input-links')?.addEventListener('click', e => {
    const reference = e.target.closest('[data-mention]');
    if (!reference) return;
    e.preventDefault();
    const file = _chatFiles.find(f => f.mention === reference.dataset.mention);
    if (file?.cite) jumpToCitation(file);
    else if (file?.thread) { const t = findThreadByKey(file.thread); if (t) openChatTab(t); }
    else if (file && !file.at) openChatAttachment(file);
  });
  {
    const editor = threadPart(thrPage, 'input-links');
    if (editor) {
      editor.contentEditable = 'true';
      thrInput.focus = options => {
        syncChatInputLinks(); editor.focus(options); restoreChatEditorSelection(editor);
      };
      document.addEventListener('selectionchange', () => { rememberChatEditorSelection(editor); openMdTokens(editor); });
      // Live markdown re-renders the editor, which drops the browser's undo: keep our own (typing bursts).
      const hist = { undo: [], redo: [], at: 0, chat: null };
      const snap = () => ({ v: thrInput.value, s: thrInput.selectionStart, e: thrInput.selectionEnd, files: _chatFiles.map(file => ({ ...file })) });
      editor._recordDraftUndo = () => {
        if (hist.chat !== curChat()) Object.assign(hist, { undo: [], redo: [], at: 0, chat: curChat() });
        rememberChatEditorSelection(editor);
        hist.undo.push(snap()); if (hist.undo.length > 200) hist.undo.shift();
        hist.redo.length = 0; hist.at = 0;
      };
      const restore = (from, to) => {
        const state = from.pop();
        if (!state) return;
        to.push(snap());
        thrInput.value = state.v; thrInput.setSelectionRange(state.s, state.e);
        _chatFiles = (state.files || []).map(file => ({ ...file }));
        renderChatFiles();
        editor._draftValue = null; syncChatInputLinks();
        thrInput.dispatchEvent(new Event('input', { bubbles: true }));
      };
      // Like VS Code's auto-surround: a quote / bracket / markdown marker typed over a selection wraps it.
      const SURROUND = { '"': '"', "'": "'", '`': '`', '(': ')', '[': ']', '{': '}', '*': '*', '_': '_', '~': '~' };
      editor.addEventListener('beforeinput', e => {
        if (e.inputType !== 'insertText' || e.isComposing || !SURROUND[e.data]) return;
        rememberChatEditorSelection(editor);
        const v = thrInput.value, s = thrInput.selectionStart, end = thrInput.selectionEnd;
        if (s === end) return;
        e.preventDefault(); e.stopImmediatePropagation();
        applyDraft(v.slice(0, s) + e.data + v.slice(s, end) + SURROUND[e.data] + v.slice(end), s + 1, end + 1); // the text stays selected
      });
      editor.addEventListener('beforeinput', e => { // (all modes: paste replaces the DOM too, so native undo can't follow)
        if (hist.chat !== curChat()) Object.assign(hist, { undo: [], redo: [], chat: curChat() });
        if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
          e.preventDefault();
          if (e.inputType === 'historyUndo') restore(hist.undo, hist.redo); else restore(hist.redo, hist.undo);
          return;
        }
        rememberChatEditorSelection(editor);
        if (Date.now() - hist.at > 400) { hist.undo.push(snap()); if (hist.undo.length > 200) hist.undo.shift(); }
        hist.at = Date.now(); hist.redo.length = 0;
      });
      editor.addEventListener('input', e => {
        thrInput.value = chatEditorText(editor);
        rememberChatEditorSelection(editor);
        const count = _chatFiles.length;
        _chatFiles = _chatFiles.filter(file => !(file.cite || file.at || file.thread) || !file.mention || thrInput.value.includes(file.mention));
        editor._draftValue = thrInput.value;
        if (threadSettings.markdown !== 'off' && !e.isComposing) { editor._draftValue = null; syncChatInputLinks(); }
        if (!thrInput.value) { editor.replaceChildren(); restoreChatEditorSelection(editor); }
        if (_chatFiles.length !== count) renderChatFiles();
        thrInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // A programmatic edit of the draft (list keys below), undoable like typing.
      const applyDraft = (value, caret, caretEnd = caret, files) => {
        editor._recordDraftUndo();
        thrInput.value = value; thrInput.setSelectionRange(caret, caretEnd);
        if (files) { _chatFiles = files; renderChatFiles(); }
        editor._draftValue = null; syncChatInputLinks();
        thrInput.dispatchEvent(new Event('input', { bubbles: true }));
      };
      editor._insertDroppedText = (text, event) => {
        const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (caret && editor.contains(caret.startContainer)) {
          const reference = caret.startContainer.parentElement?.closest('[data-mention]');
          if (reference) { caret.setStartAfter(reference); caret.collapse(true); }
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(caret);
          rememberChatEditorSelection(editor);
        }
        const start = thrInput.selectionStart, end = thrInput.selectionEnd;
        const pasted = prepareChatPastedText(text);
        applyDraft(thrInput.value.slice(0, start) + pasted.text + thrInput.value.slice(end), start + pasted.text.length, start + pasted.text.length, pasted.files);
        thrInput.focus({ preventScroll: true });
      };
      editor.addEventListener('keydown', e => {
        rememberChatEditorSelection(editor);
        // Lists, like GitHub's editor (Enter sends here, so Shift+Enter is the new line): Shift+Enter continues the
        // item (next number), on an empty item ends the list; Tab / Shift+Tab indent / outdent the item.
        if (threadSettings.markdown !== 'off' && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Tab' || (e.key === 'Enter' && e.shiftKey))) {
          const v = thrInput.value, s = thrInput.selectionStart, end = thrInput.selectionEnd;
          const ls = v.lastIndexOf('\n', s - 1) + 1, nl = v.indexOf('\n', s), le = nl < 0 ? v.length : nl;
          const line = v.slice(ls, le), m = line.match(/^(\s*)([-*+]|(\d+)[.)])(\s+)(.*)$/);
          if (m) {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Tab') {
              // At most one level deeper than the list item above (none above: can't nest).
              const prevLine = ls ? v.slice(v.lastIndexOf('\n', ls - 2) + 1, ls - 1) : '';
              const above = prevLine.match(/^(\s*)(?:[-*+]|\d+[.)])\s/);
              const maxIndent = above ? above[1].length + 2 : 0;
              const cut = e.shiftKey ? Math.min(2, m[1].length) : m[1].length + 2 <= maxIndent ? -2 : 0;
              if (cut) applyDraft(v.slice(0, ls) + (cut < 0 ? '  ' + line : line.slice(cut)) + v.slice(le), Math.max(ls, s - cut));
            } else if (!m[5].trim()) applyDraft(v.slice(0, ls) + v.slice(le), ls); // empty item: end the list
            else {
              const ins = '\n' + m[1] + (m[3] ? `${+m[3] + 1}${m[2].slice(-1)}` : m[2]) + m[4];
              applyDraft(v.slice(0, s) + ins + v.slice(end), s + ins.length);
            }
            return;
          }
        }
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        const forwarded = new KeyboardEvent('keydown', { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, cancelable: true });
        thrInput.dispatchEvent(forwarded);
        if (forwarded.defaultPrevented) { e.preventDefault(); e.stopPropagation(); }
      });
      editor.addEventListener('copy', e => copyChatInputSelection(e, editor));
      editor.addEventListener('cut', e => {
        copyChatInputSelection(e, editor);
        if (e.defaultPrevented) document.execCommand('delete');
      });
      editor.addEventListener('paste', e => {
        e.preventDefault();
        const files = [...(e.clipboardData?.files || [])];
        if (files.length) { rememberChatEditorSelection(editor); addChatFiles(files); }
        else {
          // Into the draft text itself: execCommand('insertText') splits lines into <div>s and blank lines
          // (paragraph breaks) got lost reading them back.
          rememberChatEditorSelection(editor);
          const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
          if (!text) return;
          const v = thrInput.value, s = thrInput.selectionStart, end = thrInput.selectionEnd;
          const pasted = prepareChatPastedText(text);
          applyDraft(v.slice(0, s) + pasted.text + v.slice(end), s + pasted.text.length, s + pasted.text.length, pasted.files);
          updateChatComplete();
        }
      });
    }
  }
  // ── Suggestions while typing: "@" lists files and folders, "/" at the draft's start lists commands.
  // Arrows pick, Enter/Tab insert, Escape closes. ──
  const thrComplete = threadPart(thrPage, 'complete');
  const _completeCache = new Map(); // key -> { at, data: Promise }
  const cachedList = (key, ttl, load) => {
    const hit = _completeCache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    const data = load().catch(() => null);
    _completeCache.set(key, { at: Date.now(), data });
    return data;
  };
  let _complete = null; // { kind, start, end, query, items, index }
  const chatCompleteHarness = ws => chatWorking(ws) && liveThreadAgent(ws) ? _tabAgent.get(ws.id) : chatOpts(ws).harness;
  const chatHasSkills = harness => ['codex', 'claude', 'opencode', 'antigravity'].includes(harness);
  const showSkillsInSlash = harness => harness === 'opencode' || harness === 'antigravity';
  const chatCatalogs = new Map();
  function chatCatalog(kind, harness, cwd, tabId) {
    const api = window.electronAPI;
    if (kind === 'skill' ? !chatHasSkills(harness) || !api?.chatSdkSkills : !api?.chatCommands) return null;
    const key = JSON.stringify([kind, harness, cwd]);
    let catalog = chatCatalogs.get(key);
    if (!catalog) {
      catalog = { items: undefined, refreshAt: 0, pending: null };
      chatCatalogs.set(key, catalog);
    }
    if (!catalog.pending && Date.now() >= catalog.refreshAt) {
      catalog.pending = Promise.resolve().then(async () => {
        let items = null;
        try {
          if (kind === 'slash') items = await api.chatCommands(harness, cwd);
          else {
            const agents = harness === 'claude' ? null : await loadChatAgents();
            items = await api.chatSdkSkills(harness, tabId, agents?.found?.[harnessOf(harness).bin], cwd);
          }
        } catch { /* Keep the last catalog available if a refresh fails. */ }
        if (Array.isArray(items)) catalog.items = items;
        else catalog.items ??= null;
        catalog.refreshAt = Date.now() + (Array.isArray(items) ? 60000 : 5000);
        catalog.pending = null;
        if (_complete?.catalog === catalog || _complete?.skillCatalog === catalog) void updateChatComplete();
      });
    }
    return catalog;
  }
  async function openCodeSkillText(tab, text) {
    const catalog = chatCatalog('skill', 'opencode', chatCwd(tab), tab.id);
    if (catalog?.items === undefined) await catalog?.pending;
    const ids = new Set(catalog?.items?.map(skill => skill.name));
    return text.replace(/(^|[\s([{])\$([\w:.-]+?)(?=$|[\s,!?;)\]}]|\.(?=$|\s))/g,
      (match, prefix, name) => ids.has(name) ? prefix + '@' + name : match);
  }
  function chatCompleteTrigger() {
    const editor = threadPart(thrPage, 'input-links');
    if (document.activeElement !== editor || thrInput.selectionStart !== thrInput.selectionEnd) return null;
    const caret = thrInput.selectionStart, before = thrInput.value.slice(0, caret);
    let m = before.match(/^\/([\w:.-]*)$/);
    if (m) {
      const rest = thrInput.value.slice(caret);
      const tail = rest.match(/^[\w:.-]*/)[0];
      // A second slash belongs to a path, even if the caret is in its first component.
      if (rest[tail.length] !== '/') return { kind: 'slash', start: caret - m[1].length - 1, end: caret + tail.length, query: m[1] };
    }
    m = before.match(/(?:^|[\s([{])\$([\w:.-]*)$/);
    if (m) {
      const tail = thrInput.value.slice(caret).match(/^[\w:.-]*/)[0];
      return { kind: 'skill', start: caret - m[1].length - 1, end: caret + tail.length, query: m[1] };
    }
    m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (m) return { kind: 'at', start: caret - m[1].length - 1, end: caret, query: m[1] };
    return null;
  }
  const sameChatCompleteTrigger = (a, b) => !!a && !!b
    && a.kind === b.kind && a.start === b.start && a.end === b.end && a.query === b.query;
  // Best first: name starts with the query, name contains it, path contains it, letters in order.
  function rankPaths(entries, q) {
    q = q.toLowerCase();
    if (!q) return entries.filter(e => !e.rel.includes('/')).sort((a, b) => b.dir - a.dir || a.rel.localeCompare(b.rel)).slice(0, 50);
    const seq = new RegExp([...q].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
    const scored = [];
    for (const e of entries) {
      const p = e.rel.toLowerCase(), name = p.slice(p.lastIndexOf('/') + 1);
      const s = name.startsWith(q) ? 0 : name.includes(q) ? 1 : p.includes(q) ? 2 : seq.test(p) ? 3 : -1;
      if (s >= 0) scored.push([s, e]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].rel.length - b[1].rel.length).slice(0, 50).map(x => x[1]);
  }
  async function updateChatComplete() {
    const trig = chatCompleteTrigger(), ws = curChat();
    if (!trig || !ws) { closeChatComplete(); return; }
    const cwd = chatCwd(ws), harness = chatCompleteHarness(ws);
    const same = sameChatCompleteTrigger(_complete, trig) && _complete.tab === ws
      && _complete.cwd === cwd && _complete.harness === harness;
    let items, status, loading, catalog, source, skillCatalog, slashSkills;
    if (trig.kind === 'at') {
      if (!cwd || !window.electronAPI?.chatFiles) { closeChatComplete(); return; }
      const list = await cachedList('f|' + cwd, 15000, () => window.electronAPI.chatFiles(cwd));
      if (curChat() !== ws || chatCwd(ws) !== cwd || !sameChatCompleteTrigger(chatCompleteTrigger(), trig)) return;
      source = list;
      if (same && _complete?.source === source) return;
      if (list) {
        list._entries ||= [...list.dirs.map(rel => ({ rel, dir: true })), ...list.files.map(rel => ({ rel, dir: false }))];
        items = rankPaths(list._entries, trig.query).map(e => ({ ...e, cwd }));
      } else items = [];
    } else {
      catalog = chatCatalog(trig.kind, harness, cwd, ws.id);
      if (!catalog) { closeChatComplete(); return; }
      source = catalog.items;
      const skillsCommand = trig.kind === 'slash' && /^\/skills$/i.test(thrInput.value) && chatHasSkills(harness);
      if (trig.kind === 'slash') {
        if (skillsCommand) skillCatalog = chatCatalog('skill', harness, cwd, ws.id);
        else if (showSkillsInSlash(harness)) skillCatalog = chatCatalogs.get(JSON.stringify(['skill', harness, cwd]));
        if (showSkillsInSlash(harness)) slashSkills = skillCatalog?.items;
      }
      loading = !!(trig.kind === 'skill' ? catalog.pending : skillsCommand && skillCatalog?.pending);
      if (same && _complete.source === source && _complete.slashSkills === slashSkills && _complete.loading === loading) return;
      const q = trig.query.toLowerCase(), prefixes = [], matches = [];
      const entries = skillCatalog ? [...(source || []), ...(slashSkills || []).map(skill => ({ ...skill, skill: true }))] : source || [];
      const seen = new Set();
      for (const item of entries) {
        if (seen.has(item.name)) continue;
        seen.add(item.name);
        const name = item.name.toLowerCase();
        if (name.startsWith(q)) prefixes.push(item);
        else if (name.includes(q)) matches.push(item);
      }
      items = prefixes.concat(matches).slice(0, 50);
      if (loading && (!items.length || skillsCommand)) status = 'Loading skills…';
      else if (trig.kind === 'skill') {
        status = source ? (source.length ? 'No matching skills' : 'No available skills') : 'Could not load skills';
      } else if (source === undefined) status = 'Loading commands…';
    }
    if (!items.length && !status) { closeChatComplete(); return; }
    _complete = { ...trig, items, status, loading, catalog, source, skillCatalog, slashSkills, cwd, harness, tab: ws,
      index: same && _complete ? Math.max(0, Math.min(_complete.index, items.length - 1)) : 0 };
    renderChatComplete();
  }
  function renderChatComplete() {
    const c = _complete;
    thrComplete.innerHTML = c.items.map((it, i) => {
      const icon = c.kind === 'skill' ? 'ph-lightning' : c.kind === 'slash' ? (it.custom || it.skill ? 'ph-lightning' : 'ph-terminal') : it.dir ? 'ph-folder' : linkFileIcon(it.rel);
      const name = c.kind === 'at' ? it.rel.slice(it.rel.lastIndexOf('/') + 1) : (c.kind === 'skill' ? '$' : '/') + it.name;
      const meta = c.kind === 'at' ? it.rel.slice(0, Math.max(0, it.rel.lastIndexOf('/'))) : it.description || '';
      return `<div class="thr-complete-item" role="option" id="thr-complete-${i}" data-i="${i}" aria-selected="${i === c.index}">`
        + `<i class="ph ${icon}" aria-hidden="true"></i><span class="thr-complete-name">${escHtml(name)}</span>`
        + (meta ? `<span class="thr-complete-meta">${escHtml(meta)}</span>` : '') + '</div>';
    }).join('') + (c.status && (!c.items.length || c.loading)
      ? `<div class="thr-complete-status" role="status">${c.loading ? '<span class="tv-loading-spinner" aria-hidden="true"></span>' : ''}${escHtml(c.status)}</div>` : '');
    thrComplete.hidden = false;
    const editor = threadPart(thrPage, 'input-links');
    if (c.items.length) editor?.setAttribute('aria-activedescendant', 'thr-complete-' + c.index);
    else editor?.removeAttribute('aria-activedescendant');
    thrComplete.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function closeChatComplete() {
    _complete = null;
    if (!thrComplete || thrComplete.hidden) return;
    thrComplete.hidden = true; thrComplete.replaceChildren();
    threadPart(thrPage, 'input-links')?.removeAttribute('aria-activedescendant');
  }
  function openChatSkills() {
    closeChatComplete();
    threadPart(thrPage, 'input-links')?._recordDraftUndo?.();
    thrInput.value = '$';
    thrInput.setSelectionRange(1, 1);
    thrInput.dispatchEvent(new Event('input', { bubbles: true }));
    thrInput.focus({ preventScroll: true });
    void updateChatComplete();
  }
  function acceptChatComplete(i = _complete?.index) {
    const c = _complete, it = c?.items[i];
    if (!it) return;
    const ws = curChat();
    if (ws !== c.tab || chatCwd(ws) !== c.cwd || chatCompleteHarness(ws) !== c.harness
      || !sameChatCompleteTrigger(c, chatCompleteTrigger())) { closeChatComplete(); return; }
    if (c.kind === 'slash' && it.name === 'skills' && /^\s*\/([\w:.-]*)\s*$/.test(thrInput.value)
      && chatHasSkills(c.harness)) { openChatSkills(); return; }
    closeChatComplete();
    let insert, end = c.end;
    if (c.kind !== 'at') {
      const next = thrInput.value[end];
      insert = (c.kind === 'skill' || it.skill ? '$' : '/') + it.name;
      if (next === ' ' || next === '\t') { insert += next; end++; }
      else if (!next || !/^[,;!?)}\]]$/.test(next)) insert += ' ';
    } else {
      const mention = '@' + (/\s/.test(it.rel) ? `"${it.rel}"` : it.rel);
      if (!_chatFiles.some(f => f.mention === mention)) {
        _chatFiles.push({ at: true, dir: it.dir, mention, name: it.rel.slice(it.rel.lastIndexOf('/') + 1), path: `${it.cwd.replace(/[\\/]$/, '')}/${it.rel}` });
      }
      insert = mention + ' ';
    }
    thrInput.setRangeText(insert, c.start, end, 'end');
    renderChatFiles(); autosizeThreadInput();
    thrInput.dispatchEvent(new Event('input', { bubbles: true }));
    thrInput.focus({ preventScroll: true });
  }
  {
    const editor = threadPart(thrPage, 'input-links');
    if (editor && thrComplete) {
      editor.setAttribute('aria-controls', thrComplete.id);
      editor.addEventListener('input', () => { updateChatComplete(); });
      editor.addEventListener('blur', () => closeChatComplete());
      document.addEventListener('selectionchange', () => { if (document.activeElement === editor && _complete) updateChatComplete(); });
      // Capture: runs before the editor's Enter-to-send handler.
      editor.addEventListener('keydown', e => {
        if (!_complete || e.isComposing || (e.altKey && e.key === 'Enter')) return;
        const n = _complete.items.length;
        if (!n && e.key !== 'Escape') return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') _complete.index = (_complete.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') acceptChatComplete();
        else if (e.key === 'Escape') closeChatComplete();
        else return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (_complete) renderChatComplete();
      }, true);
      thrComplete.addEventListener('mousedown', e => {
        e.preventDefault(); // keep the caret in the editor
        const row = e.target.closest('.thr-complete-item');
        if (row) acceptChatComplete(+row.dataset.i);
      });
    }
  }
  const thrComposer = thrPage.querySelector('#sbr-thread-composer');
  const isChatTextDrag = e => {
    const types = e.dataTransfer?.types || [];
    return !window.draggedTermId && !window.draggedWsId
      && !types.includes('Files') && !types.includes('application/x-terminalvibe-tab')
      && (types.includes('text/plain') || types.includes('text/uri-list'));
  };
  thrComposer?.addEventListener('dragover', e => { if (!thrInput.disabled && (isFileDrag(e) || e.dataTransfer.types.includes(THREAD_DRAG) || isChatTextDrag(e))) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; thrComposer.classList.add('drop'); } });
  thrComposer?.addEventListener('dragleave', e => { if (!thrComposer.contains(e.relatedTarget)) thrComposer.classList.remove('drop'); });
  thrComposer?.addEventListener('drop', e => {
    thrComposer.classList.remove('drop');
    if (thrInput.disabled) return;
    const threadId = e.dataTransfer.getData(THREAD_DRAG);
    if (threadId) { e.preventDefault(); e.stopPropagation(); void addChatThreadRef(threadId); return; }
    if (!isFileDrag(e)) {
      if (isChatTextDrag(e)) {
        e.preventDefault(); e.stopPropagation();
        const text = (e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list')).replace(/\r\n?/g, '\n');
        if (text) threadPart(thrPage, 'input-links')?._insertDroppedText?.(text, e);
      }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    addChatFiles([...e.dataTransfer.files]);
  });
  // ── Chat zoom: Ctrl+wheel over a chat scales its messages and composer (70–160%, remembered).
  // Caught before the pane's own Ctrl+wheel, which would resize the terminal under the chat. ──
  let _chatZoom = 1;
  try { _chatZoom = Math.max(0.7, Math.min(1.6, +localStorage.getItem('tv-chat-zoom') || 1)); } catch {}
  document.documentElement.style.setProperty('--thr-zoom', String(_chatZoom));
  document.addEventListener('wheel', e => {
    if (!e.ctrlKey || !e.deltaY) return;
    const page = e.target.closest?.('#sbr-thread, .thr-snapshot');
    if (!page) return;
    e.preventDefault(); e.stopPropagation();
    const next = Math.round(Math.max(0.7, Math.min(1.6, _chatZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) * 100) / 100;
    if (next === _chatZoom) return;
    const flow = page.querySelector('.thr-flow'), atBottom = flow && flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1;
    _chatZoom = next;
    document.documentElement.style.setProperty('--thr-zoom', String(_chatZoom));
    try { localStorage.setItem('tv-chat-zoom', String(_chatZoom)); } catch {}
    if (atBottom) flow.scrollTop = flow.scrollHeight; // keep the latest message in view
    zoomBadge(`Chat ${Math.round(_chatZoom * 100)}%`, 800);
  }, { capture: true, passive: false });
  // ── Cite: select text in the chat, a "Cite" button appears; it adds the passage to the next message ──
  let _citationFlash = null;
  function captureCitationSource(range, flow) {
    const common = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const scope = common.closest('.thr-msg-text') || flow;
    const prefix = document.createRange(); prefix.selectNodeContents(scope); prefix.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString(), text = raw.trim().slice(0, 4000);
    const start = prefix.toString().length + (raw.length - raw.trimStart().length);
    return { chatId: curChat()?.chat?.storeId || curChat()?.id, key: scope.closest('[data-key]')?.dataset.key || null, start, end: start + text.length, text };
  }
  function selectedResponseCitations(selection, flow) {
    if (!selection?.rangeCount || selection.isCollapsed) return [];
    const selected = selection.getRangeAt(0), parts = [];
    let budget = 4000;
    for (const body of flow.querySelectorAll('.thr-msg.assistant > .thr-msg-text')) {
      if (!budget || !body.getClientRects().length || !selected.intersectsNode(body)) continue;
      const bounds = document.createRange(); bounds.selectNodeContents(body);
      const clipped = selected.cloneRange();
      if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) clipped.setStart(bounds.startContainer, bounds.startOffset);
      if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) clipped.setEnd(bounds.endContainer, bounds.endOffset);
      const source = captureCitationSource(clipped, flow);
      if (!source.text) continue;
      source.text = source.text.slice(0, budget); source.end = source.start + source.text.length;
      budget -= source.text.length;
      parts.push({ cite: source.text, source, range: clipped });
    }
    return parts;
  }
  function findCitationRange(citation, flow) {
    const source = citation.source || {}, needle = source.text || citation.cite;
    if (!needle) return null;
    const original = source.key && [...flow.querySelectorAll('.thr-msg.assistant[data-key]')].find(el => el.dataset.key === source.key)?.querySelector(':scope > .thr-msg-text');
    const scopes = [...new Set([original, ...flow.querySelectorAll('.thr-msg.assistant > .thr-msg-text')].filter(Boolean))];
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT), nodes = [];
      let text = '';
      for (let node; (node = walker.nextNode());) { nodes.push({ node, start: text.length }); text += node.data; }
      let start = scope === original && text.slice(source.start, source.end) === needle ? source.start : text.indexOf(needle);
      let end = start + needle.length;
      if (start < 0) {
        // Whitespace can change between rendered markdown nodes or after a transcript refresh.
        const offsets = [], folded = [];
        for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { folded.push(text[i]); offsets.push(i); }
        const match = needle.replace(/\s/g, ''), index = match ? folded.join('').indexOf(match) : -1;
        if (index < 0) continue;
        start = offsets[index]; end = offsets[index + match.length - 1] + 1;
      }
      const first = nodes.find(item => item.start + item.node.length > start);
      const last = [...nodes].reverse().find(item => item.start < end);
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
      return range;
    }
    return null;
  }
  function clearCitationFlash() {
    if (!_citationFlash) return;
    const flash = _citationFlash;
    cancelAnimationFrame(flash.frame); clearTimeout(flash.cleanup);
    window.CSS?.highlights?.delete('tv-citation-source');
    flash.element?.classList.remove('thr-citation-source');
    flash.flow.style.removeProperty('--citation-flash-strength');
    for (const type of ['wheel', 'touchstart', 'pointerdown']) flash.flow.removeEventListener(type, flash.interrupt);
    _citationFlash = null;
  }
  function jumpToCitation(citation) {
    const chat = curChat(), flow = threadPart(thrPage, 'flow');
    if (!flow || (citation.source?.chatId && citation.source.chatId !== (chat?.chat?.storeId || chat?.id))) return false;
    const range = findCitationRange(citation, flow);
    if (!range) { zoomBadge('The cited passage is no longer available in this chat.'); return false; }
    for (const node of [range.startContainer, range.endContainer]) {
      for (let el = node.parentElement; el && el !== flow; el = el.parentElement) {
        if (el.tagName === 'DETAILS') el.open = true;
      }
    }
    clearCitationFlash();
    const motion = document.body.classList.contains('ui-animations') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flash = { flow, element: range.startContainer.parentElement, frame: null, cleanup: null, interrupt: () => clearCitationFlash(), phase: motion ? 'scroll' : 'static' };
    _citationFlash = flash;
    flow.style.setProperty('--citation-flash-strength', motion ? '0%' : '38%');
    if (window.CSS?.highlights && window.Highlight) CSS.highlights.set('tv-citation-source', new Highlight(range));
    else flash.element.classList.add('thr-citation-source');
    const rect = range.getClientRects()[0] || range.getBoundingClientRect(), viewport = flow.getBoundingClientRect();
    const visible = Math.max(60, flow.clientHeight - (thrPage.querySelector('.thr-composer-wrap')?.offsetHeight || 0));
    const from = flow.scrollTop, target = Math.max(0, Math.min(flow.scrollHeight - flow.clientHeight, from + rect.top - viewport.top - visible / 2 + rect.height / 2));
    flow.focus({ preventScroll: true });
    if (motion) {
      for (const type of ['wheel', 'touchstart', 'pointerdown']) flow.addEventListener(type, flash.interrupt, { passive: true });
      const started = performance.now(), duration = Math.abs(target - from) > 2 ? 420 : 0;
      let arrived = null;
      const animate = now => {
        if (_citationFlash !== flash) return;
        if (!flow.isConnected) { clearCitationFlash(); return; }
        const progress = duration ? Math.min(1, (now - started) / duration) : 1;
        if (progress < 1) {
          flow.scrollTop = from + (target - from) * (1 - Math.pow(1 - progress, 3));
        } else {
          if (arrived === null) { arrived = now; flow.scrollTop = target; flash.phase = 'pulse'; rememberThreadScroll(chat); }
          const elapsed = now - arrived;
          if (elapsed >= 1500) { clearCitationFlash(); return; }
          // Three soft pulses, each fading from transparent to accent and back.
          const strength = Math.pow(Math.sin(Math.PI * (elapsed % 500) / 500), 2) * 38;
          flow.style.setProperty('--citation-flash-strength', strength.toFixed(2) + '%');
        }
        flash.frame = requestAnimationFrame(animate);
      };
      flash.frame = requestAnimationFrame(animate);
    } else { flow.scrollTop = target; rememberThreadScroll(chat); }
    flash.cleanup = setTimeout(() => { if (_citationFlash === flash) clearCitationFlash(); }, motion ? 2500 : 1400);
    return true;
  }
  const citeBtn = document.createElement('button');
  citeBtn.type = 'button'; citeBtn.className = 'thr-cite-btn'; citeBtn.hidden = true;
  citeBtn.innerHTML = '<i class="ph ph-quotes" aria-hidden="true"></i><span>Cite</span>';
  document.body.appendChild(citeBtn);
  const hideCite = () => { citeBtn.hidden = true; };
  thrPage.addEventListener('mouseup', e => {
    const flow = e.target.closest('#sbr-thread-flow');
    if (e.button !== 0 || !flow) return;
    setTimeout(() => { // a right-click opens the menu instead (it has Cite)
      if (flow.parentElement !== thrPage) return;
      const sel = window.getSelection(), text = sel?.toString().trim();
      if (!text || !sel.rangeCount || !flow.contains(sel.anchorNode) || !flow.contains(sel.focusNode)) return hideCite();
      const parts = selectedResponseCitations(sel, flow);
      if (!parts.length) return hideCite();
      const range = parts[parts.length - 1].range, rects = range.getClientRects(), r = rects[rects.length - 1] || range.getBoundingClientRect();
      citeBtn.hidden = false;
      citeBtn.style.left = Math.max(8, Math.min(r.right - citeBtn.offsetWidth / 2, innerWidth - citeBtn.offsetWidth - 8)) + 'px';
      citeBtn.style.top = Math.max(8, r.top - citeBtn.offsetHeight - 6) + 'px';
    });
  });
  citeBtn.addEventListener('mousedown', e => e.preventDefault()); // keep the selection
  citeBtn.addEventListener('click', () => {
    const parts = selectedResponseCitations(window.getSelection(), threadPart(thrPage, 'flow'));
    hideCite();
    if (!parts.length) return;
    for (const { cite, source } of parts) {
      const citation = { cite, source };
      insertChatMention(citation); _chatFiles.push(citation);
    }
    window.getSelection().removeAllRanges();
    renderChatFiles(); autosizeThreadInput();
    thrInput.focus();
  });
  document.addEventListener('mousedown', e => { if (!citeBtn.hidden && e.target !== citeBtn && !citeBtn.contains(e.target)) hideCite(); }, true);
  // "Scroll to end": a pill over the composer while the chat is scrolled up from its latest message.
  const scrollEndBtn = threadPart(thrPage, 'scroll-end');
  const promptNav = threadPart(thrPage, 'prompts');
  const promptTicks = promptNav.querySelector('.thr-prompt-ticks');
  const promptPreview = promptNav.querySelector('.thr-prompt-preview');
  const promptPreviewTitle = promptPreview.querySelector('.thr-prompt-preview-title');
  const promptPreviewReply = promptPreview.querySelector('.thr-prompt-preview-reply');
  const promptSelector = '.thr-msg.user[data-key]';
  let checkpointPrompts = [];
  let activeCheckpoint = -1;
  function showCheckpoint(index) {
    activeCheckpoint = index;
    for (const [i, tick] of Array.from(promptTicks.children).entries()) {
      const distance = index < 0 ? Infinity : Math.abs(i - index);
      tick.style.setProperty('--tick-scale', [1, .667, .417][distance] ?? .333);
      tick.classList.toggle('active', distance === 0);
    }
    const prompt = checkpointPrompts[index];
    promptPreview.hidden = !prompt;
    const label = prompt?.querySelector('.thr-msg-text')?.textContent.trim().replace(/\s+/g, ' ') || 'User message';
    promptNav.setAttribute('aria-label', prompt ? 'Jump to prompt: ' + label : 'Jump to a prompt');
    if (!prompt) return;
    let reply;
    for (let row = prompt.nextElementSibling; row && !row.matches(promptSelector); row = row.nextElementSibling) {
      if (row.matches('.thr-msg.assistant')) reply = row;
    }
    promptPreview.style.top = promptTicks.children[index].style.top;
    promptPreviewTitle.textContent = label;
    promptPreviewReply.textContent = reply?.querySelector('.thr-msg-text')?.textContent.trim() || '';
  }
  function renderPromptNav() {
    const flow = threadPart(thrPage, 'flow');
    const prompts = [...flow.querySelectorAll(':scope > ' + promptSelector)];
    if (prompts.length === checkpointPrompts.length && prompts.every((prompt, i) => prompt === checkpointPrompts[i])) return;
    const activePrompt = checkpointPrompts[activeCheckpoint];
    checkpointPrompts = prompts;
    promptNav.hidden = prompts.length < 2;
    promptNav.style.setProperty('--prompt-rail-height', (prompts.length - 1) * 8 + 'px');
    promptTicks.replaceChildren(...prompts.map((_, index) => {
      const tick = document.createElement('span');
      tick.className = 'thr-prompt-tick';
      tick.style.top = index / Math.max(1, prompts.length - 1) * 100 + '%';
      return tick;
    }));
    showCheckpoint(prompts.indexOf(activePrompt));
  }
  function checkpointAtPointer(event) {
    const { top, height } = promptNav.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientY - top) / height));
    return Math.round(progress * (checkpointPrompts.length - 1));
  }
  promptNav.addEventListener('pointermove', event => {
    if (event.buttons) return;
    const index = checkpointAtPointer(event);
    if (index !== activeCheckpoint || promptPreview.hidden) showCheckpoint(index);
  });
  promptNav.addEventListener('pointerleave', () => showCheckpoint(-1));
  promptNav.addEventListener('focus', () => showCheckpoint(Math.max(0, activeCheckpoint)));
  promptNav.addEventListener('blur', () => showCheckpoint(-1));
  promptNav.addEventListener('mousedown', event => event.preventDefault());
  promptNav.addEventListener('keydown', event => {
    const last = checkpointPrompts.length - 1;
    const indexes = { ArrowUp: activeCheckpoint - 1, ArrowDown: activeCheckpoint + 1, Home: 0, End: last };
    if (Object.hasOwn(indexes, event.key)) {
      event.preventDefault();
      showCheckpoint(Math.max(0, Math.min(last, indexes[event.key])));
    }
    if (event.key === 'Escape') showCheckpoint(-1);
  });
  let stopCheckpointScroll;
  promptNav.addEventListener('click', event => {
    const index = event.detail ? checkpointAtPointer(event) : Math.max(0, activeCheckpoint);
    const prompt = checkpointPrompts[index];
    if (!prompt) return;
    stopCheckpointScroll?.();
    showCheckpoint(-1);
    prompt.tabIndex = -1;
    prompt.focus({ preventScroll: true });
    const smooth = document.body.classList.contains('ui-animations') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flow = threadPart(thrPage, 'flow');
    const destination = target => {
      const viewportTop = flow.getBoundingClientRect().top + flow.clientTop;
      const top = flow.scrollTop + target.getBoundingClientRect().top - viewportTop - 8;
      return Math.max(0, Math.min(flow.scrollHeight - flow.clientHeight, top));
    };
    // Lay out every row from the checkpoint down once, so the destination uses real heights (no drift).
    for (let row = prompt.parentElement === flow ? prompt : null; row; row = row.nextElementSibling) row.classList.add('thr-seen');
    const key = prompt.dataset.key;
    const started = performance.now();
    const listeners = new AbortController();
    let frame, previousProgress = 0, settledFrames = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      listeners.abort();
      flow.classList.remove('thr-checkpoint-scrolling');
      stopCheckpointScroll = undefined;
    };
    stopCheckpointScroll = stop;
    flow.classList.add('thr-checkpoint-scrolling');
    const advance = now => {
      const target = prompt.parentElement === flow ? prompt
        : flow.querySelector(`:scope > ${promptSelector}[data-key="${CSS.escape(key)}"]`);
      if (!target || flow !== threadPart(thrPage, 'flow') || !flow.clientHeight) return stop();
      if (target !== prompt && document.activeElement === document.body) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      // Offscreen messages use estimated heights until the scroll brings them into view.
      const progress = smooth ? 1 - Math.pow(1 - Math.min(1, (now - started) / 420), 3) : 1;
      const top = destination(target);
      const delta = top - flow.scrollTop;
      const step = progress < 1 ? (progress - previousProgress) / (1 - previousProgress) : 1;
      flow.scrollTo({ top: flow.scrollTop + delta * step, behavior: 'instant' });
      previousProgress = progress;
      settledFrames = progress === 1 && Math.abs(delta) <= 1 ? settledFrames + 1 : 0;
      if (settledFrames >= 3 || now - started > 1200) stop();
      else frame = requestAnimationFrame(advance);
    };
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      thrPage.addEventListener(type, stop, { capture: true, passive: true, signal: listeners.signal });
    }
    advance(started);
  });
  promptNav.addEventListener('wheel', event => {
    if (event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    const flow = threadPart(thrPage, 'flow');
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? flow.clientHeight : 1;
    flow.scrollTop += event.deltaY * unit;
  }, { passive: false });
  function syncCheckpointVisibility() {
    if (promptNav.hidden) return;
    const bounds = threadPart(thrPage, 'flow').getBoundingClientRect();
    for (const [index, prompt] of checkpointPrompts.entries()) {
      const rect = prompt.getBoundingClientRect();
      promptTicks.children[index].classList.toggle('in-view', rect.bottom > bounds.top && rect.top < bounds.bottom);
    }
  }
  promptNav.addEventListener('pointerenter', syncCheckpointVisibility);
  promptNav.addEventListener('focus', syncCheckpointVisibility);
  function syncScrollEnd() {
    if (!scrollEndBtn) return;
    const flowEl = thrPage.querySelector('.thr-flow');
    if (flowEl.scrollHeight - flowEl.scrollTop - flowEl.clientHeight <= 1) {
      scrollEndBtn.hidden = true;
      return;
    }
    let last = flowEl.lastElementChild;
    while (last && (last.hidden || !last.getClientRects().length)) last = last.previousElementSibling;
    const composer = thrPage.querySelector('.thr-composer-wrap');
    const bottom = Math.min(flowEl.getBoundingClientRect().bottom,
      composer?.getClientRects().length ? composer.getBoundingClientRect().top : Infinity);
    const contentVisible = !last || last.getBoundingClientRect().bottom <= bottom + 1;
    scrollEndBtn.hidden = contentVisible;
  }
  let scrollEndFrame = 0;
  const scheduleScrollEnd = () => {
    if (!scrollEndFrame) scrollEndFrame = requestAnimationFrame(() => { scrollEndFrame = 0; syncScrollEnd(); syncCheckpointVisibility(); });
  };
  const historyChanges = new MutationObserver(() => {
    scheduleScrollEnd();
    renderPromptNav();
  });
  const historySize = new ResizeObserver(scheduleScrollEnd);
  let observedFlow;
  function observeLiveFlow() {
    const flow = threadPart(thrPage, 'flow');
    if (observedFlow === flow) return;
    observedFlow = flow;
    historyChanges.disconnect();
    historySize.disconnect();
    historyChanges.observe(flow, { childList: true, subtree: true, characterData: true });
    historySize.observe(flow);
    hideCite();
    renderPromptNav();
    scheduleScrollEnd();
  }
  new MutationObserver(observeLiveFlow).observe(thrPage, { childList: true });
  observeLiveFlow();
  for (const event of ['load', 'toggle']) thrPage.addEventListener(event, e => {
    if (e.target.closest?.('#sbr-thread-flow')) scheduleScrollEnd();
  }, true);
  scrollEndBtn?.addEventListener('click', () => {
    const flowEl = threadPart(thrPage, 'flow');
    const smooth = document.body.classList.contains('ui-animations') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    flowEl.scrollTo({ top: flowEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
  // Each chat remembers where it was scrolled (restored after a tab or chat switch).
  thrPage.addEventListener('scroll', e => {
    if (e.target.id !== 'sbr-thread-flow') return;
    hideCite();
    rememberThreadScroll(_curChat);
    scheduleScrollEnd();
  }, { capture: true, passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCite(); });
  let _chatCtrl = false, _chatAlt = false;
  const scheduleDialog = document.getElementById('chat-schedule');
  const scheduleForm = scheduleDialog?.querySelector('form');
  const scheduleClock = scheduleForm?.querySelector('.chat-schedule-clock');
  const scheduleClockFace = scheduleClock?.querySelector('.chat-clock-face');
  const scheduleClockTicks = scheduleClockFace?.querySelector('.chat-clock-ticks');
  let scheduleTab = null;
  let scheduleClockPart = 'clockHour';
  const formatScheduleNumber = value => String(value).padStart(2, '0');
  function syncScheduleFields() {
    const { mode, hours } = scheduleForm.elements;
    const useClock = mode.value === 'clock';
    const countdown = hours.closest('.chat-schedule-countdown');
    countdown.hidden = useClock;
    for (const control of countdown.querySelectorAll('input, button')) control.disabled = useClock;
    scheduleClock.hidden = !useClock;
    for (const input of scheduleClock.querySelectorAll('input')) input.disabled = !useClock;
    if (useClock) syncScheduleClockFace();
  }
  function syncScheduleClockFace(part = scheduleClockPart) {
    scheduleClockPart = part;
    const minutes = part === 'clockMinute';
    const input = scheduleForm.elements[part];
    const label = minutes ? 'minute' : 'hour';
    if (scheduleClockTicks.dataset.part !== part) {
      scheduleClockTicks.dataset.part = part;
      scheduleClockFace.setAttribute('aria-label', 'Choose ' + label);
      scheduleClockTicks.replaceChildren(...Array.from({ length: 12 }, (_, index) => {
        const value = minutes ? index * 5 : index || 12;
        const angle = index * Math.PI / 6;
        const tick = document.createElement('button');
        tick.type = 'button';
        tick.className = 'chat-clock-tick';
        tick.dataset.clockValue = value;
        tick.textContent = minutes ? formatScheduleNumber(value) : value;
        tick.setAttribute('aria-label', label + ' ' + tick.textContent);
        tick.style.left = (50 + 39 * Math.sin(angle)) + '%';
        tick.style.top = (50 - 39 * Math.cos(angle)) + '%';
        return tick;
      }));
    }
    const valid = input.validity.valid && Number.isFinite(input.valueAsNumber);
    const value = input.valueAsNumber;
    const angle = value * (minutes ? 6 : 30);
    scheduleClockFace.style.setProperty('--clock-angle', (valid ? angle : 0) + 'deg');
    scheduleClockFace.classList.toggle('has-hand', valid);
    scheduleClock.querySelectorAll('.chat-clock-readout input[type="number"]').forEach(field => {
      field.classList.toggle('active', field === input);
    });
    const nearest = valid ? (minutes ? Math.round(value / 5) % 12 : value % 12) : 0;
    Array.from(scheduleClockTicks.children).forEach((tick, index) => {
      tick.tabIndex = index === nearest ? 0 : -1;
      tick.setAttribute('aria-pressed', String(valid && Number(tick.dataset.clockValue) === value));
    });
  }
  function readScheduleClockTime() {
    const { clockHour, clockMinute, clockPeriod } = scheduleForm.elements;
    const hour = clockHour.valueAsNumber % 12 + (clockPeriod.value === 'PM' ? 12 : 0);
    return formatScheduleNumber(hour) + ':' + formatScheduleNumber(clockMinute.valueAsNumber);
  }
  scheduleClockTicks?.addEventListener('click', e => {
    const tick = e.target.closest('.chat-clock-tick');
    if (!tick) return;
    const input = scheduleForm.elements[scheduleClockPart];
    input.value = formatScheduleNumber(Number(tick.dataset.clockValue));
    input.setCustomValidity('');
    if (scheduleClockPart === 'clockHour') {
      syncScheduleClockFace('clockMinute');
      scheduleClockTicks.querySelector('[tabindex="0"]')?.focus();
    } else {
      syncScheduleClockFace();
      tick.focus();
    }
  });
  scheduleClockTicks?.addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step || !e.target.matches('.chat-clock-tick')) return;
    e.preventDefault();
    const ticks = Array.from(scheduleClockTicks.children);
    const next = ticks[(ticks.indexOf(e.target) + step + ticks.length) % ticks.length];
    e.target.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });
  scheduleForm?.addEventListener('focusin', e => {
    if (e.target.name === 'clockHour' || e.target.name === 'clockMinute') syncScheduleClockFace(e.target.name);
  });
  scheduleForm?.querySelector('.chat-schedule-countdown').addEventListener('click', e => {
    const button = e.target.closest('[data-timer-step]');
    if (!button) return;
    const input = scheduleForm.elements[button.dataset.timerField];
    if (button.dataset.timerStep === '1') input.stepUp(); else input.stepDown();
    input.value = formatScheduleNumber(input.valueAsNumber);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  function nextScheduleClockTime(now, time) {
    const [hours, minutes] = time.split(':').map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (+next <= now) {
      next.setDate(next.getDate() + 1);
      next.setHours(hours, minutes, 0, 0);
    }
    return +next;
  }
  function scheduleCountdownLabel(sendAt, now = Date.now()) {
    const seconds = Math.max(0, Math.ceil((sendAt - now) / 1000));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(value => String(value).padStart(2, '0')).join(':');
  }
  function updateScheduleCountdowns(scope) {
    const now = Date.now();
    scope.querySelectorAll('[data-countdown-at]').forEach(label => {
      const text = scheduleCountdownLabel(Number(label.dataset.countdownAt), now);
      if (label.textContent !== text) label.textContent = text;
    });
  }
  function openChatSchedule(ws) {
    if (!ws || ws._editingQueued || !chatMessageText(thrInput.value.trim(), _chatFiles) || !scheduleDialog || scheduleDialog.open) return;
    scheduleTab = ws;
    scheduleForm.reset();
    const next = new Date(Math.floor(Date.now() / 300000) * 300000 + 300000);
    const { clockHour, clockMinute, clockPeriod } = scheduleForm.elements;
    clockHour.value = formatScheduleNumber(next.getHours() % 12 || 12);
    clockMinute.value = formatScheduleNumber(next.getMinutes());
    clockPeriod.value = next.getHours() < 12 ? 'AM' : 'PM';
    scheduleClockPart = 'clockHour';
    scheduleForm.querySelectorAll('input').forEach(field => field.setCustomValidity(''));
    scheduleForm.elements.mode.dispatchEvent(new Event('change'));
    scheduleDialog.showModal();
    scheduleForm.querySelector('.custom-dropdown-btn')?.focus();
    syncSendBtn();
  }
  scheduleForm?.elements.mode.addEventListener('change', syncScheduleFields);
  scheduleForm?.addEventListener('input', e => {
    scheduleForm.elements.seconds.setCustomValidity('');
    e.target.setCustomValidity?.('');
    if (e.target.name === 'clockHour' || e.target.name === 'clockMinute') syncScheduleClockFace(e.target.name);
  });
  scheduleForm?.addEventListener('change', e => {
    if (e.target.type === 'number' && e.target.validity.valid && Number.isFinite(e.target.valueAsNumber)) {
      e.target.value = formatScheduleNumber(e.target.valueAsNumber);
    }
  });
  scheduleForm?.querySelector('[data-schedule-cancel]').addEventListener('click', () => scheduleDialog.close());
  scheduleDialog?.addEventListener('close', () => {
    scheduleTab = null;
    _chatAlt = false;
    syncSendBtn();
  });
  scheduleForm?.addEventListener('submit', e => {
    e.preventDefault();
    const ws = scheduleTab;
    if (!ws || curChat() !== ws) { scheduleDialog.close(); return; }
    const { mode, hours, minutes, seconds, clockMinute } = scheduleForm.elements;
    const scheduleMode = mode.value;
    const useClock = scheduleMode === 'clock';
    const now = Date.now();
    const sendAt = useClock ? nextScheduleClockTime(now, readScheduleClockTime())
      : now + (hours.valueAsNumber * 3600 + minutes.valueAsNumber * 60 + seconds.valueAsNumber) * 1000;
    if (!Number.isFinite(new Date(sendAt).getTime()) || sendAt <= now) {
      const field = useClock ? clockMinute : seconds;
      field.setCustomValidity(useClock ? 'Choose a valid clock time.' : 'Enter a countdown greater than zero.');
      field.reportValidity();
      return;
    }
    const typed = thrInput.value.trim(), files = _chatFiles, text = chatMessageText(typed, files);
    if (!text) { scheduleDialog.close(); return; }
    ws.chat ||= { createdAt: now };
    ws.chat.opts ??= chatOpts(ws);
    (ws.chat.queuedMessages ||= []).push({ id: uuid(), typed, files, text, sendAt, scheduleMode });
    scheduleDialog.close();
    clearChatDraft(ws);
    updateChatQueue(ws);
    syncThreadComposer(ws);
    renderThreadsSidebar();
    saveState();
  });
  const queueIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h8M4 12h6M4 17h10m4-13 1.2 3.8L23 9l-3.8 1.2L18 14l-1.2-3.8L13 9l3.8-1.2Z"/></svg>';
  const syncChatModifier = e => {
    if (_chatCtrl === e.ctrlKey && _chatAlt === e.altKey) return;
    _chatCtrl = e.ctrlKey;
    _chatAlt = e.altKey;
    syncSendBtn();
  };
  window.addEventListener('keydown', syncChatModifier, true);
  window.addEventListener('keyup', syncChatModifier, true);
  window.addEventListener('blur', () => { _chatCtrl = _chatAlt = false; syncSendBtn(); });
  // Enter steers an active turn; Ctrl+Enter queues for the next turn.
  function syncSendBtn() {
    const c = curChat(), typed = !!(thrInput.value.trim() || _chatFiles.length);
    const editing = !!c?._editingQueued;
    syncQueuedEditUI(c);
    const working = !!c && (!!chatWorking(c) || _chatStarting.has(c.id));
    const scheduling = !editing && typed && (_chatAlt || scheduleDialog?.open);
    const queue = !scheduling && !editing && working && (_chatCtrl || (typed && _chatStarting.has(c.id))), stop = !editing && working && !typed && !queue;
    thrSend.classList.toggle('stop', stop);
    const resume = !editing && !working && !typed && !!c?.chat?.interruptedAt && !c._resuming && !_chatSending.has(c.id);
    thrSend.disabled = !stop && !typed && !resume;
    const scheduled = !editing && !typed && !working && !resume && c?.chat?.queuedMessages?.some(message => message.sendAt);
    const label = scheduling ? 'Schedule message' : scheduled ? 'Message scheduled' : editing ? 'Save queued message' : queue ? 'Queue message' : stop ? 'Stop' : working ? 'Steer' : resume ? 'Continue' : 'Send';
    if (thrSend.dataset.mode !== label) {
      thrSend.dataset.mode = label;
      setSendIcon(queue ? queueIcon : `<i class="ph ${scheduling || scheduled ? 'ph-clock' : editing ? 'ph-check' : stop ? 'ph-stop' : working ? 'ph-arrow-elbow-up-right' : resume ? 'ph-play' : 'ph-arrow-up'}" aria-hidden="true"></i>`);
      thrSend.setAttribute('aria-label', label);
      thrSend.dataset.tip = scheduling ? 'Schedule message (Alt+Enter)' : scheduled ? 'Message scheduled' : editing ? 'Save queued message (Enter)' : queue ? 'Queue for next turn (Ctrl+Enter)' : stop ? 'Stop (Esc in the agent)' : working ? 'Steer (Enter) · Queue (Ctrl+Enter) · Schedule (Alt+Enter)' : resume ? 'Continue (Enter)' : 'Send (Enter) · Schedule (Alt+Enter)';
    }
  }
  function setSendIcon(html) {
    const previous = thrSend.querySelector('.thr-send-icon:not(.leaving)');
    const animate = previous && document.body.classList.contains('ui-animations') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const state = animate ? getComputedStyle(previous) : null;
    const from = state ? { opacity: state.opacity, transform: state.transform } : null;
    thrSend.querySelectorAll('.thr-send-icon').forEach(icon => icon.getAnimations().forEach(animation => animation.cancel()));
    thrSend.querySelectorAll('.thr-send-icon.leaving').forEach(icon => icon.remove());
    const next = document.createElement('span'); next.className = 'thr-send-icon'; next.setAttribute('aria-hidden', 'true'); next.innerHTML = html;
    if (!animate) { thrSend.replaceChildren(next); return; }
    previous.classList.add('leaving');
    thrSend.replaceChildren(previous, next);
    const options = { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' };
    previous.animate([from, { opacity: 0, transform: 'translateY(-3px) scale(.8)' }], { ...options, fill: 'forwards' }).finished
      .then(() => previous.remove()).catch(() => previous.remove());
    next.animate([{ opacity: 0, transform: 'translateY(3px) scale(.8)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], options);
  }
  function stopChatTurn(c) {
    c.chat ||= { createdAt: Date.now() };
    c.chat.interruptedAt = Date.now();
    (c.chat.interruptions ||= []).push({ at: c.chat.interruptedAt });
    saveState();
    if (c.chat?.queuedMessages?.length) { c.chat.queuePaused = true; renderChatQueue(c); saveState(); }
    const t = liveThreadAgent(c);
    if (_chatStarting.has(c.id)) { if (c._sdk) { c._sdk.alive = false; window.electronAPI.chatSdkStop(c.id); } stopTabAgent(c); }
    else if (t?._sdk?.alive) window.electronAPI.chatSdkInterrupt(t.id);
    else if (t) sendStdin(t.id, new TextEncoder().encode('\x1b'));
    // The stopped prompt stays in the chat even if the agent never writes it to its transcript.
    const stopped = pendingMessages(c).map(p => ({ text: p.text, at: p.at }));
    if (stopped.length) { c.chat ||= { createdAt: Date.now() }; (c.chat.stopped ||= []).push(...stopped); saveState(); }
    _turns.delete(c.id); _pendingMsgs.delete(c.id);
    _flowSig = '';
    refreshThreadFlow(c); syncThreadComposer(c);
  }
  function autosizeThreadInput() {
    const editor = threadPart(thrPage, 'input-links');
    if (editor?.isContentEditable) { syncChatInputLinks(); return; }
    thrInput.style.height = 'auto';
    thrInput.style.height = Math.min(thrInput.scrollHeight, 240) + 'px';
    syncChatInputLinks();
  }
  // The unsent text is saved with the chat, so a thread with only a draft shows (and survives a restart).
  let _draftSave = 0;
  thrInput?.addEventListener('input', () => {
    autosizeThreadInput(); syncSendBtn();
    const c = curChat();
    if (!c?.chat) return;
    if (!c._editingQueued) c.chat.draft = thrInput.value;
    c._draft = thrInput.value;
    clearTimeout(_draftSave); _draftSave = setTimeout(saveState, 400);
    renderThreadsSidebar();
  });
  thrInput?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault(); e.stopPropagation();
    if (e.altKey) { openChatSchedule(curChat()); return; }
    _chatCtrl = e.ctrlKey; syncSendBtn(); thrInput.form.requestSubmit();
  });
  thrPage.querySelector('#sbr-thread-composer')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (thrSend.dataset.mode === 'Schedule message') { openChatSchedule(curChat()); return; }
    if (thrSend.dataset.mode === 'Continue' && !thrInput.value.trim() && !_chatFiles.length) { void continueInterruptedChat(curChat()); return; }
    if (e.submitter === thrSend && thrSend.classList.contains('stop')) { if (curChat()) stopChatTurn(curChat()); return; }
    const ws = curChat(), typed = thrInput.value.trim(), files = _chatFiles;
    if (ws && !ws._editingQueued && /^\/skills$/i.test(typed) && chatHasSkills(chatCompleteHarness(ws))) {
      openChatSkills();
      return;
    }
    const text = chatMessageText(typed, files);
    if (!ws || !text) return;
    if (ws._editingQueued) { finishQueuedEdit(ws, true); return; }
    ws.chat ||= { createdAt: Date.now() };
    const sideAsk = /^\/(?:side|btw)(?:\s+([\s\S]*))?$/i.exec(typed);
    if (sideAsk) { clearChatDraft(ws); void openSideChat(ws, (sideAsk[1] || '').trim(), files); return; }
    const message = { id: uuid(), text, typed, files, after: _turns.get(ws.id)?.sentAt || Date.now() }, working = !!chatWorking(ws);
    if ((working && _chatCtrl) || _chatStarting.has(ws.id) || _chatSending.has(ws.id)) {
      (ws.chat.queuedMessages ||= []).push(message);
      clearChatDraft(ws); renderChatQueue(ws); saveState();
    } else {
      clearChatDraft(ws);
      if (!await deliverChatMessage(ws, message, working)) {
        if (curChat() === ws && !thrInput.value && !_chatFiles.length) {
          thrInput.value = ws._draft = ws.chat.draft = typed;
          _chatFiles = ws._files = ws.chat.draftFiles = files;
          autosizeThreadInput(); renderChatFiles(); renderThreadsSidebar();
        } else { (ws.chat.queuedMessages ||= []).unshift(message); ws.chat.queuePaused = true; renderChatQueue(ws); }
        saveState();
      }
    }
    if (curChat() === ws) { syncThreadComposer(ws); thrInput.focus({ preventScroll: true }); }
  });
  function clearChatDraft(ws) {
    ws._draft = ''; ws._files = [];
    if (ws.chat) ws.chat.draftFiles = [];
    if (ws.chat?.draft) { ws.chat.draft = ''; syncThreadSelection(); renderThreadsSidebar(); }
    if (curChat() === ws) { thrInput.value = ''; _chatFiles = []; autosizeThreadInput(); renderChatFiles(); }
  }
  function syncQueuedEditUI(ws) {
    const composer = thrPage.querySelector('#sbr-thread-composer');
    if (!composer) return;
    let bar = composer.querySelector('.thr-queue-edit');
    if (!ws?._editingQueued) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'thr-queue-edit';
      bar.innerHTML = '<span role="status">Editing queued message</span><button type="button">Cancel</button>';
      bar.querySelector('button').addEventListener('click', () => { const tab = curChat(); if (tab?._editingQueued) finishQueuedEdit(tab, false); });
      composer.prepend(bar);
    }
  }
  function beginQueuedEdit(ws, message) {
    if (curChat() !== ws || _queueDraining.has(ws.id) || _chatSending.has(ws.id)) return;
    if (ws._editingQueued === message.id) { thrInput.focus(); return; }
    if (ws._editingQueued) finishQueuedEdit(ws, false);
    ws._queueEditDraft = { text: thrInput.value, files: _chatFiles };
    ws._editingQueued = message.id;
    thrInput.value = message.typed || '';
    _chatFiles = (message.files || []).map(file => ({ ...file }));
    ws._draft = thrInput.value; ws._files = _chatFiles;
    renderChatFiles(); autosizeThreadInput(); syncSendBtn();
    thrInput.focus({ preventScroll: true });
  }
  function finishQueuedEdit(ws, save) {
    const message = ws.chat?.queuedMessages?.find(m => m.id === ws._editingQueued);
    if (save) {
      if (!message || curChat() !== ws) return;
      const typed = thrInput.value.trim(), files = _chatFiles, text = chatMessageText(typed, files);
      if (!text) return;
      Object.assign(message, { typed, files, text });
    }
    const draft = ws._queueEditDraft || { text: '', files: [] };
    delete ws._editingQueued; delete ws._queueEditDraft;
    ws._draft = draft.text; ws._files = draft.files;
    if (ws.chat) { ws.chat.draft = draft.text; ws.chat.draftFiles = draft.files; }
    if (curChat() === ws) {
      thrInput.value = draft.text; _chatFiles = draft.files;
      renderChatFiles(); autosizeThreadInput(); syncSendBtn(); thrInput.focus({ preventScroll: true });
    }
    updateChatQueue(ws); saveState();
  }
  // The first-message title shows at once; the agent's small model replaces it with a short one, unless renamed meanwhile.
  function autoTitleChat(ws, text, force) {
    const first = ws.chat.title, pick = threadSettings.titles;
    if (pick === 'off' && !force) return Promise.resolve(false); // Regenerate title still works
    const harness = ['claude', 'codex'].includes(pick) ? pick : chatOpts(ws).harness;
    ws._titling = true; renderThreadsSidebar(); // its card's title shimmers meanwhile
    return (window.electronAPI?.chatTitle?.(harness, text) || Promise.resolve(null)).then(t => {
      if (!t || (!force && ws.chat?.title !== first)) return false;
      ws.chat.title = t; setChatTabLabel(ws); saveState();
      return true;
    }, () => false).finally(() => { ws._titling = false; renderThreadsSidebar(); });
  }
  // Right-click → Regenerate title: from the thread's first prompt (its saved history), else its current title.
  async function regenerateChatTitle(tab) {
    tab.chat ||= { createdAt: Date.now() };
    let text = '';
    try { text = (await window.electronAPI.threadHistory(threadMeta(tab))).flatMap(h => h.items).find(m => m.role === 'user' && m.text)?.text || ''; } catch {}
    text ||= tab.chat.title || '';
    if (!text || !await autoTitleChat(tab, text, true)) zoomBadge('Could not generate a title');
  }
  // ── A turn's changed files from git, whatever made them (edit tools, sed, scripts) ──
  // ws.chat.snaps: [{ at, cwd, from, to? }], the working tree (a git tree id) when each turn started;
  // a turn ends where the next one starts, or (the latest turn) when it is first shown finished.
  async function snapshotTurn(ws) {
    const cwd = chatCwd(ws), at = Date.now();
    if (!cwd || !window.electronAPI?.gitSnapshot) return;
    const from = await Promise.race([window.electronAPI.gitSnapshot(cwd).catch(() => null), new Promise(r => setTimeout(r, 3000, null))]);
    if (!from) return; // not a repo (or too slow): the card falls back to the edit tools' diffs
    const snaps = ws.chat.snaps ||= [];
    snaps.push({ at, cwd, from });
    if (snaps.length > 100) snaps.splice(0, snaps.length - 100);
    saveState();
  }
  const _turnDiffs = new Map(); // "from..to" -> files ('pending' while loading)
  const _turnEnding = new Set(); // snapshots whose end state is being taken
  function turnGitFiles(ws, promptTs, nextTs) {
    const snaps = ws.chat?.snaps, ts = Date.parse(promptTs);
    if (!snaps?.length || !ts || !window.electronAPI?.gitTurnDiff) return null;
    // The prompt lands in the transcript just after its snapshot.
    const snapOf = t => {
      const known = snaps.findIndex(s => s.promptTs === t);
      if (known >= 0) return known;
      const preceding = snaps.findLastIndex(s => s.at <= t);
      return preceding >= 0 ? preceding : snaps.findIndex(s => s.at <= t + 5000);
    };
    const k = snapOf(ts);
    const s = snaps[k];
    if (!s || s.at < ts - 60000) return null;
    s.promptTs ??= ts;
    if (nextTs && snapOf(Date.parse(nextTs)) === k) return 'later'; // the next prompt is a mid-turn message of the same turn
    // Diffs land in bursts when a chat opens: one refresh for all of them, not one per turn.
    const rerender = () => {
      clearTimeout(ws._diffRerender);
      ws._diffRerender = setTimeout(() => { _flowSig = ''; if (curChat() === ws) refreshThreadFlow(ws); }, 50);
    };
    const to = s.to || snaps[k + 1]?.from;
    if (!to) {
      if (chatWorking(ws)) return null; // its end state is taken once the agent is done
      if (!_turnEnding.has(s)) {
        _turnEnding.add(s);
        window.electronAPI.gitSnapshot(s.cwd).then(tree => { if (tree) { s.to = tree; saveState(); rerender(); } }, () => {}).finally(() => _turnEnding.delete(s));
      }
      return null;
    }
    const key = s.from + '..' + to, hit = _turnDiffs.get(key);
    if (hit) return hit === 'pending' ? null : hit;
    _turnDiffs.set(key, 'pending');
    window.electronAPI.gitTurnDiff(s.cwd, s.from, to).then(files => { _turnDiffs.set(key, files || []); rerender(); }, () => _turnDiffs.set(key, []));
    return null;
  }
  async function deliverChatMessage(ws, message, steer = false) {
    if (_chatSending.has(ws.id) || _chatStarting.has(ws.id) || !findTermById(ws.id)) return false;
    _chatSending.add(ws.id);
    const { text, typed } = message;
    ws.chat ||= { createdAt: Date.now() };
    try {
      if (ws._terminalSessionOpening) await ws._terminalSessionOpening;
      if (findTermById(ws.id)?.term !== ws) return false;
      try { await ensureThreadBranch(ws, liveThreadAgent(ws)?.cwd || chatCwd(ws)); }
      catch (err) { noteChatError(ws, err.message || 'Could not check the thread branch'); return false; }
      if (!ws.chat.title && typed) { ws.chat.title = typed.split('\n')[0].slice(0, 80); setChatTabLabel(ws); autoTitleChat(ws, typed); }
      ws.chat.updatedAt = Date.now();
      const flow = thrPage.querySelector('#sbr-thread-flow');
      const imagePaths = [];
      for (const file of message.files || []) {
        if (!file.image || !file.path) continue;
        imagePaths.push(file.path);
        if (file.preview) cacheThreadImage(file.path, file.preview);
      }
      _pendingMsgs.set(ws.id, [...pendingMessages(ws), { id: message.id, text, imagePaths, at: Date.now(), afterTs: ws._lastUserTs || 0, steer, options: { ...(steer ? liveThreadAgent(ws)?._chatCfg || chatOpts(ws) : chatOpts(ws)) } }]);
      const newTurn = !steer || !_turns.has(ws.id);
      if (newTurn) _turns.set(ws.id, { since: Date.now(), awaitingPrompt: true });
      if (curChat() === ws) {
        const atBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1;
        flow.querySelector('.thr-empty')?.remove();
        flow.querySelectorAll('.thr-pending').forEach(el => el.remove());
        flow.insertAdjacentHTML('beforeend', pendingHtml(ws));
        flow.querySelectorAll('.thr-pending img.thr-img').forEach(bindThreadImage);
        if (atBottom) flow.scrollTop = flow.scrollHeight;
        syncWorking(ws);
      }
      _flowSig = '';
      if (newTurn) await snapshotTurn(ws); // before the agent sees the message, so all of its changes count
      let t = liveThreadAgent(ws);
      if (t && !await agentRunning(t, harnessOf(_tabAgent.get(t.id)))) { _tabAgent.set(t.id, null); t = liveThreadAgent(ws); }
      const o = chatOpts(ws), cfg = t?._chatCfg;
      // Steering always targets the current agent; changed model picks apply to the next turn.
      const sdk = !!t?._sdk?.alive, picksSame = ['model', 'effort'].every(k => cfg?.[k] === o[k]) && ['fast', 'ultra'].every(k => !!cfg?.[k] === !!o[k]);
      const same = t && (steer || (_tabAgent.get(t.id) === o.harness
        // A chat that runs structured takes over a session left running in the terminal view.
        && (!sdkHarness(o.harness) || sdk)
        // Structured Codex (and Antigravity, but for Full access) take model, effort and permissions per turn;
        // structured Claude Code switches permissions live.
        && (!cfg || (sdk && sdkPerTurn(o.harness, cfg.access, o.access))
          || (picksSame && ((sdk && o.harness !== 'antigravity') || cfg.access === o.access)))));
      if (same && agentLocked(t) && !await waitUnlocked(t)) throw Error('The conversation is still open in another app');
      const back = ws.chat.bringBack && !/^\s*\//.test(text) ? _bringBackNote(ws.chat.bringBack) : '';
      if (same) { if (!await sendToAgent(t, text + back, steer, message.files)) throw Error('The agent closed before the message was sent'); }
      else if (!await startChatAgent(ws, ws, text + back, cfg && cfg.harness === o.harness ? t : null, { files: message.files })) throw Object.assign(Error('Could not start the agent'), { shown: true });
      if (back) { delete ws.chat.bringBack; saveState(); }
      if (ws.chat.interruptedAt && !(ws.chat.interruptions || []).some(item => item.at === ws.chat.interruptedAt)) (ws.chat.interruptions ||= []).push({ at: ws.chat.interruptedAt });
      delete ws.chat.interruptedAt; ws.chat.lastContinueAt = Date.now(); saveState();
      if (curChat() === ws) syncThreadComposer(ws);
      for (const ms of [400, 1200]) setTimeout(() => { if (curChat() === ws) refreshThreadFlow(ws); }, ms);
      return true;
    } catch (err) {
      const remaining = pendingMessages(ws).filter(p => p.id !== message.id);
      if (remaining.length) _pendingMsgs.set(ws.id, remaining); else _pendingMsgs.delete(ws.id);
      if (!steer) _turns.delete(ws.id);
      _flowSig = '';
      if (curChat() === ws) refreshThreadFlow(ws);
      if (!err.shown) noteChatError(ws, err.message || 'Could not send message');
      return false;
    } finally { _chatSending.delete(ws.id); }
  }
  function renderChatQueue(ws, surface = thrPage) {
    if (surface === thrPage && curChat() !== ws) return;
    const flow = threadPart(surface, 'flow');
    if (!flow) return;
    const atBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1;
    let box = threadPart(surface, 'queue');
    if (!box) {
      box = document.createElement('div'); box.className = 'thr-queue';
      if (surface === thrPage) box.id = 'sbr-thread-queue'; else box.dataset.thrId = 'sbr-thread-queue';
      box.setAttribute('aria-label', 'Queued messages');
    }
    if (box.parentElement !== flow || box !== flow.lastElementChild) flow.appendChild(box);
    const queue = ws.chat?.queuedMessages || [], paused = !!ws.chat?.queuePaused;
    hydrateChatFiles(queue.flatMap(message => message.files || []), () => updateChatQueue(ws));
    box.hidden = !queue.length;
    const header = queue.length && (paused || queue.length > 1) ? `<div class="thr-queue-head"><span>${paused ? 'Queue paused' : queue.length + ' queued messages'}</span><button type="button" data-queue-act="pause" aria-label="${paused ? 'Resume' : 'Pause'} queue"><i class="ph ${paused ? 'ph-play' : 'ph-pause'}" aria-hidden="true"></i></button></div>` : '';
    const html = header + queue.map(m => {
      const label = queuedMessageTextHtml(m);
      const schedule = m.scheduleMode === 'countdown' && m.sendAt
        ? `<div class="thr-queued-schedule"><i class="ph ph-timer" aria-hidden="true"></i><span data-countdown-at="${m.sendAt}" role="timer" aria-label="Time remaining"></span></div>`
        : m.sendAt ? `<div class="thr-queued-schedule"><i class="ph ph-clock" aria-hidden="true"></i><span>Scheduled for ${escHtml(new Date(m.sendAt).toLocaleString())}</span></div>` : '';
      const previews = (m.files || []).map((file, i) => !file.image ? '' : `<button type="button" class="thr-queued-preview" data-queue-act="preview" data-file-i="${i}" aria-label="Preview ${escHtml(file.name)}">${file.preview ? `<img src="${escHtml(file.preview)}" alt="${escHtml(file.name)}">` : '<i class="ph ph-image" aria-hidden="true"></i>'}</button>`).join('');
      return `<div class="thr-queued-message thr-msg user" data-queue-id="${escHtml(m.id)}"><div class="thr-queued-bubble">${schedule}${previews ? `<div class="thr-queued-images">${previews}</div>` : ''}<div class="thr-queued-text">${label}</div></div>`
        + '<div class="thr-queued-actions"><button type="button" data-queue-act="send" aria-label="Send queued message now"><i class="ph ph-arrow-up" aria-hidden="true"></i><span>Send now</span></button><button type="button" data-queue-act="edit" aria-label="Edit queued message"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button><button type="button" data-queue-act="remove" aria-label="Remove queued message"><i class="ph ph-x" aria-hidden="true"></i></button></div></div>';
    }).join('');
    if (box._queueHtml !== html) { box.innerHTML = html; box._queueHtml = html; }
    updateScheduleCountdowns(box);
    if (atBottom) flow.scrollTop = flow.scrollHeight;
  }
  function updateChatQueue(ws) {
    if (curChat() === ws) { renderChatQueue(ws); syncSendBtn(); }
    const snapshot = ws.el?.querySelector(':scope > .thr-snapshot');
    if (snapshot) renderChatQueue(ws, snapshot);
  }
  async function sendQueuedMessage(ws, id, steer = !!chatWorking(ws), completionAt = 0) {
    if (_queueDraining.has(ws.id) || _chatSending.has(ws.id) || ws._editingQueued) return;
    const message = ws.chat?.queuedMessages?.find(m => m.id === id);
    if (!message) return;
    _queueDraining.add(ws.id);
    const nextAfter = Date.now();
    try {
      if (await deliverChatMessage(ws, message, steer)) {
        if (completionAt) ws._queueCompletionAt = completionAt;
        ws.chat.queuedMessages = ws.chat.queuedMessages.filter(m => m.id !== id);
        // Each remaining message waits for the newly dispatched turn, not an old completion.
        ws.chat.queuedMessages.forEach(m => { if (!m.sendAt) m.after = Math.max(m.after, nextAfter + 1); });
      } else ws.chat.queuePaused = true;
      updateChatQueue(ws); saveState();
    } finally { _queueDraining.delete(ws.id); }
  }
  threadPart(thrPage, 'flow')?.addEventListener('click', e => {
    const button = e.target.closest('[data-queue-act]'), ws = curChat();
    if (!button || !ws?.chat) return;
    const id = button.closest('[data-queue-id]')?.dataset.queueId;
    if (button.dataset.queueAct === 'send') { sendQueuedMessage(ws, id); return; }
    const message = ws.chat.queuedMessages?.find(m => m.id === id);
    if (button.dataset.queueAct === 'preview') {
      e.preventDefault();
      const file = message?.files?.[+button.dataset.fileI];
      if (file) openChatAttachment(file);
      return;
    }
    if (button.dataset.queueAct === 'edit' && message) {
      beginQueuedEdit(ws, message);
      return;
    }
    if (button.dataset.queueAct === 'remove') {
      if (ws._editingQueued === id) finishQueuedEdit(ws, false);
      ws.chat.queuedMessages = ws.chat.queuedMessages.filter(m => m.id !== id);
      if (message?.sendAt) { syncThreadComposer(ws); renderThreadsSidebar(); }
    }
    else ws.chat.queuePaused = !ws.chat.queuePaused;
    updateChatQueue(ws); saveState();
  });
  async function drainChatQueue(ws) {
    const queue = ws.chat?.queuedMessages;
    if (!queue?.length || ws.chat.queuePaused || ws._editingQueued || _queueDraining.has(ws.id) || _chatSending.has(ws.id) || _chatStarting.has(ws.id)) return;
    const now = Date.now();
    const due = queue.reduce((earliest, message) =>
      message.sendAt > 0 && message.sendAt <= now && (!earliest || message.sendAt < earliest.sendAt) ? message : earliest, null);
    if (due && !ws._resuming && !ws._cliView && !chatWorking(ws)) { await sendQueuedMessage(ws, due.id, false); return; }
    const first = queue.find(message => !message.sendAt);
    if (!first) return;
    const t = liveThreadAgent(ws);
    if (!t) return; // Never send a queued prompt to a shell or restart a closed agent automatically.
    const harness = _tabAgent.get(t.id);
    let completedAt = 0;
    if (t._sdk?.alive) completedAt = !t._sdk.busy && !t._sdk.ask ? t._sdk.idleAt || 0 : 0; // its turn-end event
    else if (harness === 'claude') completedAt = !t._agentWorking ? t._idleAt || 0 : 0;
    else if (harness === 'codex' && window.electronAPI?.threadHistory) {
      _queueDraining.add(ws.id);
      try {
        const history = await window.electronAPI.threadHistory(threadMeta(ws));
        const status = history[history.length - 1]?.turnState;
        if (status) ws._chatTurnState = status;
        if (status?.status === 'completed') completedAt = status.at;
      } catch { /* Leave the queue intact until a completion can be confirmed. */ }
      finally { _queueDraining.delete(ws.id); }
    }
    if (completedAt >= first.after && completedAt > (ws._queueCompletionAt || 0) && ws.chat.queuedMessages?.find(message => !message.sendAt) === first && !ws.chat.queuePaused && !ws._editingQueued && findTermById(ws.id)) await sendQueuedMessage(ws, first.id, false, completedAt);
  }
  setInterval(() => {
    updateScheduleCountdowns(document);
    for (const ws of workspaces) for (const tab of getWorkspaceTerminals(ws)) {
      if (tab.threadHistory && tab.chat?.queuedMessages?.length) drainChatQueue(tab);
    }
  }, 1000);

  // ── Threads sidebar: open and closed chats across workspaces ──
  // Working threads first (agent busy: spinner + elapsed), then Settled, newest activity first.
  // A card: folder · time · status / title (first prompt) / branch · agent. Click opens its chat.
  const tsAside = document.getElementById('threads-sidebar');
  const tsList = document.getElementById('ts-list');
  const tsSearch = document.getElementById('ts-search');
  const tsLayout = document.getElementById('set-thread-layout');
  try { if (localStorage.getItem('tv-threads-layout') === 'project') tsLayout.value = 'project'; } catch {}
  const tsCollapsed = new Map();
  const tsSettledShown = new Map();
  function normalizeThreadProjectPath(cwd) {
    const trimmed = cwd.replace(/[\\/]+$/, '');
    return !trimmed || /^[a-z]:$/i.test(trimmed) ? cwd : trimmed;
  }
  // Project filter (header funnel): null = all projects, '' = No project, else the folder path.
  let tsProject = null;
  try {
    const savedProject = localStorage.getItem('tv-threads-project');
    if (savedProject != null) tsProject = normalizeThreadProjectPath(savedProject);
  } catch {}
  const tsProjectKey = x => x.folder === 'No project' ? '' : normalizeThreadProjectPath(x.cwd || '');
  // A project's own icon (favicon / app icon, found by the main process like T3 Code), else the folder icon.
  // Looked up once per folder per session; the sidebar and composer update when one arrives.
  const _projIcons = new Map(); // cwd -> { value: dataUrl | null } (value absent while loading)
  function projectIconHtml(cwd, fallback = 'ph-folder') {
    const folderIcon = `<i class="ph ${fallback}" aria-hidden="true"></i>`;
    if (!cwd || chatFolderName(cwd) === 'No project' || !window.electronAPI?.projectIcon) return folderIcon;
    let entry = _projIcons.get(cwd);
    if (!entry) {
      _projIcons.set(cwd, entry = {});
      window.electronAPI.projectIcon(cwd).then(v => {
        entry.value = v || null;
        if (!v) return;
        document.querySelectorAll('.thr-cwd[data-project-cwd]').forEach(button => {
          if (button.dataset.projectCwd === cwd && button.firstElementChild) {
            button.firstElementChild.outerHTML = projectIconHtml(cwd);
          }
        });
        renderThreadsSidebar();
      }, () => { entry.value = null; });
    }
    return entry.value ? `<img class="ts-proj-icon" src="${entry.value}" alt="" aria-hidden="true">` : folderIcon;
  }
  function setThreadsProject(p) {
    tsProject = p;
    try { p == null ? localStorage.removeItem('tv-threads-project') : localStorage.setItem('tv-threads-project', p); } catch {}
    syncThreadsFilterBtn(); renderThreadsSidebar();
  }
  function syncThreadsFilterBtn() {
    const b = document.getElementById('ts-filter');
    if (!b) return;
    const label = tsProject == null ? '' : tsProject === '' ? 'No project' : chatFolderName(tsProject);
    b.classList.toggle('active', tsProject != null);
    b.title = label ? `Filter: ${label}` : 'Filter by project';
    b.setAttribute('aria-pressed', String(tsProject != null));
  }
  // A thread's T3-style states: pinned (top shelf), settled (the user's "done"; new activity un-settles).
  function setThreadFlag(tab, key, on) {
    tab.chat ||= { createdAt: Date.now() };
    if (on) tab.chat[key] = key === 'settledAt' ? Date.now() : true; else delete tab.chat[key];
    saveState(); renderThreadsSidebar();
  }
  // Inline rename (double-click / F2): Enter or leaving saves, Escape cancels.
  function startThreadRename(card) {
    const tab = findChatThread(card?.dataset.tab), title = card?.querySelector('.ts-title');
    if (!tab || !title || card.querySelector('.ts-rename')) return;
    const input = document.createElement('input');
    input.className = 'ts-rename'; input.value = tab.chat?.title || tab.label || ''; input.setAttribute('aria-label', 'Thread title'); input.spellcheck = false;
    title.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (save && v && v !== tab.chat?.title) { tab.chat ||= { createdAt: Date.now() }; tab.chat.title = v.slice(0, 80); setChatTabLabel(tab); saveState(); }
      input.remove(); tsList._html = null; renderThreadsSidebar();
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    for (const ev of ['click', 'dblclick', 'mousedown']) input.addEventListener(ev, e => e.stopPropagation());
  }
  const ago = t => { const m = (Date.now() - t) / 6e4;
    return !t ? '' : m < 1 ? 'now' : m < 60 ? `${m | 0}m` : m < 1440 ? `${m / 60 | 0}h` : m < 10080 ? `${m / 1440 | 0}d` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  // A thread shows once it has messages (or one is on its way); before that only as a draft, if text is typed.
  function threadHasMessages(t) { return !!t.chat?.title || !!t.chat?.stopped?.length || !!t.chat?.queuedMessages?.length || threadSegments(t).some(s => s.used) || _pendingMsgs.has(t.id) || !!chatWorking(t); }
  function threadDraft(t) { return threadHasMessages(t) ? '' : (t.chat?.draft || '').trim(); }
  const allChatTabs = () => [...workspaces.flatMap(ws => getWorkspaceTerminals(ws).filter(t => t.threadHistory && t.chat)), ...closedThreads];
  // Side chats live inside their thread (its chat lists them), never as threads of their own.
  const chatThreads = () => allChatTabs().filter(t => !t.chat?.side)
    .filter(t => threadHasMessages(t) || threadDraft(t));
  // A thread's id that survives closing and reopening its tab.
  const threadKey = t => t.chat?.storeId || t.id;
  const findThreadByKey = key => key && allChatTabs().find(t => threadKey(t) === key);
  const sideChatsOf = t => allChatTabs().filter(x => x.chat?.side?.parentId === threadKey(t) && (threadHasMessages(x) || _chatStarting.has(x.id)))
    .sort((a, b) => (a.chat.createdAt || 0) - (b.chat.createdAt || 0));
  // `w` is a Chat tab.
  function threadInfo(w) {
    const segs = threadSegments(w), last = segs[segs.length - 1], h = harnessOf(last?.harness);
    const cwd = chatCwd(w);
    void refreshChatGitBranch(cwd);
    // "Claude Haiku · Low": a session's model and effort (the agent's name when it ran its default).
    const modelLabel = seg => [seg?.model && seg.model !== 'default' ? modelName({ harness: seg.harness, model: seg.model }, false) : harnessOf(seg?.harness)?.name || '',
      seg?.effort && seg.effort !== 'default' ? EFFORT_NAMES[seg.effort] || seg.effort : ''].filter(Boolean).join(' · ');
    const used = [...new Set([...segs.filter(x => x.used).map(x => x.harness), ...(!w._closed && _tabAgent.get(w.id) ? [_tabAgent.get(w.id)] : [])])];
    const hs = (used.length ? used : last ? [last.harness] : []).map(harnessOf).filter(Boolean);
    // One per agent the thread used, with its latest session's model (the card shows the same agents).
    const models = hs.map(x => ({ h: x, text: modelLabel(segs.findLast(sg => sg.harness === x.id)) || x.name }));
    const draft = threadDraft(w);
    return { w, ws: wsOf(w) || findWs(w.workspaceId), h, hs, cwd, folder: chatFolderName(cwd), branch: w.chat?.branch || _gitBranch.get(cwd) || '',
      draft: !!(w._closed && draft), unsent: !!w.chat.draft?.trim(), title: w.chat.title || draft.split('\n')[0].slice(0, 80) || w.label, updated: w.chat.updatedAt || last?.since || w.chat.createdAt || 0, work: chatWorking(w),
      model: modelLabel(last), models, openIn: w._closed ? null : wsOf(w) };
  }
  function renderThreadsSidebar() {
    if (!tsOpen) return;
    const q = tsSearch.value.trim().toLowerCase();
    const all = chatThreads().map(threadInfo)
      .filter(x => !q || `${x.title} ${x.folder} ${x.branch} ${x.openIn?.label || ''}`.toLowerCase().includes(q))
      .filter(x => tsProject == null || tsProjectKey(x) === tsProject)
      .sort((a, b) => b.updated - a.updated);
    // T3 Code's sidebar logic: one-line rows ([agent] title [pin] · time, the time giving way to a Settle /
    // Un-settle action on hover); shelves Pinned · Working · the active list · Settled (10, then 25 more per click).
    // Settling is the user's "done": new activity after it brings the thread back to the active list.
    const settled = x => !x.work && x.w.chat.settledAt && x.w.chat.settledAt >= x.updated;
    const clocks = new Map();
    const row = (x, shelf) => {
      const tipRows = [{ icon: 'ph-folder', text: x.cwd || 'No project' }, ...(x.openIn ? [{ icon: 'ph-squares-four', text: x.openIn.label }] : []),
        ...(x.branch ? [{ icon: 'ph-git-branch', text: x.branch }] : []), ...x.models.map(m => ({ proc: m.h.bin, text: m.text })),
        ...(x.w.chat.forkOf ? [{ icon: 'ph-git-fork', text: `Forked from ${findThreadByKey(x.w.chat.forkOf)?.chat?.title || 'a deleted thread'}` }] : [])];
      const parent = x.w.chat.forkOf && findThreadByKey(x.w.chat.forkOf);
      const forkBtn = parent ? `<button type="button" class="ts-pin ts-fork" data-act="parent" aria-label="Open parent thread" data-tip="Open parent: ${escHtml(parent.chat?.title || parent.label || 'thread')}"><i class="ph ph-git-fork" aria-hidden="true"></i></button>` : '';
      const end = x.work ? (x.work.wait ? 'Waiting' : fmtSecs(Math.max(0, Math.round((Date.now() - x.work.since) / 1000)))) : ago(x.updated);
      clocks.set(x.w.id, { time: ago(x.updated), status: x.work ? (x.work.wait ? end : `Working ${end}`) : '' });
      const action = shelf === 'project' || x.draft || x.work ? ''
        : shelf === 'settled' ? '<button type="button" class="ts-act" data-act="unsettle" aria-label="Un-settle thread"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i><span class="ts-act-label">Un-settle</span></button>'
        : '<button type="button" class="ts-act" data-act="settle" aria-label="Settle thread"><i class="ph ph-check" aria-hidden="true"></i><span class="ts-act-label">Settle</span></button>';
      const pin = x.w.chat.pinned ? '<button type="button" class="ts-pin" data-act="unpin" aria-label="Unpin thread" data-tip="Unpin thread"><i class="ph ph-push-pin" aria-hidden="true"></i></button>' : '';
      const title = `<span class="ts-title${x.w._titling ? ' titling' : ''}"${x.w._titling ? ' aria-busy="true"' : ''}>${escHtml(x.title)}</span>`;
      const unsent = x.unsent ? ' unsent' : '';
      const draftIcon = x.unsent ? '<i class="ph ph-note-pencil ts-draft-icon" aria-label="Unsent draft"></i>' : '';

      const done = !x.draft && !x.work && x.w.chat.unseenCompletion
        ? '<span class="ts-status done"><i class="ph ph-check-circle" aria-hidden="true"></i>Done</span>' : '';
      const statusLabel = x.work ? ', working' : done ? ', done' : '';
      // Project threads and the active status shelves use full cards; the Settled shelf is slim.
      if (shelf !== 'settled') {
        const heading = shelf === 'project' ? draftIcon + title
          : `<span class="ts-folder">${draftIcon}${projectIconHtml(x.cwd, x.folder === 'No project' ? 'ph-selection' : 'ph-folder')}<span>${escHtml(x.folder)}</span></span>`;
        const status = x.work ? '<span class="ts-status working"><i class="ph ph-circle-notch ts-spin" aria-hidden="true"></i></span>' : '';
        return `<div role="button" tabindex="0" class="ts-card${x.draft ? ' draft' : ''}${unsent}${x.work ? ' working' : ''}" draggable="${!x.draft}" data-tab="${x.w.id}"`
          + ` aria-label="${escHtml(x.title)}${statusLabel}" data-tip="${escHtml(x.draft ? 'Draft' : x.title)}" data-tip-rows="${escHtml(JSON.stringify(tipRows))}">`
          + `<span class="ts-row">${heading}${pin}<span class="ts-end">${done}${x.draft || x.work ? '' : '<span class="ts-time"></span>'}${action}</span>${status}</span>`
          + (shelf === 'project' ? '' : title)
          + (x.draft ? '' : `<span class="ts-row ts-meta">${x.branch ? `<span class="ts-branch"><i class="ph ph-git-branch" aria-hidden="true"></i><span>${escHtml(x.branch)}</span></span>` : '<span></span>'}`
            + (x.hs.length || forkBtn ? `<span class="ts-agents">${forkBtn}${x.hs.map(h => `<span class="ts-agent" title="${escHtml(h.name)}"${h.color ? ` style="color:${h.color}"` : ''}>${procIconHtml(h.bin, 'ph-robot')}</span>`).join('')}</span>` : '') + '</span>')
          + '</div>';
      }
      // Settled rows lead with the project's icon (folder icon when it has none); a working thread, the spinner.
      const lead = x.work ? '<i class="ph ph-circle-notch ts-spin" aria-hidden="true"></i>'
        : projectIconHtml(x.cwd, x.folder === 'No project' ? 'ph-selection' : 'ph-folder');
      return `<div role="button" tabindex="0" class="ts-card slim${unsent}" draggable="true" data-tab="${x.w.id}"`
        + ` aria-label="${escHtml(x.title)}${statusLabel}" data-tip="${escHtml(x.draft ? 'Draft' : x.title)}" data-tip-rows="${escHtml(JSON.stringify(tipRows))}">`
        + `<span class="ts-lead">${lead}</span>${draftIcon}${title}${pin}`
        + `<span class="ts-end">${done}<span class="ts-time"></span>${action}</span></div>`;
    };
    const section = (id, label, count, body, folded = false) => {
      if (!count) return '';
      const collapsed = tsCollapsed.get(id) ?? folded;
      return `<div class="ts-section${collapsed ? ' collapsed' : ''}" data-sec="${escHtml(id)}">`
        + `<button type="button" class="ts-section-head" aria-expanded="${!collapsed}">${label}<span class="ts-count">${count}</span><i class="ph ph-caret-down ts-caret" aria-hidden="true"></i></button>`
        + `<div class="ts-cards">${collapsed ? '' : body()}</div></div>`;
    };
    const shelves = list => {
      const shelf = (kind, label, items) => {
        const folded = kind === 'settled';
        const limit = folded ? tsSettledShown.get(kind) ?? 10 : items.length;
        return section(kind, `<span>${label}</span>`, items.length, () => items.slice(0, limit).map(x => row(x, kind)).join('')
          + (items.length > limit ? `<button type="button" class="ts-more">Show more <span class="ts-count">${items.length - limit}</span></button>` : ''), folded);
      };
      const rest = list.filter(x => !x.draft && !x.w.chat.pinned);
      return shelf('drafts', 'Drafts', list.filter(x => x.draft))
        + shelf('pinned', 'Pinned', list.filter(x => !x.draft && x.w.chat.pinned))
        + shelf('working', 'Working', rest.filter(x => x.work))
        + shelf('active', 'Threads', rest.filter(x => !x.work && !settled(x)))
        + shelf('settled', 'Settled', rest.filter(settled).sort((a, b) => b.w.chat.settledAt - a.w.chat.settledAt));
    };
    const byProject = () => {
      const groups = new Map();
      for (const thread of all) {
        const key = tsProjectKey(thread);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(thread);
      }
      return [...groups].map(([key, list]) => {
        const id = `project:${JSON.stringify(key)}`;
        const working = list.filter(x => x.work).length;
        const label = projectIconHtml(key, key ? 'ph-folder' : 'ph-selection')
          + `<span class="ts-project-name" title="${escHtml(key || 'No project')}">${escHtml(list[0].folder)}</span>`
          + (working ? `<span class="ts-project-working">${working} working</span>` : '');
        return section(id, label, list.length, () => list.map(x => row(x, 'project')).join(''));
      }).join('');
    };
    const html = all.length
      ? (tsLayout.value === 'project' ? byProject() : shelves(all))
      : `<div class="ts-empty">${q ? 'No threads match' : tsProject != null ? `No threads in ${escHtml(tsProject === '' ? 'No project' : chatFolderName(tsProject))}` : 'No threads yet. Open a Chat tab in a workspace and send a message.'}</div>`;
    if (tsList.querySelector('.ts-rename')) return; // an inline rename is open: don't rebuild under it
    if (tsList._html !== html) { tsList._html = html; tsList.innerHTML = html; } // rebuild only on change (keeps hover and focus)
    // Countdown ticks must preserve cards, tooltip anchors, focus, and spinner animations.
    tsList.querySelectorAll('.ts-card').forEach(card => {
      const clock = clocks.get(card.dataset.tab);
      if (!clock) return;
      const time = card.querySelector('.ts-time');
      if (time && time.textContent !== clock.time) time.textContent = clock.time;
      const status = card.querySelector('.ts-status.working');
      if (status) {
        const text = status.lastChild;
        if (text?.nodeType === Node.TEXT_NODE) { if (text.nodeValue !== clock.status) text.nodeValue = clock.status; }
        else status.append(document.createTextNode(clock.status));
      }
    });
    syncThreadSelection();
  }
  tsList.addEventListener('click', e => {
    const head = e.target.closest('.ts-section-head');
    if (head) {
      const id = head.parentElement.dataset.sec;
      tsCollapsed.set(id, head.getAttribute('aria-expanded') === 'true');
      renderThreadsSidebar();
      tsList.querySelector(`[data-sec="${CSS.escape(id)}"] > .ts-section-head`)?.focus({ preventScroll: true });
      return;
    }
    const more = e.target.closest('.ts-more');
    if (more) {
      const id = more.closest('.ts-section').dataset.sec;
      tsSettledShown.set(id, (tsSettledShown.get(id) ?? 10) + 25);
      renderThreadsSidebar();
      return;
    }
    const c = e.target.closest('.ts-card'), tab = c && findChatThread(c.dataset.tab);
    if (!tab || e.target.closest('.ts-rename')) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'settle' || act === 'unsettle') { setThreadFlag(tab, 'settledAt', act === 'settle'); return; }
    if (act === 'unpin') { setThreadFlag(tab, 'pinned', false); return; }
    if (act === 'parent') { const p = findThreadByKey(tab.chat?.forkOf); if (p) openChatTab(p); return; }
    openChatTab(tab);
  });
  tsList.addEventListener('dblclick', e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.target.closest('button, input')) return;
    const c = e.target.closest('.ts-card:not(.draft)');
    if (c) { e.preventDefault(); startThreadRename(c); }
  });
  // Rows are role="button" divs (they hold an inline rename input and action buttons): Enter / Space open, F2 renames.
  tsList.addEventListener('keydown', e => {
    const c = e.target.classList?.contains('ts-card') ? e.target : null;
    if (!c) return;
    if (e.key === 'F2' && !c.classList.contains('draft')) { e.preventDefault(); startThreadRename(c); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const tab = findChatThread(c.dataset.tab); if (tab) openChatTab(tab); }
  });
  // Drag a thread into a chat's composer: it goes in as a link, its history the message's context.
  tsList.addEventListener('dragstart', e => {
    const c = e.target.closest?.('.ts-card:not(.draft)');
    if (!c) return;
    e.dataTransfer.setData(THREAD_DRAG, c.dataset.tab);
    e.dataTransfer.effectAllowed = 'copyMove';
    // The drag preview: a small link-like chip (the card's own snapshot showed square dark corners).
    const ghost = document.createElement('div');
    ghost.className = 'ts-drag-ghost';
    ghost.innerHTML = `<span class="ts-drag-chip"><i class="ph ph-chats-circle" aria-hidden="true"></i><span>${escHtml(c.querySelector('.ts-title')?.textContent || 'Thread')}</span></span>`;
    document.body.appendChild(ghost);
    // The chip sits up and to the right of the pointer (transparent room in the image), clear of the drop spot.
    e.dataTransfer.setDragImage(ghost, 0, ghost.offsetHeight);
    setTimeout(() => ghost.remove());
  });
  tsList.addEventListener('contextmenu', e => {
    const c = e.target.closest('.ts-card');
    if (!c) return;
    e.preventDefault();
    showCtxMenu(e, 'chat-thread', c.dataset.tab);
  });
  tsSearch.addEventListener('input', renderThreadsSidebar);
  tsLayout.addEventListener('change', () => {
    try { localStorage.setItem('tv-threads-layout', tsLayout.value); } catch {}
    tsList.scrollTop = 0;
    renderThreadsSidebar();
  });
  document.getElementById('ts-new').addEventListener('click', () => openPalette('projects'));
  document.getElementById('ts-filter')?.addEventListener('click', e => {
    e.stopPropagation(); // the document click handler would close the menu right away
    const btn = e.currentTarget;
    if (ctxEl.classList.contains('open') && ctxEl._owner === btn) { hideCtxMenu(); return; } // a toggle
    const r = btn.getBoundingClientRect();
    showCtxMenu({ pageX: r.left, pageY: r.bottom + 6 }, 'ts-project');
    ctxEl._owner = btn;
  });
  syncThreadsFilterBtn();
  // Open/closed animates its width (like the left sidebar); the terminals refit once it settles.
  let tsOpen = false;
  const tsSettle = () => { const w = activeWs(); if (w) getWorkspaceTerminals(w).forEach(t => fitTerm(t)); syncBrowserSlots(); };
  function setThreadsSidebar(open) {
    tsOpen = !!open;
    holdTermFits();
    tsAside.classList.toggle('collapsed', !tsOpen);
    tsAside.inert = !tsOpen;
    document.getElementById('btn-threads')?.setAttribute('aria-expanded', String(tsOpen));
    try { localStorage.setItem('tv-threads-sidebar', tsOpen ? '1' : ''); } catch {}
    if (tsOpen) renderThreadsSidebar();
    if (!document.body.classList.contains('ui-animations')) tsSettle();
  }
  tsAside.addEventListener('transitionend', e => { if (e.target === tsAside && e.propertyName === 'width') { releaseTermFits(); tsSettle(); } });
  // Resize: drag its left edge (220-520px, remembered).
  const TS_MIN = 220, TS_MAX = 520;
  try { const w = +localStorage.getItem('tv-threads-w'); if (w) tsAside.style.setProperty('--ts-w', Math.max(TS_MIN, Math.min(TS_MAX, w)) + 'px'); } catch {}
  tsAside.querySelector('.ts-sash')?.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sash = e.currentTarget, startX = e.clientX, startW = tsAside.offsetWidth;
    sash.setPointerCapture(e.pointerId); sash.classList.add('dragging');
    _suppressResize = true; startResizing();
    const move = ev => tsAside.style.setProperty('--ts-w', Math.max(TS_MIN, Math.min(TS_MAX, startW + startX - ev.clientX)) + 'px');
    const up = () => {
      sash.removeEventListener('pointermove', move); sash.removeEventListener('pointerup', up); sash.classList.remove('dragging');
      _suppressResize = false; stopResizing(); tsSettle();
      try { localStorage.setItem('tv-threads-w', String(tsAside.offsetWidth)); } catch {}
    };
    sash.addEventListener('pointermove', move); sash.addEventListener('pointerup', up);
  });
  document.getElementById('btn-threads')?.addEventListener('click', () => setThreadsSidebar(!tsOpen));
  try { if (!SETTINGS_ONLY && localStorage.getItem('tv-threads-sidebar')) setThreadsSidebar(true); } catch {}
  setInterval(renderThreadsSidebar, 1000); // working timers and statuses; selection updates on activation

  // ── Syntax highlighting (shell, JSON) for tool calls and code blocks: escaped spans, colors from the terminal theme ──
  const tk = (cls, t) => `<span class="tk-${cls}">${escHtml(t)}</span>`;
  const codeLang = tag => /^(sh|bash|zsh|shell|console|shellscript)$/i.test(tag) ? 'sh' : /^(json|jsonc|json5)$/i.test(tag) ? 'json' : '';
  function hlJson(text) {
    const re = /("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
    let out = '', last = 0;
    for (const m of text.matchAll(re)) {
      out += escHtml(text.slice(last, m.index));
      out += m[1] ? tk(m[2] ? 'k' : 's', m[1]) + (m[2] ? escHtml(m[2]) : '') : m[3] ? tk('b', m[3]) : tk('n', m[4]);
      last = m.index + m[0].length;
    }
    return out + escHtml(text.slice(last));
  }
  function hlShell(text) {
    // strings | heredoc | comment | variable | operator | flag | word
    const re = /('[^']*'?|"(?:\\.|[^"\\])*"?)|(<<-?\s*(['"]?)([A-Za-z_]\w*)\3)|((?:^|(?<=\s))#[^\n]*)|(\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[0-9@#?$!*-])|(&&|\|\||;;|\$\(|\d*>>?&\d+|\d*>>?|<&?\d*|[|;&()])|((?<=^|\s)--?[A-Za-z0-9][\w-]*=?)|([^\s'"|;&<>()$]+)/gm;
    let out = '', last = 0, cmd = true;
    for (let m; (m = re.exec(text));) {
      const gap = text.slice(last, m.index);
      if (gap.includes('\n')) cmd = true;
      out += escHtml(gap);
      if (m[1]) out += tk('s', m[1]);
      else if (m[2]) {
        // A heredoc: its body (up to the delimiter line) is data, not shell.
        out += tk('o', m[2]);
        const nl = text.indexOf('\n', re.lastIndex), end = nl < 0 ? -1 : text.indexOf('\n' + m[4], nl);
        if (nl >= 0) {
          const stop = end < 0 ? text.length : end + 1;
          out += escHtml(text.slice(re.lastIndex, nl + 1)) + tk('h', text.slice(nl + 1, stop)) + (end < 0 ? '' : tk('o', m[4]));
          re.lastIndex = end < 0 ? text.length : end + 1 + m[4].length;
        }
        cmd = false;
      }
      else if (m[5]) out += tk('cm', m[5]);
      else if (m[6]) out += tk('v', m[6]);
      else if (m[7]) { out += tk('o', m[7]); if (/^(&&|\|\||;;?|\||&|\$\(|\()$/.test(m[7])) cmd = true; } // a redirect doesn't start a command
      else if (m[8]) out += tk('f', m[8]);
      else { out += cmd && !/^\w+=/.test(m[9]) ? tk('c', m[9]) : escHtml(m[9]); if (!/^\w+=/.test(m[9])) cmd = false; }
      last = re.lastIndex;
    }
    return out + escHtml(text.slice(last));
  }
  const hlCode = (text, lang) => lang === 'sh' ? hlShell(text) : lang === 'json' ? hlJson(text) : escHtml(text);
  // Diff prefixes and hunk coordinates are metadata, not source code.
  function hlDiffLine(line, file) {
    const cls = line.startsWith('@@') ? ' hunk' : line[0] === '+' ? ' add' : line[0] === '-' ? ' del' : '';
    const ext = file.split('.').pop().toLowerCase();
    const supported = /^(?:[cm]?[jt]sx?|css|scss|less|html?|xml|svg|vue|svelte|py|rs|c|h|cpp|hpp|cc|java|go|rb|php|sql|ya?ml|toml|ini|jsonc?|sh|bash|zsh)$/;
    let content = escHtml(line) || ' ';
    if (!line.startsWith('@@') && /^[ +\-]/.test(line) && supported.test(ext)) {
      const source = line.slice(1);
      content = escHtml(line[0]) + (/^(sh|bash|zsh)$/.test(ext) ? hlShell(source) : /^jsonc?$/.test(ext) ? hlJson(source) : hlSourceLine(source, ext));
    }
    return `<span class="dl${cls}">${content}</span>`;
  }
  function hlSourceLine(text, lang) {
    const hashComments = /^(py|rb|ya?ml|toml|ini)$/.test(lang);
    const re = /\/\/[^\n]*|\/\*.*?(?:\*\/|$)|<!--.*?(?:-->|$)|#[^\n]*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?|\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|[A-Za-z_$][\w$-]*|[{}()[\];:=<>!+*%&|?~^/-]/gi;
    const keywords = /^(?:async|await|break|case|catch|class|const|continue|def|delete|do|elif|else|enum|except|export|extends|finally|fn|for|from|function|if|impl|import|in|interface|let|match|new|of|pub|raise|return|self|static|struct|super|switch|this|throw|try|type|typeof|use|var|void|while|with|yield|select|where|insert|update|into|as)$/i;
    let out = '', last = 0;
    for (const m of text.matchAll(re)) {
      out += escHtml(text.slice(last, m.index));
      const token = m[0], after = text.slice(m.index + token.length);
      const cls = /^(\/\/|\/\*|<!--)/.test(token) || (hashComments && token[0] === '#') ? 'cm'
        : /^["'`]/.test(token) ? 's' : /^\d/.test(token) ? 'n'
        : /^(true|false|null|none|undefined)$/i.test(token) ? 'b'
        : keywords.test(token) ? 'k' : /^\s*\(/.test(after) ? 'c'
        : /^\s*:/.test(after) ? 'v' : /^[{}()[\];:=<>!+*%&|?~^/-]$/.test(token) ? 'o' : '';
      out += cls ? tk(cls, token) : escHtml(token);
      last = m.index + token.length;
    }
    return out + escHtml(text.slice(last));
  }
  // A file link's type icon, from its extension.
  const FILE_ICONS = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', html: 'html', htm: 'html', css: 'css', scss: 'css',
    py: 'py', rs: 'rs', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', md: 'md', csv: 'csv', sql: 'sql', svg: 'svg', vue: 'vue', pdf: 'pdf', txt: 'txt',
    ini: 'ini', toml: 'ini', yml: 'ini', yaml: 'ini', png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'image', webp: 'image', bmp: 'image', zip: 'archive', gz: 'archive', tar: 'archive' };
  // Its color group (an ft-* class, colored in workspace.css); any other file gets ft-other.
  const FILE_COLORS = Object.fromEntries(Object.entries({
    js: 'js mjs cjs', ts: 'ts mts cts tsx jsx', html: 'html htm xml', css: 'css scss sass less', py: 'py', rs: 'rs',
    c: 'c h cpp cc hpp cs', go: 'go', jvm: 'java kt kts scala', rb: 'rb', php: 'php', shell: 'sh bash zsh fish ps1 bat cmd',
    json: 'json jsonc json5', config: 'yml yaml toml ini env conf lock cfg', md: 'md mdx txt rst', data: 'csv tsv sql db',
    vue: 'vue', svelte: 'svelte', pdf: 'pdf', image: 'png jpg jpeg gif webp bmp svg ico', archive: 'zip gz tar rar 7z',
  }).flatMap(([group, exts]) => exts.split(' ').map(ext => [ext, group])));
  const linkFileIcon = href => {
    const path = href.replace(/#.*$/, '').replace(/:\d+(:\d+)?$/, '');
    if (/[\\/]$/.test(path)) return 'ph-folder ft-folder';
    const ext = (path.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
    const icon = /^json[c5]?$/.test(ext) ? 'ph-brackets-curly' : FILE_ICONS[ext] ? 'ph-file-' + FILE_ICONS[ext] : ext ? 'ph-file-code' : 'ph-file';
    return `${icon} ft-${FILE_COLORS[ext] || 'other'}`;
  };
  // A link's icon: web links show the site's /favicon.ico (the globe when it has none), paths their file type.
  const _faviconMissing = new Set(); // hosts whose favicon failed: straight to the globe on re-render
  // Desktop: the icon comes through the main process as a data URL, so its pixels can be read: a single-color
  // icon on a transparent background (GitHub's black octocat) is drawn as a mask in the link color instead.
  const _favicons = new Map(); // host -> Promise<{ src, mono } | null>
  const faviconHtml = f => f.mono ? `<span class="thr-favicon mono" style="--icon:url('${f.src}')" aria-hidden="true"></span>` : `<img class="thr-favicon" src="${f.src}" alt="">`;
  const faviconMono = src => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      let clear = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) { clear++; continue; }
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 28) return resolve(false); // has color
      }
      resolve(clear > 32 * 32 * 0.1); // gray and partly transparent: a glyph, not a gray tile
    };
    img.onerror = () => resolve(false);
    img.src = src;
  });
  const loadFavicon = (host, origin) => {
    if (!_favicons.has(host)) _favicons.set(host, window.electronAPI.faviconGet(origin)
      .then(async src => src ? { src, mono: await faviconMono(src) } : null).catch(() => null)
      .then(f => { _favicons.get(host).value = f; return f; }));
    return _favicons.get(host);
  };
  const linkIconHtml = href => {
    const host = (href.match(/^https?:\/\/([^/?#\s]+)/i) || [])[1];
    const globe = '<i class="ph ph-globe" aria-hidden="true"></i>';
    if (!host) return /^https?:/i.test(href) ? globe : `<i class="ph ${linkFileIcon(href)}" aria-hidden="true"></i>`;
    const origin = href.slice(0, href.indexOf(host) + host.length);
    if (window.electronAPI?.faviconGet) {
      const p = _favicons.get(host);
      if (p && 'value' in p) return p.value ? faviconHtml(p.value) : globe; // known: no flash on re-render
      return `<i class="ph ph-globe" data-favicon="${host}" data-origin="${origin}" aria-hidden="true"></i>`;
    }
    if (_faviconMissing.has(host)) return globe;
    return `<img class="thr-favicon" src="${origin}/favicon.ico" data-host="${host}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  };
  // mdLite's output (or a copied slice of it) back to markdown source, for copying a selection.
  function mdFromDom(node) {
    const kids = n => [...n.childNodes].map(mdFromDom).reduce((text, part) => /\n\n$/.test(text) && /^\n\n/.test(part) ? text + part.slice(2) : text + part, '');
    const block = s => `\n\n${s}\n\n`;
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return kids(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node, tag = el.nodeName;
    if (tag === 'I' || tag === 'IMG' || el.matches('.thr-actions, .thr-table-copy, .thr-pending-kind, .thr-seg, .thr-worked, .thr-tools > summary, .thr-tool > summary, .thr-turn > summary, button[data-act]')) return ''; // icons, chrome
    if (el.matches('.thr-msg-text, .thr-queued-text') || tag === 'P') return block(kids(el).trim());
    if (tag === 'BR') return '\n';
    if (tag === 'PRE') return block('```' + (el.matches('.thr-tool-detail') ? 'sh' : el.dataset.lang || '') + '\n' + el.textContent.replace(/\n$/, '') + '\n```');
    if (el.matches('.thr-image-ref[data-path]')) return shellQuote(el.dataset.path);
    if (tag === 'STRONG') return `**${kids(el)}**`;
    if (tag === 'EM') return `*${kids(el)}*`;
    if (tag === 'DEL') return `~~${kids(el)}~~`;
    if (tag === 'CODE' && el.parentNode?.nodeName !== 'PRE') return '`' + el.textContent + '`';
    if (tag === 'PRE' && el.matches('.thr-code')) return block('```' + (el.dataset.lang || '') + '\n' + el.textContent.replace(/\n$/, '') + '\n```');
    if (el.matches('.thr-link')) { const label = kids(el); return label === el.dataset.href ? label : `[${label}](${el.dataset.href})`; } // a bare URL copies as itself
    if (el.matches('.thr-h')) return block('#'.repeat(+el.getAttribute('aria-level') || 1) + ' ' + kids(el));
    if (tag === 'HR') return block('---');
    if (tag === 'BLOCKQUOTE') return block(kids(el).trim().split('\n').map(l => '> ' + l).join('\n'));
    if (tag === 'UL' || tag === 'OL') {
      const list = (l, depth) => [...l.children].filter(li => li.nodeName === 'LI').map((li, i) => {
        const own = [...li.childNodes].filter(c => !['UL', 'OL'].includes(c.nodeName)).map(mdFromDom).join('').trim();
        const sub = [...li.children].filter(c => ['UL', 'OL'].includes(c.nodeName)).map(s => '\n' + list(s, depth + 1)).join('');
        return '  '.repeat(depth) + (l.nodeName === 'OL' ? `${(+l.getAttribute('start') || 1) + i}. ` : '- ') + own + sub;
      }).join('\n');
      return block(list(el, 0));
    }
    if (tag === 'TABLE') {
      const rows = [...el.querySelectorAll('tr')].map(tr => '| ' + [...tr.children].map(c => mdFromDom(c).trim()).join(' | ') + ' |');
      if (el.querySelector('thead tr') && rows.length) rows.splice(1, 0, '|' + [...el.querySelector('thead tr').children].map(() => '---').join('|') + '|');
      return block(rows.join('\n'));
    }
    return kids(el);
  }
  function mdFromRange(range, scope) {
    let fragment = range.cloneContents();
    // cloneContents omits shared ancestors, including a link when only its label is selected.
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType !== Node.ELEMENT_NODE) ancestor = ancestor.parentElement;
    while (ancestor && ancestor !== scope && scope.contains(ancestor)) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.append(fragment);
      fragment = wrapper;
      ancestor = ancestor.parentElement;
    }
    return mdFromDom(fragment).trim();
  }
  // Escape first, then the markdown agents use: fences (highlighted by their language tag), `code`, **bold**,
  // *italic*, ~~strike~~, links, headings, lists, > quotes, tables and --- rules.
  function mdLite(text) {
    text = String(text);
    // `code` spans are cut out first so their contents never turn into emphasis.
    // `code` spans become placeholders first, so their contents never turn into emphasis or links, while emphasis
    // can still wrap them (**Create `media.html`**); they are put back as <code> at the end.
    const inlineMd = t => {
      const codes = [];
      return escHtml(t.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`))
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1<em>$2</em>')
        .replace(/(^|\W)_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
        .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
        // [label](target): web links open in the browser, images in the viewer, other paths in the file manager.
        // A bare http(s) URL is a link too (labelled with itself); one pass, so a [label](url)'s URL isn't linked twice.
        // A link to a local image (or ![alt](path)) also shows a clickable image preview below.
        .replace(/(!?)\[([^\]\n]*)\]\(([^()\s\u0000]+)\)|(?<![="'\w/])(https?:\/\/[^\s<>"'`)\]\u0000]*[^\s<>"'`)\].,;:!?\u0000])/g, (_, bang, label, href, bare) => {
          if (bare) { href = label = bare; }
          const link = label ? `<button type="button" class="thr-link" data-href="${href}" title="${href}">${linkIconHtml(href)}${label}</button>` : '';
          const raw = href.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          if (bare || /^[a-z]+:/i.test(raw) || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(raw.replace(/[?#].*$/, ''))) return link || href;
          const img = `<span class="thr-img-wrap thr-md-img"><img class="thr-img" data-path="${escHtml(chatLinkPath(raw).path)}" alt="${label}"></span>`;
          return (bang ? '' : link) + img;
        })
        .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escHtml(codes[i])}</code>`);
    };
    const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    // Consecutive list items (blank lines between them allowed) as nested <ul>/<ol> by indent.
    const listHtml = items => {
      let html = '';
      const stack = [];
      for (const it of items) {
        while (stack.length && it.ind < stack.at(-1).ind) html += `</li></${stack.pop().tag}>`;
        if (!stack.length || it.ind > stack.at(-1).ind) {
          const tag = it.num ? 'ol' : 'ul';
          html += `<${tag} class="thr-list"${it.num > 1 ? ` start="${it.num}"` : ''}>`;
          stack.push({ ind: it.ind, tag });
        } else html += '</li>';
        html += `<li>${inlineMd(it.text)}`;
      }
      while (stack.length) html += `</li></${stack.pop().tag}>`;
      return html;
    };
    // Lines in; headings, lists, tables, quotes and rules come out as blocks (which take the line breaks around them).
    const inline = t => {
      const lines = t.split('\n'), segs = [];
      const isRow = l => /^\s*\|.*\|\s*$/.test(l);
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        let m;
        if (isRow(l) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
          const start = i, align = cells(lines[i + 1]).map(c => c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : '');
          const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inlineMd(c)}</${tag}>`;
          let html = `<table class="thr-table"><thead><tr>${cells(l).map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>`;
          for (i += 2; i < lines.length && isRow(lines[i]); i++) html += `<tr>${cells(lines[i]).map((c, k) => cell('td', c, k)).join('')}</tr>`;
          html = `<div class="thr-table-wrap"><div class="thr-table-scroll">${html}</tbody></table></div>`
            + `<button type="button" class="thr-table-copy" data-md="${escHtml(lines.slice(start, i).join('\n'))}" aria-label="Copy table as markdown"><i class="ph ph-copy" aria-hidden="true"></i></button></div>`;
          i--; segs.push({ html, block: true });
        } else if ((m = l.match(/^(#{1,6}) (.+)$/))) {
          segs.push({ html: `<div class="thr-h thr-h${Math.min(m[1].length, 3)}" role="heading" aria-level="${m[1].length}">${inlineMd(m[2])}</div>`, block: true });
        } else if (LIST.test(l)) {
          const items = [];
          for (; i < lines.length; i++) {
            const x = lines[i].match(LIST);
            if (x) items.push({ ind: x[1].replace(/\t/g, '    ').length, num: /\d/.test(x[2]) ? parseInt(x[2]) : 0, text: x[3] });
            else if (!(lines[i].trim() === '' && LIST.test(lines[i + 1] || ''))) break;
          }
          i--; segs.push({ html: listHtml(items), block: true });
        } else if (/^\s*>/.test(l)) {
          const q = [];
          for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
          i--; segs.push({ html: `<blockquote class="thr-quote">${q.map(inlineMd).join('\n')}</blockquote>`, block: true });
        } else if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(l)) segs.push({ html: '<hr class="thr-hr">', block: true });
        else segs.push({ html: inlineMd(l) });
      }
      // Blank lines next to a block (or at a chunk's edges) would show as empty lines in pre-wrap text.
      const kept = [];
      for (const s of segs) {
        if (!s.block && !s.html && (!kept.length || kept.at(-1).block)) continue;
        if (s.block) while (kept.length && !kept.at(-1).block && !kept.at(-1).html) kept.pop();
        kept.push(s);
      }
      while (kept.length && !kept.at(-1).block && !kept.at(-1).html) kept.pop();
      return kept.reduce((out, s, k) => out + (k && !s.block && !kept[k - 1].block ? '\n' : '') + s.html, '');
    };
    let out = '', last = 0;
    for (const m of text.matchAll(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g)) {
      out += inline(text.slice(last, m.index)) + `<pre class="thr-code" data-lang="${escHtml(m[1].trim())}"><code>${hlCode(m[2].replace(/\n$/, ''), codeLang(m[1].trim()))}</code></pre>`;
      last = m.index + m[0].length;
    }
    return out + inline(text.slice(last));
  }
  const toolIcon = n => /view_?image|image_?view|screenshot/i.test(n) ? 'ph-eye' : /bash|shell|exec|command|terminal/i.test(n) ? 'ph-terminal' : /read|view|cat/i.test(n) ? 'ph-file-text'
    : /edit|write|patch|update|create/i.test(n) ? 'ph-pencil-simple' : /grep|glob|search|find|list/i.test(n) ? 'ph-magnifying-glass'
    : /web|fetch|url|browser/i.test(n) ? 'ph-globe' : /task|agent/i.test(n) ? 'ph-robot' : 'ph-wrench';
  // A tool that looks at an image (Codex view_image, Claude's Read of a .png…): its expanded row shows the image
  // with a viewer and copy action alongside the path.
  const toolImageHtml = x => {
    if (!/image|^read$|read_?file|view|screenshot/i.test(x.name || '')) return '';
    const m = `${x.summary || ''}\n${x.detail || ''}`.match(/(?:^|["'\s])((?:[A-Za-z]:)?[^\s"'<>]*\.(?:png|jpe?g|gif|webp|bmp))(?=$|["'\s,}])/im);
    if (!m) return '';
    return `<div class="thr-tool-image" data-path="${escHtml(m[1])}"><span class="thr-img-wrap thr-md-img"><img class="thr-img" data-path="${escHtml(chatLinkPath(m[1]).path)}" alt="">`
      + '<span class="thr-img-actions"><button type="button" data-act="copy" title="Copy image" aria-label="Copy image"><i class="ph ph-copy" aria-hidden="true"></i></button></span></span></div>';
  };
  const threadClock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const clockTime = ts => {
    if (!ts) return '';
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? '' : threadClock.format(date);
  };
  const toolDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const toolTimestampHtml = ts => {
    if (!ts) return '';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const today = now.toDateString();
    now.setDate(now.getDate() - 1);
    const day = date.toDateString();
    const label = day === today ? `today at ${clockTime(ts)}`
      : day === now.toDateString() ? `yesterday at ${clockTime(ts)}` : toolDateTime.format(date);
    return `<time class="thr-tools-time" datetime="${date.toISOString()}" title="${escHtml(toolDateTime.format(date))}">${escHtml(label)}</time>`;
  };
  function toolDetailsHtml(tool) {
    const image = toolImageHtml(tool);
    if (image) return image;
    const changes = (tool.files || []).filter(file => file.patch);
    if (changes.length) return changes.map(file => {
      const path = escHtml(file.path);
      const diff = file.patch.split('\n').map(line => hlDiffLine(line, file.path)).join('');
      return `<div class="thr-tool-change"><div class="thr-change-path" title="${path}">${path}</div>`
        + `<pre class="thr-diff" data-lang="diff" tabindex="0" role="region" aria-label="File diff"><span class="thr-diff-lines">${diff}</span></pre></div>`;
    }).join('');
    const shell = /(?:^|\.)(bash|shell|local_shell|exec_command|run_terminal_cmd|terminal|run_command|execute)$/i.test(tool.name);
    const command = `<pre class="thr-tool-detail">${hlCode(tool.detail || tool.summary || '', shell ? 'sh' : /^\s*[{[]/.test(tool.detail || '') ? 'json' : '')}</pre>`;
    return command + (shell && tool.output !== undefined
      ? `<pre class="thr-tool-output" tabindex="0" role="region" aria-label="Command output">${escHtml(tool.output || 'No output')}</pre>` : '');
  }
  function applyWorkUsernamePrivacy(root) {
    const hidden = threadSettings.usernames === 'blur';
    for (const span of root.querySelectorAll('.thr-work-username')) {
      const record = [..._workUsernameRecords.values()].find(r => r.mask === span.dataset.usernameMask);
      if (!record || span.dataset.usernameHidden === String(hidden)) continue;
      span.dataset.usernameHidden = String(hidden);
      if (hidden) span.textContent = record.mask;
      else if (_workUsernameMarkup.has(span)) span.replaceChildren(_workUsernameMarkup.get(span).cloneNode(true));
      else span.textContent = record.value; // A cloned split-pane snapshot retains only the random identifier.
    }
    // Native and custom path tooltips must use the same substituted usernames.
    for (const element of root.querySelectorAll('.thr-change-path, .thr-tool-image-path, .thr-tool-detail, .thr-tool-sum')) {
      for (const attribute of ['title', 'data-tip']) {
        const text = element.getAttribute(attribute);
        if (!text) continue;
        let safe = text;
        if (hidden) safe = text.replace(/((?:[A-Za-z]:[\\/]+Users[\\/]+|[\\/](?:home|Users)[\\/]+))([^\\/\s"'<>]+)/gi,
          (_, prefix, value) => prefix + (_workUsernameRecords.get(value)?.mask || value));
        else for (const record of _workUsernameRecords.values()) safe = safe.split(record.mask).join(record.value);
        if (safe !== text) element.setAttribute(attribute, safe);
      }
    }
  }
  function decorateWorkUsernames(root) {
    for (const element of root.querySelectorAll('.thr-tools-text, .thr-tool-sum, .thr-tool-detail, .thr-tool-output, .thr-change-path, .thr-tool-image-path, .thr-tool-change .thr-diff')) {
      if (element.dataset.usernamesDecorated) continue;
      element.dataset.usernamesDecorated = '1';
      // Match username components only, including JSON-escaped Windows paths.
      const matches = [...element.textContent.matchAll(/(?:[A-Za-z]:[\\/]+Users[\\/]+|[\\/](?:home|Users)[\\/]+)([^\\/\s"'<>]+)/gi)];
      for (const match of matches.reverse()) {
        const start = match.index + match[0].length - match[1].length, end = start + match[1].length;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let offset = 0, startNode, endNode, startOffset, endOffset;
        while (walker.nextNode()) {
          const node = walker.currentNode, next = offset + node.length;
          if (!startNode && start < next) { startNode = node; startOffset = start - offset; }
          if (end <= next) { endNode = node; endOffset = end - offset; break; }
          offset = next;
        }
        if (!startNode || !endNode) continue;
        const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
        const span = document.createElement('span'); span.className = 'thr-work-username';
        span.append(range.extractContents()); range.insertNode(span);
        const value = span.textContent;
        let record = _workUsernameRecords.get(value);
        if (!record) { record = { value, mask: randomPrivateUsername() }; _workUsernameRecords.set(value, record); }
        span.dataset.usernameMask = record.mask;
        const original = document.createDocumentFragment(); original.append(...[...span.childNodes].map(n => n.cloneNode(true)));
        _workUsernameMarkup.set(span, original);
      }
    }
    applyWorkUsernamePrivacy(root);
  }

  function syncChatInterruption(tab, history) {
    const latest = history.at(-1);
    if (!latest) return;
    const items = latest.items || [], start = items.findLastIndex(item => item.role === 'user');
    const times = items.slice(Math.max(0, start)).filter(item => item.interrupted).map(item => Date.parse(item.interruptedAt || item.ts) || 0);
    if (latest.turnState?.status === 'aborted') times.push(latest.turnState.at || 0);
    const at = Math.max(0, ...times);
    if (at > (tab.chat?.lastContinueAt || 0)) { tab.chat ||= {}; tab.chat.interruptedAt ||= at; }
  }
  async function continueInterruptedChat(tab) {
    if (!tab?.chat?.interruptedAt || tab._resuming || chatWorking(tab) || _chatStarting.has(tab.id) || _chatSending.has(tab.id)) return;
    tab._resuming = true;
    const text = 'continue from where you left';
    try {
      await deliverChatMessage(tab, { id: uuid(), text, typed: text, files: [], after: Date.now() });
    } finally {
      delete tab._resuming;
      if (curChat() === tab) syncWorking(tab);
    }
  }
  function renderChatResume(tab, surface = thrPage) {
    const flow = surface.querySelector('.thr-flow');
    if (!flow) return;
    flow.querySelector('.thr-continue')?.remove();
    flow.querySelectorAll('.thr-interruption-status').forEach(el => el.remove());
    // Keep locally stopped turns even after the active Continue state is cleared.
    const interruptions = [...(tab.chat?.interruptions || [])];
    if (tab.chat?.interruptedAt && !interruptions.some(item => item.at === tab.chat.interruptedAt)) interruptions.push({ at: tab.chat.interruptedAt });
    const prompts = interruptions.length ? [...flow.querySelectorAll('.thr-msg.user[data-ts]')] : [];
    for (const { at } of interruptions.sort((a, b) => a.at - b.at)) {
      const next = prompts.find(el => Number(el.dataset.ts) > at);
      let anchor = next;
      // A model header introduces the next prompt. Keep the previous turn's
      // interruption outside that header and any intervening session notes.
      for (let row = next?.previousElementSibling; row?.matches('.thr-seg, .thr-note'); row = row.previousElementSibling) {
        if (row.matches('.thr-seg')) anchor = row;
      }
      const previous = anchor ? anchor.previousElementSibling : [...flow.children].filter(el => !el.matches('.thr-queue, .thr-working')).at(-1);
      if (previous?.matches('.thr-status-line')) continue;
      const status = document.createElement('div');
      status.className = 'thr-status-line thr-interruption-status';
      status.setAttribute('role', 'status');
      status.dataset.interruptedAt = at;
      status.innerHTML = '<i class="ph ph-stop-circle" aria-hidden="true"></i><span class="thr-status-title">Interrupted</span><span class="thr-status-detail">· Generation stopped</span>';
      if (anchor) anchor.before(status); else flow.insertBefore(status, flow.querySelector('.thr-queue'));
    }
    if (surface === thrPage && curChat() === tab) syncSendBtn();
  }

  function renderChatErrors(tab, flow) {
    flow.querySelectorAll('.thr-chat-error').forEach(el => el.remove());
    for (const error of tab.chat?.errors || []) {
      flow.querySelector('.thr-empty')?.remove();
      const row = document.createElement('div'); row.className = 'thr-chat-error'; row.setAttribute('role', 'alert');
      row.innerHTML = '<i class="ph ph-warning-circle" aria-hidden="true"></i><span></span>';
      row.querySelector('span').textContent = error.message;
      const next = [...flow.querySelectorAll('.thr-msg.user[data-ts]')].find(el => Number(el.dataset.ts) > error.at);
      if (next) next.before(row); else flow.insertBefore(row, flow.querySelector('.thr-queue'));
    }
  }
  function noteChatError(tab, message) {
    if (!tab) return;
    tab.chat ||= { createdAt: Date.now() };
    tab.chat.interruptedAt = Date.now();
    const errors = tab.chat.errors ||= [], last = errors.at(-1), at = Date.now();
    if (!last || last.message !== message || at - last.at > 2000) errors.push({ at, message: String(message) });
    _flowSig = '';
    const surface = curChat() === tab ? thrPage : tab.el?.querySelector('.thr-snapshot');
    const flow = surface?.querySelector('.thr-flow');
    if (flow) { const bottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1; renderChatErrors(tab, flow); if (bottom) flow.scrollTop = flow.scrollHeight; }
    saveState();
  }
  // The composer's context ring: how full the agent's context window was at its latest reply.
  function syncContextRing(el, ctx) {
    if (!el) return;
    el.hidden = !ctx?.max;
    if (el.hidden) return;
    const p = Math.min(100, Math.round(ctx.used / ctx.max * 100));
    el.style.setProperty('--p', p);
    el.setAttribute('aria-label', `Context: ${p}% used`);
  }
  // Right-click the composer (outside the text) to pick which controls it shows.
  document.addEventListener('contextmenu', e => {
    if (!e.target.closest?.('.thr-composer') || e.target.closest('.thr-input-wrap')) return;
    e.preventDefault();
    showCtxMenu(e, 'composer');
  });
  async function refreshThreadFlow(ws, surface = thrPage) {
    const flow = surface.querySelector('.thr-flow');
    const api = window.electronAPI;
    const segs = threadSegments(ws);
    const storeId = ws.chat?.storeId;
    const current = () => flow.parentElement === surface && ws.chat?.storeId === storeId
      && (surface === thrPage ? curChat() === ws : surface.isConnected && surface.parentElement === ws.el);
    let hist = [], note = '';
    if (segs.length && !api?.threadHistory) note = 'The history preview needs the desktop app.';
    else if (segs.length) {
      const meta = threadMeta(ws);
      if (!flow.firstElementChild) {
        flow.innerHTML = '<div class="thr-empty" role="status"><span class="tv-loading-spinner" aria-hidden="true"></span><span>Loading conversation…</span></div>';
      }
      if (!flow._historyPreviewTried && !flow.dataset.seen && api.threadHistoryPreview
        && !ws.chat?.side && !pendingMessages(ws).length && !chatWorking(ws)
        && (!ws._scrollState || ws._scrollState.bottom)) {
        flow._historyPreviewTried = true;
        const cached = await api.threadHistoryPreview(meta).catch(() => null);
        if (!current()) return;
        if (cached?.length && !flow.dataset.seen && !pendingMessages(ws).length && !chatWorking(ws)) {
          renderThreadFlow(ws, surface, flow, segs, cached, '', true);
          // Show the saved tail before parsing or rendering the full transcript.
          if (!document.hidden) await new Promise(resolve => {
            const timeout = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 64);
            let frame = requestAnimationFrame(() => {
              frame = requestAnimationFrame(() => { clearTimeout(timeout); resolve(); });
            });
          });
          if (!current()) return;
        }
      }
      try { hist = await api.threadHistory(meta); }
      catch { note = 'Could not read the history.'; }
    }
    if (!current()) return;
    if (note && flow._showingHistoryPreview) return;
    renderThreadFlow(ws, surface, flow, segs, hist, note);
  }

  function renderThreadFlow(ws, surface, flow, segs, hist, note, preview = false) {
    const t = ws.chat, replacingPreview = flow._showingHistoryPreview && !preview;
    flow._showingHistoryPreview = preview;
    if (!preview && segs[segs.length - 1]?.harness === 'codex' && hist[hist.length - 1]?.turnState) ws._chatTurnState = hist[hist.length - 1].turnState;
    syncContextRing(threadPart(surface, 'ctx'), hist[hist.length - 1]?.ctx);
    // A side chat's forked session starts with a copy of the thread's history: like T3 Code, it shows
    // only what was said in the side chat itself (the agent still has the rest).
    if (ws.chat?.side && ws.chat.createdAt) for (const h of hist) h.items = h.items.filter(m => !m.ts || Date.parse(m.ts) >= ws.chat.createdAt - 2000);
    // The chat's title (first prompt) and last activity, for its tab and the threads sidebar.
    if (t && !preview) {
      let first, lastTs = 0;
      for (const segment of hist) {
        for (const message of segment.items) {
          if (!t.title && !first && message.role === 'user' && message.text) first = message;
          lastTs = Math.max(lastTs, Date.parse(message.ts) || 0);
        }
      }
      if ((!t.title && first) || lastTs > (t.updatedAt || 0)) {
        if (!t.title && first) { t.title = first.text.split('\n')[0].slice(0, 80); setChatTabLabel(ws); }
        if (lastTs > (t.updatedAt || 0)) t.updatedAt = lastTs;
        saveState();
      }
    }
    // A session with messages can be resumed later (or handed off to another agent).
    if (!preview) hist.forEach((h, i) => { if (h.items.length && segs[i] && !segs[i].used) { segs[i].used = true; saveState(); } });
    // Codex ids are only known once its transcript exists.
    if (!preview) hist.forEach((h, i) => {
      if (!h.sessionId || segs[i].sessionId) return;
      segs[i].sessionId = h.sessionId;
      if (i === segs.length - 1) t.sessionId = h.sessionId;
      saveState();
    });
    // A sent message is in the transcript: the user message at or after it was sent, starting with its text.
    const inTranscript = (text, at, afterTs = 0) => {
      // (Hidden notes, e.g. a dropped thread's, never reach the transcript's text.)
      const head = text.replace(/\s*<terminalvibe_context\b[\s\S]*?<\/terminalvibe_context>\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      for (const segment of hist) {
        const match = segment.items.find(m => m.role === 'user' && !m.stopped && (Date.parse(m.ts) || Infinity) >= at - 5000
          && (!afterTs || Date.parse(m.ts) > afterTs)
          && String(m.text || '').replace(/\s+/g, ' ').includes(head));
        if (match) return match;
      }
    };
    // Stopped prompts the transcript doesn't have go into the history where they were sent.
    if (!preview && t?.stopped?.length && hist.length) {
      const before = t.stopped.length;
      t.stopped = t.stopped.filter(x => !inTranscript(x.text, x.at));
      if (t.stopped.length !== before) saveState();
      for (const x of t.stopped) {
        let i = segs.findLastIndex(sg => (sg.since || 0) <= x.at);
        if (i < 0 || !hist[i]) i = hist.length - 1;
        const items = hist[i].items, j = items.findIndex(m => (Date.parse(m.ts) || 0) > x.at);
        const k = j < 0 ? items.length : j, item = { role: 'user', text: x.text, ts: new Date(x.at).toISOString(), stopped: true };
        items.splice(k, 0, item);
        // The interrupt that stopped it was flagged on the step before (the transcript never got this prompt):
        // when it came after this prompt was sent, it's this prompt's, so the "Interrupted" line follows it.
        const prev = items[k - 1];
        if (prev?.interrupted && (Date.parse(prev.interruptedAt) || Infinity) >= x.at - 1000) {
          item.interrupted = prev.interrupted; delete prev.interrupted;
        }
      }
    }
    if (!preview) syncChatInterruption(ws, hist);
    renderChatResume(ws, surface);
    const sig = note + '|' + segs.length + '|' + hist.map(h => {
      const l = h.items[h.items.length - 1];
      return `${h.trimmed || 0}:${h.items.length}:${l?.ts || ''}:${l?.text?.length || 0}:${l?.error ? 1 : 0}`;
    }).join(',')
      // Tool outputs grow while they stream: their count and total size catch that without
      // stringifying every output on each refresh (that made switching to long chats lag).
      + '|' + hist.map(h => { let n = 0, len = 0; for (const m of h.items) if (m.role === 'tool') { n++; len += typeof m.output === 'string' ? m.output.length : (m.output ? JSON.stringify(m.output).length : 0); } return n + ':' + len; }).join(',');
    // The sent message shows until the transcript has it (or 60s pass).
    const pending = pendingMessages(ws);
    const remaining = pending.filter(pend => {
      const got = inTranscript(pend.text, pend.at, pend.afterTs);
      if (got && !pend.steer) {
        const turn = _turns.get(ws.id);
        if (turn && pend.at >= turn.since - 1000) { turn.promptTs = got.ts; turn.awaitingPrompt = false; }
      }
      if (got && pend.options) {
        ws.chat ||= {};
        const options = ws.chat.turnOptions ||= {};
        if (!options[got.ts]) { options[got.ts] = { ...pend.options }; saveState(); }
      }
      // A steer keeps its label once the transcript has it.
      if (got && pend.steer && t && !t.steered?.includes(got.ts)) { (t.steered ||= []).push(got.ts); saveState(); }
      return !(got || Date.now() - pend.at > 60000);
    });
    if (remaining.length) _pendingMsgs.set(ws.id, remaining); else _pendingMsgs.delete(ws.id);
    ws._lastUserTs = Math.max(ws._lastUserTs || 0, ...hist.flatMap(h => h.items).filter(m => m.role === 'user').map(m => Date.parse(m.ts) || 0));
    const working = !!chatWorking(ws);
    const awaitingTurnPrompt = !!_turns.get(ws.id)?.awaitingPrompt || remaining.some(p => !p.steer);
    const sigP = sig + '|p' + remaining.length + (working ? '|w' : '') + (awaitingTurnPrompt ? '|awaiting-prompt' : '');
    if (sigP === (surface === thrPage ? _flowSig : flow.dataset.signature)) return;
    if (surface === thrPage) _flowSig = sigP; else flow.dataset.signature = sigP;
    const atBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight <= 1;
    const scrollTop = flow.scrollTop;
    const distanceFromBottom = replacingPreview ? flow.scrollHeight - flow.clientHeight - scrollTop : 0;
    const open = new Set([...flow.querySelectorAll('[data-key].open, details[data-key][open]')].map(el => el.dataset.key));
    const outputScroll = new Map([...flow.querySelectorAll('details[open] > .thr-tool-output')].map(el => [el.parentElement.dataset.key, { top: el.scrollTop, left: el.scrollLeft }]));
    if (!segs.length || note) {
      flow._historyChunks = undefined;
      flow.innerHTML = pendingHtml(ws) || `<div class="thr-empty"><i class="ph ph-chats-circle" aria-hidden="true"></i><div class="thr-empty-title">${note ? escHtml(note) : 'No messages yet'}</div>${note ? '' : '<div>Pick an agent below and send a message to start one, or run an agent CLI in a terminal tab of this workspace.</div>'}</div>`;
      flow.querySelectorAll('.thr-pending img.thr-img').forEach(bindThreadImage);
      renderChatErrors(ws, flow);
      syncWorking(ws, surface);
      return;
    }
    // An agent is running but nothing was said yet: the same empty state, not a lone session header.
    if (!segs.some(x => x.handoff) && !hist.some(h => h.items.length || h.unsupported)) {
      flow._historyChunks = undefined;
      flow.innerHTML = pendingHtml(ws) || '<div class="thr-empty"><i class="ph ph-chat-circle-dots" aria-hidden="true"></i><div class="thr-empty-title">No chat yet</div><div>Send a prompt to start.</div></div>';
      flow.querySelectorAll('.thr-pending img.thr-img').forEach(bindThreadImage);
      renderChatErrors(ws, flow);
      syncWorking(ws, surface);
      return;
    }
    let html = '';
    const chunks = [];
    const finishChunk = () => {
      if (html) chunks.push(html);
      html = '';
    };
    // The fork note marks the fork point: after the copied (frozen) sessions, before the fork's own.
    let forkNote = '';
    if (ws.chat?.forkOf) {
      const from = findThreadByKey(ws.chat.forkOf);
      forkNote = `<div class="thr-note thr-fork-note"><i class="ph ph-git-fork" aria-hidden="true"></i>Forked from ${escHtml(from?.chat?.title || from?.label || 'a deleted thread')}</div>`;
    }
    const texts = new Map(); // data-key -> raw message text, for the copy buttons
    const lazy = new Map(); // data-key -> body of a collapsed tool call or diff, built when it opens
    const lazyBody = (key, html) => { lazy.set(key, html); return ''; };
    let lastHead = '';
    const addAgentHeader = (opts, fallbackHarness, time) => {
      const id = opts.harness || fallbackHarness;
      const agent = harnessOf(id), name = agent?.name || id;
      const meta = [opts.model, opts.effort].filter(value => value && value !== 'default').join(' · ');
      const head = name + '|' + meta;
      if (head === lastHead) return;
      lastHead = head;
      html += `<div class="thr-seg" data-head="${escHtml(head)}"${agent?.color ? ` style="--agent-color:${agent.color}"` : ''}>${procIconHtml(agent?.bin || '', 'ph-robot')}<span class="thr-seg-name">${escHtml(name)}</span>${meta ? `<span class="thr-seg-meta">${escHtml(meta)}</span>` : ''}<span class="thr-seg-time">${clockTime(time)}</span></div>`;
    };
    segs.forEach((seg, i) => {
      if (forkNote && !seg.frozen) { html += forkNote; forkNote = ''; lastHead = ''; }
      const h = harnessOf(seg.harness), name = h?.name || seg.harness, res = hist[i] || { items: [] };
      if (!res.items.length && !res.unsupported) return; // a session with nothing said shows nothing
      const first = res.items[0];
      const firstOptions = first?.role === 'user' && ws.chat?.turnOptions?.[first.ts];
      addAgentHeader(firstOptions || seg, seg.harness, firstOptions ? first.ts : seg.since);
      if (seg.handoff) html += `<div class="thr-note"><i class="ph ph-arrows-left-right" aria-hidden="true"></i>Started with the full history of the ${i} earlier session${i > 1 ? 's' : ''}</div>`;
      if (res.trimmed) html += `<div class="thr-note">${res.trimmed} earlier items not shown</div>`;
      if (res.unsupported) html += `<div class="thr-note">${escHtml(name)} keeps no history TerminalVibe can read yet.</div>`;
      // A run of tool calls opens to every call and its full command or arguments.
      const toolsHtml = (tools, key, completed, changedFiles) => {
        const last = tools[tools.length - 1];
        const commands = tools.filter(x => /(?:^|[._])(?:bash|shell|exec(?:_command)?|run_command|terminal)(?:$|[._])/i.test(x.name)).length;
        const other = tools.length - commands;
        const files = new Set((changedFiles || tools.flatMap(x => x.files || [])).map(f => f.path)).size;
        const label = [
          commands && `Ran ${commands} command${commands === 1 ? '' : 's'}`,
          other && `${commands ? 'used' : 'Used'} ${other} tool${other === 1 ? '' : 's'}`,
          files && `changed ${files} file${files === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' and ');
        const title = completed ? label : `${last.name} ${last.summary}`;
        return `<details class="thr-tools" data-key="${key}"><summary><i class="ph ${completed ? 'ph-hammer' : toolIcon(last.name)}" aria-hidden="true"></i>`
          + `<span class="thr-tools-text">${escHtml(title)}</span>${!completed && tools.length > 1 ? `<span class="thr-tools-count">+${tools.length - 1}</span>` : ''}`
          + `${completed ? '' : `<span class="thr-tools-time">${clockTime(last.ts)}</span>`}<i class="ph ph-caret-right thr-tools-caret" aria-hidden="true"></i></summary><div class="thr-tool-list">`
          // Each call expands to its command, arguments, or recorded file changes.
          + tools.map((x, n) => `<details class="thr-tool" data-key="${key}:${n}"><summary><i class="ph ${toolIcon(x.name)}" aria-hidden="true"></i><span class="thr-tool-name">${escHtml(x.name)}</span><span class="thr-tool-sum">${escHtml(x.summary)}</span>${toolTimestampHtml(x.ts)}${x.error ? '<i class="ph ph-warning-circle thr-tool-err" aria-label="Failed"></i>' : ''}<i class="ph ph-caret-right thr-tool-caret" aria-hidden="true"></i></summary>`
            + lazyBody(`${key}:${n}`, () => toolDetailsHtml(x)) + '</details>').join('')
          + '</div></details>';
      };
      const msgHtml = (m, key, showActions = true, extra = '') => {
        const cls = `thr-msg ${m.role}`;
        texts.set(key, m.text);
        // Copy + time under the message, shown on hover.
        // A reply can be forked: a new thread with the history up to it. The fork point is the full (untrimmed)
        // item index, which is what the main process slices.
        const forkAt = m.role !== 'user' && window.electronAPI?.threadFork
          ? Number(key.split(':')[1]) + (res.trimmed || 0) - (res.previewOffset || 0) : null;
        const actions = showActions ? `<div class="thr-actions"><button type="button" class="thr-copy" aria-label="Copy message"><i class="ph ph-copy" aria-hidden="true"></i></button>`
          + (forkAt != null ? `<button type="button" class="thr-fork" data-seg="${i}" data-item="${forkAt}" data-tip="Fork from here" aria-label="Fork the thread from this reply"><i class="ph ph-git-fork" aria-hidden="true"></i></button>` : '')
          + `<span class="thr-time">${clockTime(m.ts)}</span></div>` : '';
        const user = m.role === 'user' ? userTextHtml(m.text, m.threads) : null;
        const imgs = threadImagesHtml(m.images?.length ? m.images : user?.paths || []);
        return m.role === 'user'
          ? `<div class="${cls}" data-key="${key}" data-ts="${Date.parse(m.ts) || 0}">${m.stopped ? '<span class="thr-pending-kind">Stopped</span>' : (m.steered || t?.steered?.includes(m.ts)) ? '<span class="thr-pending-kind">Steered</span>' : ''}${imgs}${user.html ? `<div class="thr-bubble"><div class="thr-msg-text">${user.html}</div></div>` : ''}${actions}</div>`
          : `<div class="${cls}" data-key="${key}"><div class="thr-msg-text">${mdLite(m.text)}</div>${extra}${actions}</div>`;
      };
      // The agent's thinking: "Thought" with a one-line peek, opening to the whole text.
      const thoughtHtml = (m, key) => `<details class="thr-thought" data-key="${key}"><summary><i class="ph ph-brain" aria-hidden="true"></i>`
        + `<span class="thr-thought-label">Thought</span><span class="thr-thought-peek">${escHtml(m.text.replace(/\s+/g, ' ').slice(0, 140))}</span><i class="ph ph-caret-down thr-thought-caret" aria-hidden="true"></i></summary>`
        + `<div class="thr-thought-text">${mdLite(m.text)}</div></details>`;
      // A question the agent asked (AskUserQuestion): one row per question, like a thought, opening to the answer given.
      const qaHtml = (m, key) => m.qa.map((x, n) => `<details class="thr-qa" data-key="${key}:q${n}">`
        + `<summary><i class="ph ph-chat-circle-dots" aria-hidden="true"></i><span class="thr-qa-q">${escHtml(x.question)}</span>`
        + `<i class="ph ph-caret-down thr-qa-caret" aria-hidden="true"></i></summary>`
        + (x.answer != null ? `<div class="thr-qa-a"><i class="ph ph-arrow-bend-down-right" aria-hidden="true"></i><span>${escHtml(x.answer)}</span></div>`
          : '<div class="thr-qa-a none">Not answered</div>') + '</details>').join('');
      // A turn's steps in order: thoughts, interim replies, runs of tool calls.
      const stepsHtml = (list, base, completed = false, changedFiles) => {
        let out = '', run = [];
        const totalTools = list.filter(({ m }) => m.role === 'tool' && !m.qa).length;
        // A run the agent has moved on from is done (summarized) even mid-turn; only the trailing run stays live.
        const flush = (done = true) => {
          // A single run can use the whole turn's diff, including files changed by shell commands.
          if (run.length) out += toolsHtml(run.map(x => x.m), base + ':tools:' + run[0].j, done,
            run.length === totalTools ? changedFiles : undefined);
          run = [];
        };
        for (const { m, j } of list) {
          // The agent's question and your answer (a question still open shows in the answer tray instead).
          if (m.role === 'tool' && m.qa) {
            if (m.qa.some(x => x.answer != null) || m.error) { flush(); out += qaHtml(m, i + ':' + j); }
            continue;
          }
          if (m.role === 'tool') { run.push({ m, j }); continue; }
          flush();
          out += m.role === 'thinking' ? thoughtHtml(m, i + ':' + j) : msgHtml(m, i + ':' + j, false);
        }
        flush(completed);
        return out;
      };
      // The files a turn changed (from its edit tools' diffs): a card with +/- counts; each file,
      // or "Open diff" for all of them, opens to its diff.
      // In a git repo the turn's real changes (turnGitFiles) win, so shell edits show too.
      const changesHtml = (changedFiles, key) => {
        const files = new Map();
        for (const f of changedFiles) {
          const cur = files.get(f.path) || { path: f.path, add: 0, del: 0, patches: [] };
          cur.add += f.add; cur.del += f.del; cur.patches.push(f.patch); files.set(f.path, cur);
        }
        if (!files.size) return '';
        const all = [...files.values()];
        const rel = p => seg.cwd && p.startsWith(seg.cwd.replace(/[\\/]$/, '') + '/') ? p.slice(seg.cwd.replace(/[\\/]$/, '').length + 1) : p;
        const sum = k => all.reduce((s, f) => s + f[k], 0);
        return `<div class="thr-changes"><details class="thr-changes-list" data-key="${key}"><summary class="thr-changes-head">`
          + `<i class="ph ph-caret-right thr-changes-caret" aria-hidden="true"></i><span class="thr-changes-count">${all.length} changed file${all.length > 1 ? 's' : ''}</span>`
          + `<span class="thr-add">+${sum('add')}</span><span class="thr-del">-${sum('del')}</span></summary>`
          + all.map((f, n) => `<details class="thr-change" data-key="${key}:${n}"><summary><i class="ph ${linkFileIcon(f.path)}" aria-hidden="true"></i>`
            + `<span class="thr-change-path" title="${escHtml(f.path)}">${escHtml(rel(f.path))}</span><span class="thr-add">+${f.add}</span><span class="thr-del">-${f.del}</span></summary>`
            + lazyBody(`${key}:${n}`, () => `<pre class="thr-diff"><span class="thr-diff-lines">${f.patches.map(p => p.split('\n').map(l => hlDiffLine(l, f.path)).join('')).join('<span class="dl sep"></span>')}</span></pre>`) + '</details>').join('')
          + '</details><button type="button" class="thr-diff-btn"><i class="ph ph-file-text" aria-hidden="true"></i>Open diff</button></div>';
      };
      // T3-style turns: the prompt; for a finished turn a collapsible "Worked for 16s" holding its
      // steps, then the final reply and the files it changed. The turn in progress shows its steps live.
      const list = res.items.map((m, j) => ({ m, j: j + (res.previewOffset || 0) }));
      const firstPrompt = list.findIndex(x => x.m.role === 'user');
      if (firstPrompt !== 0) html += stepsHtml(firstPrompt < 0 ? list : list.slice(0, firstPrompt), i + ':pre', !working || i < segs.length - 1 || firstPrompt > 0); // a resumed session's start
      finishChunk();
      for (let u = firstPrompt; u >= 0 && u < list.length;) {
        let e = u + 1;
        while (e < list.length && list[e].m.role !== 'user') e++;
        const prompt = list[u], rest = list.slice(u + 1, e);
        const live = working && !awaitingTurnPrompt && i === segs.length - 1 && e === list.length;
        const options = ws.chat?.turnOptions?.[prompt.m.ts];
        if (options) addAgentHeader(options, seg.harness, prompt.m.ts);
        html += msgHtml(prompt.m, i + ':' + prompt.j);
        let fin = -1;
        if (!live) for (let x = rest.length - 1; x >= 0; x--) if (rest[x].m.role === 'assistant') { fin = x; break; }
        const steps = rest.filter((_, x) => x !== fin);
        const secs = Math.round((Date.parse(rest[rest.length - 1]?.m.ts) - Date.parse(prompt.m.ts)) / 1000);
        const took = rest.length && secs >= 0 ? `Worked for ${fmtSecs(secs)}` : '';
        // Resolve the turn's files once for both the tool summary and the diff card.
        // A prompt sent mid-turn shares its snapshot, so only the last prompt shows the diff.
        const turnPromptTs = Date.parse(_turns.get(ws.id)?.promptTs);
        const running = working && !awaitingTurnPrompt && i === segs.length - 1
          && (e === list.length || (turnPromptTs && Date.parse(prompt.m.ts) >= turnPromptTs));
        const git = !live && !running ? turnGitFiles(ws, prompt.m.ts, list[e]?.m.ts) : 'later';
        const changedFiles = git === 'later' ? [] : git?.length ? git : rest.flatMap(({ m }) => m.files || []);
        if (live) html += stepsHtml(steps, i + ':' + prompt.j);
        else if (steps.length) {
          const tk = 'turn:' + i + ':' + prompt.j;
          html += `<details class="thr-turn" data-key="${tk}"><summary><span>${took || 'Steps'}</span><i class="ph ph-caret-right thr-turn-caret" aria-hidden="true"></i></summary>`
            + `<div class="thr-turn-steps">${stepsHtml(steps, i + ':' + prompt.j, !running, changedFiles)}</div></details>`;
        } else if (took) html += `<div class="thr-worked">${took}</div>`;
        const changes = changesHtml(changedFiles, 'chg:' + i + ':' + prompt.j);
        html += fin >= 0 ? msgHtml(rest[fin].m, i + ':' + rest[fin].j, true, changes) : changes;
        // A turn the user stopped ends with a status line (Claude Code's "[Request interrupted by user]").
        const stopped = !live && (prompt.m.interrupted || rest.find(x => x.m.interrupted)?.m.interrupted);
        if (stopped && !preview && i === segs.length - 1 && e === list.length) {
          const at = Math.max(Date.parse(prompt.m.ts) || 0, ...rest.map(x => Date.parse(x.m.interruptedAt || x.m.ts) || 0));
          if (at > (ws.chat.lastContinueAt || 0)) ws.chat.interruptedAt ||= at;
        }
        if (stopped) html += `<div class="thr-status-line" role="status"><i class="ph ph-stop-circle" aria-hidden="true"></i><span class="thr-status-title">Interrupted</span>`
          + `<span class="thr-status-detail">· ${stopped === 'crash' ? 'The agent exited unexpectedly. Send a message to continue' : stopped === 'tool' ? 'Stopped by you during a tool call' : 'Stopped by you'}</span></div>`;
        finishChunk();
        u = e;
      }
    });
    html += forkNote + pendingHtml(ws);
    finishChunk();
    const content = updateThreadHistory(flow, chunks);
    const newOutputs = content.querySelectorAll('.thr-tool-output');
    const newImages = content.querySelectorAll('img.thr-img');
    // Keep the open states on replaced rows, without making a toggle invalidate cached markup.
    flow._lazy = lazy;
    // Lazy-render each row once: after it first scrolls into view it stays laid out (no re-skip jitter).
    for (const row of flow.children) if (!row.classList.contains('thr-seen')) seenObserver().observe(row);
    for (const details of content.querySelectorAll('details[data-key]')) {
      details.open = open.has(details.dataset.key);
      if (details.open) fillLazyDetails(details, lazy);
    }
    decorateWorkUsernames(content);
    flow._texts = texts;
    hydrateChatAttachmentSizes(content);
    bindThreadCopy(flow);
    content.querySelectorAll('.thr-copy').forEach(b => b.addEventListener('click', () => {
      const text = b.closest('.thr-flow')?._texts?.get(b.closest('.thr-msg').dataset.key) || '';
      void copyPrivateText(text).catch(() => {});
      b.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i>';
      b.setAttribute('aria-label', 'Copied');
      setTimeout(() => { b.innerHTML = '<i class="ph ph-copy" aria-hidden="true"></i>'; b.setAttribute('aria-label', 'Copy message'); }, 1200);
    }));
    content.querySelectorAll('i[data-favicon]').forEach(i => loadFavicon(i.dataset.favicon, i.dataset.origin).then(f => { if (f && i.isConnected) i.outerHTML = faviconHtml(f); }));
    content.querySelectorAll('img.thr-favicon[data-host]').forEach(img => {
      const fail = () => { _faviconMissing.add(img.dataset.host); img.outerHTML = '<i class="ph ph-globe" aria-hidden="true"></i>'; };
      if (img.complete && !img.naturalWidth) fail(); else img.addEventListener('error', fail, { once: true });
    });
    content.querySelectorAll('.thr-table-copy').forEach(b => b.addEventListener('click', () => {
      void copyPrivateText(b.dataset.md).catch(() => {});
      b.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i>';
      setTimeout(() => { b.innerHTML = '<i class="ph ph-copy" aria-hidden="true"></i>'; }, 1200);
    }));
    content.querySelectorAll('.thr-fork').forEach(b => b.addEventListener('click', () => forkChatAt(ws, Number(b.dataset.seg), Number(b.dataset.item))));
    content.querySelectorAll('.thr-diff-btn').forEach(b => b.addEventListener('click', () => {
      const list = b.closest('.thr-changes').querySelector('.thr-changes-list');
      const files = [...list.querySelectorAll('details.thr-change')];
      const openAll = !list.open || files.some(d => !d.open);
      list.open = true;
      files.forEach(d => { d.open = openAll; });
    }));
    flow.append(content);
    renderChatErrors(ws, flow);
    syncWorking(ws, surface);
    if (surface !== thrPage) disableSnapshotHistoryFocus(flow);
    if (surface === thrPage && thrFind.q) thrFindRun(true);
    for (const el of newOutputs) {
      const saved = outputScroll.get(el.parentElement.dataset.key);
      if (saved) { el.scrollTop = saved.top; el.scrollLeft = saved.left; }
    }
    newImages.forEach(bindThreadImage);
    if (!flow.dataset.seen && ws._scrollState && !ws._scrollState.bottom) { flow.scrollTop = ws._scrollState.top; flow.dataset.seen = '1'; } // back where it was
    else {
      const bottom = Math.max(0, flow.scrollHeight - flow.clientHeight);
      const restoredTop = atBottom || !flow.dataset.seen ? bottom
        : replacingPreview ? bottom - distanceFromBottom : scrollTop;
      // Assigning the current position cancels an in-flight smooth scroll.
      if (flow.scrollTop !== restoredTop) flow.scrollTop = restoredTop;
      flow.dataset.seen = '1';
    }
    if (surface === thrPage) syncScrollEnd();
  }
  async function hydrateThreadImage(img) {
    const p = img.dataset.path;
    let src = _thrImgCache.get(p);
    if (!src) {
      const r = await window.electronAPI?.readImageFile?.(p).catch(() => null);
      if (!r?.data) {
        const tool = img.closest('.thr-tool-image');
        img.closest('.thr-img-wrap')?.remove();
        if (tool) {
          const label = document.createElement('span'); label.className = 'thr-tool-image-path'; label.textContent = tool.dataset.path;
          tool.append(label); decorateWorkUsernames(tool);
        }
        return;
      }
      src = `data:${r.mediaType};base64,${r.data}`;
      _thrImgSize.set(p, Math.floor(r.data.length * 3 / 4) - (r.data.endsWith('==') ? 2 : r.data.endsWith('=') ? 1 : 0));
      cacheThreadImage(p, src);
    }
    const flow = img.closest('.thr-flow'); // the chat may have moved into or out of a snapshot
    if (!flow) return;
    img.src = src;
    const size = _thrImgSize.get(p);
    if (size) flow.querySelectorAll('.thr-img-size').forEach(el => { if (el.dataset.sizePath === p) el.textContent = fmtBytes(size).replace(' ', ''); });
    flow.querySelectorAll('.thr-img-link').forEach(link => {
      if (link.dataset.path !== p) return;
      link.querySelector('.thr-inline-image-icon').innerHTML = `<img src="${escHtml(src)}" alt="">`;
    });
  }
  function bindThreadImage(img) {
    const wrap = img.closest('.thr-img-wrap');
    const open = () => openClaudeRefViewer(null, { kind: 'file', path: img.dataset.path, label: img.dataset.path.split(/[\\/]/).pop() }, '', _thrImgCache.get(img.dataset.path));
    img.addEventListener('click', open);
    const copy = wrap.querySelector('[data-act="copy"]');
    copy?.addEventListener('click', async () => {
      try {
        await copyChatImage(img);
        copy.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i>';
      } catch { copy.innerHTML = '<i class="ph ph-warning-circle" aria-hidden="true"></i>'; }
      setTimeout(() => { copy.innerHTML = '<i class="ph ph-copy" aria-hidden="true"></i>'; }, 1200);
    });
    void hydrateThreadImage(img);
  }
  function bindThreadCopy(flow) {
    // A selection across messages copies them as a transcript of their original markdown.
    if (!flow._copyBound) {
      flow._copyBound = true;
      flow.addEventListener('copy', e => {
        const sel = getSelection();
        if (!sel.rangeCount || sel.isCollapsed) return;
        const r = sel.getRangeAt(0);
        // A message counts only when the selection covers some of its text: a triple-click or a drag to the end
        // of a bubble ends the range at the very start of the next message, which intersectsNode alone counts.
        const within = m => { // the selection clipped to one message
          const part = document.createRange(); part.selectNodeContents(m);
          if (r.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(r.startContainer, r.startOffset);
          if (r.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(r.endContainer, r.endOffset);
          return part;
        };
        const covers = m => { if (!r.intersectsNode(m)) return false; const part = within(m); return !part.collapsed && part.toString().trim() !== ''; };
        const msgs = [...flow.querySelectorAll('.thr-msg[data-key]')].filter(covers);
        if (!msgs.length) {
          const start = r.startContainer.nodeType === Node.ELEMENT_NODE ? r.startContainer : r.startContainer.parentElement;
          const queued = start?.closest('.thr-queued-text');
          if (queued && queued.contains(r.endContainer)) {
            e.clipboardData.setData('text/plain', mdFromRange(r, queued));
            e.preventDefault();
          }
          return; // tool output etc.: the browser's own copy
        }
        // Inside one message: the selected part as markdown source.
        const text = mdFromRange(r, flow).trim();
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
      });
    }
  }
  // Hidden tool bodies and diffs are built on first open: highlighting all of them made long chats slow to show.
  function seenObserver() {
    return seenObserver.io ||= new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('thr-seen'); seenObserver.io.unobserve(e.target); }
    }, { rootMargin: '600px 0px' });
  }
  function fillLazyDetails(details, lazy = details.closest('.thr-flow')?._lazy) {
    const html = !details.dataset.filled && lazy?.get(details.dataset.key);
    if (!html) return;
    details.dataset.filled = '1';
    details.insertAdjacentHTML('beforeend', html());
    decorateWorkUsernames(details);
    details.querySelectorAll('img.thr-img').forEach(bindThreadImage);
  }
  document.addEventListener('toggle', e => { if (e.target.open && e.target.matches?.('details[data-key]')) fillLazyDetails(e.target); }, true);
  function updateThreadHistory(flow, chunks) {
    const previous = flow._historyChunks || [];
    let first = 0;
    while (first < chunks.length && previous[first]?.html === chunks[first]
      && previous[first].nodes.every(node => node.parentNode === flow)) first++;
    const kept = previous.slice(0, first);
    const last = kept.at(-1)?.nodes.at(-1);
    // Keep finished turns mounted so their details, focus, and layout survive streaming updates.
    for (let node = last ? last.nextSibling : flow.firstChild; node;) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    const content = document.createDocumentFragment();
    const template = document.createElement('template');
    for (let i = first; i < chunks.length; i++) {
      template.innerHTML = chunks[i];
      kept.push({ html: chunks[i], nodes: [...template.content.childNodes] });
      content.append(template.content);
    }
    flow._historyChunks = kept;
    return content;
  }
  // ── Find in the thread history: Ctrl+F while the panel has focus, or the header button ──
  // Matches are painted with the CSS Highlight API, so the message markup is never touched.
  // shortcut: a match must sit inside one text node (not across `code` / **bold** boundaries).
  const thrFind = { q: '', ranges: [], i: -1 };
  const thrFindEl = id => thrPage.querySelector('#sbr-thread-find' + id);
  function thrFindRun(keepIndex) {
    const flow = thrPage.querySelector('#sbr-thread-flow'), q = thrFind.q.toLowerCase(), ranges = [];
    if (q && flow) {
      flow.querySelectorAll('details[data-key]:not([data-filled])').forEach(d => fillLazyDetails(d));
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT, { acceptNode: n =>
        n.parentElement?.closest('.thr-actions, .thr-tools-time, .thr-seg-time, .thr-img-actions') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      for (let n; (n = walker.nextNode());) {
        const text = n.data.toLowerCase();
        for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + q.length)) {
          const r = new Range(); r.setStart(n, at); r.setEnd(n, at + q.length); ranges.push(r);
        }
      }
    }
    thrFind.ranges = ranges;
    thrFind.i = !ranges.length ? -1 : keepIndex ? Math.min(Math.max(thrFind.i, 0), ranges.length - 1) : 0;
    thrFindPaint(!keepIndex);
  }
  function thrFindPaint(scroll) {
    const { ranges, i, q } = thrFind, cur = ranges[i];
    thrFindEl('-count').textContent = !q ? '' : ranges.length ? `${i + 1}/${ranges.length}` : 'No results';
    if (window.CSS?.highlights) {
      CSS.highlights.set('thr-find', new Highlight(...ranges.filter(r => r !== cur)));
      if (cur) CSS.highlights.set('thr-find-current', new Highlight(cur)); else CSS.highlights.delete('thr-find-current');
    }
    if (!scroll || !cur) return;
    // Reveal a match hidden in a folded tool group, then center it.
    for (let d = cur.startContainer.parentElement?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true;
    const flow = thrPage.querySelector('#sbr-thread-flow'), fr = flow.getBoundingClientRect(), rr = cur.getBoundingClientRect();
    flow.scrollTop += rr.top - fr.top - fr.height / 2;
  }
  function thrFindStep(d) {
    if (!thrFind.ranges.length) return;
    thrFind.i = (thrFind.i + d + thrFind.ranges.length) % thrFind.ranges.length;
    thrFindPaint(true);
  }
  function openThreadFind() {
    const bar = thrFindEl(''), input = thrFindEl('-input');
    // A selection in the history seeds the search, like a browser's find.
    const sel = String(window.getSelection() || '').trim();
    if (sel && !sel.includes('\n') && thrPage.querySelector('#sbr-thread-flow').contains(window.getSelection().anchorNode)) input.value = sel;
    bar.hidden = false; input.focus(); input.select();
    thrFind.q = input.value; thrFindRun(false);
  }
  function closeThreadFind() {
    thrFindEl('').hidden = true; thrFind.q = ''; thrFindRun(false);
    thrPage.querySelector('#sbr-thread-flow')?.focus();
  }
  // Plain Ctrl+F in the history panel (the app-wide Ctrl+Shift+F leaves Ctrl+F to terminal programs).
  thrPage?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); openThreadFind(); }
  });
  thrFindEl('-input')?.addEventListener('input', e => { thrFind.q = e.target.value; thrFindRun(false); });
  thrFindEl('-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); thrFindStep(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeThreadFind(); }
  });
  thrFindEl('-prev')?.addEventListener('click', () => thrFindStep(-1));
  thrFindEl('-next')?.addEventListener('click', () => thrFindStep(1));
  thrFindEl('-close')?.addEventListener('click', closeThreadFind);

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
  // Delete a thread (or side chat) after a confirm: close its tab, forget it, remove its saved history.
  function confirmDeleteThread(tab, w = wsOf(tab) || activeWs(), what = 'thread') {
    showConfirm(`Delete ${what} "${tab.chat?.title || tab.label}"? Its saved history is removed.`, () => {
      const storeId = tab.chat?.storeId || tab.id;
      if (!tab._closed) removeTerminal(w.id, tab.id, false, false, true, true); // already confirmed: close now, no second prompt
      closedThreads = closedThreads.filter(t => (t.chat.storeId || t.id) !== storeId);
      window.electronAPI?.threadDelete?.(storeId, tab.chat?.scratch ? tab.chat.cwd : null); // only its own scratch folder
      saveState(); renderThreadsSidebar();
      const cur = curChat(); if (cur) syncThreadComposer(cur); // its row leaves the side chats tray
    });
  }
  function procIconHtml(name, fallback = 'ph-terminal-window') {
    const key = String(name).toLowerCase().replace(/[\d.]+$/, '');
    if (key === 'codex') return '<i class="ws-proc-icon ph ph-open-ai-logo"></i>';
    const img = window.PROC_ICON_IMAGES?.[key];
    if (img) return `<img class="ws-proc-icon" src="${img}" alt="" aria-hidden="true">`;
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
      // An agent CLI shows as its harness: brand-colored logo and product name (claude → Claude Code).
      const h = THREAD_HARNESSES.find(x => x.bin === process.name);
      if (h?.color) row.style.setProperty('--agent-color', h.color); else row.style.removeProperty('--agent-color');
      row.classList.toggle('ws-proc-agent', !!h?.color);
      const html = `${procIconHtml(process.name)}${process.count > 1 ? `<span class="ws-proc-count">${process.count}</span>` : ''}<span>${escHtml(h?.name || process.name)}</span>`;
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
    // Structured chat agents own a process without occupying the tab's PTY.
    const terms = getWorkspaceTerminals(wsp).filter(t => t._sdk?.alive || isLiveTerminal(t));
    const signature = () => getWorkspaceTerminals(wsp).filter(t => t._sdk?.alive || isLiveTerminal(t))
      .map(t => `${t.id}:${t._sdk?.alive ? t._sdk.harness : 'pty'}`).sort().join(',');
    const termIds = signature();
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
    Promise.all(terms.map(t => t._sdk?.alive ? harnessOf(t._sdk.harness)?.bin || t._sdk.harness : checkTerminalRunning(t.id))).then(names => {
      if (!btn.isConnected) return;
      if (signature() !== termIds) { updateWorkspaceProcs(wsp, btn); return; }
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
    ctxEl.style.minHeight = '';

    const item = (icon, label, key, fn, danger, parent = ctxEl, keepOpen = false) => {
      const el = document.createElement('div');
      el.className = 'ctx-item' + (danger ? ' danger' : '');
      el.innerHTML = `<span>${icon}</span><span>${label}</span>${key ? `<span class="ci-key">${key}</span>` : ''}`;
      el.addEventListener('click', () => {
        if (!keepOpen) hideCtxMenu();
        fn();
      });
      parent.appendChild(el);
      return el;
    };
    const sep = () => { const el = document.createElement('div'); el.className = 'ctx-sep'; ctxEl.appendChild(el); };

    if (type === 'composer') {
      for (const [k, label, icon] of COMPOSER_PARTS) {
        const shown = () => !(threadSettings.composerHidden || []).includes(k);
        const el = item(`<i class="ph ${icon}" aria-hidden="true"></i>`, label, '<i class="ph ph-check" aria-hidden="true"></i>', () => {
          const hidden = new Set(threadSettings.composerHidden || []);
          if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
          threadSettings = { ...threadSettings, composerHidden: [...hidden] };
          applyComposerParts(); saveState();
          el.setAttribute('aria-checked', String(shown()));
        }, false, ctxEl, true);
        el.setAttribute('role', 'menuitemcheckbox');
        el.dataset.composerPart = k;
        el.setAttribute('aria-checked', String(shown()));
      }
    } else if (type === 'usage') {
      const choice = (icon, label, key, value) => {
        const el = item(`<i class="ph ${icon}" aria-hidden="true"></i>`, label,
          '<i class="ph ph-check" aria-hidden="true"></i>', () => {
            threadSettings = { ...threadSettings, [key]: value };
            if (key === 'usageDisplay') document.getElementById('set-thread-usage').value = value;
            renderUsageSidebar(true);
            renderUsageModal();
            saveState();
          });
        el.dataset.usageSetting = key;
        el.setAttribute('role', 'menuitemradio');
        el.setAttribute('aria-checked', String(threadSettings[key] === value));
      };
      const hasMonthly = Object.values(_usageLimits || {}).some(u => u.windows?.some(monthlyUsage));
      choice('ph-clock', usageWindows.session, 'usageWindow', 'session');
      choice('ph-calendar-blank', usageWindows.weekly, 'usageWindow', 'weekly');
      if (hasMonthly || threadSettings.usageWindow === 'monthly')
        choice('ph-calendar', usageWindows.monthly, 'usageWindow', 'monthly');
      sep();
      choice('ph-hourglass', 'Remaining', 'usageDisplay', 'remaining');
      choice('ph-gauge', 'Consumed', 'usageDisplay', 'consumed');
      sep();
      const trigger = document.createElement('div');
      trigger.className = 'ctx-item has-sub ctx-usage-providers';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.innerHTML = '<span><i class="ph ph-robot" aria-hidden="true"></i></span><span>Sidebar providers</span><span class="ci-sub-caret"><i class="ph ph-caret-right" aria-hidden="true"></i></span>';
      const submenu = document.createElement('div');
      submenu.className = 'ctx-sub';
      submenu.setAttribute('role', 'menu');
      submenu.setAttribute('aria-label', 'Sidebar providers');
      trigger.appendChild(submenu);
      ctxEl.appendChild(trigger);
      trigger.addEventListener('click', e => {
        if (e.target.closest('.ctx-item') === trigger) {
          trigger.focus();
          submenu.querySelector('.ctx-item')?.focus();
        }
      });
      const hidden = hiddenUsageProviders();
      for (const id of new Set([...usageProviderIds, ...Object.keys(_usageLimits || {})])) {
        const provider = harnessOf(id);
        if (!provider) continue;
        const el = item(procIconHtml(provider.bin, 'ph-robot'), escHtml(provider.name),
          '<i class="ph ph-check" aria-hidden="true"></i>', () => {
            if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
            el.setAttribute('aria-checked', String(!hidden.has(id)));
            el.focus({ preventScroll: true });
            threadSettings = { ...threadSettings, hiddenUsageProviders: [...hidden] };
            if (usageButton.classList.contains('loading')) renderUsagePlaceholders();
            else renderUsageSidebar();
            saveState();
          }, false, submenu, true);
        const icon = el.firstElementChild;
        icon.classList.add('ctx-agent-icon');
        icon.setAttribute('aria-hidden', 'true');
        if (provider.color) icon.style.color = provider.color;
        el.setAttribute('role', 'menuitemcheckbox');
        el.setAttribute('aria-checked', String(!hidden.has(id)));
      }
    } else if (type === 'workspace') {
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
    } else if (type === 'tabbar') {
      const { wsId, groupId } = data;
      item('<i class="ph ph-plus"></i>', 'New terminal', 'Ctrl+Shift+T', () => addTerminal(wsId, groupId));
      // Chat › one entry per installed agent: opens the Chat tab with that agent picked.
      {
        const sub = document.createElement('div');
        sub.className = 'ctx-sub';
        const agents = chatAgentIds().map(harnessOf);
        for (const h of agents) {
          const el = document.createElement('div');
          el.className = 'ctx-item';
          el.innerHTML = `<span class="ctx-agent-icon"${h.color ? ` style="color:${h.color}"` : ''}>${procIconHtml(h.bin, 'ph-robot')}</span><span>${escHtml(h.name)}</span>`;
          el.addEventListener('click', () => { hideCtxMenu(); newChatTab(findWs(wsId), groupId, h.id); });
          sub.appendChild(el);
        }
        if (!agents.length) sub.innerHTML = '<div class="ctx-item disabled"><span><i class="ph ph-info"></i></span><span>No agent CLI found on PATH</span></div>';
        const trigger = document.createElement('div');
        trigger.className = 'ctx-item has-sub';
        trigger.innerHTML = `<span><i class="ph ph-chats-circle"></i></span><span>Chat</span><span class="ci-sub-caret"><i class="ph ph-caret-right"></i></span>`;
        trigger.appendChild(sub);
        ctxEl.appendChild(trigger);
      }
      if (shellList.length) sep();
      for (const s of shellList) {
        // Same logos as Settings → Default shell.
        item(`<svg class="ctx-shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${shellIconPath(s)}"/></svg>`, escHtml(s.label) + (s.id === defaultShell ? ' (default)' : ''), '',
          () => addTerminal(wsId, groupId, { shell: s.id }));
      }
    } else if (type === 'chat-cwd') {
      const tab = data, cur = chatCwd(tab);
      const dirs = chatProjectDirs(cur).slice(0, 12);
      item('<i class="ph ph-selection"></i>', 'No project', '', () => setChatCwd(tab, null, true));
      if (dirs.length) sep();
      dirs.forEach(d => item(projectIconHtml(d).startsWith('<img') ? projectIconHtml(d) : chatFolderIcon(d, d === cur), escHtml(d.replace(/^\/home\/[^/]+/, '~')), '', () => setChatCwd(tab, d)));
      if (window.electronAPI?.selectDirectory) {
        if (dirs.length) sep();
        item('<i class="ph ph-folder-plus"></i>', 'Choose folder…', '', async () => setChatCwd(tab, await window.electronAPI.selectDirectory(cur || undefined)));
      }
    } else if (type === 'chat-branch') {
      const { tab, cwd, branches } = data, cur = _gitBranch.get(cwd);
      // Search field (sticky at the top) that filters the rows below.
      const search = document.createElement('label');
      search.className = 'ctx-search';
      search.innerHTML = '<i class="ph ph-magnifying-glass" aria-hidden="true"></i><input type="text" placeholder="Search branches…" aria-label="Search branches" spellcheck="false" autocomplete="off">';
      search.querySelector('input').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        ctxEl.querySelectorAll('.ctx-item').forEach(el => { el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      });
      ctxEl.appendChild(search);
      if (!branches.length) item('<i class="ph ph-git-branch"></i>', 'No branches', '', () => {});
      const saved = tab?.chat?.branch;
      branches.forEach(b => item('<i class="ph ph-git-branch"></i>', escHtml(b) + (b === cur ? ' (current)' : '') + (b === saved ? ' (thread)' : ''), '', () => {
        if (b !== cur || b !== saved) void setChatBranch(tab, cwd, b);
      }));
      // Only the rows scroll; the search field stays above them.
      const list = document.createElement('div');
      list.className = 'ctx-list';
      list.append(...ctxEl.querySelectorAll(':scope > .ctx-item'));
      ctxEl.append(list);
    } else if (type === 'ts-project') {
      // The threads sidebar's project filter: All projects, then each folder threads use (most recent first).
      const search = document.createElement('label');
      search.className = 'ctx-search';
      search.innerHTML = '<i class="ph ph-magnifying-glass" aria-hidden="true"></i><input type="text" placeholder="Search projects…" aria-label="Search projects" spellcheck="false" autocomplete="off">';
      search.querySelector('input').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        ctxEl.querySelectorAll('.ctx-item').forEach(el => { el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      });
      ctxEl.appendChild(search);
      const projects = new Map(); // key -> { label, path, updated }
      for (const x of chatThreads().map(threadInfo).sort((a, b) => b.updated - a.updated)) {
        const key = tsProjectKey(x);
        if (!projects.has(key)) projects.set(key, { label: key === '' ? 'No project' : x.folder, path: key });
      }
      const pick = (icon, label, key) => {
        // The project's own icon (as in the sidebar), with a check badge on the picked one.
        const glyph = key ? projectIconHtml(key, icon) : `<i class="ph ${icon}"></i>`;
        item(`<span class="ts-pick-icon">${glyph}${tsProject === key ? '<i class="ph ph-check-circle ts-pick-check" aria-hidden="true"></i>' : ''}</span>`, escHtml(label), '', () => setThreadsProject(key));
        const el = [...ctxEl.querySelectorAll(':scope > .ctx-item')].pop();
        if (el) { el.classList.toggle('selected', tsProject === key); if (key) el.title = key; }
      };
      pick('ph-folders', 'All projects', null);
      for (const [key, p] of projects) pick(key === '' ? 'ph-selection' : 'ph-folder', p.label, key);
      const list = document.createElement('div');
      list.className = 'ctx-list';
      list.append(...ctxEl.querySelectorAll(':scope > .ctx-item'));
      ctxEl.append(list);
    } else if (type === 'chat-image') {
      const img = data, path = img.dataset.path, name = path.split(/[\\/]/).pop();
      const copyText = text => { void copyPrivateText(text).catch(() => {}); };
      item('<i class="ph ph-arrows-out"></i>', 'Open image', '', () => openClaudeRefViewer(null, { kind: 'file', path, label: name }, ''));
      item('<i class="ph ph-copy"></i>', 'Copy image', '', () => copyChatImage(img).catch(() => zoomBadge('Could not copy the image')));
      item('<i class="ph ph-file"></i>', 'Copy path', '', () => copyText(path));
      if (window.electronAPI?.showInFolder) { sep(); item('<i class="ph ph-folder-open"></i>', 'Show in folder', '', () => window.electronAPI.showInFolder(path)); }
    } else if (type === 'chat-msg') {
      // A message's text: the selection (copied as markdown by the flow's copy handler, or cited), the whole
      // message as markdown, and a reply's fork point.
      const msg = data, sel = window.getSelection(), raw = msg.closest('.thr-flow')?._texts?.get(msg.dataset.key) || '';
      const selected = sel && !sel.isCollapsed && msg.closest('.thr-flow')?.contains(sel.anchorNode) && sel.toString().trim();
      const copyText = text => { void copyPrivateText(text).catch(() => {}); };
      if (selected) {
        // Clicking the menu can drop the selection: put the one it opened on back before acting.
        const range = sel.getRangeAt(0).cloneRange(), restore = () => { const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(range); };
        item('<i class="ph ph-copy"></i>', 'Copy', 'Ctrl+C', () => { restore(); document.execCommand('copy'); });
        item('<i class="ph ph-quotes"></i>', 'Cite selection', '', () => { restore(); citeBtn.click(); });
      } else {
        item('<i class="ph ph-text-aa"></i>', 'Copy message', '', () => copyText(raw));
        const fork = msg.querySelector('.thr-fork');
        if (fork) item('<i class="ph ph-git-fork"></i>', 'Fork from here', '', () => fork.click());
      }
    } else if (type === 'chat-link') {
      const copy = text => { void copyPrivateText(text).catch(() => {}); };
      if (/^https?:/i.test(data)) {
        item('<i class="ph ph-arrow-square-out"></i>', 'Open link', '', () => openChatWebLink(data));
        item(`<i class="ph ${terminalLinkTarget === 'external' ? 'ph-browser' : 'ph-globe'}"></i>`, terminalLinkTarget === 'external' ? 'Open in a browser tab' : 'Open in system browser', '', () => openChatWebLink(data, true));
        item('<i class="ph ph-copy"></i>', 'Copy link', '', () => copy(data));
      } else {
        const { path, rel, line } = chatLinkPath(data);
        item('<i class="ph ph-code"></i>', 'Open in VS Code', '', () => window.electronAPI?.openInVSCode?.(path + (line ? ':' + line : '')).then(ok => { if (!ok) zoomBadge('VS Code (code) not found'); }));
        item('<i class="ph ph-folder-open"></i>', 'Reveal in Files', '', () => window.electronAPI?.showInFolder?.(path));
        sep();
        item('<i class="ph ph-copy"></i>', 'Copy relative path', '', () => copy(rel));
        item('<i class="ph ph-copy"></i>', 'Copy full path', '', () => copy(path));
      }
    } else if (type === 'chat-thread') {
      // A card can outlive its Chat tab.
      const tab = findChatThread(data), w = tab && (wsOf(tab) || activeWs());
      if (!tab || !w) return;
      const agent = liveThreadAgent(tab), h = agent && harnessOf(_tabAgent.get(tab.id));
      item('<i class="ph ph-chats-circle"></i>', 'Open', '', () => openChatTab(tab));
      const parent = findThreadByKey(tab.chat?.forkOf);
      if (parent) item('<i class="ph ph-git-fork"></i>', 'Open parent thread', '', () => openChatTab(parent));
      item('<i class="ph ph-pencil-simple"></i>', 'Rename', '', () => { const card = tsOpen && [...tsList.querySelectorAll('.ts-card')].find(c => c.dataset.tab === tab.id); if (card) return startThreadRename(card); showPrompt('Rename thread', tab.chat?.title || tab.label, value => {
        if (!value.trim()) return;
        tab.chat ||= { createdAt: Date.now() };
        tab.chat.title = value.trim().slice(0, 80);
        setChatTabLabel(tab); saveState(); renderThreadsSidebar();
      }); });
      if (window.electronAPI?.chatTitle) item('<i class="ph ph-sparkle"></i>', 'Regenerate title', '', () => regenerateChatTitle(tab));
      item(`<i class="ph ${tab.chat?.pinned ? 'ph-push-pin-slash' : 'ph-push-pin'}"></i>`, tab.chat?.pinned ? 'Unpin' : 'Pin', '', () => setThreadFlag(tab, 'pinned', !tab.chat?.pinned));
      if (tsLayout.value !== 'project') {
        const isSettled = tab.chat?.settledAt && tab.chat.settledAt >= (tab.chat.updatedAt || 0);
        item(`<i class="ph ${isSettled ? 'ph-arrow-counter-clockwise' : 'ph-check'}"></i>`, isSettled ? 'Un-settle' : 'Settle', '', () => setThreadFlag(tab, 'settledAt', !isSettled));
      }
      if (h) {
        sep();
        item('<i class="ph ph-terminal-window"></i>', `Show ${escHtml(h.name)} terminal`, '', () => { if (viewSwitchBlocked(tab)) return; openChatTab(tab); setChatView(tab, true); });
        item('<i class="ph ph-stop-circle"></i>', `Stop ${escHtml(h.name)}`, '', () => stopTabAgent(tab).then(ok => { if (!ok) zoomBadge(`${h.name} did not stop`); syncThreadPanel(); renderThreadsSidebar(); }));
      }
      const cwd = chatCwd(tab);
      if (cwd) {
        sep();
        item('<i class="ph ph-copy"></i>', 'Copy folder path', '', () => { if (window.electronAPI?.clipboardWrite) window.electronAPI.clipboardWrite(cwd); else navigator.clipboard?.writeText(cwd).catch(() => {}); });
      }
      sep();
      item('<i class="ph ph-trash"></i>', 'Delete thread', '', () => confirmDeleteThread(tab, w), true);
    } else if (type === 'chat-terminal') {
      const { entry, owner } = data, term = entry.term;
      const copy = item('<i class="ph ph-copy"></i>', 'Copy', 'Ctrl+Shift+C', () => { void copyPrivateTerminal(term).catch(() => {}); });
      if (!term.hasSelection()) copy.classList.add('disabled');
      item('<i class="ph ph-clipboard-text"></i>', 'Paste', 'Ctrl+Shift+V', () => { doPaste(entry); term.focus(); });
      item('<i class="ph ph-selection-all"></i>', 'Select all', '', () => term.selectAll());
      item('<i class="ph ph-eraser"></i>', 'Clear', '', () => term.clear());
      sep();
      item('<i class="ph ph-x"></i>', 'Hide terminal', 'Ctrl+J', () => toggleChatBottomTerminal(owner));
    } else if (type === 'browser-more') {
      const { entry, history } = data;
      item('<i class="ph ph-clock-counter-clockwise"></i>', 'History', '', history);
      item('<i class="ph ph-code"></i>', entry._devtools ? 'Close developer tools' : 'Developer tools', 'F12', () => entry._toggleDevTools?.());
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
            void copyPrivateTerminal(t.term.term).catch(() => {});
          }
        });
      }
      sep();
      // Bulk close, scoped to this tab bar; closing this one stays last.
      const tabs = (wsp && findGroupContainingTerm(wsp.layout, termId)?.terminals.map(t => t.id)) || [];
      const at = tabs.indexOf(termId);
      if (tabs.length > 1) {
        item('<i class="ph ph-x-square"></i>', 'Close other tabs', '', () => closeTabs(wsId, tabs.filter(id => id !== termId)));
        if (at < tabs.length - 1) item('<i class="ph ph-arrow-line-right"></i>', 'Close tabs to the right', '', () => closeTabs(wsId, tabs.slice(at + 1)));
        item('<i class="ph ph-x-circle"></i>', 'Close all tabs', '', () => closeTabs(wsId, tabs));
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
      if (!el.hasAttribute('role')) el.setAttribute('role', 'menuitem');
      el.tabIndex = -1;
    });
    ctxEl.classList.add('open');
    const menuW = ctxEl.offsetWidth;
    const menuH = ctxEl.offsetHeight;
    let x = e.alignRight ? e.pageX - menuW : e.pageX; // alignRight: pageX is the menu's right edge
    let y = e.above ? e.pageY - menuH : e.pageY; // above: pageY is the menu's bottom edge
    if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;
    ctxEl.style.left = Math.max(0, x) + 'px';
    ctxEl.style.top = Math.max(0, y) + 'px';
    // Flip the submenu to the left when the menu sits near the right screen edge
    ctxEl.classList.toggle('sub-flip', x + menuW + 210 > window.innerWidth);
    // A searchable menu keeps its size while filtering (it stays on its trigger) and takes the typing.
    const searchInput = ctxEl.querySelector('.ctx-search input');
    if (searchInput) { ctxEl.style.minHeight = menuH + 'px'; searchInput.focus(); }
  }

  function hideCtxMenu() {
    const restoreFocus = ctxEl.contains(document.activeElement);
    ctxEl.classList.remove('open');
    ctxEl.inert = true;
    ctxEl._owner = null;
    if (restoreFocus && ctxPreviousFocus?.isConnected) ctxPreviousFocus.focus({ preventScroll: true });
  }
  document.addEventListener('contextmenu', e => { if (!ctxEl.contains(e.target)) hideCtxMenu(); }, true);
  // Terminal mouse handling can consume the gesture before a click bubbles.
  window.addEventListener('pointerdown', e => {
    if (!ctxEl.classList.contains('open') || ctxEl.contains(e.target) || ctxEl._owner?.contains(e.target)) return;
    hideCtxMenu();
  }, true);
  document.addEventListener('click', e => { if (!e.target.closest('#ctx')) hideCtxMenu(); });
  // Clicks inside a browser pane (webview / iframe / native view) never reach
  // this document: close when focus moves into one or the window loses focus.
  document.addEventListener('focusin', e => { if (e.target.matches?.('webview, iframe') && ctxEl.classList.contains('open')) hideCtxMenu(); });
  window.addEventListener('blur', () => { if (ctxEl.classList.contains('open')) hideCtxMenu(); });
  document.addEventListener('keydown', e => {
    if (!ctxEl.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideCtxMenu(); return; }
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key)) return;
    const inSearch = e.target.matches?.('.ctx-search input');
    if (inSearch && !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return; // typing in a menu's search field
    e.preventDefault(); e.stopPropagation();
    const items = [...ctxEl.querySelectorAll('.ctx-item')].filter(el => el.getClientRects().length);
    if (inSearch && e.key === 'Enter') { items[0]?.click(); return; } // Enter picks the first match
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
      opts.onClose?.();
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
      'Close Tab', callback, onCancel);
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

    closeConfirmOverlay.classList.add('open');
    closeConfirmOverlay.showModal();
    closeConfirmCancel.focus();

    const close = () => {
      closeConfirmOverlay.classList.remove('open');
      closeConfirmOk.onclick = null;
      closeConfirmCancel.onclick = null;
      closeConfirmOverlay.onclick = null;
      closeConfirmOverlay.oncancel = null;
      document.removeEventListener('keydown', onKey, true);
      closeConfirmOverlay.close();
    };
    const cancel = () => {
      close();
      onCancel();
    };
    const submit = () => {
      if (key && closeConfirmDontAgain?.checked) setDontAskAgain(key);
      close();
      callback();
    };
    const onKey = e => {
      e.stopPropagation();
      if (submitShortcut && matchShortcut(e, submitShortcut)) { e.preventDefault(); submit(); return; }
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };

    closeConfirmOk.onclick = submit;
    closeConfirmCancel.onclick = cancel;
    closeConfirmOverlay.onclick = e => { if (e.target === closeConfirmOverlay) cancel(); };
    closeConfirmOverlay.oncancel = e => { e.preventDefault(); cancel(); };
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
  const _notifyAudio = new Map();
  function playNotifySound(file = 'notify.wav') {
    try {
      let audio = _notifyAudio.get(file);
      if (!audio) {
        audio = new Audio('sounds/' + file);
        _notifyAudio.set(file, audio);
      }
      audio.currentTime = 0;
      audio.play().catch(() => { });
    } catch { }
  }
  function notifyAgentQuestion() {
    if (notificationSound) playNotifySound('question.wav');
  }
  function isTermOnScreen(ws, termId) {
    if (ws.id !== activeWsId) return false;
    const group = findGroupContainingTerm(ws.layout, termId);
    return !!group && group.activeTermId === termId && (!ws._maximizedGroupId || ws._maximizedGroupId === group.id);
  }
  window.addEventListener('focus', syncThreadSelection);
  function onTerminalFinished({ id, kind, name, completed = kind === 'agent' }) {
    const found = findTermById(id);
    if (!found || (document.hasFocus() && isTermOnScreen(found.ws, id))) return;
    if (completed && found.term.threadHistory && found.term.chat && !found.term.chat.unseenCompletion) {
      found.term.chat.unseenCompletion = true;
      saveState();
      renderThreadsSidebar();
    }
    if (!notifyOnCommandFinish) return;
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
  // fresh: Windows reads a process table up to seconds old; guards that act on the answer ask for a new one.
  function checkTerminalRunning(termId, fresh = false) {
    return new Promise((resolve) => {
      if (isDesktop() && window.electronAPI && window.electronAPI.terminalHasRunningProcess) {
        window.electronAPI.terminalHasRunningProcess(termId, fresh)
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

  /* ── App toast ── */
  const zoomBadge = (function () {
    const el = document.createElement('div');
    el.className = 'app-toast app-toast-fixed';
    el.innerHTML = '<i class="ph ph-info" aria-hidden="true"></i><span role="status"></span>'
      + '<button type="button" class="app-toast-close" aria-label="Dismiss notification" hidden><i class="ph ph-x" aria-hidden="true"></i></button>';
    const label = el.querySelector('[role="status"]'), close = el.querySelector('button');
    document.body.appendChild(el);
    let timer, duration;
    const hide = () => {
      clearTimeout(timer);
      el.classList.remove('visible');
      close.hidden = true;
    };
    const resume = () => {
      clearTimeout(timer);
      if (el.classList.contains('visible') && !el.matches(':hover, :focus-within')) timer = setTimeout(hide, duration);
    };
    close.addEventListener('click', hide);
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', resume);
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('focusout', () => queueMicrotask(resume));
    return function showToast(text, timeout = 4000) {
      duration = timeout;
      label.textContent = text;
      close.hidden = false;
      el.classList.add('visible');
      resume();
    };
  })();

  document.getElementById('pane-area').addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !e.deltaY) return;
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

    // Font size and the matching grid change right here, in the wheel event, never in a rAF callback:
    // the renderer's canvas resize wipes it and its repaint is a requestAnimationFrame, which from inside
    // a rAF callback lands a frame late — one blank frame per step (the flicker). From an event, the
    // repaint runs in the coming frame, before it is painted.
    active.term.options.fontSize = newSize;
    // fitTerm tells the PTY shortly after, so a TUI redraws over xterm's reflow of its old
    // layout quickly; writePtyData paints that redraw in one frame.
    fitTerm(active);
    zoomBadge(newSize + 'px', 800);

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

  // Shared search overlay for tabs, commands, snippets, history and thread projects.
  let tsMode = 'tabs';
  let tsShown = [];
  let tsReturnFocus = null;

  function collectTabItems() {
    const items = [];
    for (const ws of workspaces) {
      for (const t of getWorkspaceTerminals(ws)) {
        items.push({
          label: t.label, meta: ws.label, metaUi: true, icon: t.type === 'browser' ? 'ph-globe-hemisphere-west' : 'ph-terminal-window',
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
      ['New workspace', null, 'ph-folder-plus', () => createWorkspace()],
      ['Open settings', null, 'ph-gear', () => openSettingsGlobal()],
    ].map(([label, sc, icon, run]) => ({ label, meta: sc ? key(sc) : '', icon, run }));
    for (const w of workspaces) cmds.push({ label: 'Workspace: ' + w.label, meta: '', icon: 'ph-squares-four', run: () => activateWorkspace(w.id) });
    for (const c of _pluginCommands.values()) {
      cmds.push({ label: c.label, meta: 'plugin', metaUi: true, icon: 'ph-puzzle-piece', run: () => { try { c.handler(); } catch (e) { console.error('[plugin] command failed:', c.id, e); } } });
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
      label: 'Clear browsing history', meta: list.length + ' entries', metaUi: true, icon: 'ph-trash', pin: true,
      run: () => { saveBrowserHistory([]); },
    });
    return items;
  }

  // Per-tab history drawer on the right of the page. It lives inside .browser-content,
  // so a right-docked DevTools (a native view over its own column) never covers it.
  function toggleBrowserHistoryDrawer(entry, contentWrap) {
    const open = contentWrap.querySelector('.browser-history-drawer:not(.is-closing)');
    if (open) { open._close(); return; }
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const drawer = el('section', 'browser-history-drawer');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'History');
    const head = el('header', 'bh-head');
    const close = el('button', 'bh-icon-btn');
    close.type = 'button'; close.title = 'Close'; close.setAttribute('aria-label', 'Close history');
    close.innerHTML = '<i class="ph ph-x"></i>';
    head.append(el('h2', '', 'History'), close);
    const searchWrap = el('div', 'bh-search');
    searchWrap.innerHTML = '<i class="ph ph-magnifying-glass" aria-hidden="true"></i>';
    const search = el('input');
    search.type = 'search'; search.placeholder = 'Search history'; search.spellcheck = false;
    search.setAttribute('aria-label', 'Search history');
    searchWrap.append(search);
    const list = el('div', 'bh-list');
    const foot = el('footer', 'bh-foot');
    const clear = el('button', 'bh-clear', 'Clear history');
    clear.type = 'button';
    foot.append(clear);
    drawer.append(head, searchWrap, list, foot);

    const dayLabel = ts => {
      const d = new Date(ts), today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
      return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    };
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const all = loadBrowserHistory();
      const hits = all.filter(h => !q || ((h.title || '') + ' ' + h.url).toLowerCase().includes(q));
      list.replaceChildren();
      clear.disabled = !all.length;
      if (!hits.length) { list.append(el('div', 'bh-empty', all.length ? 'No matches' : 'No history yet')); return; }
      let day = null;
      for (const h of hits) {
        const label = dayLabel(h.ts || 0);
        if (label !== day) { day = label; list.append(el('div', 'bh-day', label)); }
        const row = el('div', 'bh-row');
        const go = el('button', 'bh-open');
        go.type = 'button'; go.title = h.url;
        const text = el('span', 'bh-text');
        text.append(el('span', 'bh-title', h.title || h.url), el('span', 'bh-url', h.url.replace(/^https?:\/\/(www\.)?/, '')));
        go.append(text, el('span', 'bh-time', h.ts ? new Date(h.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''));
        go.addEventListener('click', () => { finish(); entry._loadUrl?.(h.url); });
        const del = el('button', 'bh-icon-btn bh-del');
        del.type = 'button'; del.title = 'Remove from history'; del.setAttribute('aria-label', 'Remove from history');
        del.innerHTML = '<i class="ph ph-x"></i>';
        del.addEventListener('click', () => { saveBrowserHistory(loadBrowserHistory().filter(x => x.url !== h.url)); render(); });
        row.append(go, del);
        list.append(row);
      }
    };
    // Slide out, then remove (workspace.css). The timer covers reduced motion / a missed animationend.
    const finish = () => {
      if (drawer.classList.contains('is-closing')) return;
      drawer.classList.add('is-closing');
      const done = () => drawer.remove();
      drawer.addEventListener('animationend', done, { once: true });
      setTimeout(done, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250);
    };
    drawer._close = finish;
    close.addEventListener('click', finish);
    clear.addEventListener('click', () => { saveBrowserHistory([]); render(); });
    search.addEventListener('input', render);
    drawer.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); finish(); } });
    // Keep the slot's mousedown focus handling from pulling focus back to the page.
    drawer.addEventListener('mousedown', e => e.stopPropagation());
    render();
    contentWrap.append(drawer);
    search.focus();
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

  function collectProjectItems() {
    const ws = activeWs();
    const start = project => newChatTab(findWs(ws?.id) || activeWs(), undefined, undefined, project);
    const projects = chatProjectDirs(ws?.cwd).map(path => ({
      label: chatFolderName(path), path, search: `${chatFolderName(path)} ${path}`, run: () => start(path),
    }));
    projects.splice(Math.min(1, projects.length), 0, { label: 'No project', icon: 'ph-selection', run: () => start(null) });
    projects.push({
      label: 'Choose folder…', icon: 'ph-folder-plus', always: true,
      run: async () => {
        if (!window.electronAPI?.selectDirectory) {
          showPrompt('Project folder path', '', value => { if (value.trim()) start(value.trim()); });
          return;
        }
        try {
          const path = await window.electronAPI.selectDirectory(ws?.cwd || undefined);
          if (path) start(path);
        } catch {
          zoomBadge('Could not open the folder picker');
        }
      },
    });
    return projects;
  }

  function renderTabSearch() {
    const q = tsInput.value;
    tsShown = tsItems
      .map((it, i) => ({ it, i, score: it.always ? 1e9 : it.pin ? (q ? Infinity : 1e9) : fuzzyScore(q, it.search || it.label) }))
      .filter(x => x.score !== Infinity)
      .sort((a, b) => a.score - b.score || (tsMode === 'history' || tsMode === 'projects' ? a.i - b.i : a.it.label.localeCompare(b.it.label)))
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
      row.innerHTML = `${it.path ? projectIconHtml(it.path) : `<i class="ph ${it.icon}"></i>`}<span class="ts-label"></span><span class="ts-ws"></span>`;
      row.querySelector('.ts-label').textContent = it.label;
      row.querySelector('.ts-ws').textContent = it.meta || '';
      if (it.path) {
        const path = document.createElement('small');
        path.className = 'ts-project-path';
        path.textContent = `Local · ${it.path}`;
        row.querySelector('.ts-label').append(path);
        row.title = it.path;
      }
      if (it.metaUi) row.querySelector('.ts-ws').classList.add('ts-ws-ui'); // plain text, not a key/url/command
      if (it.del) {
        const d = document.createElement('i');
        d.className = 'ph ph-trash ts-del';
        d.title = it.delTitle || 'Delete snippet';
        d.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); it.del(); });
        row.appendChild(d);
      }
      row.addEventListener('mousedown', e => { e.preventDefault(); if (tsMode !== 'projects') tsPick(i, e); });
      if (tsMode === 'projects') row.addEventListener('click', e => tsPick(i, e));
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

  const TS_PLACEHOLDERS = { tabs: 'Search tabs…', cmds: 'Type a command…', snips: 'Search snippets… (Ctrl+Enter runs)', history: 'Search browser history…', projects: 'Search projects…' };
  function openPalette(mode, query) {
    if (!tabSearchEl || tsResults.contains(document.activeElement)) return;
    if (tabSearchEl.style.display === 'none') tsReturnFocus = document.activeElement;
    tsMode = mode;
    tabSearchEl.dataset.mode = mode;
    tabSearchEl.querySelector('[role="dialog"]').setAttribute('aria-label', mode === 'projects' ? 'Choose a project for the new thread' : 'Find tabs and commands');
    tsResults.setAttribute('aria-label', mode === 'projects' ? 'Projects' : 'Search results');
    document.getElementById('ts-enter-label').textContent = mode === 'projects' ? 'Select' : 'Open';
    document.querySelectorAll('[data-palette-mode]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.paletteMode === mode)));
    tsItems = mode === 'cmds' ? collectCommandItems() : mode === 'snips' ? collectSnippetItems()
      : mode === 'history' ? collectHistoryItems() : mode === 'projects' ? collectProjectItems() : collectTabItems();
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
  tabSearchEl.querySelector('.ts-project-back').addEventListener('click', closeTabSearch);
  tabSearchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.target !== tsInput) { e.stopPropagation(); closeTabSearch(); }
    if (e.key !== 'Tab') return;
    const controls = [...tabSearchEl.querySelectorAll('button, input')].filter(control => control.getClientRects().length);
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

  // simple-icons has no Microsoft shell logos, so these two are drawn: a prompt cut out of a console window / PowerShell's slanted panel.
  const SHELL_GLYPHS = {
    terminal: 'M2 4h20v16H2zM5.2 9l3.4 3-3.4 3 1.2 1.4 4.8-4.4-4.8-4.4zM12 14.6v1.8h6.5v-1.8z',
    powershell: 'M6 4h16.5L18 20H1.5zM7 8.8l3.4 3.2-4.7 3 1.2 1.4 6.1-4.5-4.7-4.5zM11.6 14.7l-.4 1.7h5.4l.4-1.7z',
  };
  const SHELL_ICON_SLUGS = [
    [/^git bash$/, 'git'], [/^bash$/, 'gnubash'], [/^zsh$/, 'zsh'], [/^fish$/, 'fishshell'], [/^nu$/, 'nushell'],
    [/ubuntu/, 'ubuntu'], [/debian/, 'debian'], [/alpine/, 'alpinelinux'], [/fedora/, 'fedora'], [/arch/, 'archlinux'],
    [/suse/, 'opensuse'], [/kali/, 'kalilinux'], [/alma/, 'almalinux'],
  ];
  function shellIconPath({ id, label }) {
    if (id === 'powershell' || id === 'pwsh') return SHELL_GLYPHS.powershell;
    const name = label.toLowerCase();
    const slug = SHELL_ICON_SLUGS.find(([pattern]) => pattern.test(name))?.[1] || (id.startsWith('wsl:') ? 'linux' : null);
    return window.PROC_ICON_PATHS?.[slug] || SHELL_GLYPHS.terminal;
  }

  async function refreshDefaultShellSetting() {
    // Browser mode's server picks its own shell.
    if (!window.electronAPI?.listShells) { document.getElementById('set-default-shell-row').style.display = 'none'; return; }
    const shells = await window.electronAPI.listShells();
    const select = document.getElementById('set-default-shell');
    select.replaceChildren(...[{ id: '', label: 'System default' }, ...shells].map(shell => {
      const option = new Option(shell.label, shell.id);
      option.dataset.icon = shellIconPath(shell);
      return option;
    }));
    select.value = shells.some(shell => shell.id === defaultShell) ? defaultShell : '';
    const dd = document.querySelector('.custom-dropdown[data-for="set-default-shell"]');
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
    btn.id = select.id + '-trigger';
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
    function appendIcon(host, pathData, agentId) {
      if (agentId) {
        const h = harnessOf(agentId);
        if (!h) return;
        const icon = document.createElement('span');
        icon.className = 'dropdown-icon dropdown-agent-icon';
        icon.style.color = h.color || 'var(--fg)';
        icon.innerHTML = procIconHtml(h.bin, 'ph-robot');
        host.append(icon);
        return;
      }
      if (!pathData) return;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('dropdown-icon'); svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData); svg.append(path); host.append(svg);
    }
    function refresh() {
      label.replaceChildren();
      appendIcon(label, select.selectedOptions[0]?.dataset.icon, select.selectedOptions[0]?.dataset.agent);
      const text = select.selectedOptions[0]?.textContent || '';
      label.append(document.createTextNode(text));
      const accessibleName = select.getAttribute('aria-label');
      if (accessibleName) btn.setAttribute('aria-label', accessibleName + ': ' + text);
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
        appendIcon(item, option.dataset.icon, option.dataset.agent);
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
      const modal = dd.closest('#settings-modal, dialog')?.getBoundingClientRect();
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
    dd.closest('dialog')?.addEventListener('close', () => close(), { signal: lifetime.signal });
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

  function refreshThreadHarnessSetting() {
    const select = document.getElementById('set-thread-harness');
    if (!select) return;
    const render = found => {
      select.replaceChildren(new Option('Last used', ''));
      for (const h of THREAD_HARNESSES) {
        if (h.retired || !CHAT_AGENTS[h.id] || !found[h.bin]) continue;
        const option = new Option(h.name, h.id);
        option.dataset.agent = h.id;
        select.add(option);
      }
      select.value = [...select.options].some(o => o.value === threadSettings.harness) ? threadSettings.harness : '';
      const dd = document.querySelector('.custom-dropdown[data-for="set-thread-harness"]');
      if (dd) initCustomDropdown(dd);
    };
    render(_chatAgentsFound || {});
    loadChatAgents().then(r => render(r?.found || {}));
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

    // Hide email addresses: the blurs stay in place, CSS shows or hides them all at once.
    const hideEmailsToggle = document.getElementById('set-hide-emails');
    if (hideEmailsToggle) {
      hideEmailsToggle.checked = hideEmails;
      hideEmailsToggle.onchange = e => {
        hideEmails = e.target.checked;
        document.body.classList.toggle('show-emails', !hideEmails);
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

    refreshDefaultShellSetting();

    // Terminal links
    const linkSelect = document.getElementById('set-link-target');
    linkSelect.value = terminalLinkTarget;
    const linkDD = document.querySelector('.custom-dropdown[data-for="set-link-target"]');
    if (linkDD) initCustomDropdown(linkDD);

    // Threads
    refreshThreadHarnessSetting();
    for (const [id, key] of [['set-thread-harness', 'harness'], ['set-thread-folder', 'folder'], ['set-thread-titles', 'titles'], ['set-thread-usage', 'usageDisplay'], ['set-thread-markdown', 'markdown'], ['set-thread-usernames', 'usernames']]) {
      document.getElementById(id).value = threadSettings[key];
      const dd = document.querySelector(`.custom-dropdown[data-for="${id}"]`);
      if (dd) initCustomDropdown(dd);
    }

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
      item.dataset.shortcutAction = action;
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
    settingsSearchInput.value = '';
    settingsSearchResults.hidden = true;
    settingsSearchMatches.replaceChildren();
    settingsSearchStatus.textContent = '';
    settingsOverlay.querySelector('.settings-search-target')?.classList.remove('settings-search-target');
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
      if (state.hideEmails !== undefined) hideEmails = !!state.hideEmails;
      document.body.classList.toggle('show-emails', !hideEmails);
      if (state.notifyOnCommandFinish !== undefined) notifyOnCommandFinish = !!state.notifyOnCommandFinish;
      if (state.notificationSound !== undefined) notificationSound = !!state.notificationSound;
      if (['tab', 'external'].includes(state.terminalLinkTarget)) terminalLinkTarget = state.terminalLinkTarget;
      loadThreadSettings(state.threadSettings);
      renderUsageSidebar();
      renderUsageModal();
      if (state.backgroundMode) backgroundMode = state.backgroundMode;
      if (state.globalBackgroundImage) globalBackgroundImage = state.globalBackgroundImage;
      if (state.backgroundOpacity !== undefined) backgroundOpacity = state.backgroundOpacity;
      if (state.searchEngine) searchEngine = state.searchEngine;
      if (state.customSearchUrl) customSearchUrl = state.customSearchUrl;
      if (state.defaultTerminalPath !== undefined) defaultTerminalPath = state.defaultTerminalPath;
      if (state.defaultShell !== undefined) { defaultShell = state.defaultShell; window.electronAPI?.setDefaultShell?.(defaultShell); }
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
      const t = keyTerminal();
      if (t && t.type !== 'browser' && t.term.hasSelection()) {
        e.preventDefault(); e.stopPropagation();
        void copyPrivateTerminal(t.term).catch(() => {});
      }
      return;
    }
    // Paste — leave it to the focused text field
    const inTextField = isTextField(e.target);
    if (matchShortcut(e, 'paste')) {
      const t = keyTerminal();
      if (t && t.type !== 'browser' && !inTextField) {
        e.preventDefault(); e.stopPropagation();
        doPaste(t);
      }
      return;
    }
    // Ctrl+V paste (non-shift variant)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v') {
      const t = keyTerminal();
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
    if (matchShortcut(e, 'search')) {
      e.preventDefault();
      // Focus in the open thread history: search the history instead of the terminal.
      if (document.activeElement?.closest?.('#sbr-thread')) openThreadFind(); else openSearch();
      return;
    }
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

  const settingsSearchInput = document.getElementById('settings-nav-search');
  const settingsSearchResults = document.getElementById('settings-search-results');
  const settingsSearchMatches = settingsSearchResults.querySelector('.settings-search-matches');
  const settingsSearchStatus = settingsSearchResults.querySelector('.settings-search-status');

  function normalizeSettingsSearch(text) {
    return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function showSettingsSearchTarget({ cat, target, action }) {
    switchSettingsCat(cat);
    if (action) {
      document.getElementById('shortcuts-search').value = '';
      renderShortcutsList();
      target = document.querySelector(`[data-shortcut-action="${CSS.escape(action)}"]`);
    }
    if (target && !target.getClientRects().length) {
      const fallback = {
        'set-custom-search-row': 'set-search-engine',
        'fontfamily-custom-row': 'set-fontpreset',
        'set-default-shell-row': 'set-default-path',
      }[target.id];
      target = fallback && document.getElementById(fallback)?.closest('[data-setting]');
    }
    const destination = target || settingsOverlay.querySelector('.settings-cat-btn.active');
    if (target) {
      target.tabIndex = -1;
      target.classList.add('settings-search-target');
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    destination?.focus({ preventScroll: true });
  }

  function renderSettingsSearch() {
    const rawQuery = settingsSearchInput.value.trim();
    const query = normalizeSettingsSearch(rawQuery);
    const terms = query ? query.split(' ') : [];
    const results = [];
    settingsSearchMatches.replaceChildren();

    function addResult(cat, category, label, keywords, destination) {
      if (!label) return;
      const name = normalizeSettingsSearch(label);
      const details = normalizeSettingsSearch(keywords);
      const context = normalizeSettingsSearch(category);
      if (!terms.length || !terms.every(term => name.includes(term) || details.includes(term) || context.includes(term))) return;
      if (destination && !terms.some(term => name.includes(term) || details.includes(term))) return;
      const score = (name === query ? 100 : name.includes(query) ? 20 : 0) +
        terms.reduce((total, term) => total + (name.includes(term) ? 4 : details.includes(term) ? 2 : 0), 0);
      results.push({ cat, category, label, score, ...destination });
    }

    for (const section of settingsOverlay.querySelectorAll('.settings-section[data-cat]')) {
      const cat = section.dataset.cat;
      const category = settingsOverlay.querySelector(`.settings-cat-btn[data-cat="${cat}"] span`).textContent.trim();
      if (!rawQuery) continue;
      addResult(cat, category, category, '', null);
      for (const target of section.querySelectorAll('[data-setting]')) {
        if (target.style.display === 'none') continue;
        const heading = target.querySelector('h3') || target.querySelector(':scope > .gap-1 > :first-child');
        const label = heading?.textContent.trim() || target.textContent.trim() || target.title;
        const options = [...target.querySelectorAll('option')].map(option => option.textContent).join(' ');
        addResult(cat, category, label, `${target.textContent} ${target.dataset.setting} ${options}`, { target });
      }
      if (cat === 'shortcuts') {
        for (const [action, shortcut] of Object.entries(customShortcuts)) {
          addResult(cat, category, SHORTCUT_LABELS[action] || action, formatKeyCombo(shortcut), { action });
        }
      }
    }

    settingsSearchResults.hidden = !rawQuery;
    settingsSearchStatus.textContent = !rawQuery ? '' : results.length
      ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
      : 'No settings found';
    results.sort((a, b) => b.score - a.score);
    for (const result of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-search-result';
      button.title = result.target || result.action ? `${result.label} (${result.category})` : result.label;
      const label = document.createElement('span');
      label.textContent = result.label;
      button.append(label);
      if (result.target || result.action) {
        const category = document.createElement('small');
        category.textContent = result.category;
        button.append(category);
      }
      button.addEventListener('click', () => showSettingsSearchTarget(result));
      settingsSearchMatches.append(button);
    }
    settingsSearchResults.scrollTop = 0;
  }

  settingsSearchInput.addEventListener('input', renderSettingsSearch);
  settingsSearchInput.addEventListener('keydown', e => {
    if (e.isComposing) return;
    const first = settingsSearchMatches.firstElementChild;
    if (e.key === 'Enter' && first) {
      e.preventDefault();
      first.click();
    } else if (e.key === 'ArrowDown' && first) {
      e.preventDefault();
      first.focus();
    } else if (e.key === 'Escape' && settingsSearchInput.value) {
      e.preventDefault();
      e.stopPropagation();
      settingsSearchInput.value = '';
      renderSettingsSearch();
    }
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

  // Settings-window bootstrap: skip the entire terminal/browser layer.
  async function settingsOnlyBoot() {
    await loadCustomThemes();
    await restoreSettingsOnly();
    await loadPlugins();
    applyTheme(currentThemeName);
    document.body.classList.add('settings-only');
    openSettings();
    document.getElementById('splash')?.classList.add('hide');
  }

  // Declare background controls before the settings-window bootstrap.
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

  // Open/close
  document.getElementById('btn-settings').addEventListener('click', () => openSettingsGlobal());
  const btnProfiles = document.getElementById('btn-profiles');
  if (btnProfiles) btnProfiles.addEventListener('click', openProfilePicker);
  // Native browser views sit above DOM overlays; hide them while the picker
  // is visible and restore them when it closes, including Escape and switching.
  const profilePickerObserver = new MutationObserver(() => syncBrowserSlots());
  profilePickerObserver.observe(document.getElementById('profile-picker'), { attributes: true, attributeFilter: ['style'] });

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
    const say=(icon,text,cls='')=>{notice.className='app-toast session-drop-feedback '+cls;notice.innerHTML=`<i class="ph ${icon}" aria-hidden="true"></i>`;const t=document.createElement('span');t.textContent=text;notice.append(t);};
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
        if (node.returnToShell === false) entry.keepOnExit = true;
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

  document.getElementById('set-default-shell').addEventListener('change', e => {
    defaultShell = e.target.value;
    window.electronAPI?.setDefaultShell?.(defaultShell);
    saveState();
  });

  document.getElementById('set-link-target').addEventListener('change', e => {
    terminalLinkTarget = e.target.value === 'external' ? 'external' : 'tab';
    saveState();
  });
  for (const [id, key] of [['set-thread-harness', 'harness'], ['set-thread-folder', 'folder'], ['set-thread-titles', 'titles'], ['set-thread-usage', 'usageDisplay'], ['set-thread-markdown', 'markdown'], ['set-thread-usernames', 'usernames']])
    document.getElementById(id).addEventListener('change', e => {
      threadSettings = { ...threadSettings, [key]: e.target.value };
      if (key === 'usernames') {
        document.body.classList.toggle('blur-work-usernames', threadSettings.usernames === 'blur');
        applyWorkUsernamePrivacy(document);
      }
      if (key === 'usageDisplay') { renderUsageSidebar(true); renderUsageModal(); }
      if (key === 'markdown') syncChatInputLinks();
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
  // Width shared by the left sidebar and #main (Split's sizes are percents of it).
  function sbPairWidth() {
    // #app also holds the right threads sidebar; Split.js measures only the pair.
    return document.getElementById('app').offsetWidth - (document.getElementById('threads-sidebar')?.offsetWidth || 0);
  }
  const SB_SPLIT_OPTS = {
    gutterSize: 4,
    snapOffset: 0,
    maxSize: [SB_MAX, Infinity],
    elementStyle(dimension, size, gutterSize) {
      return { 'flex-basis': `${Math.max(0, size / 100 * sbPairWidth() - gutterSize)}px` };
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
    const containerW = sbPairWidth();
    const initialPct = savedPx ? Math.max(5, (savedPx / containerW) * 100) : (expanded ? 15 : 0);

    sidebarSplit = Split([sb, main], {
      ...SB_SPLIT_OPTS,
      sizes: [initialPct, 100 - initialPct],
      minSize: expanded ? [SB_EXPANDED_MIN, 200] : [0, 200],
      onDragStart() {
        _suppressResize = true;
        // Split.js turns off pointer events on both sides, so :hover drops whenever the
        // cursor outruns the gutter (or passes min/max); keep the accent for the whole drag.
        sb.parentElement.querySelector(':scope > .gutter')?.classList.add('dragging');
        sb.style.willChange = 'flex-basis';
        main.style.willChange = 'flex-basis';
        sb.style.overflowY = 'hidden';
        startResizing();
      },
      onDragEnd(sizes) {
        _suppressResize = false;
        sb.parentElement.querySelector(':scope > .gutter')?.classList.remove('dragging');
        sb.style.willChange = '';
        main.style.willChange = '';
        sb.style.overflowY = '';
        // Remember the resized width so collapse/expand restores it
        if (sb.classList.contains('expanded')) {
          const containerW = sbPairWidth();
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

  // ── Sidebar display modes: 'normal' | 'hover' | 'hidden' ──
  let hoverPinned = false;   // expanded via toggle button while in hover mode
  let sbTempVisible = false; // temporarily shown via toggle button while in hidden mode

  function sbExpand() {
    const sb = document.getElementById('sidebar');
    sb.classList.add('expanded');
    const px = savedSidebarWidth || Math.max(sb.offsetWidth || 0, SB_EXPANDED_MIN);
    savedSidebarWidth = Math.max(px, SB_EXPANDED_MIN);
    const pct = Math.max(5, (savedSidebarWidth / sbPairWidth()) * 100);
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
    releaseTermFits();
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
    holdTermFits();
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
    if (isDesktop() && !SETTINGS_ONLY) {
      const tb = document.getElementById('titlebar');
      if (tb) tb.classList.add('active');
    }

    let restored = false;
    try {
      if (!SETTINGS_ONLY) {
        await profileGate();
      }
      await loadCustomThemes();
      restored = await restoreState();
      applyTheme(currentThemeName);
      applySidebarMode();
      applyWsProcsSetting();
    } catch (bootErr) {
      console.error('[BOOT-ERROR]', bootErr);
    }
    try {
      applyBackground();
      if (restored) {
        renderSidebar();
        renderPaneArea();
      }
      if (isDesktop()) connectNativePTY();
      else {
        // Build the initial pane while the socket connects so the splash never
        // hands off to an empty desktop.
        if (!workspaces.length) {
          for (const term of getWorkspaceTerminals(createWorkspace('Main'))) term.pending = true;
        }
        connectWS();
      }
    } catch (bootErr) {
      console.error('[BOOT-ERROR]', bootErr);
    } finally {
      document.getElementById('splash')?.classList.add('hide');
    }
    if (!SETTINGS_ONLY) loadPlugins(); // deferred, non-blocking

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

    if (!SETTINGS_ONLY && window.electronAPI?.onAgentRequest) {
      window.electronAPI.onAgentRequest(handleAgentRequest);
    } else if (!isDesktop() && !SETTINGS_ONLY) {
      agentBrowserReady = true;
      if (wsReady) ws.send(JSON.stringify({ type: 'agent:ready' }));
    }
  })(); // async boot
})();
