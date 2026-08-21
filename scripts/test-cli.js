#!/usr/bin/env node
// CLI grammar test — runs `npm test` to verify the terminalvibe subcommand CLI.
// Loads the pure functions out of main.js (grammar + YAML blocks) into a vm
// sandbox, plus a syntax check on the two edited source files.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'electron', 'main.js');
const APP = path.join(ROOT, 'app.js');

let pass = 0, fail = 0;
const assert = (cond, msg) => (cond ? pass++ : (fail++, console.log('  FAIL:', msg)));

// ── 1. syntax check the edited sources ──
for (const f of [MAIN, APP]) {
  try { cp.execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); assert(true, `syntax ${path.basename(f)}`); }
  catch (e) { assert(false, `syntax ${path.basename(f)}: ${e.stderr}`); }
}
// js-yaml must be installed (bundled into the build)
let hasYaml = false;
try { hasYaml = !!require(path.join(ROOT, 'node_modules', 'js-yaml')); } catch {}
assert(hasYaml, 'js-yaml installed');

// ── 2. load CLI functions into a sandbox ──
const src = fs.readFileSync(MAIN, 'utf-8');
const grammar = src.slice(src.indexOf('// ── CLI subcommand grammar ──'), src.indexOf('// ── Window ──'));
const yamlBlock = src.slice(src.indexOf('function entryFromYaml'), src.indexOf('function headlessList'));
const yaml = require(path.join(ROOT, 'node_modules', 'js-yaml'));
const sandbox = { yaml, process: { argv: ['node', 'main.js'] }, Date, Math, console, JSON, require, Buffer, fs };
vm.createContext(sandbox);
vm.runInContext(grammar + '\n' + yamlBlock, sandbox);
const run = (...argv) => { sandbox.process.argv = ['node', 'main.js', ...argv]; return sandbox.parseCli(); };
const build = (d) => sandbox.generateCliState(d);

// ── 3. `new` layout building ──
let s = run('new', 'Fullstack', '-t', 'editor:terminal:nvim .', '-s', 'v', 'backend:terminal:python runserver');
let st = build(s);
assert(st.workspaces.length === 1 && st.workspaces[0].label === 'Fullstack', 'new: 1 ws "Fullstack"');
assert(st.workspaces[0].layout.type === 'split' && st.workspaces[0].layout.direction === 'column', 'new: root vertical(top/bottom) split');
assert(st.workspaces[0].layout.children[0].terminals[0].argv.join(',') === 'nvim,.', 'new: argv "nvim ."');
assert(st.workspaces[0].layout.children[1].terminals[0].argv.join(',') === 'python,runserver', 'new: argv "python runserver"');

s = run('new', 'Dev', '-t', 'web:browser:https://example.com', '-t', 'logs:terminal:tail -f log.txt');
st = build(s);
assert(st.workspaces[0].layout.type === 'group' && st.workspaces[0].layout.terminals.length === 2, 'new: 2 tabs in one group');
assert(st.workspaces[0].layout.terminals[0].type === 'browser' && st.workspaces[0].layout.terminals[0].url === 'https://example.com', 'new: browser tab url');
assert(st.workspaces[0].layout.terminals[1].argv.join(',') === 'tail,-f,log.txt', 'new: tail argv');

// ── 4. nested --split-back ──
s = run('new', 'W', '-t', 'a:terminal:x', '-s', 'v', 'b:terminal:y', '-s', 'h', 'c:terminal:z', '--split-back', '-s', 'v', 'd:terminal:w');
st = build(s);
const L = st.workspaces[0].layout;
assert(L.children[0].terminals[0].label === 'a', 'back: outer child a');
assert(L.children[1].direction === 'column', 'back: S2 column');
assert(L.children[1].children[0].direction === 'row', 'back: inner row');
assert(L.children[1].children[0].children[1].terminals[0].label === 'c', 'back: c in inner');
assert(L.children[1].children[1].terminals[0].label === 'd', 'back: d splits S2');

// ── 5. multi-workspace + positional name ──
s = run('new', 'First', '-t', 'x:terminal:p', '--workspace', 'Second', '-t', 'y:terminal:q');
st = build(s);
assert(st.workspaces.length === 2 && st.workspaces[0].label === 'First' && st.workspaces[1].label === 'Second', 'new: positional + --workspace');

// ── 6. splitArgs quoting ──
assert(sandbox.splitArgs('nvim .').join(',') === 'nvim,.', 'splitArgs: simple');
assert(sandbox.splitArgs('echo "hello world"').join(',') === 'echo,hello world', 'splitArgs: double quote');
assert(sandbox.splitArgs("git commit -m 'fix bug'").join(',') === 'git,commit,-m,fix bug', 'splitArgs: single quote');
assert(sandbox.splitArgs('').length === 0, 'splitArgs: empty');

// ── 7. tab spec parsing ──
assert(sandbox.parseTabSpec('code:terminal:nvim .').cmd === 'nvim .', 'spec: terminal cmd');
assert(sandbox.parseTabSpec('w:browser:https://x.com').url === 'https://x.com', 'spec: browser url');
assert(sandbox.parseTabSpec('plain').label === 'plain', 'spec: bare label');

// ── 8. list / close / attach parse ──
assert(run('list').cmd === 'list', 'cmd: list');
const c1 = run('close', 'My Workspace');
assert(c1.cmd === 'close' && c1.name === 'My Workspace', 'cmd: close NAME');
const c2 = run('attach', 'Foo', '--profile', 'abc');
assert(c2.cmd === 'attach' && c2.name === 'Foo' && c2.profile === 'abc', 'cmd: attach + --profile');

// ── 9. create parse ──
const c3 = run('create', '-f', 'workspaces.yaml', '-w', 'A');
assert(c3.cmd === 'create' && c3.file === 'workspaces.yaml' && c3.filters.join(',') === 'A', 'cmd: create -f -w');

// ── 10. YAML create (nested split + filter) ──
const wfile = path.join(ROOT, '.test-workspaces.yaml');
fs.writeFileSync(wfile, `
workspaces:
  - name: Fullstack
    tabs:
      - name: editor
        type: terminal
        command: nvim .
      - name: web
        type: browser
        url: https://localhost:3000
        split:
          direction: horizontal
          panes:
            - name: logs
              type: terminal
              command: tail -f log.txt
  - name: Ops
    tabs:
      - name: api
        type: terminal
        command: python runserver
`);
st = sandbox.buildStateFromYaml({ cmd: 'create', file: wfile, filters: [], cwd: null });
const w1 = st.workspaces[0];
assert(st.workspaces.length === 2 && w1.label === 'Fullstack' && st.workspaces[1].label === 'Ops', 'yaml: 2 workspaces');
assert(w1.layout.children[0].terminals[0].argv.join(',') === 'nvim,.', 'yaml: editor argv');
const webSplit = w1.layout.children[1];
assert(webSplit.direction === 'row' && webSplit.children[0].terminals[0].url === 'https://localhost:3000', 'yaml: nested browser split');
assert(webSplit.children[1].terminals[0].argv.join(',') === 'tail,-f,log.txt', 'yaml: nested logs argv');
const filt = sandbox.buildStateFromYaml({ cmd: 'create', file: wfile, filters: ['Ops'], cwd: null });
assert(filt.workspaces.length === 1 && filt.workspaces[0].label === 'Ops', 'yaml: -w filter');
fs.unlinkSync(wfile);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
