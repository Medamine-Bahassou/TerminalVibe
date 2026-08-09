#!/usr/bin/env node
/**
 * Assembles vendor/ from installed node_modules (gitignored, never committed).
 * index.html loads these at runtime; build-dist.js copies them into dist/.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'vendor');

const cp = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[vendor]', path.relative(root, dest));
};

fs.rmSync(vendor, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });

// xterm + addons (UMD bundles)
const xtermDst = path.join(vendor, 'xterm');
cp(path.join(root, 'node_modules/xterm/lib/xterm.js'), path.join(xtermDst, 'xterm.js'));
cp(path.join(root, 'node_modules/xterm/css/xterm.css'), path.join(xtermDst, 'xterm.css'));
for (const addon of ['fit', 'web-links', 'search', 'unicode11', 'webgl']) {
  const name = `xterm-addon-${addon}`;
  cp(path.join(root, `node_modules/${name}/lib/${name}.js`), path.join(xtermDst, `${name}.js`));
}

// split.js
cp(path.join(root, 'node_modules/split.js/dist/split.min.js'), path.join(vendor, 'split.min.js'));

// embedpdf
cp(path.join(root, 'node_modules/@embedpdf/snippet/dist/embedpdf.js'), path.join(vendor, 'embedpdf', 'embedpdf.js'));

// coloris — copy the real @melloware/coloris UMD build out of node_modules
cp(path.join(root, 'node_modules/@melloware/coloris/dist/umd/coloris.min.js'), path.join(vendor, 'coloris.min.js'));
cp(path.join(root, 'node_modules/@melloware/coloris/dist/coloris.min.css'), path.join(vendor, 'coloris.min.css'));

console.log('[vendor] done →', vendor);
