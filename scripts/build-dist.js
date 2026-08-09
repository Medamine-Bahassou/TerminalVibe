#!/usr/bin/env node
/**
 * Builds dist/ for the Electron app: copies the frontend assets (the packaged
 * app loads dist/index.html via loadFile). Also stages server-dist/ so the
 * Node backend can be shipped as extraResources in dev-like layouts.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const serverDist = path.join(root, 'src-tauri', 'server-dist');

const assets = ['index.html', 'app.js', 'style.css', 'logo.png', 'logo-app.svg'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'vendor', 'xterm'), { recursive: true });

for (const a of assets) {
  fs.copyFileSync(path.join(root, a), path.join(dist, a));
}

const vendorXterm = path.join(root, 'vendor', 'xterm');
if (fs.existsSync(vendorXterm)) {
  fs.cpSync(vendorXterm, path.join(dist, 'vendor', 'xterm'), { recursive: true });
} else {
  // Fall back to node_modules xterm (same package that vendor/ is built from)
  const nmXterm = path.join(root, 'node_modules', 'xterm', 'lib');
  if (fs.existsSync(nmXterm)) {
    fs.cpSync(nmXterm, path.join(dist, 'vendor', 'xterm'), { recursive: true });
    for (const addon of ['xterm-addon-fit', 'xterm-addon-web-links', 'xterm-addon-search', 'xterm-addon-unicode11', 'xterm-addon-webgl']) {
      const src = path.join(root, 'node_modules', addon, 'lib');
      if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(dist, 'vendor', 'xterm', addon.replace(/^xterm-addon-/, 'xterm-addon-')), { recursive: true });
      }
    }
  }
}

// Copy coloris assets
for (const f of ['coloris.min.css', 'coloris.min.js']) {
  const src = path.join(root, 'vendor', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
}

// Stage server-dist (also used by the old Tauri bundle layout)
fs.rmSync(serverDist, { recursive: true, force: true });
fs.mkdirSync(serverDist, { recursive: true });
fs.copyFileSync(path.join(root, 'server.js'), path.join(serverDist, 'server.js'));
for (const dep of ['ws', 'node-pty']) {
  fs.cpSync(path.join(root, 'node_modules', dep), path.join(serverDist, 'node_modules', dep), { recursive: true });
}

console.log('[build] dist/ written to', dist);
console.log('[build] server-dist/ staged at', serverDist);
