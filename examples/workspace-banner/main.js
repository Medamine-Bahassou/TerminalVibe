// Workspace Banner — compiled entry. Do not edit by hand; edit src/main.ts
// and rebuild:
//   npx esbuild src/main.ts --format=cjs --platform=browser --outfile=main.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ART = {
    waves: `<svg viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="wb-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1b2f"/><stop offset="1" stop-color="#2b2b4f"/></linearGradient></defs><rect width="200" height="80" fill="url(#wb-bg)"/><path d="M0 50 Q 25 35 50 50 T 100 50 T 150 50 T 200 50" stroke="#4dabf7" stroke-width="3" fill="none" opacity="0.9"/><path d="M0 58 Q 25 43 50 58 T 100 58 T 150 58 T 200 58" stroke="#cc5de8" stroke-width="3" fill="none" opacity="0.7"/><path d="M0 66 Q 25 51 50 66 T 100 66 T 150 66 T 200 66" stroke="#22b8cf" stroke-width="3" fill="none" opacity="0.5"/></svg>`,
    peaks: `<svg viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice"><rect width="200" height="80" fill="#141428"/><circle cx="160" cy="20" r="10" fill="#f1f3f5" opacity="0.9"/><polygon points="0,80 50,30 90,80" fill="#4dabf7" opacity="0.75"/><polygon points="60,80 120,18 180,80" fill="#7048e8" opacity="0.8"/><polygon points="130,80 170,45 200,80" fill="#22b8cf" opacity="0.7"/></svg>`,
    terminal: `<svg viewBox="0 0 200 80" preserveAspectRatio="xMidYMid slice"><rect width="200" height="80" fill="#0d1117"/><text x="14" y="34" font-family="monospace" font-size="16" fill="#51cf66">$ terminalvibe</text><text x="14" y="58" font-family="monospace" font-size="16" fill="#4dabf7">&gt; <tspan fill="#f1f3f5">_</tspan></text></svg>`,
};
class WorkspaceBannerPlugin extends TerminalVibe.Plugin {
    async onload() {
        this.log('loaded');
        // sidebar-top mounts above the WORKSPACES header and stays there across
        // sidebar re-renders (the host re-asserts its position).
        this.bannerEl = document.createElement('div');
        this.bannerEl.classList.add('workspace-banner');
        this.bannerEl.setAttribute('role', 'img');
        this.bannerEl.setAttribute('aria-label', 'Workspace banner');
        this.bannerEl.title = 'Workspace Banner (plugin image)';
        this.api.ui.addWidget({ id: 'banner', position: 'sidebar-top', el: this.bannerEl });
        // Live settings: re-render when the user edits options in
        // Settings → Plugins → Workspace Banner → Options.
        this.api.config.onChange(() => this.render());
        this.render();
    }
    onunload() {
        this.bannerEl = null;
    }
    render() {
        if (!this.bannerEl)
            return;
        const art = this.api.config.get('art', 'waves');
        const rawHeight = Number(this.api.config.get('height', 72));
        const height = Math.max(24, Math.min(240, Number.isFinite(rawHeight) ? rawHeight : 72));
        this.bannerEl.innerHTML = ART[art] || ART.waves;
        this.bannerEl.style.height = height + 'px';
        this.bannerEl.classList.toggle('is-rounded', !!this.api.config.get('rounded', true));
    }
}
module.exports = WorkspaceBannerPlugin;
