#!/usr/bin/env node
/**
 * Builds dist/ for the Electron app: copies the frontend assets (the packaged
 * app loads dist/index.html via loadFile).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

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

// Copy all vendor assets (coloris, split) to dist/vendor/
// index.html references them with the vendor/ prefix
for (const f of ['coloris.min.css', 'coloris.min.js', 'split.min.js']) {
  const src = path.join(root, 'vendor', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, 'vendor', f));
}

console.log('[build] dist/ written to', dist);
