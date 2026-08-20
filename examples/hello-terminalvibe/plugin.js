// Hello TerminalVibe — example plugin.
//
// Install: copy this folder to ~/.terminalvibe/plugins/hello-terminalvibe/ and
// restart the app. The plugin shows off every surface of the plugin API.
//
// It declares two settings (plugin.json → "settings"), which are editable from
// Settings → Plugins → Hello TerminalVibe and read via api.config.get().
(function () {
  let interval = null;

  TerminalVibe.register({
    id: 'hello-terminalvibe',
    activate(api) {
      api.log('activated');

      // 1. Command with a keybinding (Ctrl+Shift+H). Built-in shortcuts win,
      //    so pick a combo the app does not already use.
      api.commands.register({
        id: 'hello-terminalvibe.greet',
        label: 'Greet in active terminal',
        combo: { ctrl: true, shift: true, key: 'H' },
        handler() {
          const term = api.state.getActiveTerminal();
          if (!term) { api.log('no active terminal'); return; }
          const text = `\r\n\x1b[32m[hello] Hi from ${api.name} v${api.version}!\x1b[0m\r\n`;
          const data = new TextEncoder().encode(text);
          window.electronAPI.terminalWrite({ id: term.id, data });
        }
      });

      // 2. Terminal lifecycle hooks
      api.events.on('terminal:add', ({ termId, type }) => api.log('terminal added:', termId, type));
      api.events.on('terminal:activate', ({ termId }) => api.log('terminal activated:', termId));
      api.events.on('terminal:remove', ({ termId }) => api.log('terminal removed:', termId));
      api.events.on('theme:changed', ({ name }) => api.log('theme changed:', name));

      // 3. Context menu item on terminal right-click
      api.menus.add('terminal', {
        label: 'Hello from plugin',
        icon: '<i class="ph ph-hand-wave"></i>',
        handler(data) {
          const term = api.state.getActiveTerminal();
          if (!term) return;
          const text = '\r\n\x1b[33m[hello] context menu clicked\x1b[0m\r\n';
          window.electronAPI.terminalWrite({ id: term.id, data: new TextEncoder().encode(text) });
        }
      });

      // 4. Register a theme (appears in Settings → Appearance → Theme)
      api.themes.register('hello-theme', {
        label: 'Hello Theme',
        bg: '#1b1b2f',
        fg: '#e0e0ff',
        cursor: '#e0e0ff',
        selection: '#353570',
        swatches: ['#1b1b2f', '#e0e0ff'],
        palette: [
          '#1b1b2f', '#ff6b6b', '#51cf66', '#ffd43b',
          '#4dabf7', '#cc5de8', '#22b8cf', '#f8f9fa',
          '#495057', '#ff8787', '#8ce99a', '#ffe066',
          '#74c0fc', '#da77f2', '#66d9e8', '#f1f3f5'
        ],
        ui: { accent: '#4dabf7' }
      });

      // 5. Read the plugin's editable settings (see plugin.json "settings").
      //    Values are edited from Settings → Plugins and persisted in state.json.
      const greeting = api.config.get('greeting', 'hello');
      const style = api.config.get('style', 'green');
      const showClock = api.config.get('showClock', true);
      api.log('config → greeting:', greeting, '| style:', style, '| showClock:', showClock);

      // React live when the user edits settings in Settings → Plugins.
      api.config.onChange(({ config }) => {
        api.log('config changed →', JSON.stringify(config));
      });

      // 6. Status bar widget — a live clock
      const clock = document.createElement('span');
      clock.style.fontVariantNumeric = 'tabular-nums';
      const tick = () => {
        clock.textContent = showClock ? new Date().toLocaleTimeString() : '';
      };
      tick();
      interval = setInterval(tick, 1000);
      api.ui.addWidget({ id: 'clock', position: 'statusbar', el: clock });

      api.log('ready — press Ctrl+Shift+H');
    },
    deactivate() {
      if (interval) clearInterval(interval);
    }
  });
})();