const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

function wslLocation(cwd, platform) {
  return platform === 'win32' && /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)([\\/].*)?$/i.exec(cwd);
}

function gitHostPath(cwd, gitPath, platform = process.platform) {
  const wsl = wslLocation(cwd, platform);
  return wsl ? path.win32.join('\\\\wsl.localhost\\' + wsl[1], gitPath) : gitPath;
}

function gitInvocation(cwd, args, platform = process.platform, systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  const wsl = wslLocation(cwd, platform);
  if (wsl) return {
    file: path.win32.join(systemRoot, 'System32', 'wsl.exe'),
    args: ['--distribution', wsl[1], '--cd', (wsl[2] || '/').replace(/\\/g, '/'), '--exec', 'git', ...args],
    cwd: os.tmpdir(),
  };
  return { file: 'git', args, cwd };
}

function runGit(cwd, args, env) {
  const command = gitInvocation(cwd, args);
  if (env?.GIT_INDEX_FILE && wslLocation(cwd, process.platform)) {
    env = { ...env, WSLENV: [env.WSLENV, "GIT_INDEX_FILE/p"].filter(Boolean).join(":") };
  }
  return new Promise(resolve => execFile(command.file, command.args,
    { cwd: command.cwd, env, windowsHide: true, timeout: 15000, maxBuffer: 64 << 20 },
    (err, out, errOut) => resolve({ ok: !err, out: String(out || ''),
      error: err && (String(errOut || '').trim().split(/\r?\n/).pop() || err.message) })));
}

// A WSL folder's Linux $HOME in its distro ('' when it can't be read); null for a folder outside WSL.
function wslHome(cwd) {
  const wsl = wslLocation(cwd, process.platform);
  if (!wsl) return Promise.resolve(null);
  return new Promise(resolve => execFile(gitInvocation(cwd, []).file, ['--distribution', wsl[1], '--exec', 'sh', '-c', 'printf %s "$HOME"'],
    { windowsHide: true, timeout: 15000 }, (err, out) => resolve(err ? '' : String(out || '').trim())));
}

module.exports = { gitInvocation, gitHostPath, runGit, wslHome };
