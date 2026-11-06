const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);

function parseSs(output) {
  return output.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const endpoint = line.trim().split(/\s+/)[3] || '';
    const colon = endpoint.lastIndexOf(':');
    return { address: endpoint.slice(0, colon).replace(/^\[|\]$/g, '').replace(/%.*/, ''),
      port: Number(endpoint.slice(colon + 1)), pid: Number(/pid=(\d+)/.exec(line)?.[1]) || null,
      process: /users:\(\("([^"]+)"/.exec(line)?.[1] || null };
  });
}

function parseLsof(output) {
  let pid = null, name = null;
  const listeners = [];
  for (const line of output.split(/\r?\n/)) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    if (line[0] === 'c') name = line.slice(1);
    if (line[0] !== 'n') continue;
    const endpoint = line.slice(1), colon = endpoint.lastIndexOf(':');
    listeners.push({ address: endpoint.slice(0, colon).replace(/^\[|\]$/g, ''), port: Number(endpoint.slice(colon + 1)), pid, process: name });
  }
  return listeners;
}

function normalize(listeners) {
  const unique = new Map();
  for (const item of listeners) {
    if (!Number.isInteger(item.port) || item.port < 1 || item.port > 65535 || !item.address) continue;
    const host = ['*', '0.0.0.0', '::'].includes(item.address) ? 'localhost' : item.address;
    const key = `${host}:${item.port}`;
    const authority = host.includes(':') ? `[${host}]` : host;
    const previous = unique.get(key);
    unique.set(key, { ...item, pid: item.pid || previous?.pid || null, process: item.process || previous?.process || null,
      url: `${[443, 8443].includes(item.port) ? 'https' : 'http'}://${authority}:${item.port}` });
  }
  return [...unique.values()].sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
}

let pending;
async function listRunningServers() {
  if (pending) return pending;
  pending = (async () => {
    const options = { timeout: 8000, maxBuffer: 2 * 1024 * 1024, windowsHide: true };
    if (process.platform === 'win32') {
      const command = "$ErrorActionPreference='Stop'; $names=@{}; Get-Process | ForEach-Object { $names[[int]$_.Id]=$_.ProcessName }; @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { @{address=$_.LocalAddress;port=[int]$_.LocalPort;pid=[int]$_.OwningProcess;process=$names[[int]$_.OwningProcess]} }) | ConvertTo-Json -Compress";
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], options);
      const result = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : [];
      return normalize(Array.isArray(result) ? result : [result]);
    }
    if (process.platform === 'linux') {
      const { stdout } = await execute('ss', ['-H', '-ltnp'], options);
      return normalize(parseSs(stdout));
    }
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await execute('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], options);
        return normalize(parseLsof(stdout));
      } catch (error) { if (error.code === 1 && !error.stdout && !error.stderr) return []; throw error; }
    }
    throw new Error('Server discovery is not supported on this platform.');
  })();
  try { return await pending; } finally { pending = null; }
}

// Stop a listening server from the list. Re-check the listener first so a
// recycled PID is never signalled, and never stop TerminalVibe itself.
async function killServer(pid, port, self = process.pid) {
  pid = Number(pid); port = Number(port);
  if (!Number.isInteger(pid) || pid < 2 || !Number.isInteger(port)) throw new Error('Invalid server.');
  if (pid === self) throw new Error('This server is TerminalVibe itself.');
  if (!(await listRunningServers()).some(server => server.pid === pid && server.port === port)) {
    throw new Error('That server is no longer listening.');
  }
  process.kill(pid, 'SIGTERM');
}

module.exports = { listRunningServers, killServer, parseSs, parseLsof, normalize };
