const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { gitInvocation, runGit } = require('../electron/git-command');
const args = ['switch', 'feature/example'];
for (const cwd of ['\\\\wsl.localhost\\Ubuntu\\home\\med\\My Project', '\\\\wsl$\\Ubuntu\\home\\med\\My Project', '//WSL.localhost/Ubuntu/home/med/My Project']) {
  const call = gitInvocation(cwd, args, 'win32', 'C:\\Windows');
  assert.equal(call.file, 'C:\\Windows\\System32\\wsl.exe');
  assert.deepEqual(call.args, ['--distribution', 'Ubuntu', '--cd', '/home/med/My Project', '--exec', 'git', ...args]);
  assert.equal(call.cwd, os.tmpdir(), 'WSL launch must not inherit an unsupported UNC working directory');
}
assert.equal(gitInvocation('\\\\wsl$\\Debian', ['status'], 'win32').args[3], '/');
const native = gitInvocation('C:\\Users\\user\\repo', ['status'], 'win32');
assert.equal(native.file, 'git'); assert.equal(native.cwd, 'C:\\Users\\user\\repo');
assert.equal(gitInvocation('/home/med/repo', ['status'], 'linux').file, 'git');
assert.deepEqual(gitInvocation('\\\\server\\share', ['status'], 'win32').args, ['status']);
const shellChars = gitInvocation('\\\\wsl.localhost\\Ubuntu\\home\\med\\repo;echo unsafe', ['switch', 'feature/test'], 'win32');
assert(shellChars.args.includes('/home/med/repo;echo unsafe'), 'paths must be literal argv entries, never shell code');
(async () => {
  if (process.platform === 'win32' && /^[\\/]{2}wsl/i.test(process.cwd())) {
    const result = await runGit(process.cwd(), ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    assert(result.ok, result.error); assert(result.out.trim(), 'the real WSL repository must list its branches');
  } else {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-git-'));
    const git = async args => { const r = await runGit(root, args); assert(r.ok, r.error); return r.out.trim(); };
    await git(['init']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial']);
    await git(['branch', 'feature/test']);
    assert((await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).includes('feature/test'));
    await git(['switch', 'feature/test']);
    assert.equal(await git(['branch', '--show-current']), 'feature/test');
    assert.equal((await runGit(root, ['switch', 'missing-branch'])).ok, false);
  }
  console.log('PASS: WSL Git routing, literal arguments, branch listing and switching');
})().catch(error => { console.error(error); process.exitCode = 1; });
