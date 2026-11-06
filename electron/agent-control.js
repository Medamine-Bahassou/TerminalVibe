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
    if (p.mode !== undefined && !['tab', 'split'].includes(p.mode)) throw new Error('placement.mode must be tab or split');
    if (p.mode === 'tab' && (plan.layout?.split || ['split', 'sizes', 'before', 'compact'].some(key => p[key] !== undefined))) throw new Error('Tab placement requires one layout leaf and no split sizing options');
    if (p.split !== undefined && !['row', 'column'].includes(p.split)) throw new Error('placement.split must be row or column');
    if (p.before !== undefined && typeof p.before !== 'boolean') throw new Error('placement.before must be boolean');
    if (p.compact !== undefined && typeof p.compact !== 'boolean') throw new Error('placement.compact must be boolean');
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
      if (node.type !== undefined && !['terminal', 'browser'].includes(node.type)) throw new Error('Pane type must be terminal or browser');
      if (node.type === 'browser' || node.url !== undefined) {
        if (node.type === 'terminal' || node.argv !== undefined || node.cwd !== undefined) throw new Error('Browser panes use url, not argv or cwd');
        let url;
        try { url = typeof node.url === 'string' && new URL(node.url); } catch {}
        if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('Browser url must be an absolute http(s) URL');
        return;
      }
      if (node.returnToShell !== undefined && typeof node.returnToShell !== 'boolean') throw new Error('returnToShell must be boolean');
      if (!Array.isArray(node.argv) || !node.argv.length || node.argv.some(x => typeof x !== 'string' || x.includes('\0')) || !node.argv[0]) throw new Error('Each pane needs a nonempty argv array');
      if (typeof node.cwd !== 'string' || !path.isAbsolute(node.cwd) || !fs.statSync(node.cwd).isDirectory()) throw new Error('Each pane needs an existing absolute cwd');
    }
  }
  visit(plan.layout, 0);
  return plan;
}

// An updated backend may still be connected to a pre-update page. Never send
// it a browser mutation: old launch handlers build terminal slots before failing.
async function dispatchWithCapabilities(request, dispatch) {
  const hasBrowser = node => !!node && (node.type === 'browser' || node.url !== undefined ||
    (Array.isArray(node.children) && node.children.some(hasBrowser)));
  if (request.method === 'launch' && request.params?.placement?.mode === 'tab') {
    const state = await dispatch({ method: 'list', params: {} });
    if (!state.capabilities?.launchAsTab) throw new Error('The running TerminalVibe page lacks launchAsTab. No panes were changed. Save active terminal work, then refresh the page or restart Electron to load the update.');
  }
  const capability = request.method === 'navigate' ? 'browserNavigate'
    : request.method === 'launch' && hasBrowser(request.params?.layout) ? 'browserLaunch' : null;
  if (capability) {
    const state = await dispatch({ method: 'list', params: {} });
    if (!state.capabilities?.[capability]) throw new Error(
      `The running TerminalVibe page lacks ${capability}. No panes were changed. Save active terminal work, then refresh the page or restart the Electron app to load the update.`);
  }
  return dispatch(request);
}

function canReplaceSession(info, allowClaude = false) {
  return info?.running === false || (allowClaude && info?.running === true && /^(claude|claude-code)(\.exe)?$/i.test(info.name || ''));
}

module.exports = { startAgentControl, validateLaunch, dispatchWithCapabilities, canReplaceSession };
