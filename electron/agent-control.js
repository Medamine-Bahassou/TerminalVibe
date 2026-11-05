// Authenticated, per-instance loopback RPC. No browser origins are accepted.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function startAgentControl({ directory, dispatch }) {
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `instance-${process.pid}.json`);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    if (req.headers.origin || req.headers.authorization !== `Bearer ${token}`) {
      reply(403, { error: 'Unauthorized' }); return;
    }
    if (req.method !== 'POST' || req.url !== '/rpc') { reply(404, { error: 'Use POST /rpc' }); return; }
    try {
      let body = '', size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) { reply(413, { error: 'Request too large' }); return; }
        body += chunk;
      }
      const request = JSON.parse(body);
      const result = await dispatch(request);
      reply(200, { result });
    } catch (err) { reply(400, { error: err.message }); }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const descriptor = { version: 1, pid: process.pid, url: `http://127.0.0.1:${server.address().port}/rpc`, token };
  fs.writeFileSync(file, JSON.stringify(descriptor), { mode: 0o600, flag: 'wx' });
  return { file, close() { server.close(); try { fs.unlinkSync(file); } catch {} } };
}

// Validate the entire launch plan before creating UI or processes.
function validateLaunch(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('A launch plan is required');
  const existing = plan.workspaceId !== undefined || plan.anchorPaneId !== undefined;
  if (!existing && (typeof plan.name !== 'string' || !plan.name.trim())) throw new Error('name is required for a new workspace');
  if (plan.workspaceId !== undefined && (typeof plan.workspaceId !== 'string' || !plan.workspaceId.trim())) throw new Error('workspaceId must be an ID or current');
  if (plan.anchorPaneId !== undefined && (typeof plan.anchorPaneId !== 'string' || !plan.anchorPaneId.trim())) throw new Error('anchorPaneId must be a pane ID');
  if (existing && plan.name !== undefined) throw new Error('Use name for a new workspace, or workspaceId/anchorPaneId for an existing workspace');
  if (plan.placement !== undefined) {
    const p = plan.placement;
    if (!existing || !p || typeof p !== 'object' || Array.isArray(p)) throw new Error('placement requires an existing workspace');
    if (p.split !== undefined && !['row', 'column'].includes(p.split)) throw new Error('placement.split must be row or column');
    if (p.before !== undefined && typeof p.before !== 'boolean') throw new Error('placement.before must be boolean');
    if (p.sizes !== undefined && (!Array.isArray(p.sizes) || p.sizes.length !== 2 || p.sizes.some(n => !Number.isFinite(n) || n <= 0) || Math.abs(p.sizes[0] + p.sizes[1] - 100) > 0.01)) throw new Error('placement.sizes must be two positive percentages totaling 100');
  }
  const names = new Set();
  let count = 0;
  function visit(node, depth) {
    if (!node || depth > 8) throw new Error('Invalid layout or layout too deep');
    if (node.split) {
      if (!['row', 'column'].includes(node.split) || !Array.isArray(node.children) || node.children.length !== 2) {
        throw new Error('Splits require row (left/right) or column (top/bottom), and two children');
      }
      if (node.sizes && (!Array.isArray(node.sizes) || node.sizes.length !== 2 ||
        node.sizes.some(x => !Number.isFinite(x) || x <= 0) || Math.abs(node.sizes[0] + node.sizes[1] - 100) > 0.01)) {
        throw new Error('sizes must be two positive percentages totaling 100');
      }
      node.children.forEach(child => visit(child, depth + 1));
    } else {
      if (++count > 16 || typeof node.name !== 'string' || !node.name.trim() || names.has(node.name)) throw new Error('Use 1–16 uniquely named panes');
      names.add(node.name);
      if (!Array.isArray(node.argv) || !node.argv.length || node.argv.some(x => typeof x !== 'string' || x.includes('\0')) || !node.argv[0]) throw new Error('Each pane needs a nonempty argv array');
      if (typeof node.cwd !== 'string' || !path.isAbsolute(node.cwd) || !fs.statSync(node.cwd).isDirectory()) throw new Error('Each pane needs an existing absolute cwd');
    }
  }
  visit(plan.layout, 0);
  return plan;
}

module.exports = { startAgentControl, validateLaunch };
