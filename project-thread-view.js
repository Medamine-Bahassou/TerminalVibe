/* Thread workspace UI. CLI processes still belong to the existing terminal layer. */
(() => {
  const providers = [
    { id: 'claude', name: 'Claude Code', icon: 'sparkle' },
    { id: 'codex', name: 'Codex', icon: 'code' },
    { id: 'gemini', name: 'Gemini CLI', icon: 'star-four' },
    { id: 'opencode', name: 'OpenCode', icon: 'terminal-window' },
  ];
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(label, action, className = 'thread-view-button') {
    const el = node('button', className, label); el.type = 'button'; el.onclick = action; return el;
  }
  window.ProjectThreadView = class {
    constructor(main, api) {
      this.api = api;
      this.main = main;
      this.live = new Map();
      this.header = node('header', 'thread-view-header');
      this.chooser = node('section', 'thread-agent-picker');
      this.history = node('aside', 'thread-history');
      this.history.setAttribute('aria-label', 'History of thread');
      main.append(this.header, this.chooser, this.history);
      this.timer = setInterval(() => this.refreshHistory(), 2000);
    }
    capture(ws) {
      for (const run of ws?.threadRuns || []) {
        // A restored terminal is a new shell, not the previous agent's output.
        if (this.live.get(run.id) !== run.termId) continue;
        const term = this.api.terminals(ws).find(t => t.id === run.termId);
        const buffer = term?.term?.buffer?.active;
        if (!buffer) continue;
        const lines = [];
        for (let i = Math.max(0, buffer.length - 300); i < buffer.length; i++) {
          lines.push(buffer.getLine(i)?.translateToString(true) || '');
        }
        const output = lines.join('\n').trim().slice(-24000);
        if (output) run.output = output;
      }
      return ws?.threadRuns || [];
    }
    render(ws, projects) {
      if (this.ws) this.capture(this.ws);
      this.ws = ws?.projectId ? ws : null;
      this.projects = projects;
      this.main.classList.toggle('has-project-thread', !!this.ws);
      this.header.hidden = this.chooser.hidden = this.history.hidden = !this.ws;
      if (!this.ws) { this.main.classList.remove('thread-choosing-agent'); return; }
      this.header.replaceChildren();
      const tab = node('div', 'thread-view-tab', ws.label);
      tab.title = ws.label;
      this.header.append(tab, button('Agents', () => this.showPicker(true)), button('Terminals', () => this.showPicker(false)));
      this.chooser.replaceChildren();
      const intro = node('div', 'thread-picker-intro');
      intro.append(node('p', 'thread-eyebrow', 'PROJECT THREAD'), node('h1', '', 'Choose an agent'), node('p', '', 'Work with your preferred agent in this thread.'));
      const label = node('label', 'thread-folder-label', 'Project folder');
      const select = node('select', 'thread-folder-select'); select.setAttribute('aria-label', 'Project folder');
      for (const project of projects) {
        const option = node('option', '', project.name + ' — ' + project.cwd); option.value = project.id;
        option.selected = project.id === ws.projectId; select.append(option);
      }
      select.onchange = () => {
        ws.projectId = select.value;
        this.api.changed(); this.render(ws, projects);
      };
      label.append(select); intro.append(label, node('p', 'thread-folder-hint', 'New sessions start in this folder. Existing terminals keep their directory.'));
      this.chooser.append(intro);
      const grid = node('div', 'thread-agent-grid');
      for (const provider of providers) {
        const card = button('', () => this.launch(provider), 'thread-agent-card');
        card.setAttribute('aria-label', 'Open ' + provider.name);
        const icon = node('i', 'ph ph-' + provider.icon); icon.setAttribute('aria-hidden', 'true');
        card.append(icon, node('strong', '', provider.name), node('span', '', this.running(provider.id) ? 'Open terminal' : 'Start a new session'));
        grid.append(card);
      }
      this.chooser.append(grid, node('p', 'thread-picker-footnote', 'Agents run locally. Install the CLI you want to use, or open Terminals to run another harness.'));
      this.status = node('p', 'thread-launch-status'); this.status.setAttribute('role', 'status'); this.chooser.append(this.status);
      this.history.replaceChildren();
      const heading = node('div', 'thread-history-heading');
      heading.append(node('h2', '', 'History of thread'), button('Refresh', () => this.refreshHistory()));
      this.history.append(heading, node('p', 'thread-history-caption', 'Saved agent sessions and terminal output excerpts.'));
      this.historyList = node('div', 'thread-history-list'); this.history.append(this.historyList);
      this.historySignature = null;
      this.refreshHistory();
      this.showPicker(ws._threadPicker !== false);
    }
    showPicker(show) {
      if (!this.ws) return;
      this.ws._threadPicker = show;
      this.main.classList.toggle('thread-choosing-agent', show);
      this.chooser.hidden = !show;
      for (const b of this.header.querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.textContent === 'Agents') === show));
      this.api.resize();
    }
    running(provider) {
      return (this.ws?.threadRuns || []).find(run => run.provider === provider && this.live.get(run.id) === run.termId &&
        this.api.terminals(this.ws).some(t => t.id === run.termId && !t.dead));
    }
    launch(provider) {
      const ws = this.ws;
      const project = this.projects.find(p => p.id === ws.projectId);
      if (!project) return;
      const running = this.running(provider.id);
      if (running) { this.showPicker(false); this.api.focus(ws, running.termId); return; }
      try {
        // Hide the picker before mounting and measuring the new terminal.
        this.showPicker(false);
        const term = this.api.launch(ws, { cwd: project.cwd, cmd: provider.id, label: provider.name });
        if (!term) throw Error('The terminal could not be created.');
        term.keepOnExit = true;
        const run = { id: this.api.id(), provider: provider.id, name: provider.name, cwd: project.cwd, termId: term.id, createdAt: Date.now(), output: '' };
        (ws.threadRuns ||= []).push(run);
        this.live.set(run.id, term.id);
        this.api.changed(); this.render(ws, this.projects);
      } catch (error) {
        this.showPicker(true); this.status.textContent = error.message;
      }
    }
    refreshHistory() {
      if (!this.ws || !this.historyList) return;
      const runs = this.capture(this.ws);
      const signature = JSON.stringify(runs);
      if (signature === this.historySignature) return;
      this.historySignature = signature;
      const scroll = this.historyList.scrollTop;
      const atEnd = this.historyList.scrollHeight - this.historyList.clientHeight - scroll < 30;
      this.historyList.replaceChildren();
      if (!runs.length) {
        const empty = node('div', 'thread-history-empty');
        empty.append(node('i', 'ph ph-clock-counter-clockwise'), node('h3', '', 'Your thread starts here'), node('p', '', 'Choose an agent. Its session and recent terminal output will appear here.'));
        this.historyList.append(empty);
      }
      for (const run of runs) {
        const card = node('article', 'thread-history-entry');
        const title = node('div', 'thread-history-entry-title');
        title.append(node('strong', '', run.name), node('time', '', new Date(run.createdAt).toLocaleString()));
        card.append(title, node('p', 'thread-history-cwd', run.cwd));
        const output = node('pre', 'thread-history-output', run.output || 'Session opened. Waiting for terminal output…');
        card.append(output);
        if (this.live.get(run.id) === run.termId && this.api.terminals(this.ws).some(t => t.id === run.termId)) {
          card.append(button('Open terminal', () => { this.showPicker(false); this.api.focus(this.ws, run.termId); }));

        } else {
          card.append(node('p', 'thread-history-caption', 'Saved session. Use the thread’s actions to save a resume command with its session ID.'));
        }
        this.historyList.append(card);
      }
      this.historyList.scrollTop = atEnd ? this.historyList.scrollHeight : scroll;
    }
    dispose() {
      clearInterval(this.timer);
      this.main.classList.remove('has-project-thread', 'thread-choosing-agent');
      this.header.remove(); this.chooser.remove(); this.history.remove();
    }
  };
})();
