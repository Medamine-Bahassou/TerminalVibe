// Full-screen transparent overlay that tracks the mouse while a terminal tab
// is dragged from a detached window back into the main window. HTML5
// drag-and-drop cannot cross BrowserWindows, so the overlay (always on top,
// covering every display) reports the global cursor position and the release.
//
// The overlay also renders the drag "ghost" — a screenshot of the tab button
// captured by the main process (or a labeled pill fallback) — and moves it
// with the cursor locally, so the ghost never adds IPC traffic.
//
// mousemove can fire far faster than the display can paint, so events are
// coalesced with requestAnimationFrame — at most one IPC per frame — and
// positions that haven't actually changed are dropped.
const { ipcRenderer } = require('electron');

let pending = null;   // latest unsent position
let raf = null;       // scheduled flush
let lastSent = null;  // last position actually sent
let lastPos = null;   // last known { sx, sy } (pending or sent)
let ghost = null;     // { el, w, h } drag ghost element
let lastGhostPos = null;

function setGhostPos(sx, sy) {
  if (!ghost) return;
  const left = sx - window.screenX + 14; // small offset so the ghost
  const top = sy - window.screenY + 16;  // doesn't sit under the cursor
  if (lastGhostPos && lastGhostPos.left === left && lastGhostPos.top === top) return;
  lastGhostPos = { left, top };
  // transform (compositor-only) instead of left/top so moving costs no layout
  ghost.el.style.transform = `translate(${left}px, ${top}px)`;
}

function showGhost({ dataUrl, label, width, height }) {
  if (ghost) { ghost.el.remove(); ghost = null; }
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:0;top:0;z-index:9999;pointer-events:none;' +
    'will-change:transform;opacity:.92;filter:drop-shadow(0 8px 16px rgba(0,0,0,.45));';
  if (dataUrl) {
    el.style.backgroundImage = `url(${dataUrl})`;
    el.style.backgroundSize = '100% 100%';
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  } else {
    // Fallback: a simple pill with the terminal's name
    el.style.cssText +=
      'display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;' +
      'background:#2b2f36;color:#e8eaed;border:1px solid #4b5261;' +
      'font:13px system-ui,sans-serif;white-space:nowrap;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#4c9aff;flex:none;';
    el.appendChild(dot);
    el.appendChild(document.createTextNode(label || 'terminal'));
  }
  document.body.appendChild(el);
  ghost = { el, w: width, h: height };
  lastGhostPos = null;
  if (pending) setGhostPos(pending.sx, pending.sy);
}

function removeGhost() {
  if (ghost) { ghost.el.remove(); ghost = null; }
  lastGhostPos = null;
}

function flush() {
  raf = null;
  if (!pending) return;
  const p = pending;
  pending = null;
  lastPos = p;
  setGhostPos(p.sx, p.sy);
  if (lastSent && lastSent.sx === p.sx && lastSent.sy === p.sy) return;
  lastSent = p;
  ipcRenderer.send('drag:move', p);
}

window.addEventListener('mousemove', (e) => {
  pending = { sx: e.screenX, sy: e.screenY };
  if (!raf) raf = requestAnimationFrame(flush);
});

function endDrag(cancelled) {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  pending = null;
  const pos = lastPos || lastSent || null;
  removeGhost();
  ipcRenderer.send('drag:end', {
    sx: pos ? pos.sx : 0,
    sy: pos ? pos.sy : 0,
    cancelled: !!cancelled,
  });
}

window.addEventListener('mouseup', () => endDrag(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') endDrag(true);
});

ipcRenderer.on('drag:ghost', (_e, g) => showGhost(g));
