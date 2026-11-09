#!/usr/bin/env node
/**
 * Generates vendor/tailwind.css: only the utility classes the frontend
 * actually uses. Replaces the Tailwind CDN script, which compiled CSS in the
 * renderer and re-scanned the DOM on every mutation.
 * Rerun (or run build-dist.js) after adding a new Tailwind class.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

execFileSync(process.execPath, [
  require.resolve('tailwindcss/lib/cli.js'),
  '--content', './index.html,./app.js,./session-drawer.js',
  '-o', path.join('vendor', 'tailwind.css'),
  '--minify',
], { cwd: root, stdio: 'pipe' });
console.log('[vendor] vendor/tailwind.css');
