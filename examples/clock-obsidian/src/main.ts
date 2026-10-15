/// <reference path="../plugin-api.d.ts" />
// Clock (Obsidian-style) — TypeScript source.
//
// Install: copy manifest.json + main.js + styles.css to
//   ~/.terminalvibe/plugins/clock-obsidian/
// and restart the app (src/ stays in your dev checkout).
//
// Rebuild after editing:
//   npx esbuild src/main.ts --format=cjs --platform=browser --outfile=main.js
// (--bundle only needed if you import npm packages.)
//
// No imports here on purpose: TerminalVibe.Plugin is a runtime global, so
// the compiled CJS output has zero dependencies and works with either
// `export default` (tsc/esbuild) or `module.exports =` (plain JS).
export default class ClockPlugin extends TerminalVibe.Plugin {
  private timer: ReturnType<typeof setInterval> | null = null;
  private clockEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    this.log('loaded');

    // Status-bar widget (element returned for the plugin to fill).
    this.clockEl = this.addStatusBarItem();
    this.clockEl.classList.add('clock-obsidian-time');

    // Command with a keybinding (Ctrl+Shift+H). Built-in shortcuts win, so
    // pick a combo the app does not already use.
    this.addCommand({
      id: 'greet',
      name: 'Greet in active terminal',
      combo: { ctrl: true, shift: true, key: 'H' },
      callback: () => this.greet(),
    });

    // Lifecycle hook — all api.events.* names work here too.
    this.registerEvent('theme:changed', ({ name }: { name: string }) => {
      this.log('theme changed:', name);
    });

    // Live settings: re-render the clock when the user edits options in
    // Settings → Plugins → Clock → Options.
    this.api.config.onChange(() => this.tick());

    await this.startClock();
    this.log('ready — press Ctrl+Shift+H');
  }

  onunload(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async startClock(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    if (!this.clockEl) return;
    const format = this.api.config.get('format', 'time');
    const now = new Date();
    if (format === 'date-time') {
      this.clockEl.textContent = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
    } else if (format === 'time-seconds') {
      this.clockEl.textContent = now.toLocaleTimeString();
    } else {
      this.clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    this.clockEl.title = 'Clock (Obsidian-style plugin)';
  }

  private greet(): void {
    const term = this.api.state.getActiveTerminal();
    if (!term) {
      this.log('no active terminal');
      return;
    }
    const greeting = this.api.config.get('greeting', 'hello');
    // Display-only write: rendered on screen, never fed to the shell.
    this.api.terminal.write(term.id, `\r\n\x1b[36m[clock] ${greeting} from ${this.name}!\x1b[0m\r\n`);
  }
}
