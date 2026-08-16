(function() {
  'use strict';

  // The settings UI can live in a separate Electron window (index.html?mode=settings)
  // so it renders above native browser views. In that window only the settings
  // page boots — the whole terminal/browser/sidebar layer is skipped.
  const SETTINGS_ONLY = new URLSearchParams(window.location.search).get('mode') === 'settings';
  const DETACHED_ONLY = new URLSearchParams(window.location.search).get('mode') === 'detached';
  const DETACHED_PARAMS = DETACHED_ONLY ? new URLSearchParams(window.location.search) : null;

  // App version — single source of truth, shared across the whole app
  const APP_VERSION = '0.5.10';

  // Configure Coloris — hex color picker
  Coloris({
    parent: '#settings-modal',
    themeMode: 'dark',
    theme: 'default',
    format: 'hex',
    alpha: true,
    wrap: true,
  });

  // Desktop bridge (Electron preload, exposed as window.electronAPI)
  function electronBridge() { return window.electronAPI || null; }
  function isDesktop() { return !!window.electronAPI; }


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
    multiSelect:    { ctrl: true, alt: true, key: 'Click', label: 'Ctrl+Alt+Click' },
    maximizeTab:    { ctrl: true, shift: true, key: 'M', label: 'Ctrl+Shift+M' },
    quitApp:        { ctrl: true, shift: true, key: 'Q', label: 'Ctrl+Shift+Q' },
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
    maximizeTab: 'Maximize / restore tab', quitApp: 'Quit application',
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

  function matchShortcutMouse(e, action) {
    const s = customShortcuts[action];
    if (!s) return false;
    return s.key === 'Click' && e.button === 0
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
      bg: '#2a2a2a', fg: '#cdd6f4', cursor: '#f5e0dc', selection: '#45475a',
      swatches: ['#2a2a2a','#cdd6f4','#f5e0dc'],
      palette: [
        '#2a2a2a','#f38ba8','#a6e3a1','#f9e2af',
        '#89b4fa','#f5c2e7','#94e2d5','#bac2de',
        '#585b70','#f38ba8','#a6e3a1','#f9e2af',
        '#89b4fa','#f5c2e7','#94e2d5','#a6adc8',
      ],
      ui: {
        accent: '#89b4fa',
        border: 'rgba(255,255,255,0.08)',
        tabActiveBg: 'rgba(255,255,255,0.07)',
        tabHoverBg: 'rgba(255,255,255,0.04)',
        dimText: 'rgba(255,255,255,0.3)',
        mutedText: 'rgba(255,255,255,0.5)',
      },
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
    } catch {}
  }

  async function saveCustomThemes(customs) {
    try {
      const api = configApi();
      if (api && api.configWriteCustomThemes) {
        await api.configWriteCustomThemes(customs);
      }
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customs));
    } catch {}
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

  function openExternalUrl(url) {
    if (isDesktop() && window.electronAPI) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  function doPaste(entry) {
    if (!entry || !entry.term) return;
    if (isDesktop() && window.electronAPI) {
      window.electronAPI.clipboardRead().then(text => {
        if (text) sendStdin(entry.id, new TextEncoder().encode(text));
      }).catch(err => console.warn('Paste failed:', err));
    } else {
      navigator.clipboard.readText().then(text => {
        if (text) sendStdin(entry.id, new TextEncoder().encode(text));
      }).catch(() => {});
    }
  }

  // Fallback paste handler for native Ctrl+V
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
  let cornerStyle = 'sharp'; // 'rounded' | 'sharp'
  let currentFontFamily = "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace";
  let customFonts = {}; // name -> { name, dataUrl, format }
  const PRESET_FONTS = [
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
  let currentLineHeight = 1.4;
  let currentCursorStyle = 'block';
  let currentCursorBlink = true;
  let currentScrollback = 10000;
  let backgroundMode = 'none';       // 'none' | 'per-tab' | 'global'
  let globalBackgroundImage = '';    // data URL for global bg
  let backgroundOpacity = 0.85;       // 0..1
  let settingsCategory = 'appearance'; // last-opened settings category (deep-link via openSettings(cat))
  let searchEngine = 'google';        // 'google' | 'duckduckgo' | 'brave' | 'bing' | 'yahoo' | 'startpage' | 'custom'
  let customSearchUrl = '';           // custom search URL with %s placeholder
  const SEARCH_ENGINES = {
    google:     'https://www.google.com/search?igu=1&q=%s',
    duckduckgo: 'https://duckduckgo.com/?q=%s',
    brave:      'https://search.brave.com/search?q=%s',
    startpage:  'https://www.startpage.com/do/search?q=%s',
  };
  const SEARCH_ENGINE_ICONS = {
    google:     'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z',
    duckduckgo: 'M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 .984C18.083.984 23.016 5.916 23.016 12S18.084 23.016 12 23.016.984 18.084.984 12C.984 5.917 5.916.984 12 .984zm0 .938C6.434 1.922 1.922 6.434 1.922 12c0 4.437 2.867 8.205 6.85 9.55-.237-.82-.776-2.753-1.6-6.052-1.184-4.741-2.064-8.606 2.379-9.813.047-.011.064-.064.03-.093-.514-.467-1.382-.548-2.233-.38a.06.06 0 0 1-.07-.058c0-.011 0-.023.011-.035.205-.286.572-.507.822-.64a1.843 1.843 0 0 0-.607-.335c-.059-.022-.059-.12-.006-.144.006-.006.012-.012.024-.012 1.749-.233 3.586.292 4.49 1.448.011.011.023.017.035.023 2.968.635 3.509 4.837 3.328 5.998a9.607 9.607 0 0 0 2.346-.576c.746-.286 1.008-.222 1.101-.053.1.193-.018.513-.28.81-.496.567-1.393 1.01-2.974 1.137-.546.044-1.029.024-1.445.006-.789-.035-1.339-.059-1.633.39-.192.298-.041.998 1.487 1.22 1.09.157 2.078.047 2.798-.034.643-.07 1.073-.118 1.172.069.21.402-.996 1.207-3.066 1.224-.158 0-.315-.006-.467-.011-1.283-.065-2.227-.414-2.816-.735a.094.094 0 0 1-.035-.017c-.105-.059-.31.045-.188.267.07.134.444.478 1.004.776-.058.466.087 1.184.338 2l.088-.016c.041-.009.087-.019.134-.025.507-.082.775.012.926.175.717-.536 1.913-1.294 2.03-1.154.583.694.66 2.332.53 2.99-.004.012-.017.024-.04.035-.274.117-1.783-.296-1.783-.511-.059-1.075-.26-1.173-.493-1.225h-.156c.006.006.012.018.018.03l.052.12c.093.257.24 1.063.13 1.26-.112.199-.835.297-1.284.303-.443.006-.543-.158-.637-.408-.07-.204-.103-.675-.103-.95a.857.857 0 0 1 .012-.216c-.134.058-.333.193-.397.281-.017.262-.017.682.123 1.149.07.221-1.518 1.164-1.74.99-.227-.181-.634-1.952-.459-2.67-.187.017-.338.075-.42.191-.367.508.093 2.933.582 3.248.257.169 1.54-.553 2.176-1.095.105.145.305.158.553.158.326-.012.782-.06 1.103-.158.192.45.423.972.613 1.388 4.47-1.032 7.803-5.037 7.803-9.82 0-5.566-4.512-10.078-10.078-10.078zm1.791 5.646c-.42 0-.678.146-.795.332-.023.047.047.094.094.07.14-.075.357-.161.701-.156.328.006.516.09.67.159l.023.01c.041.017.088-.03.059-.065-.134-.18-.332-.35-.752-.35zm-5.078.198a1.24 1.24 0 0 0-.522.082c-.454.169-.67.526-.67.76 0 .051.112.057.141.011.081-.123.21-.31.617-.478.408-.17.73-.146.951-.094.047.012.083-.041.041-.07a.989.989 0 0 0-.558-.211zm5.434 1.423a.651.651 0 0 0-.655.647.652.652 0 0 0 1.307 0 .646.646 0 0 0-.652-.647zm.283.262h.008a.17.17 0 0 1 .17.17c0 .093-.077.17-.17.17a.17.17 0 0 1-.17-.17c0-.09.072-.165.162-.17zm-5.358.076a.752.752 0 0 0-.758.758c0 .42.338.758.758.758s.758-.337.758-.758a.756.756 0 0 0-.758-.758zm.328.303h.01c.112 0 .2.089.2.2 0 .11-.088.197-.2.197a.195.195 0 0 1-.197-.198c0-.107.082-.194.187-.199z',
    brave:      'M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z',
    startpage:  'm16.885 14.254.04-.06a8.723 8.723 0 0 0 1.851-4.309c-1.334 0-2.648 0-3.982.04a4.901 4.901 0 0 1-4.758 3.696 4.948 4.948 0 0 1-4.56-3.044 89.632 89.632 0 0 0-3.941.514c1.035 3.697 4.46 6.405 8.501 6.405a8.76 8.76 0 0 0 3.743-.83l.06-.02.04.04 5.455 6.603c.378.454.916.711 1.513.711.458 0 .896-.158 1.234-.435.399-.336.657-.79.697-1.304.04-.514-.1-1.009-.438-1.424zM5.118 8.56c.1-2.59 2.27-4.685 4.918-4.685a4.911 4.911 0 0 1 4.898 4.389c1.314.02 2.608.04 3.922.099C18.616 3.717 14.754 0 10.036 0c-4.858 0-8.82 3.934-8.82 8.758v.178a86.7 86.7 0 0 1 3.902-.376z',
  };

  let workspaces = [];       // [{id, label, activeTermId, layout: (Node), folderId?}]
  let folders = [];          // [{id, label, color?, collapsed?}]  — workspace folders/groups
  let sideOrder = [];        // top-level sidebar flow: [{type:'ws'|'folder', id}] in visual order
  let pinnedCollapsed = false; // "Pinned" section collapsed state
  let sidebarMode = 'normal'; // 'normal' | 'hover' | 'hidden'
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

  let ws = null;             // WebSocket
  let wsReady = false;
  let nativePtyReady = false; // native PTY backend ready (Electron main process)

  let _browserSyncRaf = null;
  const browserEventHooks = new Map(); // browser tab id -> handler(listener payload)
  if (isDesktop() && window.electronAPI) {
    window.electronAPI.onBrowserEvent(d => browserEventHooks.get(d && d.id)?.(d));
  }
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

    // A full-screen settings layer is up (either the separate Electron window or
    // the in-window overlay fallback). Native views paint above the window's DOM,
    // so detach them all (alive, not destroyed) on every sync — they must never
    // re-raise above the settings layer.
    const overlayOpen = settingsWindowOpen ||
      (document.getElementById('settings-overlay')?.classList.contains('open') === true);
    if (overlayOpen) {
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
                const r = cw.getBoundingClientRect();
                viewUpdates.push({ id: t.id, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, show: true });
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
          window.electronAPI.browserResize(v.id, v.rect);
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
    const wsHost = window.location.hostname || '127.0.0.1';
    ws = new WebSocket(`ws://${wsHost}:${WS_PORT}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      wsReady = true;

      if (workspaces.length) {
        for (const ws of workspaces) {
          const terms = getWorkspaceTerminals(ws);
          for (const t of terms) {
            if (t.pending) {
              const slot = getSlotDimensions(t);
              sendControl({ type: 'create', id: t.id, cols: slot.cols, rows: slot.rows, cwd: t.cwd || null });
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
        if (result) {
          const oscCwd = _extractOSC7Cwd(data);
          if (oscCwd) result.term.cwd = oscCwd;
          result.term.term.write(data);
        }
      } else {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'ready') {
            if (msg.port) { WS_PORT = msg.port; }
          } else if (msg.type === 'exit') handleExit(msg.id, msg.code);
          else if (msg.type === 'error') handleError(msg.id, msg.msg);
          else if (msg.type === 'pong') {}
        } catch {}
      }
    };

    ws.onclose = () => {
      wsReady = false;
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
      } catch {}
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
      } catch {}
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
    if (isDesktop() && window.electronAPI && nativePtyReady) {
      const api = window.electronAPI;
      if (obj.type === 'create') api.terminalCreate({ id: obj.id, cols: obj.cols, rows: obj.rows, cwd: obj.cwd || null });
      else if (obj.type === 'resize') api.terminalResize({ id: obj.id, cols: obj.cols, rows: obj.rows });
      else if (obj.type === 'close') api.terminalClose(obj.id);
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(obj));
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
    _sendStdinRaw(sid, data);
    if (_multiSelected.size > 1) {
      for (const otherId of _multiSelected) {
        if (otherId !== sid) _sendStdinRaw(otherId, data);
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
          } catch {}
          if (api.tabDragReady) api.tabDragReady(ready);
        });
      }
      // The main process broadcasts which detached terminal is being dragged —
      // drag data set in another window's renderer is unreadable here, so this
      // id is how the main window recognizes the cross-window drop.
      if (api.onTabDragActive) {
        api.onTabDragActive(({ id }) => {
          window.externalDragTermId = id || null;
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
            sendControl({ type: 'create', id: t.id, cols: slot.cols, rows: slot.rows, cwd: t.cwd || null });
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
  function applyCornerStyle() {
    document.body.classList.toggle('roundless', cornerStyle === 'sharp');
  }

  function applySidebarMode() {
    document.body.classList.toggle('sb-hidden', sidebarMode === 'hidden');
    if (window.__sidebarCtl) window.__sidebarCtl.apply(sidebarMode);
  }

  function applyTheme(name) {
    const theme = THEMES[name];
    if (!theme) return;
    currentThemeName = name;
    currentTheme = theme;

    applyCornerStyle();

    document.documentElement.style.setProperty('--app-font', currentFontFamily);

    const r = document.documentElement.style;
    r.setProperty('--bg', theme.bg);
    r.setProperty('--fg', theme.fg);
    r.setProperty('--cursor', theme.cursor);
    r.setProperty('--selection', theme.selection);
    const accent = (theme.ui && theme.ui.accent) || theme.palette[4] || theme.palette[12] || theme.fg;
    r.setProperty('--accent', accent);
    r.setProperty('--ws-active-strip', accent);
    r.setProperty('--accent-dim', hexToRgba(accent, 0.15));
    const multiColor = (theme.ui && theme.ui.multiSelect) || theme.palette[3] || '#f9e2af';
    r.setProperty('--multi-select', multiColor);

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
        if (t.type !== 'browser') {
          t._bgTransparent = termHasBgImage(t);
          t.term.options.theme = makeXtermTheme(theme, t._bgTransparent);
        }
      }
    }

    renderSidebar();
    renderPaneArea();
    applyBackground();
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
   B A*CKGROUND IMAGE & OPACITY
   ═══════════════════════════════════════════════════════════════ */
  /* The opacity slider is "terminal background opacity": 100% = fully solid
     terminal, 0% = image fully visible. The image layer therefore renders at
     the complement, on top of the solid theme colour that fills the panel. */
  function bgImageAlpha() {
    return Math.max(0, Math.min(1, 1 - backgroundOpacity));
  }

  function cssUrl(dataUrl) {
    return 'url("' + String(dataUrl).replace(/["\\]/g, '\\$&') + '")';
  }

  /* Is an image showing behind this terminal, in either mode? */
  function termHasBgImage(entry) {
    if (!entry || entry.type === 'browser') return false;
    if (backgroundMode === 'global') return !!globalBackgroundImage;
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

    // Per-tab mode: each panel carries its own image layer.
    for (const wsp of workspaces) {
      const terms = getWorkspaceTerminals(wsp);
      for (const t of terms) {
        applyTermBgImage(t);
      }
    }
  }

  function applyTermBgImage(entry) {
    if (!entry || !entry.el) return;
    const slot = entry.el;

    // Browser tabs render their own opaque content — no background layer.
    const usePerTab = entry.type !== 'browser' && backgroundMode === 'per-tab' && !!entry.bgImage;

    slot.style.backgroundImage = '';   // legacy inline image, layers handle it now
    slot.classList.toggle('has-bg-image', usePerTab);
    slot.style.setProperty('--tv-bg-image', usePerTab ? cssUrl(entry.bgImage) : 'none');
    slot.style.setProperty('--tv-bg-image-opacity', usePerTab ? String(bgImageAlpha()) : '0');

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

  function loadBgImageFromFile(file, callback) {
    if (!file) { callback(''); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      callback(e.target.result);
    };
    reader.onerror = () => { callback(''); };
    reader.readAsDataURL(file);
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
  const STATE_KEY = 'ghostterm-state-v2';
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
          else if (t.cwd) o.cwd = t.cwd;
          if (t.bgImage) o.bgImage = t.bgImage;
          if (t.dead) o.dead = true;
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
        if (tData.cwd) entry.cwd = tData.cwd;
        if (tData.bgImage) entry.bgImage = tData.bgImage;
        if (tData.dead) entry.dead = true;
        group.terminals.push(entry);
      }
      return group;
    }
  }

  function saveState() {
    // In the settings window we must NOT clobber the main window's live
    // workspaces/folders/sideOrder. Only merge the settings fields into the
    // shared state and ping the main window to re-apply them.
    if (SETTINGS_ONLY) {
      const settings = {
        theme: currentThemeName,
        fontSize: currentFontSize,
        fontFamily: currentFontFamily,
        customFonts,
        lineHeight: currentLineHeight,
        cornerStyle,
        cursorStyle: currentCursorStyle,
        cursorBlink: currentCursorBlink,
        scrollback: currentScrollback,
      settingsCategory,
      pinnedCollapsed,
      sidebarMode,
      backgroundMode,
      globalBackgroundImage,
        backgroundOpacity,
        shortcuts: customShortcuts,
        searchEngine,
        customSearchUrl,
      };
      try {
        const state = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        Object.assign(state, settings);
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
        const api = configApi();
        if (api && api.configWriteState) api.configWriteState(state);
      } catch {}
      if (window.electronAPI && window.electronAPI.settingsChanged) window.electronAPI.settingsChanged();
      return;
    }

    const key = DETACHED_ONLY ? DETACHED_STATE_KEY : STATE_KEY;
    const state = {
      theme: currentThemeName,
      fontSize: currentFontSize,
      fontFamily: currentFontFamily,
      customFonts,
      lineHeight: currentLineHeight,
      cornerStyle,
      cursorStyle: currentCursorStyle,
      cursorBlink: currentCursorBlink,
      scrollback: currentScrollback,
      settingsCategory,
      pinnedCollapsed,
      sidebarMode,
      backgroundMode,
      globalBackgroundImage,
      backgroundOpacity,
      searchEngine,
      customSearchUrl,
      sidebarExpanded: document.getElementById('sidebar').classList.contains('expanded'),
  sidebarWidth: document.getElementById('sidebar').offsetWidth || null,
  shortcuts: customShortcuts,
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
     if (ws.folderId) o.folderId = ws.folderId;
     if (ws.pinned) o.pinned = true;
     return o;
   }),
    };
    try {
      localStorage.setItem(key, JSON.stringify(state));
      if (!DETACHED_ONLY) {
        const api = configApi();
        if (api && api.configWriteState) api.configWriteState(state);
      }
    } catch {}
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

      if (state.theme && THEMES[state.theme]) {
        currentThemeName = state.theme;
        currentTheme = THEMES[currentThemeName];
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
      if (state.cornerStyle) cornerStyle = state.cornerStyle;
      if (state.cursorStyle) currentCursorStyle = state.cursorStyle;
      if (state.cursorBlink !== undefined) currentCursorBlink = state.cursorBlink;
      if (state.scrollback) currentScrollback = state.scrollback;
      if (typeof state.settingsCategory === 'string') settingsCategory = state.settingsCategory;
      if (state.pinnedCollapsed !== undefined) pinnedCollapsed = !!state.pinnedCollapsed;
      if (state.sidebarMode) sidebarMode = state.sidebarMode;
      if (state.backgroundMode) backgroundMode = state.backgroundMode;
      if (state.globalBackgroundImage) globalBackgroundImage = state.globalBackgroundImage;
      if (state.backgroundOpacity !== undefined) backgroundOpacity = state.backgroundOpacity;
      if (state.searchEngine) searchEngine = state.searchEngine;
      if (state.customSearchUrl) customSearchUrl = state.customSearchUrl;
      if (state.shortcuts) {
        for (const [k, v] of Object.entries(state.shortcuts)) {
          if (customShortcuts[k]) customShortcuts[k] = v;
        }
      }

      if (!state.workspaces?.length) return false;
      if (state.sidebarExpanded) document.getElementById('sidebar').classList.add('expanded');
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
        if (wsData.folderId) ws.folderId = wsData.folderId;
        if (wsData.pinned) ws.pinned = true;

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
   W O*RKSPACE MANAGEMENT
   ═══════════════════════════════════════════════════════════════ */
  let wsCount = 0;

  function createWorkspace(label, folderId) {
    wsCount++;
    const id = uuid();
    const ws = { id, label: label || ('Workspace ' + (workspaces.length + 1)), layout: null, activeTermId: null, folderId: folderId || undefined };
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

    // Let layout settle before measuring: reading rects in the same tick as
    // display:block (or inside a fixed 30ms timeout) can capture a size from
    // before the flex tree settles, making .browser-slot short. Double-RAF runs
    // after the next paint; a late re-sync self-corrects any transient size.
    requestAnimationFrame(() => requestAnimationFrame(() => {
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
      syncBrowserSlots();
    }));
    setTimeout(() => syncBrowserSlots(), 120);
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

  const _closingWs = new Set();

  function removeWorkspace(id) {
    const ws = findWs(id);
    if (!ws || _closingWs.has(id)) return;
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
      if (workspaces.length) { activateWorkspace(workspaces[Math.max(0, idx-1)].id); renderSidebar(); }
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

    showPrompt('Edit workspace', ws.label, { color: ws.color || '' }, (value, color) => {
      ws.label = value.trim() || ws.label;
      ws.color = color || undefined;
      renderSidebar();
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
        t.label = shortTitle(title) || t.label;
        // Lightweight update: just change the tab label in the DOM
        const tabEl = document.querySelector(`.tg-tab[data-termid="${id}"] .tg-tab-name`);
        if (tabEl) tabEl.textContent = t.label;
        const tabWrap = document.querySelector(`.tg-tab[data-termid="${id}"]`);
        if (tabWrap) tabWrap.title = t.label;
        renderSidebar();
      }
    });

    const entry = { id, label, term, fit: fitAddon, search: searchAddon, el: null, opened: false, _bgTransparent: false };
    return entry;
  }

  function addTerminal(wsId, targetGroupId) {
    const wsp = findWs(wsId || activeWsId);
    if (!wsp) return;

    const cwd = _getFocusedCwd();
    const id = uuid();
    const allTerms = getWorkspaceTerminals(wsp);
    const label = activeTerminal()?.label || `bash ${allTerms.length + 1}`;
    const entry = _createTermEntry(wsp, id, label);
    entry.cwd = cwd;

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
            tab.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(); if (window.electronAPI && window.electronAPI.tabDragStart) window.electronAPI.tabDragStart({ id: entry.id, cols: entry.term ? entry.term.cols : 80, rows: entry.term ? entry.term.rows : 24, cwd: entry.cwd, label: entry.label }); });
            tab.addEventListener('dragend', e => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); if (!DETACHED_ONLY && entry.term && (!e.dataTransfer || e.dataTransfer.dropEffect === 'none')) detachTerminal(wsp.id, entry.id); if (!DETACHED_ONLY && window.electronAPI && window.electronAPI.tabDragEnd) window.electronAPI.tabDragEnd({ id: entry.id, cancelled: true }); });
            tab.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-left' : 'drop-right'); });
            tab.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !tab.contains(e.relatedTarget)) { tab.classList.remove('drop-left', 'drop-right'); } });
            tab.addEventListener('drop', e => { e.preventDefault(); const draggedId = window.draggedTermId || window.externalDragTermId || e.dataTransfer.getData('text/plain'); if (!window.draggedTermId && draggedId && !findGroupContainingTerm(wsp.layout, draggedId)) { const api = window.electronAPI; if (api && api.tabDragDrop) { const r = tab.getBoundingClientRect(); api.tabDragDrop({ id: draggedId, targetGroupId: targetGroup.id, zone: 'center', beforeTabId: e.clientX < r.left + r.width / 2 ? entry.id : null }); } window.externalDragTermId = null; return; } if (draggedId && draggedId !== entry.id) { const fromIdx = targetGroup.terminals.findIndex(x => x.id === draggedId); let toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); if (fromIdx !== -1 && toIdx !== -1) { const [moved] = targetGroup.terminals.splice(fromIdx, 1); toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); const insertIdx = e.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2 ? toIdx : toIdx + 1; targetGroup.terminals.splice(insertIdx, 0, moved); targetGroup.activeTermId = draggedId; } renderPaneArea(); activateTerminal(wsp.id, draggedId); } tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); });
            tabsContainer.appendChild(tab);
            updateTabBarOverflow(groupEl);
            scrollTabIntoView(groupEl, entry.id);
            // Create and add the slot
            const slot = getOrCreateSlot(entry, wsp, body);
            document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
            body.querySelectorAll('.term-slot').forEach(s => { s.style.display = 'none'; });
            slot.style.display = entry.type === 'browser' ? 'flex' : 'block';
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
      sendControl({ type: 'create', id, cols: slot.cols, rows: slot.rows, cwd });
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
            tab.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', entry.id); tab.classList.add('dragging'); window.draggedTermId = entry.id; window.dragSourceGroupId = targetGroup.id; startResizing(); if (window.electronAPI && window.electronAPI.tabDragStart) window.electronAPI.tabDragStart({ id: entry.id, cols: entry.term ? entry.term.cols : 80, rows: entry.term ? entry.term.rows : 24, cwd: entry.cwd, label: entry.label }); });
            tab.addEventListener('dragend', e => { tab.classList.remove('dragging'); window.draggedTermId = null; window.dragSourceGroupId = null; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); stopResizing(); if (!DETACHED_ONLY && entry.term && (!e.dataTransfer || e.dataTransfer.dropEffect === 'none')) detachTerminal(wsp.id, entry.id); if (!DETACHED_ONLY && window.electronAPI && window.electronAPI.tabDragEnd) window.electronAPI.tabDragEnd({ id: entry.id, cancelled: true }); });
            tab.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-left' : 'drop-right'); });
            tab.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !tab.contains(e.relatedTarget)) { tab.classList.remove('drop-left', 'drop-right'); } });
            tab.addEventListener('drop', e => { e.preventDefault(); const draggedId = window.draggedTermId || window.externalDragTermId || e.dataTransfer.getData('text/plain'); if (!window.draggedTermId && draggedId && !findGroupContainingTerm(wsp.layout, draggedId)) { const api = window.electronAPI; if (api && api.tabDragDrop) { const r = tab.getBoundingClientRect(); api.tabDragDrop({ id: draggedId, targetGroupId: targetGroup.id, zone: 'center', beforeTabId: e.clientX < r.left + r.width / 2 ? entry.id : null }); } window.externalDragTermId = null; return; } if (draggedId && draggedId !== entry.id) { const fromIdx = targetGroup.terminals.findIndex(x => x.id === draggedId); let toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); if (fromIdx !== -1 && toIdx !== -1) { const [moved] = targetGroup.terminals.splice(fromIdx, 1); toIdx = targetGroup.terminals.findIndex(x => x.id === entry.id); const insertIdx = e.clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2 ? toIdx : toIdx + 1; targetGroup.terminals.splice(insertIdx, 0, moved); targetGroup.activeTermId = draggedId; } renderPaneArea(); activateTerminal(wsp.id, draggedId); } tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => el.classList.remove('drop-left', 'drop-right')); });
            tabsContainer.appendChild(tab);
            updateTabBarOverflow(groupEl);
            scrollTabIntoView(groupEl, entry.id);
            // Create slot
            const slot = getOrCreateSlot(entry, wsp, body);
            document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
            body.querySelectorAll('.term-slot').forEach(s => { s.style.display = 'none'; });
            slot.style.display = 'flex';
            slot.classList.add('focused');
            body.appendChild(slot);
            focusedSlotId = slot.id; updateFocusedGroup();
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
            if (t.type === 'browser') {
              if (isActive) resumeBrowserTab(t);
              else suspendBrowserTab(t);
            }
          });
        }
      }
      const terms = getWorkspaceTerminals(wsp);
      const t = terms.find(x => x.id === termId);
      if (t && t.el) {
        focusedSlotId = t.el.id; updateFocusedGroup();
        t.el.classList.add('focused');
        if (t.type === 'browser') {
          // handled after syncBrowserSlots positions the container
        } else {
          setTimeout(() => { t.term.focus(); fitTerm(t); }, 20);
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
    } catch {}

    window.electronAPI.terminalDetach({ id: termId, cols: slot.cols, rows: slot.rows, cwd }).then(ok => {
      if (!ok) { try { localStorage.removeItem(DETACH_BUFFER_KEY(termId)); } catch {} return; }
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
    } catch {}
  }

  // Reverse of detachTerminal: the detached window was closed by dragging its
  // tab over this window; re-create the tab here attached to the SAME PTY
  // (no terminal:create — that would kill the session and spawn a new shell).
  // `placement` ({ targetGroupId, zone }) drops it into a specific group,
  // splitting the pane like a normal tab drag-and-drop.
  function reattachTerminal(termId, cols, rows, cwd, placement) {
    let wsp = workspaces.find(w => w.id === activeWsId) || workspaces[0];
    if (!wsp) {
      // All workspaces were closed while the tab was detached — make a fresh
      // one manually (createWorkspace would spawn a new terminal/PTY).
      wsp = { id: uuid(), label: 'Workspace 1', layout: null, activeTermId: null };
      workspaces.push(wsp);
      sideOrder.push({ type: 'ws', id: wsp.id });
      activeWsId = wsp.id;
      const empty = document.getElementById('empty-state');
      if (empty) empty.style.display = 'none';
    }

    // Read the stashed buffer first so the tab can keep its name; the PTY is
    // re-attached, the content replayed from this snapshot.
    let stash = null;
    try {
      const raw = localStorage.getItem(DETACH_BUFFER_KEY(termId));
      localStorage.removeItem(DETACH_BUFFER_KEY(termId));
      if (raw) stash = JSON.parse(raw);
    } catch {}

    const entry = _createTermEntry(wsp, termId, (stash && stash.label) || 'terminal');
    entry.cwd = cwd;

    if (!wsp.layout) {
      wsp.layout = { type: 'group', id: 'group-' + uuid(), terminals: [entry], activeTermId: termId };
    } else {
      const targetGroup = (placement && placement.targetGroupId && findGroupById(wsp.layout, placement.targetGroupId))
        || (activeTerminal() && findGroupContainingTerm(wsp.layout, activeTerminal().id))
        || findFirstGroup(wsp.layout);
      if (!targetGroup) return;
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
    wsp.activeTermId = termId;

    if (placement && placement.zone && placement.zone !== 'center' && findGroupById(wsp.layout, placement.targetGroupId)) {
      // Split placement: route through the normal drop handler so the same
      // guards (maximized, min size) and split logic apply.
      handleTerminalDrop(termId, placement.targetGroupId, placement.zone, wsp);
    } else {
      renderPaneArea();
      activateTerminal(wsp.id, termId);
    }

    // Open at the size the PTY is running at so replayed lines don't wrap,
    // replay the stashed screen/scrollback, then announce the attach so main
    // flushes output buffered while the detached window was closing.
    try { entry.term.resize(cols || 80, rows || 24); } catch {}
    if (stash) { try { restoreTermBuffer(entry, stash); } catch {} }
    if (window.electronAPI && window.electronAPI.terminalAttached) {
      window.electronAPI.terminalAttached(termId);
    }

    // Fit to the new layout, then sync the PTY to the fitted size.
    setTimeout(() => {
      try {
        fitTerm(entry);
        if (entry.term && window.electronAPI && window.electronAPI.terminalResize) {
          window.electronAPI.terminalResize({ id: termId, cols: entry.term.cols, rows: entry.term.rows });
        }
      } catch {}
      try { entry.term && entry.term.focus(); } catch {}
    }, 80);

    renderSidebar();
    saveState();
  }

  const _processCheckPending = new Set(); // termIds with an in-flight running-process check

  function removeTerminal(wsId, termId, skipRender, skipPtyClose, confirmed, checked) {
    const wsp = findWs(wsId);
    if (!wsp || !wsp.layout) return;
    if (_multiSelected.has(termId)) { _multiSelected.delete(termId); document.getElementById('slot-' + termId)?.classList.remove('multi-selected'); }

    // Confirm before closing a tab that has a process running inside it
    // (something other than the idle shell). Skipped for dead terminals,
    // browser tabs, detaches and internal teardowns.
    if (!confirmed && !checked && !skipRender && !skipPtyClose) {
      const entry = getWorkspaceTerminals(wsp).find(t => t.id === termId);
      if (isLiveTerminal(entry)) {
        if (_processCheckPending.has(termId)) return;
        _processCheckPending.add(termId);
        checkTerminalRunning(termId).then(running => {
          _processCheckPending.delete(termId);
          if (running) {
            const closesWorkspace = getWorkspaceTerminals(wsp).length <= 1;
            showCloseConfirm(entry.label, closesWorkspace,
              () => removeTerminal(wsId, termId, skipRender, skipPtyClose, true, true),
              () => {});
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
      if (_closingWs.has(wsId)) return;
      if (confirmed) { _removeWorkspace(wsId); return; }
      _closingWs.add(wsId);
      const label = wsp.label;
      showConfirm(`Close "${label}"?`,
        () => { try { _removeWorkspace(wsId); } finally { _closingWs.delete(wsId); } },
        () => _closingWs.delete(wsId));
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
      if (!skipPtyClose) {
        sendControl({ type: 'close', id: termId });
        try { if (entry.term) entry.term.dispose(); } catch {}
      }
    } else {
      if (entry._msgCleanup) entry._msgCleanup();
      if (entry._resizeObs) { entry._resizeObs.disconnect(); entry._resizeObs = null; }
      if (entry._suspendTimer) { clearTimeout(entry._suspendTimer); entry._suspendTimer = null; }
      if (entry.browserContainer) { entry.browserContainer.remove(); entry.browserContainer = null; }
      if (entry._viewCreated && window.electronAPI) { window.electronAPI.browserDestroy(entry.id); browserEventHooks.delete(entry.id); }
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
          updateTabBarOverflow(groupEl);
          if (group.activeTermId) scrollTabIntoView(groupEl, group.activeTermId);
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
        syncBrowserSlots();
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
    }
    renderSidebar();
    saveState();

    // If this was the last terminal (detach case), remove the now-empty workspace
    if (skipPtyClose && getWorkspaceTerminals(wsp).length === 0) {
      _removeWorkspace(wsId);
    }
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
      saveState();
    });
  }

  function handleExit(id, code) {
    const result = findTermById(id);
    if (!result) return;
    const { ws, term: t } = result;
    t.dead = true;
    if (getWorkspaceTerminals(ws).length <= 1) {
      if (DETACHED_ONLY) {
        window.close();
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

  function fitTerm(entry) {
    if (!entry || !entry.el || entry.type === 'browser') return;
    if (entry.dead) return;
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

    } catch {}
  }

  /* ═══════════════════════════════════════════════════════════════
   S P*LIT MANAGEMENT (VS Code recursive logic)
═══════════════════════════════════════════════════════════════ */

  function splitGroupDirectly(wsId, groupId, direction) {
    const wsp = findWs(wsId);
    if (!wsp || !wsp.layout) return;

    const cwd = _getFocusedCwd();

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
    const label = activeTerminal()?.label || `bash ${allTerms.length + 1}`;
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
      sendControl({ type: 'create', id, cols: slot.cols, rows: slot.rows, cwd });
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
      tabsContainer.addEventListener('scroll', () => updateTabBarOverflow(groupEl));

      // Container-level drop handling for gaps between tabs and edges
      tabsContainer.addEventListener('dragover', (e) => {
        if (!window.draggedTermId) {
          // Cross-window drag (tab from a detached window): accept it.
          if (e.target !== tabsContainer) return;
          if (!window.externalDragTermId && !e.dataTransfer.types.includes('text/plain')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          return;
        }
        if (e.target !== tabsContainer) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const tabs = Array.from(tabsContainer.querySelectorAll('.tg-tab'))
          .filter(el => !el.classList.contains('dragging'));
        if (!tabs.length) return;
        let closest = tabs[0];
        let bestDist = Infinity;
        const cx = e.clientX;
        for (const t of tabs) {
          const r = t.getBoundingClientRect();
          const dist = Math.abs(cx - (r.left + r.width / 2));
          if (dist < bestDist) { bestDist = dist; closest = t; }
        }
        tabs.forEach(t => t.classList.remove('drop-left', 'drop-right'));
        const r = closest.getBoundingClientRect();
        if (cx < r.left + r.width / 2) {
          closest.classList.add('drop-left');
        } else {
          closest.classList.add('drop-right');
        }
      });
      tabsContainer.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !tabsContainer.contains(e.relatedTarget)) {
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
            el.classList.remove('drop-left', 'drop-right');
          });
        }
      });
      tabsContainer.addEventListener('drop', (e) => {
        // Cross-window drag (tab from a detached window): attach into this group.
        if (!window.draggedTermId) {
          if (e.target !== tabsContainer) return;
          e.preventDefault();
          e.stopPropagation();
          const extId = window.externalDragTermId || e.dataTransfer.getData('text/plain');
          if (extId && !findGroupContainingTerm(wsp.layout, extId)) {
            const api = window.electronAPI;
            if (api && api.tabDragDrop) {
              api.tabDragDrop({ id: extId, targetGroupId: node.id, zone: 'center' });
            }
          }
          window.externalDragTermId = null;
          return;
        }
        if (e.target !== tabsContainer) return;
        e.preventDefault();
        e.stopPropagation();
        const tabs = Array.from(tabsContainer.querySelectorAll('.tg-tab'))
          .filter(el => !el.classList.contains('dragging'));
        if (!tabs.length) return;
        let closest = tabs[0];
        let bestDist = Infinity;
        const cx = e.clientX;
        for (const t of tabs) {
          const r = t.getBoundingClientRect();
          const dist = Math.abs(cx - (r.left + r.width / 2));
          if (dist < bestDist) { bestDist = dist; closest = t; }
        }
        const draggedId = window.draggedTermId;
        const targetTermId = closest.dataset.termid;
        const r = closest.getBoundingClientRect();
        const insertBefore = cx < r.left + r.width / 2;
        tabs.forEach(t => t.classList.remove('drop-left', 'drop-right'));
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
      });

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
          // Announce the drag to the main process so every OTHER window can
          // recognize this tab if it's dropped there (drag data is unreadable
          // across renderers).
          if (window.electronAPI && window.electronAPI.tabDragStart) {
            window.electronAPI.tabDragStart({ id: t.id, cols: t.term ? t.term.cols : 80, rows: t.term ? t.term.rows : 24, cwd: t.cwd, label: t.label });
          }
        });
        tab.addEventListener('dragend', e => {
          tab.classList.remove('dragging');
          tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
            el.classList.remove('drop-left', 'drop-right');
          });
          stopResizing();
          // Main window: releasing a terminal tab where no tab bar accepted
          // the drop (dropEffect 'none' — i.e. outside the app, or away from
          // any drop target) detaches it into its own window.
          if (!DETACHED_ONLY && t.type !== 'browser' && t.term
              && (!e.dataTransfer || e.dataTransfer.dropEffect === 'none')) {
            detachTerminal(wsp.id, t.id);
          }
          if (!DETACHED_ONLY && window.electronAPI && window.electronAPI.tabDragEnd) {
            // Ends the active-drag broadcast. The detach above (if any) is an
            // independent flow; this message is cancelled so main won't move
            // the terminal a second time.
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
            } catch {}
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
          if (!window.draggedTermId) {
            // Cross-window drag (tab from a detached window): accept the drop
            // and show the insertion hint using the broadcast drag id.
            if (!window.externalDragTermId && !e.dataTransfer.types.includes('text/plain')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (window.externalDragTermId) {
              tabsContainer.querySelectorAll('.drop-left, .drop-right').forEach(el => {
                el.classList.remove('drop-left', 'drop-right');
              });
              const rect = tab.getBoundingClientRect();
              tab.classList.add(e.clientX < rect.left + rect.width / 2 ? 'drop-left' : 'drop-right');
            }
            return;
          }
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
        tab.addEventListener('dragleave', (e) => {
          if (!e.relatedTarget || !tab.contains(e.relatedTarget)) {
            tab.classList.remove('drop-left', 'drop-right');
          }
        });
        tab.addEventListener('drop', e => {
          e.preventDefault();
          e.stopPropagation();
          // Cross-window drag (tab from a detached window): attach it into
          // this group, at the release position relative to this tab.
          if (!window.draggedTermId) {
            const extId = window.externalDragTermId || e.dataTransfer.getData('text/plain');
            if (extId && !findGroupContainingTerm(wsp.layout, extId)) {
              const api = window.electronAPI;
              if (api && api.tabDragDrop) {
                const rect0 = tab.getBoundingClientRect();
                api.tabDragDrop({
                  id: extId, targetGroupId: node.id, zone: 'center',
                  beforeTabId: e.clientX < rect0.left + rect0.width / 2 ? t.id : null,
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

        function showImageViewer(url) {
          if (window.electronAPI) window.electronAPI.browserHide(entry.id);
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
          img.src = targetUrl(url);
          entry._imgEl = img;
          entry._browserZoom = 1;
        }

        function showPdfViewer(url) {
          if (window.electronAPI) window.electronAPI.browserHide(entry.id);
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
          const srcUrl = targetUrl(url);
          console.log('[EmbedPDF] src:', srcUrl, '(original:', url, ')');
          if (!window.EmbedPDF) { wrap.style.display = 'none'; const fb = contentWrap.querySelector('iframe.browser-fallback'); if (fb) fb.style.display = ''; return; }
          try {
            window.EmbedPDF.init({ type: 'container', target, src: srcUrl, worker: false, tabBar: 'never' });
          } catch (err) { console.error('[EmbedPDF] init failed:', err); wrap.style.display = 'none'; const fb = contentWrap.querySelector('iframe.browser-fallback'); if (fb) fb.style.display = ''; }
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
            // Pin shadow iframe height as soon as the shadow DOM appears
            const pinIframe = () => {
              try {
                const sr = surface.shadowRoot;
                if (sr) { const f = sr.querySelector('iframe'); if (f) { f.style.height = '100%'; return true; } }
              } catch {}
              return false;
            };
            if (!pinIframe()) {
              const mo = new MutationObserver(() => { if (pinIframe()) mo.disconnect(); });
              mo.observe(surface, { childList: true, subtree: true });
            }
            if (isElectron) {
              surface.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes');
              surface.setAttribute('allowpopups', '');
              surface.addEventListener('did-start-loading', () => showLoading(true));
              surface.addEventListener('did-stop-loading', () => {
                entry._retryCount = 0;
                clearTimeout(entry._loadTimer);
                showLoading(false);
                resumeBrowserTab(entry);
              });
              surface.addEventListener('did-navigate', e => syncUrl(e.url));
              surface.addEventListener('did-navigate-in-page', e => syncUrl(e.url));
              surface.addEventListener('did-fail-load', (e, errorCode) => {
                if (errorCode === -3) return; // ERR_ABORTED = redirect, not real error
                // Retry a few times before giving up
                entry._retryCount = (entry._retryCount || 0) + 1;
                if (entry._retryCount <= 3) {
                  setTimeout(() => { surface.src = targetUrl(entry.url); }, 500);
                  return;
                }
                clearTimeout(entry._loadTimer);
                showLoading(false);
                showError(entry.url, 'Failed to load page.');
              });
              surface.addEventListener('new-window', e => { e.preventDefault(); openExternalUrl(e.url); });
              // Force the inner iframe (shadow DOM) to fill the webview height
              // immediately — no flash of small height before resize.
              const pinShadowIframe = () => {
                try {
                  const sr = surface.shadowRoot;
                  if (sr) { const f = sr.querySelector('iframe'); if (f) f.style.height = '100%'; }
                } catch {}
              };
              // Watch for the shadow root to appear (fires instantly, no flash)
              new MutationObserver(pinShadowIframe).observe(surface, { childList: true, subtree: true });
              pinShadowIframe();
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
          updateNavButtons();
          entry.label = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 28) || 'browser';
          renderSidebar();

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
          surface.src = targetUrl(url);
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

        bc.addEventListener('mousedown', (e) => {
          document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
          slot.classList.add('focused');
          focusedSlotId = slot.id;
          updateFocusedGroup();
          wsp.activeTermId = entry.id;
          const group = findGroupContainingTerm(wsp.layout, entry.id);
          if (group) group.activeTermId = entry.id;
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
    applyTermBgImage(entry);

    slot.addEventListener('mousedown', (e) => {
      // Ctrl+Alt+LeftClick toggles multi-select (skip browser tabs)
      if (e.button === 0 && e.ctrlKey && e.altKey && entry.type !== 'browser') {
        e.preventDefault(); e.stopPropagation();
        toggleMultiSelect(entry.id);
        return;
      }
      document.querySelectorAll('.term-slot.focused').forEach(s => s.classList.remove('focused'));
      slot.classList.add('focused');
      focusedSlotId = slot.id;
      updateFocusedGroup();
      wsp.activeTermId = entry.id;

      const group = findGroupContainingTerm(wsp.layout, entry.id);
      if (group) group.activeTermId = entry.id;

      entry.term.focus();
    });

    // Right-click on terminal body area — includes copy/paste
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
      const draggedId = window.draggedTermId || window.externalDragTermId || e.dataTransfer.getData('text/plain');
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

      const draggedId = window.draggedTermId || window.externalDragTermId || e.dataTransfer.getData('text/plain');
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
    const sb = document.getElementById('sidebar-inner') || document.getElementById('sidebar');
    if (!sideOrder.length && (workspaces.length || folders.length)) rebuildSideOrder();
    const actionsEl = sb.querySelector('.sidebar-actions');
    sb.querySelectorAll('.ws-header, .ws-folder-row, .ws-btn, .ws-pin-label, .ws-pin-sep').forEach(e => e.remove());

    const clearDropMarks = () => {
      sb.querySelectorAll('.ws-btn.drop-above, .ws-btn.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
      sb.querySelectorAll('.ws-folder-row.drop-into, .ws-folder-row.drop-above, .ws-folder-row.drop-below').forEach(el => el.classList.remove('drop-into', 'drop-above', 'drop-below'));
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
    addBtn.title = 'New workspace';
    addBtn.innerHTML = '<i class="ph ph-plus"></i>';
    addBtn.addEventListener('click', () => createWorkspace());
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
    folderBtn.innerHTML = '<i class="ph ph-folder-plus"></i>';
    folderBtn.addEventListener('click', () => showPrompt('New folder', '', { color: '' }, (value, color) => createFolder(value, color)));
    headerActions.appendChild(folderBtn);

    header.appendChild(headerActions);
    sb.insertBefore(header, sb.firstChild);

    // ── Workspace button builder (shared by root list and folders) ──
    // slot is the sideOrder index for top-level buttons (undefined for folder children)
    const buildWsBtn = (wsp, folderKey, slot) => {
      const btn = document.createElement('div');
      const isActive = wsp.id === activeWsId;
      btn.className = 'ws-btn' + (isActive ? ' active' : '');
      btn.draggable = true;
      btn.dataset.wsid = wsp.id;
      if (slot !== undefined) btn.dataset.slot = String(slot);
      const abbr = wsp.label.substring(0,3).toUpperCase();
      const tabCount = getWorkspaceTerminals(wsp).length;
      const isInFolder = folderKey != null;
      btn.innerHTML = `<span class="ws-strip"></span><span class="ws-label">${abbr}</span><span class="ws-name">${escHtml(wsp.label)}</span><span class="ws-actions">${!isInFolder ? `<span class="ws-action ws-pin" title="${wsp.pinned ? 'Unpin' : 'Pin to top'}"><i class="ph ph-push-pin${wsp.pinned ? '-slash' : ''}"></i></span>` : ''}<span class="ws-action ws-rename" title="Rename"><i class="ph ph-pencil-simple"></i></span><span class="ws-action ws-remove" title="Close"><i class="ph ph-x"></i></span></span>${wsp.pinned && !isInFolder ? '<span class="ws-pin-icon"><i class="ph ph-push-pin-simple"></i></span>' : ''}<span class="ws-count">${tabCount}</span>`;
      if (wsp.pinned) btn.classList.add('pinned');
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

      // Drag & drop: move / reorder (folder-aware)
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
        clearDropMarks();
        stopResizing();
      });
      btn.addEventListener('dragover', e => {
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
          btn.classList.remove('drop-above', 'drop-below');
        }
      });
      btn.addEventListener('drop', e => {
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

      if (!isInFolder) {
        btn.querySelector('.ws-pin').addEventListener('click', (e) => {
          e.stopPropagation();
          togglePinWorkspace(wsp.id);
        });
      }
      btn.querySelector('.ws-rename').addEventListener('click', (e) => {
        e.stopPropagation();
        renameWorkspace(wsp.id);
      });
      btn.querySelector('.ws-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeWorkspace(wsp.id);
      });
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
      headerEl.innerHTML = `
        <span class="ws-folder-icon ws-folder-icon-closed"><i class="ph ph-folder"></i></span>
        <span class="ws-folder-icon ws-folder-icon-open"><i class="ph ph-folder-open"></i></span>
        <span class="ws-folder-name">${escHtml(folder.label)}</span>
        ${folder.pinned ? '<span class="ws-folder-pin-icon"><i class="ph ph-push-pin-simple"></i></span>' : ''}
        <span class="ws-folder-count">${wss.length}</span>
        <span class="ws-folder-actions">
          <span class="ws-folder-action ws-folder-pin" title="${folder.pinned ? 'Unpin' : 'Pin to top'}"><i class="ph ph-push-pin${folder.pinned ? '-slash' : ''}"></i></span>
          <span class="ws-folder-action ws-folder-add" title="New workspace here"><i class="ph ph-plus"></i></span>
          <span class="ws-folder-action ws-folder-rename" title="Edit folder"><i class="ph ph-pencil-simple"></i></span>
          <span class="ws-folder-action ws-folder-remove" title="Delete folder"><i class="ph ph-x"></i></span>
        </span>`;
      if (folder.pinned) row.classList.add('pinned');

      headerEl.addEventListener('click', e => {
        if (e.target.closest('.ws-folder-action')) return;
        if (window._wsDragged || window.draggedFolderId) { window._wsDragged = false; return; }
        toggleFolderCollapsed(folder.id);
      });
      headerEl.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, 'folder', folder.id); });

      headerEl.querySelector('.ws-folder-pin').addEventListener('click', e => { e.stopPropagation(); togglePinFolder(folder.id); });
      headerEl.querySelector('.ws-folder-add').addEventListener('click', e => { e.stopPropagation(); createWorkspace(undefined, folder.id); });
      headerEl.querySelector('.ws-folder-rename').addEventListener('click', e => { e.stopPropagation(); renameFolder(folder.id); });
      headerEl.querySelector('.ws-folder-remove').addEventListener('click', e => { e.stopPropagation(); removeFolder(folder.id); });

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
      const wsPinned = findWs(wsId)?.pinned;
      item('<i class="ph ph-plus"></i>', 'New terminal', 'Ctrl+Shift+T', () => { activateWorkspace(wsId); addTerminal(wsId); });
      sep();
      item(`<i class="ph ph-push-pin${wsPinned ? '-slash' : ''}"></i>`, wsPinned ? 'Unpin from top' : 'Pin to top', '', () => togglePinWorkspace(wsId));
      item('<i class="ph ph-pencil-simple"></i>', 'Edit workspace', '', () => renameWorkspace(wsId));
      if (folders.length || findWs(wsId)?.folderId) {
        sep();
        for (const f of folders) {
          const inFolder = findWs(wsId)?.folderId === f.id;
          item(`<i class="ph ph-folder${inFolder ? '-open' : ''}"></i>`, `${inFolder ? '✓ ' : ''}Move to "${f.label}"`, '', () => moveWsTo(wsId, f.id, getGroupList(f.id).length));
        }
        item('<i class="ph ph-folder-simple-plus"></i>', 'New folder', '', () => showPrompt('New folder', '', { color: '' }, (value, color) => { const nf = createFolder(value, color); if (nf) moveWsTo(wsId, nf.id, 0); }));
        if (findWs(wsId)?.folderId) {
          item('<i class="ph ph-folder-minus"></i>', 'Remove from folder', '', () => moveWsTo(wsId, null, getGroupList(null).length));
        }
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
    } else if (type === 'terminal') {
      const { wsId, termId } = data;
      const wsp = findWs(wsId);
      const isMaximized = wsp && wsp._maximizedGroupId && findGroupContainingTerm(wsp.layout, termId)?.id === wsp._maximizedGroupId;
      item(isMaximized ? '<i class="ph ph-corners-in"></i>' : '<i class="ph ph-corners-out"></i>', isMaximized ? 'Restore tab' : 'Maximize tab', '', () => toggleMaximizeTerminal(wsId, termId));
      item('<i class="ph ph-plus"></i>', 'New terminal', 'Ctrl+Shift+T', () => addTerminal(wsId));
      item('<i class="ph ph-pencil-simple"></i>', 'Edit tab', '', () => renameTerminal(wsId, termId));
      if (backgroundMode === 'per-tab') {
        const termEntry = getWorkspaceTerminals(wsp).find(t => t.id === termId);
        if (termEntry && termEntry.bgImage) {
          item('🖼', 'Clear background image', '', () => {
            setTermBackgroundImage(termEntry, '');
            applyBackground();
          });
        } else {
          item('🖼', 'Set background image…', '', () => {
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
      }
      // Copy & Paste — only when right-clicking on the terminal body
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
        item('<i class="ph ph-clipboard-text"></i>', 'Paste', 'Ctrl+Shift+V', () => {
          const t = findTermById(termId);
          if (t && t.term.type !== 'browser') {
            if (isDesktop() && window.electronAPI) {
              window.electronAPI.clipboardRead()
              .then(text => { if (text) t.term.term.paste(text); }).catch(() => {});
            } else {
              navigator.clipboard.readText()
              .then(text => { if (text) t.term.term.paste(text); }).catch(() => {});
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

  function showConfirm(message, callback, onCancel) {
    onCancel = onCancel || (() => {});
    promptLabel.textContent = message;
    promptInput.style.display = 'none';
    promptColors.style.display = 'none';

    promptOverlay.classList.add('open');
    promptOk.focus();

    let onKey;
    let cancelled = false;
    const close = () => {
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

  function showCloseConfirm(label, closesWorkspace, callback, onCancel) {
    showDangerConfirm('Close tab?',
      `<span class="cc-label">${escHtml(label)}</span> is running a process.` +
      (closesWorkspace ? ' Closing it will terminate the process and remove the workspace.' : ' Closing it will terminate the process.'),
      'Close Tab', callback, onCancel);
  }

  // Shared destructive-style confirmation (red warning icon + red button)
  function showDangerConfirm(title, messageHTML, okLabel, callback, onCancel) {
    onCancel = onCancel || (() => {});
    closeConfirmTitle.textContent = title;
    closeConfirmMessage.innerHTML = messageHTML;
    closeConfirmOk.textContent = okLabel;

    closeConfirmOverlay.classList.add('open');
    closeConfirmCancel.focus();

    let onKey;
    let cancelled = false;
    const close = () => {
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
    const submit = () => { close(); callback(); };

    onKey = e => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    };

    closeConfirmOk.onclick = submit;
    closeConfirmCancel.onclick = cancel;
    closeConfirmOverlay.onclick = e => { if (e.target === closeConfirmOverlay) cancel(); };
    document.addEventListener('keydown', onKey, true);
  }

  // Count live terminals with a running process (excluding idle shells)
  // across all workspaces, then ask for confirmation before quitting.
  function confirmQuitApp() {
    const pending = [];
    for (const wsp of workspaces) {
      for (const t of getWorkspaceTerminals(wsp)) {
        if (isLiveTerminal(t)) {
          pending.push(checkTerminalRunning(t.id).then(name => name ? { label: t.label, name } : null));
        }
      }
    }
    Promise.all(pending).then(results => {
      const running = results.filter(Boolean);
      const msg = running.length > 0
        ? `There ${running.length > 1 ? 'are' : 'is'} ${running.length} terminal${running.length > 1 ? 's' : ''} with running processes: ` +
          running.map(r => `<span class="cc-label">${escHtml(r.label)}</span> (${escHtml(r.name)})`).join(', ') +
          '. Quitting will terminate them.'
        : 'All terminals are idle.';
      showDangerConfirm('Quit TerminalVibe?', msg, 'Quit', () => window.close());
    });
  }

  function isLiveTerminal(entry) {
    return !!entry && entry.type !== 'browser' && !entry.dead;
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
          } catch {}
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

      function initCustomDropdown(dd) {
        const selectId = dd.dataset.for;
        const select = document.getElementById(selectId);
        if (!select) return;

        dd.innerHTML = '';
        const btn = document.createElement('div');
        btn.className = 'custom-dropdown-btn';
        btn.innerHTML = `<span class="custom-dropdown-label"></span><i class="ph ph-caret-down dropdown-arrow"></i>`;
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
            let content = '';
            if (opt.dataset.icon) {
              content += `<svg class="dropdown-icon" viewBox="0 0 24 24" width="16" height="16"><path d="${opt.dataset.icon}"/></svg>`;
            }
            // Support theme swatches via data-swatches attribute
            if (opt.dataset.swatches) {
              const swatches = opt.dataset.swatches.split(',');
              content += `<span class="theme-swatch">${swatches.map(c => `<span style="background:${c}"></span>`).join('')}</span>`;
            }
            content += `<span>${opt.textContent}</span>`;
            el.innerHTML = content;
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
          const label = btn.querySelector('.custom-dropdown-label');
          let html = '';
          if (sel && sel.dataset.icon) {
            html += `<svg class="dropdown-icon" viewBox="0 0 24 24" width="14" height="14"><path d="${sel.dataset.icon}"/></svg>`;
          }
          html += sel ? sel.textContent : '';
          label.innerHTML = html;
          menu.querySelectorAll('.custom-dropdown-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.value === select.value);
          });
        }

        function close() {
          btn.classList.remove('open');
          menu.classList.remove('open');
          const arrow = btn.querySelector('.dropdown-arrow');
          if (arrow) { arrow.classList.remove('ph-caret-up'); arrow.classList.add('ph-caret-down'); }
        }

        btn.addEventListener('click', e => {
          e.stopPropagation();
          const isOpen = menu.classList.contains('open');
          // Close all other dropdowns
          document.querySelectorAll('.custom-dropdown-menu.open').forEach(m => m.classList.remove('open'));
          document.querySelectorAll('.custom-dropdown-btn.open').forEach(b => {
            b.classList.remove('open');
            const a = b.querySelector('.dropdown-arrow');
            if (a) { a.classList.remove('ph-caret-up'); a.classList.add('ph-caret-down'); }
          });
          if (!isOpen) {
            buildOptions();
            btn.classList.add('open');
            menu.classList.add('open');
            const arrow = btn.querySelector('.dropdown-arrow');
            if (arrow) { arrow.classList.remove('ph-caret-down'); arrow.classList.add('ph-caret-up'); }
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
          accent: 'Accent', border: 'Border', multiSelect: 'Multi-select',
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
        if (key === 'multiSelect') return editingTheme.ui.multiSelect || editingTheme.palette[3] || '#f9e2af';
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
         else if (key === 'multiSelect') editingTheme.ui.multiSelect = val || undefined;
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
           if (groupName === 'UI Colors') {
             const sep = document.createElement('div');
             sep.className = 'border-t border-[var(--border)] my-3';
             colorsCard.appendChild(sep);
           }
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

        // Corner style
        const cornerSelect = document.getElementById('set-corner-style');
        cornerSelect.value = cornerStyle;
        cornerSelect.onchange = e => {
          cornerStyle = e.target.value;
          applyCornerStyle();
          saveState();
        };
        const cornerDD = document.querySelector('.custom-dropdown[data-for="set-corner-style"]');
        if (cornerDD) initCustomDropdown(cornerDD);

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

        // Always open on the first category (Appearance) unless deep-linked
        switchSettingsCat(typeof cat === 'string' ? cat : 'appearance');
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
        syncBrowserSlots();
      }

      function closeSettings() {
        applyTheme(currentThemeName);
        settingsOverlay.classList.remove('open');
        syncBrowserSlots();
        // In the Electron settings window, closing the overlay closes the window
        if (SETTINGS_ONLY && window.electronAPI && window.electronAPI.settingsClose) window.electronAPI.settingsClose();
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

      function switchSettingsCat(cat) {
        const prevCat = document.querySelector('.settings-cat-btn.active')?.dataset.cat;
        document.querySelectorAll('.settings-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
        document.querySelectorAll('.settings-section[data-cat]').forEach(s => s.classList.toggle('active', s.dataset.cat === cat));
        // Leaving theme editor → revert live preview to applied theme
        if (prevCat === 'theme-editor' && cat !== 'theme-editor') {
          applyTheme(currentThemeName);
        }
        // Reset scroll to top of the new section
        document.querySelector('.settings-section')?.parentElement?.scrollTo({ top: 0 });
        settingsCategory = cat;
        saveState();
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
        document.documentElement.style.setProperty('--app-font', currentFontFamily);
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
          if (state.theme && THEMES[state.theme]) { currentThemeName = state.theme; currentTheme = THEMES[currentThemeName]; }
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
          if (state.cornerStyle) cornerStyle = state.cornerStyle;
          if (state.cursorStyle) currentCursorStyle = state.cursorStyle;
          if (state.cursorBlink !== undefined) currentCursorBlink = state.cursorBlink;
          if (state.scrollback) currentScrollback = state.scrollback;
          if (typeof state.settingsCategory === 'string') settingsCategory = state.settingsCategory;
          if (state.pinnedCollapsed !== undefined) pinnedCollapsed = !!state.pinnedCollapsed;
          if (state.sidebarMode) {
            if (sidebarMode !== state.sidebarMode) {
              sidebarMode = state.sidebarMode;
              applySidebarMode();
            }
          }
          if (state.backgroundMode) backgroundMode = state.backgroundMode;
          if (state.globalBackgroundImage) globalBackgroundImage = state.globalBackgroundImage;
          if (state.backgroundOpacity !== undefined) backgroundOpacity = state.backgroundOpacity;
          if (state.searchEngine) searchEngine = state.searchEngine;
          if (state.customSearchUrl) customSearchUrl = state.customSearchUrl;
          if (state.shortcuts) {
            for (const [k, v] of Object.entries(state.shortcuts)) {
              if (customShortcuts[k]) customShortcuts[k] = v;
            }
          }
        } catch {}
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
          // Paste
          if (matchShortcut(e, 'paste')) {
            const t = activeTerminal();
            if (t && t.type !== 'browser') {
              e.preventDefault(); e.stopPropagation();
              navigator.clipboard.readText()
              .then(text => { if (text) t.term.paste(text); }).catch(() => {});
            }
            return;
          }
          // Ctrl+V paste (non-shift variant)
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v') {
            const t = activeTerminal();
            if (t && t.type !== 'browser') {
              e.preventDefault(); e.stopPropagation();
              navigator.clipboard.readText()
              .then(text => { if (text) t.term.paste(text); }).catch(() => {});
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
          // Arrow key tab switching (legacy)
          if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
            if (e.code === 'ArrowLeft') { e.preventDefault(); prevTab(); return; }
            if (e.code === 'ArrowRight') { e.preventDefault(); nextTab(); return; }
          }
        });

      // Settings-window bootstrap: skip the entire terminal/browser layer.
      async function settingsOnlyBoot() {
        await loadCustomThemes();
        await restoreSettingsOnly();
        applyTheme(currentThemeName);
        document.body.classList.add('settings-only');
        const splash = document.getElementById('splash');
        if (splash) splash.classList.add('hide');
        openSettings('appearance');
      }

      async function detachedOnlyBoot() {
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
            if (state.theme && THEMES[state.theme]) { currentThemeName = state.theme; currentTheme = THEMES[currentThemeName]; }
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
            if (state.cornerStyle) cornerStyle = state.cornerStyle;
            if (state.cursorBlink !== undefined) currentCursorBlink = state.cursorBlink;
            if (state.cursorStyle) currentCursorStyle = state.cursorStyle;
            if (state.scrollback !== undefined) currentScrollback = state.scrollback;
          }
        } catch {}
        applyTheme(currentThemeName);
        document.body.classList.add('detached');

        // Hide splash screen (normal init hides it at line ~6017, after the detached return)
        const splash = document.getElementById('splash');
        if (splash) splash.classList.add('hide');

        // Show the titlebar so the window is draggable
        const tb = document.getElementById('titlebar');
        if (tb) tb.classList.add('active');

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
          api.onTerminalExit(({ id, code }) => {
            const result = findTermById(id);
            if (result) {
              result.dead = true;
              result.term = null;
            }
            window.close();
          });
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
                  ready.remaining = getWorkspaceTerminals(wsp).length;
                  if (ready.remaining > 0) {
                    renderPaneArea();
                    const nt = activeTerminal();
                    if (nt) activateTerminal(wsp.id, nt.id);
                    saveState();
                  }
                }
              } catch {}
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
            api.onTabDragActive(({ id }) => { window.externalDragTermId = id || null; });
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
        try { restored = await restoreState(); } catch {}

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
          } catch {}

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
          try { active.term.resize(cols, rows); } catch {}
          if (!detachedBuffer) {
            // restored-from-state path: the stash wasn't read above
            try {
              const raw = localStorage.getItem(DETACH_BUFFER_KEY(termId));
              detachedBuffer = raw ? JSON.parse(raw) : null;
            } catch {}
          }
          try { localStorage.removeItem(DETACH_BUFFER_KEY(termId)); } catch {}
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

      // Settings-window bootstrap: skip the entire terminal/browser layer.
      if (SETTINGS_ONLY) { settingsOnlyBoot(); return; }

      // Detached-terminal bootstrap: minimal terminal-only window.
      if (DETACHED_ONLY) { detachedOnlyBoot(); return; }

      // Open/close
      document.getElementById('btn-settings').addEventListener('click', () => openSettingsGlobal());
      document.getElementById('settings-close').addEventListener('click', closeSettings);
      settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && settingsOverlay.classList.contains('open')) { closeSettings(); e.stopPropagation(); }
        if (e.ctrlKey && e.key === ',' && !e.metaKey && !e.altKey) { e.preventDefault(); openSettingsGlobal(); }
      });
      // Deep-link API: e.g. openSettings('appearance')
      window.openSettings = openSettingsGlobal;
      window.closeSettings = closeSettings;

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

      // ── Background Image Settings ──
      const bgModeSelect = document.getElementById('set-bg-mode');
      const bgImageRow = document.getElementById('bg-image-row');
      const bgOpacitySlider = document.getElementById('set-bg-opacity');
      const bgOpacityVal = document.getElementById('set-bg-opacity-val');
      const bgUploadArea = document.getElementById('set-bg-image-area');
      const bgFileInput = document.getElementById('set-bg-image-input');
      const bgPreview = bgUploadArea.querySelector('.bg-upload-preview');
      const bgClearBtn = document.getElementById('bg-image-clear');

      function updateBgImageRowHelpText() {
        const textEl = bgUploadArea.querySelector('.bg-upload-text');
        if (backgroundMode === 'global') {
          textEl.textContent = 'Click to select global background image';
        } else if (backgroundMode === 'per-tab') {
          textEl.textContent = 'Click to set background for current tab';
        } else {
          textEl.textContent = 'Enable a background mode first';
        }
      }

      function updateBgUploadPreview() {
        let hasImage = false;
        let src = '';
        if (backgroundMode === 'global') {
          hasImage = !!globalBackgroundImage;
          src = globalBackgroundImage;
        } else if (backgroundMode === 'per-tab') {
          const active = activeTerminal();
          hasImage = active && !!active.bgImage;
          src = active ? (active.bgImage || '') : '';
        }
        bgUploadArea.classList.toggle('has-image', hasImage);
        if (hasImage) {
          bgPreview.src = src;
        }
      }

      function refreshBgSettingsUI() {
        bgModeSelect.value = backgroundMode;
        const dd = document.querySelector('.custom-dropdown[data-for="set-bg-mode"]');
        if (dd) initCustomDropdown(dd);

        const isEnabled = backgroundMode !== 'none';
        bgImageRow.style.display = isEnabled ? '' : 'none';
        bgOpacitySlider.value = Math.round(backgroundOpacity * 100);
        bgOpacityVal.textContent = Math.round(backgroundOpacity * 100) + '%';
        updateBgImageRowHelpText();
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
          } else if (backgroundMode === 'per-tab') {
            const active = activeTerminal();
            if (active) {
              setTermBackgroundImage(active, dataUrl);
              applyBackground();
            }
          }
          refreshBgSettingsUI();
        });
        e.target.value = '';
      });

      bgClearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (backgroundMode === 'global') {
          setGlobalBackgroundImage('');
        } else if (backgroundMode === 'per-tab') {
          const active = activeTerminal();
          if (active) {
            setTermBackgroundImage(active, '');
            applyBackground();
          }
        }
        refreshBgSettingsUI();
      });

      // Also add "Set background…" context menu option for per-tab
      // We'll patch into the existing context menu

      // Theme editor — Save
      document.getElementById('theme-btn-save').addEventListener('click', async () => {
        const nameInput = document.getElementById('set-theme-name');
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        if (BUILTIN_THEME_KEYS.has(name)) { alert('Cannot overwrite a built-in theme.'); return; }
        editingTheme.label = name;
        const customs = await getCustomThemes();
        customs[name] = { ...editingTheme, _custom: true };
        await saveCustomThemes(customs);
        applyTheme(name);
        saveState();
        refreshThemeDropdown();
      });

      // Theme editor — Delete
      document.getElementById('theme-btn-delete').addEventListener('click', async () => {
        const nameInput = document.getElementById('set-theme-name');
        const name = nameInput.value.trim();
        if (!name || BUILTIN_THEME_KEYS.has(name)) return;
        if (!(await getCustomThemes())[name]) return;
        await deleteCustomTheme(name);
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
          const wsp = activeWs();
          if (wsp) for (const t of getWorkspaceTerminals(wsp)) fitTerm(t);
        }

        const sbEl = document.getElementById('sidebar');

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

        document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
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
        });

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
        function startResizing() {
          document.body.classList.add('resizing');
        }

        function stopResizing() {
          document.body.classList.remove('resizing');
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
        function escHtml(s) {
          return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        /* ═══════════════════════════════════════════════════════════════
         B O*OT
         ═══════════════════════════════════════════════════════════════ */
        (async () => {
          await loadCustomThemes();
          const restored = await restoreState();
          applyTheme(currentThemeName);
          applySidebarMode();

        // Hide splash screen after app is ready
        const splash = document.getElementById('splash');
        if (splash) splash.classList.add('hide');

        // Apply initial background & opacity
        applyBackground();

        // Settings live in a separate Electron window; re-apply on any change
        if (isDesktop() && window.electronAPI && window.electronAPI.onSettingsChanged) {
          window.electronAPI.onSettingsChanged(() => {
            restoreSettingsOnly().then(() => {
              applyTheme(currentThemeName);
              applyBackground();
              applySettings();
              syncBrowserSlots();
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
              if (navUrl !== active.url) active._syncUrl(navUrl);
            }
          }
        });

        // Auto-save every 30 seconds
        setInterval(saveState, 30000);

        // Save on close (browser)
        window.addEventListener('beforeunload', (e) => {
          saveState();
          if (!isDesktop()) {
            const hasLiveTerms = workspaces.some(ws => getWorkspaceTerminals(ws).some(t => !t.dead));
            if (hasLiveTerms) { e.preventDefault(); e.returnValue = ''; }
          }
        });

        // Save on window close (Electron)
        if (isDesktop() && window.electronAPI) {
          window.addEventListener('beforeunload', () => saveState());
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

        // Keep blur for instant reaction and Electron native child webviews
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

        })(); // async boot
})();
