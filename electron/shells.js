// Detects the shells offered by Settings > Terminal > Default shell.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NOT_INTERACTIVE_SHELLS = new Set(['nologin', 'false', 'git-shell', 'tmux', 'screen', 'rbash']);

// wsl.exe prints UTF-16LE. docker-desktop distros are Docker internals, not shells.
function parseWslList(output) {
  return output.toString('utf16le').split(/\r?\n/).map(name => name.replace(/\0/g, '').trim())
    .filter(name => name && !/^docker-desktop/i.test(name));
}

function listWslDistros(wsl) {
  try {
    return parseWslList(execFileSync(wsl, ['-l', '-q'], { timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return []; // WSL is not set up, or has no distro.
  }
}

function windowsShells(env = process.env, exists = fs.existsSync, listDistros = listWslDistros) {
  const join = path.win32.join;
  const root = env.SystemRoot || 'C:\\Windows';
  const under = (dir, ...rest) => dir ? join(dir, ...rest) : null;
  const shells = [
    { id: 'powershell', label: 'Windows PowerShell', command: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
    { id: 'pwsh', label: 'PowerShell 7', command: under(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe') },
    { id: 'cmd', label: 'Command Prompt', command: env.ComSpec || join(root, 'System32', 'cmd.exe') },
    { id: 'git-bash', label: 'Git Bash', command: [
      under(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
      under(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
      under(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    ].find(file => file && exists(file)) },
  ].filter(shell => shell.command && exists(shell.command));
  const wsl = join(root, 'System32', 'wsl.exe');
  if (exists(wsl)) {
    for (const name of listDistros(wsl)) {
      shells.push({ id: `wsl:${name}`, label: name, command: wsl, args: ['-d', name], homeArgs: ['--cd', '~'] });
    }
  }
  return shells;
}

function posixShells(read = () => fs.readFileSync('/etc/shells', 'utf8'), exists = fs.existsSync) {
  let lines = [];
  try { lines = read().split('\n'); } catch {}
  const byName = new Map();
  for (const line of lines) {
    const command = line.trim();
    const name = path.posix.basename(command);
    if (!command.startsWith('/') || NOT_INTERACTIVE_SHELLS.has(name) || byName.has(name) || !exists(command)) continue;
    byName.set(name, { id: command, label: name, command });
  }
  return [...byName.values()];
}

let cached = null;
function listShells(refresh = false) {
  if (!cached || refresh) cached = process.platform === 'win32' ? windowsShells() : posixShells();
  return cached;
}

// A saved shell may have been uninstalled: null makes the caller use the system default.
function findShell(id) {
  return id ? listShells().find(shell => shell.id === id) || null : null;
}

// node-pty's PATH lookup returns an empty path when the name also exists in the app's
// current folder, which is System32 when Windows starts the app, so wsl.exe and cmd.exe failed.
function resolveExecutable(file, env = process.env, platform = process.platform) {
  if (platform !== 'win32' || /[\\/]/.test(file)) return file;
  const names = path.win32.extname(file) ? [file] : [`${file}.exe`, `${file}.com`];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(';')) {
    for (const name of dir ? names : []) {
      const full = path.join(dir.replace(/^"|"$/g, ''), name);
      try { if (fs.statSync(full).isFile()) return full; } catch {}
    }
  }
  return file; // Not on PATH: node-pty reports it.
}

module.exports = { listShells, findShell, parseWslList, windowsShells, posixShells, resolveExecutable };
