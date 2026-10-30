// Claude Chats — lists Claude Code sessions (~/.claude/projects/<project>/<session>.jsonl)
// in the right panel. Click a chat to resume it in a new terminal in its project folder.
//
// Install: copy this folder to ~/.terminalvibe/plugins/claude-chats/.
'use strict';

const ROOT = '~/.claude/projects';
const HEAD_BYTES = 64 * 1024; // first prompt + cwd live near the top
const TAIL_BYTES = 64 * 1024; // ai-title is re-appended as the chat goes; /rename too
// One-shot sessions run in temp dirs (e.g. title generators) can't be resumed usefully.
const TEMP_CWD = /^\/tmp\/|[\\/]Temp[\\/]/i;

// Pull title / first prompt / cwd out of a chunk of JSONL. Chunks may start or
// end mid-line, so unparsable lines are skipped.
function scan(text, info) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type === 'custom-title' && r.customTitle) info.custom = r.customTitle;
    else if (r.type === 'ai-title' && r.aiTitle) info.ai = r.aiTitle;
    else if (r.type === 'summary' && r.summary && !info.summary) info.summary = r.summary;
    if (!info.cwd && r.cwd) info.cwd = r.cwd;
    if (!info.prompt && r.type === 'user' && !r.isMeta && !r.isSidechain && r.message) {
      const c = r.message.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(p => p && p.type === 'text') || {}).text : '';
      // Skip slash-command / hook wrappers like <command-name>…
      if (t && !t.trimStart().startsWith('<')) info.prompt = t.trim().replace(/\s+/g, ' ');
    }
  }
}

async function loadChats(api, limit) {
  const projects = (await api.fs.list(ROOT)) || [];
  const files = [];
  await Promise.all(projects.filter(p => p.dir).map(async p => {
    const ents = (await api.fs.list(`${ROOT}/${p.name}`)) || [];
    for (const e of ents) {
      if (!e.dir && e.name.endsWith('.jsonl') && e.size > 0) files.push({ project: p.name, ...e });
    }
  }));
  files.sort((a, b) => b.mtime - a.mtime);
  const chats = await Promise.all(files.slice(0, limit).map(async f => {
    const path = `${ROOT}/${f.project}/${f.name}`;
    const info = {};
    scan((await api.fs.read(path, { maxBytes: HEAD_BYTES })) || '', info);
    if (f.size > HEAD_BYTES) scan((await api.fs.read(path, { maxBytes: TAIL_BYTES, fromEnd: true })) || '', info);
    return {
      id: f.name.slice(0, -'.jsonl'.length),
      mtime: f.mtime,
      cwd: info.cwd || null,
      title: info.custom || info.ai || info.summary || info.prompt || '(empty chat)',
    };
  }));
  // Chats with no user prompt yet (e.g. opened and closed) are just noise.
  return chats.filter(c => c.title !== '(empty chat)' && !TEMP_CWD.test(c.cwd || ''));
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

const base = p => (p || '').split(/[\\/]/).filter(Boolean).pop() || p || '?';

module.exports = {
  activate(api) {
    const root = document.createElement('div');
    root.className = 'cc-root';
    root.innerHTML = '<div class="cc-tools"><input class="cc-search" placeholder="Search chats…" spellcheck="false">'
      + '<button class="sbr-btn cc-refresh" title="Refresh"><i class="ph ph-arrow-clockwise"></i></button></div>'
      + '<div class="cc-list"></div>';
    const search = root.querySelector('.cc-search');
    const list = root.querySelector('.cc-list');
    let chats = [];
    let loading = false;

    const render = () => {
      const q = search.value.trim().toLowerCase();
      const shown = chats.filter(c => !q || c.title.toLowerCase().includes(q) || (c.cwd || '').toLowerCase().includes(q));
      list.textContent = '';
      if (!shown.length) {
        const empty = document.createElement('div');
        empty.className = 'sbr-empty';
        empty.textContent = loading ? 'Loading…' : q ? 'No matching chats.' : 'No Claude chats found in ~/.claude/projects.';
        list.appendChild(empty);
        return;
      }
      for (const c of shown) {
        const item = document.createElement('div');
        item.className = 'cc-item';
        item.title = `${c.title}\n${c.cwd || ''}\nClick to resume`;
        const title = document.createElement('div');
        title.className = 'cc-title';
        title.textContent = c.title;
        const meta = document.createElement('div');
        meta.className = 'cc-meta';
        meta.textContent = `${base(c.cwd)} · ${ago(c.mtime)}`;
        item.append(title, meta);
        item.addEventListener('click', () => {
          const cmd = String(api.config.get('command', 'claude --resume')).trim() || 'claude --resume';
          api.terminal.open({ cwd: c.cwd || undefined, cmd: `${cmd} ${c.id}`, label: c.title.slice(0, 40) });
        });
        list.appendChild(item);
      }
    };

    const refresh = async () => {
      if (loading) return;
      loading = true;
      render();
      try {
        const limit = Math.max(1, Math.min(500, Number(api.config.get('limit', 60)) || 60));
        chats = await loadChats(api, limit);
      } catch (e) {
        api.log('failed to load chats:', e);
      }
      loading = false;
      render();
    };

    search.addEventListener('input', render);
    root.querySelector('.cc-refresh').addEventListener('click', refresh);
    api.ui.addPanel({ id: 'claude-chats', label: 'Claude chats', icon: 'ph-chat-circle-text', el: root, onShow: refresh });
  },
  deactivate() { },
};
