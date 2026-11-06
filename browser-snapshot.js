// Shared, fixed read-only snapshot for iframe documents and Electron guests.
(function () {
  function snapshotBrowserPage(doc, options = {}) {
    const maxChars = options.maxChars ?? 20000, offset = options.offset ?? 0;
    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 100000 ||
        !Number.isInteger(offset) || offset < 0) throw new Error('Use maxChars 1–100000 and a nonnegative integer offset');
    const full = options.full === true;
    const limit = (value, size) => full ? value : value.slice(0, size);
    const win = doc.defaultView;
    const visible = el => {
      const style = win.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0;
    };
    const text = doc.body?.innerText || '';
    const links = Array.from(doc.querySelectorAll('a[href]')).filter(visible);
    const controls = Array.from(doc.querySelectorAll('input, textarea, select, button')).filter(visible);
    return {
      url: doc.location.href, title: doc.title, readyState: doc.readyState,
      text: full ? text : text.slice(offset, offset + maxChars), offset, totalChars: text.length,
      truncated: !full && offset + maxChars < text.length,
      links: limit(links, 100).map(el => ({ text: limit(el.innerText || el.getAttribute('aria-label') || '', 500), url: el.href })),
      linksTruncated: !full && links.length > 100,
      controls: limit(controls, 100).map(el => ({
        tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '',
        label: limit(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.placeholder || el.innerText || '', 500),
        ...(el.type === 'password' || el.type === 'file' ? { redacted: true } : { value: limit(String(el.value || ''), 2000) })
      })),
      controlsTruncated: !full && controls.length > 100,
      limitations: 'Main document only; nested frames, closed shadow DOM, canvas and images may contain additional content.'
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = snapshotBrowserPage;
  else globalThis.snapshotBrowserPage = snapshotBrowserPage;
})();
