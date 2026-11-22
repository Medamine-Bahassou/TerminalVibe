#!/usr/bin/env node
/**
 * Builds vendor/lucide/{icons.css,lucide.woff2}: the Lucide icon font plus
 * `ph ph-<name>` classes. The app (and saved workspace icon refs)
 * name icons with the old Phosphor class names, so each one is aliased here to
 * a Lucide glyph.
 *
 * Add an icon: map its name below (value = Lucide name, see
 * node_modules/lucide-static/icons/). An unmapped `ph-x` renders nothing.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'lucide-static', 'font');
const out = path.join(root, 'vendor', 'lucide');

const PH_TO_LUCIDE = {
  'arrow-bend-down-right': 'corner-down-right', 'arrow-bend-up-left': 'corner-up-left',
  'arrow-clockwise': 'rotate-cw', 'arrow-counter-clockwise': 'rotate-ccw',
  'arrow-elbow-up-right': 'corner-up-right', 'arrow-left': 'arrow-left', 'arrow-line-right': 'arrow-right-to-line',
  'arrow-right': 'arrow-right', 'arrows-clockwise': 'refresh-cw', 'arrows-down-up': 'arrow-down-up',
  'arrows-left-right': 'arrow-left-right', 'arrows-out': 'expand', 'arrow-square-out': 'external-link',
  'arrow-up': 'arrow-up', 'arrow-up-right': 'arrow-up-right', 'arrow-u-up-left': 'undo-2',
  'brackets-curly': 'braces', 'brain': 'brain', 'browser': 'app-window', 'browsers': 'app-window',
  'caret-double-down': 'chevrons-down', 'caret-double-up': 'chevrons-up', 'caret-down': 'chevron-down',
  'caret-right': 'chevron-right', 'caret-up': 'chevron-up', 'caret-left': 'chevron-left',
  'chart-bar': 'chart-column', 'chat-circle-dots': 'message-circle-more', 'chat-circle-text': 'message-circle',
  'chats-circle': 'messages-square', 'check': 'check', 'check-circle': 'circle-check', 'circle': 'circle',
  'circle-dot': 'circle-dot', 'circle-half': 'contrast', 'circle-notch': 'loader-circle',
  'clipboard-text': 'clipboard-list', 'clock': 'clock', 'clock-counter-clockwise': 'history', 'cloud': 'cloud',
  'code': 'code', 'columns': 'columns-2', 'copy': 'copy', 'corners-in': 'minimize', 'corners-out': 'maximize',
  'dot': 'dot', 'dots-three': 'ellipsis', 'dots-three-vertical': 'ellipsis-vertical', 'eraser': 'eraser',
  'eye': 'eye', 'faders-horizontal': 'sliders-horizontal', 'flip-horizontal': 'flip-horizontal-2',
  'file': 'file', 'file-archive': 'file-archive', 'file-c': 'file-code', 'file-code': 'file-code',
  'file-diff': 'file-diff',
  'file-cpp': 'file-code', 'file-css': 'file-code', 'file-csv': 'file-spreadsheet', 'file-html': 'file-code',
  'file-image': 'file-image', 'file-ini': 'file-cog', 'file-jpg': 'file-image', 'file-js': 'file-code',
  'file-jsx': 'file-code', 'file-md': 'file-text', 'file-pdf': 'file-text', 'file-png': 'file-image',
  'file-py': 'file-code', 'file-rs': 'file-code', 'file-sql': 'file-code', 'file-svg': 'file-image',
  'file-text': 'file-text', 'file-ts': 'file-code', 'file-tsx': 'file-code', 'file-txt': 'file-text',
  'file-vue': 'file-code', 'folder': 'folder', 'folder-minus': 'folder-minus', 'folder-open': 'folder-open',
  'folder-plus': 'folder-plus', 'folders': 'folders', 'folder-simple': 'folder', 'folder-simple-plus': 'folder-plus',
  'funnel-simple': 'list-filter', 'gauge': 'gauge', 'gear': 'settings', 'gear-six': 'settings',
  'git-branch': 'git-branch', 'git-commit': 'git-commit-horizontal', 'git-fork': 'git-fork', 'git-merge': 'git-merge',
  'git-pull-request': 'git-pull-request', 'globe': 'globe', 'globe-hemisphere-west': 'earth', 'hammer': 'hammer',
  'hand-pointing': 'pointer', 'hand-wave': 'hand', 'hard-drives': 'hard-drive', 'image': 'image',
  'infinity': 'infinity', 'info': 'info', 'keyboard': 'keyboard', 'lightning': 'zap', 'linux-logo': 'terminal',
  'list-checks': 'list-checks', 'lock': 'lock', 'lock-simple': 'lock', 'lock-simple-open': 'lock-open',
  'magic-wand': 'wand-sparkles', 'magnifying-glass': 'search', 'magnifying-glass-minus': 'zoom-out',
  'magnifying-glass-plus': 'zoom-in', 'minus-circle': 'circle-minus', 'note-pencil': 'square-pen',
  'open-ai-logo': 'bot', 'paperclip': 'paperclip', 'pause': 'pause', 'pencil-simple': 'pencil',
  'pencil-simple-line': 'pen-line', 'play': 'play', 'plus': 'plus', 'push-pin': 'pin', 'push-pin-simple': 'pin',
  'push-pin-slash': 'pin-off', 'puzzle-piece': 'puzzle', 'quotes': 'quote', 'robot': 'bot', 'rows': 'rows-2',
  'selection': 'square-dashed', 'selection-all': 'square-dashed-mouse-pointer', 'shield': 'shield',
  'shield-slash': 'shield-off', 'sidebar-simple': 'panel-left', 'shapes': 'shapes', 'arrow-square-in': 'square-arrow-down-left', 'sign-in': 'log-in',
  'sliders-horizontal': 'sliders-horizontal', 'sort-ascending': 'arrow-up-narrow-wide',
  'sort-descending': 'arrow-down-wide-narrow', 'sparkle': 'sparkle', 'square': 'square',
  'squares-four': 'layout-grid', 'square-split-horizontal': 'columns-2', 'square-split-vertical': 'rows-2',
  'stack': 'layers', 'star': 'star', 'stop': 'square', 'stop-circle': 'circle-stop', 'sun': 'sun',
  'terminal': 'terminal', 'terminal-window': 'square-terminal', 'text-aa': 'type', 'text-t': 'type',
  'timer': 'timer', 'trash': 'trash-2', 'trend-down': 'trending-down', 'trend-up': 'trending-up', 'user': 'user',
  'user-circle': 'circle-user', 'users': 'users', 'user-switch': 'user-round-cog', 'warning': 'triangle-alert',
  'warning-circle': 'circle-alert', 'wrench': 'wrench', 'x': 'x', 'x-circle': 'circle-x', 'x-square': 'square-x',
  // A2UI 1.0 basic catalog Icon names (a2ui.js renders `ph-a2ui-<name>`).
  'a2ui-accountCircle': 'circle-user', 'a2ui-add': 'plus', 'a2ui-arrowBack': 'arrow-left', 'a2ui-arrowForward': 'arrow-right',
  'a2ui-attachFile': 'paperclip', 'a2ui-calendarToday': 'calendar', 'a2ui-call': 'phone', 'a2ui-camera': 'camera',
  'a2ui-check': 'check', 'a2ui-close': 'x', 'a2ui-delete': 'trash-2', 'a2ui-download': 'download', 'a2ui-edit': 'pencil',
  'a2ui-event': 'calendar-days', 'a2ui-error': 'circle-alert', 'a2ui-fastForward': 'fast-forward', 'a2ui-favorite': 'heart',
  'a2ui-favoriteOff': 'heart-off', 'a2ui-folder': 'folder', 'a2ui-help': 'circle-help', 'a2ui-home': 'house', 'a2ui-info': 'info',
  'a2ui-locationOn': 'map-pin', 'a2ui-lock': 'lock', 'a2ui-lockOpen': 'lock-open', 'a2ui-mail': 'mail', 'a2ui-menu': 'menu',
  'a2ui-moreVert': 'ellipsis-vertical', 'a2ui-moreHoriz': 'ellipsis', 'a2ui-notificationsOff': 'bell-off',
  'a2ui-notifications': 'bell', 'a2ui-pause': 'pause', 'a2ui-payment': 'credit-card', 'a2ui-person': 'user',
  'a2ui-phone': 'smartphone', 'a2ui-photo': 'image', 'a2ui-play': 'play', 'a2ui-print': 'printer', 'a2ui-refresh': 'refresh-cw',
  'a2ui-rewind': 'rewind', 'a2ui-search': 'search', 'a2ui-send': 'send', 'a2ui-settings': 'settings', 'a2ui-share': 'share-2',
  'a2ui-shoppingCart': 'shopping-cart', 'a2ui-skipNext': 'skip-forward', 'a2ui-skipPrevious': 'skip-back', 'a2ui-star': 'star',
  'a2ui-starHalf': 'star-half', 'a2ui-starOff': 'star-off', 'a2ui-stop': 'square', 'a2ui-upload': 'upload',
  'a2ui-visibility': 'eye', 'a2ui-visibilityOff': 'eye-off', 'a2ui-volumeDown': 'volume-1', 'a2ui-volumeMute': 'volume',
  'a2ui-volumeOff': 'volume-x', 'a2ui-volumeUp': 'volume-2', 'a2ui-warning': 'triangle-alert',
};

const codepoints = JSON.parse(fs.readFileSync(path.join(src, 'codepoints.json'), 'utf8'));
const glyph = name => {
  const cp = codepoints[name];
  if (cp == null) throw new Error(`[icons] unknown Lucide icon: ${name}`);
  return `"\\${cp.toString(16)}"`;
};

fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(src, 'lucide.woff2'), path.join(out, 'lucide.woff2'));
const css = [
  '/* Generated by scripts/build-icons.js — do not edit. */',
  '@font-face { font-family:"lucide"; src:url("lucide.woff2") format("woff2"); font-display:block; }',
  '.ph { font-family:"lucide" !important; font-style:normal; font-weight:normal;',
  '  speak:never; font-variant:normal; text-transform:none; line-height:1; display:inline-block;',
  '  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; }',
  ...Object.entries(PH_TO_LUCIDE).map(([ph, lu]) => `.ph-${ph}::before { content:${glyph(lu)}; }`),
].join('\n') + '\n';
fs.writeFileSync(path.join(out, 'icons.css'), css);
// Every Lucide icon's codepoint, for the workspace icon picker (loaded on demand, not at launch).
fs.writeFileSync(path.join(out, 'names.js'), `window.LUCIDE_CODEPOINTS=${JSON.stringify(codepoints)};\n`);
console.log(`[icons] ${Object.keys(PH_TO_LUCIDE).length} aliases → vendor/lucide/icons.css`);

module.exports = { PH_TO_LUCIDE };
