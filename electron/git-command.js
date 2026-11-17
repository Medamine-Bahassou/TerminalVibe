const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

function gitInvocation(cwd, args, platform = process.platform, systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  const wsl = platform === 'win32' && /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)([\\/].*)?$/i.exec(cwd);
  if (wsl) return {
    file: path.win32.join(systemRoot, 'System32', 'wsl.exe'),
    args: ['--distribution', wsl[1], '--cd', (wsl[2] || '/').replace(/\\/g, '/'), '--exec', 'git', ...args],
    cwd: os.tmpdir(),
  };
  return { file: 'git', args, cwd };
}

function runGit(cwd, args) {
  const command = gitInvocation(cwd, args);
  return new Promise(resolve => execFile(command.file, command.args,
    { cwd: command.cwd, windowsHide: true, timeout: 15000, maxBuffer: 64 << 20 },
    (err, out, errOut) => resolve({ ok: !err, out: String(out || ''),
      error: err && (String(errOut || '').trim().split(/\r?\n/).pop() || err.message) })));
}

module.exports = { gitInvocation, runGit };
