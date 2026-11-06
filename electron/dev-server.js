// Dev-mode static server: serves the project root (index.html, app.js, style.css, vendor/, logo).
// In production the window loads dist/index.html directly via loadFile.
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = parseInt(process.env.APP_PORT || '7769', 10);
const ROOT = path.join(__dirname, '..');
const skillManager = require('./skill-manager').createSkillManager();

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

http.createServer((req, res) => {
  // npm run dev also serves the UI from this origin. Keep local history
  // available here rather than letting /api requests fall through to files.
  const parsed = new URL(req.url, `http://${HOST}:${PORT}`);
  if (parsed.pathname === '/api/skills') {
    require('./skill-http').handleSkillRequest(req, res, skillManager);
    return;
  }
  if (parsed.pathname === '/api/claude-sessions') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) { res.writeHead(403); res.end(JSON.stringify({ error:'Invalid origin' })); return; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(JSON.stringify({ error:'Use GET' })); return; }
    require('./claude-sessions').listClaudeSessions(parsed.searchParams.get('cwd')).then(
      data => res.end(JSON.stringify(data)),
      error => { res.writeHead(400); res.end(JSON.stringify({ error:error.message })); });
    return;
  }
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, HOST, () => console.log(`[dev-server] Serving ${ROOT} on http://${HOST}:${PORT}`));
