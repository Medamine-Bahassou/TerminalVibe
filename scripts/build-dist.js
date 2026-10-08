#!/usr/bin/env node
/**
 * Builds dist/ for the Electron app: copies the frontend assets (the packaged
 * app loads dist/index.html via loadFile).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const vendorDir = path.join(root, 'vendor');

// vendor/ is gitignored and never committed, so on a fresh checkout (e.g. CI)
// it does not exist. Rebuild any missing vendor file straight from
// node_modules — same mapping as scripts/build-vendor.js — instead of
// shipping a dist/ with 404ing <script> tags (which used to kill app.js
// before boot and leave the packaged app stuck on the splash screen).
function ensureVendorFile(vendorRel, nmRel) {
  const dst = path.join(vendorDir, vendorRel);
  if (fs.existsSync(dst)) return;
  const src = path.join(root, nmRel);
  if (!fs.existsSync(src)) {
    throw new Error(`[build] missing vendor source: ${nmRel} (needed for vendor/${vendorRel})`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('[build] vendor rebuilt from node_modules:', vendorRel);
}

ensureVendorFile(path.join('xterm', 'xterm.js'), path.join('node_modules', 'xterm', 'lib', 'xterm.js'));
ensureVendorFile(path.join('xterm', 'xterm.css'), path.join('node_modules', 'xterm', 'css', 'xterm.css'));
for (const addon of ['fit', 'web-links', 'search', 'unicode11', 'webgl']) {
  const name = `xterm-addon-${addon}`;
  ensureVendorFile(path.join('xterm', `${name}.js`), path.join('node_modules', name, 'lib', `${name}.js`));
}
ensureVendorFile('split.min.js', path.join('node_modules', 'split.js', 'dist', 'split.min.js'));
ensureVendorFile('coloris.min.js', path.join('node_modules', '@melloware', 'coloris', 'dist', 'umd', 'coloris.min.js'));
ensureVendorFile('coloris.min.css', path.join('node_modules', '@melloware', 'coloris', 'dist', 'coloris.min.css'));

const assets = ['index.html', 'app.js', 'style.css', 'logo.png', 'logo-app.svg'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'vendor', 'xterm'), { recursive: true });

for (const a of assets) {
  fs.copyFileSync(path.join(root, a), path.join(dist, a));
}

const vendorXterm = path.join(root, 'vendor', 'xterm');
fs.cpSync(vendorXterm, path.join(dist, 'vendor', 'xterm'), { recursive: true });

// Copy all vendor assets (coloris, split) to dist/vendor/
// index.html references them with the vendor/ prefix
for (const f of ['coloris.min.css', 'coloris.min.js', 'split.min.js']) {
  const src = path.join(root, 'vendor', f);
  if (!fs.existsSync(src)) throw new Error(`[build] missing vendor file: vendor/${f}`);
  fs.copyFileSync(src, path.join(dist, 'vendor', f));
}

// Final sanity check: every <script src="vendor/..."> in index.html must
// exist in dist/, otherwise the packaged app would boot to a stuck splash.
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf-8');
const missing = [];
for (const m of html.matchAll(/src="(vendor\/[^"]+)"/g)) {
  if (!fs.existsSync(path.join(dist, m[1]))) missing.push(m[1]);
}
for (const m of html.matchAll(/href="(vendor\/[^"]+)"/g)) {
  if (!fs.existsSync(path.join(dist, m[1]))) missing.push(m[1]);
}
if (missing.length) throw new Error('[build] dist/ missing referenced assets: ' + [...new Set(missing)].join(', '));

console.log('[build] dist/ written to', dist);
