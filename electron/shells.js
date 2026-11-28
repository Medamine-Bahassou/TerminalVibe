// Detects the shells offered by Settings > Terminal > Default shell.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const NOT_INTERACTIVE_SHELLS = new Set(['nologin', 'false', 'git-shell', 'tmux', 'screen', 'rbash', 'systemd-home-fallback-shell']); // the last: systemd-homed's placeholder for a locked home

// wsl.exe prints UTF-16LE. docker-desktop distros are Docker internals, not shells.
function parseWslList(output) {
  return output.toString('utf16le').split(/\r?\n/).map(name => name.replace(/\0/g, '').trim())
    .filter(name => name && !/^docker-desktop/i.test(name));
}

// `wsl -l` boots the WSL VM (~3s cold), so it runs async: a sync call froze the main process at startup.
let wslDistros = [];
function loadWslDistros(wsl) {
  return new Promise(resolve => execFile(wsl, ['-l', '-q'], { timeout: 15000, windowsHide: true, encoding: 'buffer' },
    (err, out) => resolve(wslDistros = err ? [] : parseWslList(out)))); // error: WSL is not set up, or has no distro
}

function windowsShells(env = process.env, exists = fs.existsSync, listDistros = () => wslDistros) {
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

// SSH hosts from ~/.ssh/config, offered as shells. A host name reaches ssh as an argument and comes
// back from saved tabs (renderer input), so only plain names pass: no options, no shell syntax.
const SSH_HOST = /^[\w.@:%-]+$/;
const sshShell = host => ({ id: `ssh:${host}`, label: `ssh ${host}`, ssh: host });
function sshHosts(read = () => fs.readFileSync(path.join(require('os').homedir(), '.ssh', 'config'), 'utf8')) {
  let text = '';
  try { text = read(); } catch {}
  const hosts = new Set();
  // ponytail: Include'd files are not followed; read them if hosts live in ~/.ssh/config.d.
  for (const line of text.split('\n')) {
    const names = /^\s*Host(?:\s*=\s*|\s+)(.+)/i.exec(line)?.[1].split(/\s+/) || [];
    for (const name of names) if (SSH_HOST.test(name) && !name.startsWith('-') && !/[*?!]/.test(name)) hosts.add(name);
  }
  return [...hosts].map(sshShell);
}

// Settings > Terminal > SSH hosts: add, edit and delete Host blocks in ~/.ssh/config, so plain
// ssh, scp and other tools see the same hosts. Every field is checked against a strict pattern
// first, since a newline or space would let one field write extra config lines (a ProxyCommand
// runs code). Edits touch only HostName, User and Port: options added by hand (IdentityFile,
// ProxyJump, ...) stay. Writers return an error message, or null once written.
const sshConfigFile = () => path.join(require('os').homedir(), '.ssh', 'config');
const SSH_KEY_LINE = /^\s*(HostName|User|Port)(?:\s*=\s*|\s+)(\S+)/i;

// The block of a host with its own `Host <name>` line: [top, end) covers the comments right
// above it, and stops before trailing blank lines and comments (those introduce the next host).
// A name shared on one line (`Host a b`) or set by a pattern isn't ours to edit: null.
function sshBlock(lines, name) {
  const start = lines.findIndex(line => /^\s*Host(?:\s*=\s*|\s+)(\S+)\s*$/i.exec(line)?.[1].toLowerCase() === name.toLowerCase());
  if (start < 0) return null;
  let end = start + 1, top = start;
  while (end < lines.length && !/^\s*(Host|Match)\b/i.test(lines[end])) end++;
  while (end > start + 1 && /^\s*(#|$)/.test(lines[end - 1])) end--;
  while (top > 0 && /^\s*#/.test(lines[top - 1])) top--;
  return { top, start, end };
}

function sshHostList(file = sshConfigFile()) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const lines = text.split('\n');
  return sshHosts(() => text).map(({ ssh: name }) => {
    const block = sshBlock(lines, name);
    const keys = {};
    for (const line of block ? lines.slice(block.start + 1, block.end) : []) {
      const [, key, value] = SSH_KEY_LINE.exec(line) || [];
      if (key && !keys[key.toLowerCase()]) keys[key.toLowerCase()] = value;
    }
    return { name, hostName: keys.hostname || '', user: keys.user || '', port: keys.port || '', editable: !!block };
  });
}

function checkSshHost({ name, host, port } = {}) {
  name = String(name || '').trim(); host = String(host || '').trim(); port = String(port || '').trim();
  const [, user = '', hostName] = /^(?:([\w.-]+)@)?([\w.:-]+)$/.exec(host) || [];
  if (!SSH_HOST.test(name) || name.startsWith('-') || /[*?!]/.test(name)) return { error: 'Name can use letters, digits, ".", "-" and "_"' };
  if (!hostName || hostName.startsWith('-')) return { error: 'Host must look like user@192.168.1.10 or example.com' };
  if (port && !(/^\d+$/.test(port) && +port >= 1 && +port <= 65535)) return { error: 'Port must be a number from 1 to 65535' };
  return { name, user, hostName, port: port === '22' ? '' : port }; // 22 is ssh's default: no Port line
}

// Writes through a symlink (dotfile managers link ~/.ssh/config), keeps the file private, and
// leaves the previous version in config.terminalvibe.bak in case an edit wasn't wanted.
function writeSshConfig(file, text, before) {
  const real = (() => { try { return fs.realpathSync(file); } catch { return file; } })();
  fs.mkdirSync(path.dirname(real), { recursive: true, mode: 0o700 });
  if (before !== null) fs.writeFileSync(`${real}.terminalvibe.bak`, before, { mode: 0o600 });
  const tmp = `${real}.tv-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, real);
}
const readSshConfig = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// No oldName: add a host. With oldName: edit that host's block in place.
function saveSshHost(fields, oldName = '', file = sshConfigFile()) {
  const host = checkSshHost(fields);
  if (host.error) return host.error;
  const before = readSshConfig(file), text = before ?? '';
  const taken = sshHosts(() => text).some(({ ssh }) => ssh.toLowerCase() === host.name.toLowerCase() && ssh.toLowerCase() !== String(oldName).toLowerCase());
  if (taken) return `A host named ${host.name} already exists`;
  const values = { HostName: host.hostName, User: host.user, Port: host.port };
  if (!oldName) {
    const block = [`Host ${host.name}`, ...Object.entries(values).filter(([, v]) => v).map(([k, v]) => `  ${k} ${v}`)].join('\n');
    writeSshConfig(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`, before);
    return null;
  }
  const lines = text.split('\n'), block = sshBlock(lines, String(oldName));
  if (!block) return `${oldName} can only be edited in ~/.ssh/config`;
  const body = lines.slice(block.start + 1, block.end);
  const indent = body.find(line => /^\s+\S/.test(line))?.match(/^\s+/)[0] || '  ';
  for (const [key, value] of Object.entries(values)) {
    const i = body.findIndex(line => SSH_KEY_LINE.exec(line)?.[1].toLowerCase() === key.toLowerCase());
    if (i >= 0 && value) body[i] = `${body[i].match(/^\s*/)[0]}${key} ${value}`;
    else if (i >= 0) body.splice(i, 1);
    else if (value) body.splice(key === 'HostName' ? 0 : body.length, 0, `${indent}${key} ${value}`);
  }
  lines.splice(block.start, block.end - block.start, `${lines[block.start].match(/^\s*/)[0]}Host ${host.name}`, ...body);
  writeSshConfig(file, lines.join('\n'), before);
  return null;
}

function removeSshHost(name, file = sshConfigFile()) {
  const before = readSshConfig(file);
  const lines = (before ?? '').split('\n'), block = sshBlock(lines, String(name || ''));
  if (!block) return `${name} can only be removed in ~/.ssh/config`;
  lines.splice(block.top, block.end - block.top);
  writeSshConfig(file, lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''), before);
  return null;
}

// Settings > SSH hosts' test button. BatchMode never waits on a prompt, so a host that asks for a
// password still answers: "Permission denied" means the server was reached, which is what this
// tests. Anything else that ends with ssh's 255 (timeout, refused, unknown host, changed host
// key) is a failure, shown with ssh's own last line.
function testSshHost(name, bin = resolveExecutable('ssh')) {
  if (!SSH_HOST.test(String(name)) || String(name).startsWith('-')) return Promise.resolve({ ok: false, message: 'Invalid host name' });
  const started = Date.now();
  return new Promise(resolve => execFile(bin, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', name, 'true'], { timeout: 15000, windowsHide: true }, (err, _out, stderr) => {
    const ms = Date.now() - started;
    const line = String(stderr || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    if (!err) return resolve({ ok: true, ms, message: 'Connected' });
    if (/permission denied/i.test(line)) return resolve({ ok: true, ms, message: 'Reachable, asks for a password or key' });
    resolve({ ok: false, ms, message: err.killed ? 'No answer in 15s' : line.replace(/^ssh:\s*/, '') || (err.code === 'ENOENT' ? 'ssh is not installed' : 'Connection failed') });
  }));
}

// A tmux-like SSH tab: the remote side attaches (or creates) a tmux session named after the pane,
// so restarting the app reattaches the same session, and a dropped connection (ssh exits 255)
// reconnects on its own. Without tmux on the host it falls back to a plain login shell.
// An unreachable host made ssh wait ~2 minutes in silence, so the tab sat blank: each attempt
// now says what it's doing, gives up after 10s, and keepalives notice a dead link in ~45s.
const SSH_OPTS = '-o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3';
const SSH_RECONNECT = `n=0; while :; do printf "\\033[2mConnecting to %s...\\033[0m\\r\\n" "$0"; ssh -t ${SSH_OPTS} "$0" "$1"; s=$?; `
  + '[ $s -eq 255 ] || exit $s; n=$((n+1)); '
  + 'printf "\\033[2mNo connection to %s (attempt %d). Retrying in 5s, Ctrl+C to stop.\\033[0m\\r\\n\\r\\n" "$0" $n; sleep 5; done';
function sshLaunch(host, paneId, platform = process.platform) {
  const session = `tv-${String(paneId).replace(/[^\w-]/g, '').slice(0, 8)}`;
  const remote = `command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -s ${session} || exec "$SHELL" -l`;
  return {
    // ponytail: no reconnect loop on Windows (no /bin/sh); the tab ends when the connection drops.
    ...(platform === 'win32' ? { command: 'ssh', args: ['-t', ...SSH_OPTS.split(' '), host, remote] } : { command: '/bin/sh', args: ['-c', SSH_RECONNECT, host, remote] }),
    // Closing the tab ends the remote session too; quitting the app leaves it for the next launch.
    killArgs: ['-o', 'BatchMode=yes', host, `tmux kill-session -t ${session}`],
  };
}

let cached = null;
function listShells(refresh = false) {
  if (!cached || refresh) cached = [...(process.platform === 'win32' ? windowsShells() : posixShells()), ...sshHosts()];
  return cached;
}

// Settings and the tab bar menu: the list including WSL distros, without blocking the main process.
async function listShellsFresh() {
  const wsl = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  if (process.platform === 'win32' && fs.existsSync(wsl)) await loadWslDistros(wsl);
  return listShells(true);
}

// A saved shell may have been uninstalled: null makes the caller use the system default.
function findShell(id) {
  // A saved WSL distro doesn't need the slow `wsl -l` scan (it boots the WSL VM) before the first terminal opens.
  if (process.platform === 'win32' && id?.startsWith('wsl:')) {
    const wsl = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    if (fs.existsSync(wsl)) return { id, label: id.slice(4), command: wsl, args: ['-d', id.slice(4)], homeArgs: ['--cd', '~'] };
  }
  // A saved SSH tab still opens if its Host line was removed from ~/.ssh/config.
  if (id?.startsWith('ssh:')) return SSH_HOST.test(id.slice(4)) && !id.startsWith('ssh:-') ? sshShell(id.slice(4)) : null;
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

module.exports = { listShells, listShellsFresh, findShell, parseWslList, windowsShells, posixShells, sshHosts, sshHostList, saveSshHost, removeSshHost, testSshHost, sshLaunch, resolveExecutable };
