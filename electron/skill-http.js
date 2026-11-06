// Shared by the browser PTY server and frontend dev server.
function handleSkillRequest(req, res, skillManager) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  // Require a loopback Host and same-origin JSON for filesystem mutations.
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)) {
    res.writeHead(403); res.end(JSON.stringify({ error: 'Invalid origin' })); return;
  }
  if (req.method === 'GET') {
    try { res.end(JSON.stringify(skillManager.list())); }
    catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
    return;
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Use GET or POST' })); return; }
  if (req.headers['content-type'] !== 'application/json' || req.headers.origin !== `http://${host}`) {
    res.writeHead(403); res.end(JSON.stringify({ error: 'Use same-origin JSON' })); return;
  }
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on('end', () => {
    try {
      const { id, enabled } = JSON.parse(body);
      res.end(JSON.stringify(skillManager.setEnabled(id, enabled)));
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
  });
}

module.exports = { handleSkillRequest };
