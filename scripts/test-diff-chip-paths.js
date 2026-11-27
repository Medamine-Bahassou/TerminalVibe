// openChatDiffAt's path matching: one file under its WSL, Linux and relative spellings.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const norm = eval(src.match(/const norm = (s => [^;]+);/)[1]);
const same = eval(src.match(/const same = (\(a, b\) => \{[^}]+\});/)[1]);
assert(same('\\\\wsl.localhost\\Ubuntu\\home\\med\\app.js', '/home/med/app.js'));
assert(same('/home/med/app.js', '\\\\wsl.localhost\\Ubuntu\\home\\med\\app.js'));
assert(same('app.js', '/home/med/app.js'));
assert(same('scripts\\build.js', '/home/med/scripts/build.js'));
assert(!same('xapp.js', '/home/med/app.js'));
assert(!same('/home/med/a/app.js', '/home/med/b/app.js'));
console.log('PASS: diff chip paths match across spellings', typeof norm);
