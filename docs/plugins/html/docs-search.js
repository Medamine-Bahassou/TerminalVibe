// Shared search for the static HTML plugin docs pages.
// Shows a cross-page dropdown of matching sections as you type, and
// highlights case-insensitive matches in the current page's content.
(() => {
  // Embedded index of every page + its headings, so this works over file://
  // where fetching sibling pages is blocked by CORS.
  const DOCS = {
    'index.html': [
      [1, 'TerminalVibe Plugin System'],
      [2, 'What are plugins?'],
      [2, 'What can plugins do?'],
      [2, 'How loading works'],
      [2, 'Install a plugin'],
      [2, 'Manage plugins'],
      [2, 'Quick start'],
      [2, 'Doc pages'],
    ],
    'manifest.html': [
      [1, 'Plugin Manifest (plugin.json)'],
      [2, 'Location'],
      [2, 'Fields'],
      [2, 'Settings (configurable options)'],
      [2, 'Example'],
      [2, 'Validation rules'],
      [2, 'Entry contract'],
      [2, 'Enable / disable'],
    ],
    'api-reference.html': [
      [1, 'Plugin API Reference'],
      [2, 'Identity & logging'],
      [2, 'Events'],
      [2, 'Commands + keybindings'],
      [2, 'Terminal I/O'],
      [2, 'Context-menu items'],
      [2, 'Themes'],
      [2, 'Configurable settings'],
      [2, 'UI widgets'],
      [2, 'Read-only state access'],
    ],
    'tutorial.html': [
      [1, 'Building a Plugin'],
      [2, '1. Scaffold the folder'],
      [2, '2. Log and register a command'],
      [2, '3. Watch lifecycle events'],
      [2, '4. Add a context-menu item'],
      [2, '5. Register a theme'],
      [2, '6. Add configurable options'],
      [2, '7. Add a status-bar widget'],
      [2, '8. Clean up on deactivate'],
      [2, '9. Restart and verify'],
      [2, 'Next steps'],
    ],
    'troubleshooting.html': [
      [1, 'Plugin Troubleshooting'],
      [2, 'Limitations'],
      [2, 'Debugging'],
      [3, 'See plugin logs'],
      [3, 'Plugin did not load'],
      [3, 'Keybinding does nothing'],
      [3, 'Menu item missing'],
      [3, 'Status bar / widget not visible'],
      [2, 'Security model'],
      [2, 'Error handling in your plugin'],
    ],
  };

  const PAGE = location.pathname.split('/').pop() || 'index.html';

  const all = [];
  for (const file in DOCS) {
    for (const [level, title] of DOCS[file]) all.push({ file, level, title });
  }

  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const input = document.getElementById('docs-search');
  const main = document.querySelector('.docs-main');
  if (!input || !main) return;

  // ── Cross-page dropdown ──
  const dd = document.createElement('div');
  dd.className = 'docs-dropdown';
  document.body.appendChild(dd);

  const highlight = (text, ql) => {
    const i = text.toLowerCase().indexOf(ql);
    if (i === -1) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + ql.length)) + '</mark>' + esc(text.slice(i + ql.length));
  };

  const openAt = q => {
    const ql = q.trim().toLowerCase();
    if (!ql) { dd.classList.remove('open'); return; }
    const hits = all.filter(s => s.title.toLowerCase().includes(ql)).slice(0, 24);
    if (!hits.length) { dd.classList.remove('open'); return; }
    dd.textContent = '';
    for (const h of hits) {
      const it = document.createElement('a');
      it.className = 'docs-dd-item';
      it.href = h.file + '#' + slug(h.title);
      it.innerHTML = '<span class="docs-dd-page">' + h.file.replace('.html', '') + '</span>'
        + '<span class="docs-dd-title">' + highlight(h.title, ql) + '</span>';
      dd.appendChild(it);
    }
    const r = input.getBoundingClientRect();
    dd.style.left = r.left + 'px';
    dd.style.top = (r.bottom + 4) + 'px';
    dd.style.width = Math.max(r.width, 280) + 'px';
    dd.classList.add('open');
  };

  input.addEventListener('input', () => openAt(input.value));

  // Enter jumps to the first suggestion.
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = dd.querySelector('.docs-dd-item');
      if (first) location.href = first.getAttribute('href');
    } else if (e.key === 'Escape') {
      dd.classList.remove('open');
    }
  });

  // Close on outside click or Escape; keep the click on a suggestion alive.
  document.addEventListener('mousedown', e => {
    if (!dd.contains(e.target) && e.target !== input) dd.classList.remove('open');
  });

  // ── Inline highlight of the current page (existing behavior) ──
  const original = main.innerHTML;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) { main.innerHTML = original; return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = original;
    walk(tmp);
    main.innerHTML = tmp.innerHTML;

    function walk(root) {
      const ql = q.toLowerCase();
      root.querySelectorAll('h1, h2, h3, h4, p, li, td, th, pre, blockquote').forEach(el => {
        if (el.querySelector('mark')) return;
        const nodes = Array.from(el.childNodes).filter(n => n.nodeType === 3);
        nodes.forEach(n => {
          const lower = n.nodeValue.toLowerCase();
          if (!lower.includes(ql)) return;
          const frag = document.createDocumentFragment();
          let rest = n.nodeValue;
          let idx = rest.toLowerCase().indexOf(ql);
          while (idx !== -1) {
            if (idx > 0) frag.appendChild(document.createTextNode(rest.slice(0, idx)));
            const mark = document.createElement('mark');
            mark.textContent = rest.slice(idx, idx + q.length);
            frag.appendChild(mark);
            rest = rest.slice(idx + q.length);
            idx = rest.toLowerCase().indexOf(ql);
          }
          if (rest) frag.appendChild(document.createTextNode(rest));
          el.replaceChild(frag, n);
        });
      });
    }
  });

  // ── Scroll to the section a suggestion pointed at (file#slug) ──
  if (location.hash) {
    const want = decodeURIComponent(location.hash.slice(1));
    const sec = (DOCS[PAGE] || []).find(s => slug(s[1]) === want);
    if (sec) {
      const h = [...document.querySelectorAll('h1, h2, h3, h4')]
        .find(e => slug(e.textContent.trim()) === want);
      if (h) {
        h.scrollIntoView({ block: 'start' });
        h.classList.add('docs-target');
        setTimeout(() => h.classList.remove('docs-target'), 2200);
      }
    }
  }
})();
