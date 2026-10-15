// Clock (Obsidian-style) — compiled entry. Do not edit by hand; edit
// src/main.ts and rebuild:
//   npx esbuild src/main.ts --format=cjs --platform=browser --outfile=main.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ClockPlugin extends TerminalVibe.Plugin {
    async onload() {
        this.log('loaded');
        // Status-bar widget (element returned for the plugin to fill).
        this.clockEl = this.addStatusBarItem();
        this.clockEl.classList.add('clock-obsidian-time');
        // Command with a keybinding (Ctrl+Shift+H). Built-in shortcuts win.
        this.addCommand({
            id: 'greet',
            name: 'Greet in active terminal',
            combo: { ctrl: true, shift: true, key: 'H' },
            callback: () => this.greet(),
        });
        // Lifecycle hook — all api.events.* names work here too.
        this.registerEvent('theme:changed', ({ name }) => {
            this.log('theme changed:', name);
        });
        // Live settings: re-render the clock when the user edits options in
        // Settings → Plugins → Clock → Options.
        this.api.config.onChange(() => this.tick());
        await this.startClock();
        this.log('ready — press Ctrl+Shift+H');
    }
    onunload() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    async startClock() {
        if (this.timer)
            clearInterval(this.timer);
        this.tick();
        this.timer = setInterval(() => this.tick(), 1000);
    }
    tick() {
        if (!this.clockEl)
            return;
        const format = this.api.config.get('format', 'time');
        const now = new Date();
        if (format === 'date-time') {
            this.clockEl.textContent = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
        }
        else if (format === 'time-seconds') {
            this.clockEl.textContent = now.toLocaleTimeString();
        }
        else {
            this.clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        this.clockEl.title = 'Clock (Obsidian-style plugin)';
    }
    greet() {
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
module.exports = ClockPlugin;
