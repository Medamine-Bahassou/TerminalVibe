const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { gitInvocation, gitHostPath, runGit } = require('../electron/git-command');
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
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const { gitSnapshot, turnDiff } = new Function('fs', 'path', 'runGit', 'gitHostPath', 'require',
    slice('async function gitSnapshot(', "ipcMain.handle('git:snapshot'") +
    slice('async function turnDiff(', "ipcMain.handle('git:branches'") +
    'return { gitSnapshot, turnDiff };')(fs, path, runGit, gitHostPath, require('node:module').createRequire(path.join(__dirname, '../electron/main.js')));
  const wsl = process.platform === 'win32' && /^[\\/]{2}wsl/i.test(process.cwd());
  const root = fs.mkdtempSync(wsl ? gitHostPath(process.cwd(), '/tmp/tv-turn-git-') : path.join(os.tmpdir(), 'tv-turn-git-'));
  try {
    assert((await runGit(root, ['init'])).ok);
    const tracked = path.join(root, 'example.txt');
    fs.writeFileSync(tracked, 'staged line\n');
    assert((await runGit(root, ['add', 'example.txt'])).ok);
    const staged = (await runGit(root, ['ls-files', '--stage'])).out;
    const cwd = path.join(root, 'nested');
    fs.mkdirSync(cwd);
    const before = await gitSnapshot(cwd);
    assert(before?.tree, 'capture the worktree from a nested directory');
    fs.writeFileSync(tracked, 'edited line\n');
    fs.writeFileSync(path.join(root, 'new.txt'), 'untracked line\n');
    const after = await gitSnapshot(cwd);
    assert(after?.tree && after.tree !== before.tree, 'capture shell edits and untracked files');
    const files = await turnDiff(cwd, before.tree, after.tree);
    assert.deepEqual(files.map(file => [path.basename(file.path), file.add, file.del]), [['example.txt', 1, 1], ['new.txt', 1, 0]]);
    assert.equal((await runGit(root, ['ls-files', '--stage'])).out, staged, 'turn snapshots preserve the real staging area');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('PASS: WSL Git routing, literal arguments, branch listing, switching and turn snapshots');
})().catch(error => { console.error(error); process.exitCode = 1; });
