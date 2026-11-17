const assert = require('node:assert/strict');
const { releaseCandidates } = require('../electron/release-session');
const sid = '12345678-abcd';
const rows = [
 { pid: 10, ppid: 1, args: 'TerminalVibe.exe' },
 { pid: 20, ppid: 10, args: 'cmd.exe' },
 { pid: 21, ppid: 20, args: `codex resume ${sid}` },
 { pid: 30, ppid: 1, args: `"C:\\bin\\codex.exe" resume "${sid}"` },
 { pid: 31, ppid: 1, args: 'codex resume different-session' },
 { pid: 32, ppid: 1, args: `echo resume ${sid}` },
 { pid: 33, ppid: 1, args: `codex resume ${sid}-different` },
];
assert.deepEqual(releaseCandidates(rows, sid, 20, 10).map(p => p.pid), [30]);
assert.deepEqual(releaseCandidates(rows, sid, null), []);
assert.deepEqual(releaseCandidates(rows, 'bad', 20), []);
console.log('PASS: exact quoted Windows session matching; own process tree, ancestors and unrelated commands protected');
const { ownSessionId } = require('../electron/release-session');
const uuid = '12345678-abcd-1234-1234-123456789abc';
assert.equal(ownSessionId([
 { pid: 20, ppid: 10, args: 'powershell.exe' },
 { pid: 21, ppid: 20, args: `"C:\\bin\\codex.exe" resume "${uuid}"` },
 { pid: 30, ppid: 1, args: 'codex resume 99999999-abcd-1234-1234-123456789abc' },
], 20), uuid);
assert.equal(ownSessionId([{ pid: 30, ppid: 1, args: `codex resume ${uuid}` }], 20), null, 'never infer identity from another terminal');
console.log('PASS: missing session IDs recovered only from the requesting terminal');
