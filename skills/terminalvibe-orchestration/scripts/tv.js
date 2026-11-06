#!/usr/bin/env node
// Portable client: Node.js 18+, no npm dependencies.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');

function run(file, args, options = {}) {
  const { input, ...settings } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: 10000, windowsHide: true, ...settings },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    child.stdin.on('error', () => {}); // The child may exit before consuming input.
    child.stdin.end(input);
  });
}

function linuxPath(value, distro) {
  const unc = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(.*)$/i.exec(value);
  if (unc) {
    if (unc[1].toLowerCase() !== distro.toLowerCase()) throw new Error('Paths belong to different WSL distributions');
    return unc[2].replace(/\\/g, '/') || '/';
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) return `/mnt/${value[0].toLowerCase()}${value.slice(2).replace(/\\/g, '/')}`;
  return value;
}

function wslInvocation(args, cwd, env = process.env, script = __filename) {
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(.*)$/i.exec(cwd);
  if (!match) return null;
  const distro = match[1];
  const forwarded = args.map((arg, i) => ['--file', '--instance', '--cwd'].includes(args[i - 1]) && arg !== '-'
    ? linuxPath(arg, distro) : arg);
  const vars = [];
  for (const name of ['TERMINALVIBE_CONTROL_FILE', 'TERMINALVIBE_PANE_ID']) {
    if (env[name]) vars.push(`${name}=${linuxPath(env[name], distro)}`);
  }
  if (env.USERPROFILE) vars.push(`TERMINALVIBE_WINDOWS_HOME=${linuxPath(env.USERPROFILE, distro)}`);
  return ['--distribution', distro, '--cd', linuxPath(cwd, distro), '--exec', '/usr/bin/env', ...vars,
    'node', linuxPath(script, distro), ...forwarded];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function instances(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(f => /^instance-\d+\.json$/.test(f)).flatMap(name => {
    const file = path.join(directory, name);
    try {
      const d = readJson(file);
      let alive = true;
      try { process.kill(d.pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
      return [{ file, pid: d.pid, alive }];
    } catch { return []; } // Ignore a partially written/crashed descriptor.
  });
}

// PIDs above this process. The TerminalVibe instance hosting the calling pane
// is one of them, which beats any inherited (possibly stale) descriptor path.
function ancestorPids(pid = process.ppid) {
  const pids = new Set();
  for (let i = 0; pid > 1 && i < 64 && !pids.has(pid); i++) {
    pids.add(pid);
    try {
      pid = process.platform === 'linux'
        ? Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop().split(' ')[1])
        : process.platform === 'darwin'
          ? Number(require('child_process').execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }))
          : 0;
    } catch { break; }
  }
  return pids;
}

function selectInstance(found, envDescriptor, ancestors = ancestorPids()) {
  const live = found.filter(d => d.alive);
  const own = live.filter(d => ancestors.has(d.pid));
  if (own.length === 1) return own[0].file;
  const inherited = envDescriptor && found.find(d => path.resolve(d.file) === path.resolve(envDescriptor));
  // A descriptor outside the scanned directory (WSL relay, custom path) is trusted as given.
  if (envDescriptor && (inherited ? inherited.alive : fs.existsSync(envDescriptor))) return envDescriptor;
  if (live.length === 1) return live[0].file;
  if (live.length > 1) throw new Error(`Multiple live instances (${live.map(d => d.pid).join(', ')}) and none hosts this process; select one with --instance FILE.`);
  return null;
}

async function resolveLauncher(provider) {
  if (!['claude', 'codex'].includes(provider)) throw new Error('Use --provider claude or codex; use launch with explicit argv for other agents');
  const home = os.homedir();
  const names = process.platform === 'win32' ? [`${provider}.exe`, provider] : [provider];
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(home, '.local', 'bin')];
  const candidates = dirs.filter(Boolean).flatMap(dir => names.map(name => path.join(dir, name)));
  // WSL can use the Windows native launcher without a temporary shell adapter.
  // Use the calling user's home, never scan other Windows users' installations.
  const windowsHome = process.env.TERMINALVIBE_WINDOWS_HOME || /^\/mnt\/[a-z]\/Users\/[^/]+/i.exec(__filename)?.[0];
  if (process.platform === 'linux' && windowsHome) candidates.push(path.join(windowsHome, '.local', 'bin', `${provider}.exe`));
  const failures = [];
  for (const file of new Set(candidates)) {
    try { fs.accessSync(file, fs.constants.X_OK); } catch { continue; }
    try {
      const version = await run(file, ['--version'], { timeout: 4000 });
      return { provider, argv: [file], promptStyle: 'positional', version };
    } catch { failures.push(file); }
  }
  throw new Error(`${provider} launcher unavailable${failures.length ? ` (failed --version: ${failures.join(', ')})` : ''}. No provider was substituted.`);
}

async function rpc(descriptor, method, params = {}) {
  const d = readJson(descriptor);
  const url = new URL(d.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/rpc') throw new Error('Invalid local control endpoint');
  const body = JSON.stringify({ method, params });
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let output = '';
      res.setEncoding('utf8');
      res.on('data', data => { output += data; });
      res.on('end', () => {
        try {
          const reply = JSON.parse(output);
          if (reply.error || res.statusCode !== 200) reject(new Error(reply.error || `HTTP ${res.statusCode}`));
          else resolve(reply.result);
        } catch (err) { reject(err); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Request timed out; inspect list before retrying a mutation')));
    req.on('error', reject);
    req.end(body);
  });
}

async function snapshots(descriptor, launches) {
  // One bounded snapshot, not a provider-specific readiness/authentication poll.
  await new Promise(resolve => setTimeout(resolve, 750));
  return Promise.all(launches.map(async pane => {
    try { return { paneId: pane.id, ...await rpc(descriptor, 'read', { paneId: pane.id, lines: 40 }) }; }
    catch (error) { return { paneId: pane.id, error: error.message }; }
  }));
}

async function main(args) {
  const originalArgs = [...args];
  const method = args.shift();
  if (!method || method === '--help') {
    console.log('tv.js pair --provider claude|codex [--prompt TEXT] [--cwd DIR]\ntv.js context [--provider claude|codex]\ntv.js instances | list | launch|arrange --file FILE|- | read|send|focus|resize|place|navigate JSON\nnavigate: {paneId,url:"https://example.com/"}\nlaunch in current split: {workspaceId,anchorPaneId,placement:{mode:"tab"},layout:LEAF}\nlaunch browser leaf: {name:"Browser",type:"browser",url:"https://example.com/"}\nread: terminal {paneId,lines:100} or browser {paneId,maxChars:20000,offset:0}\nresize: {paneId,width:"min"|"auto"|PIXELS,height:"min"|"auto"|PIXELS}\nplace: {paneId,anchorPaneId,side:"left"|"right"|"top"|"bottom",compact:true}\nThe instance hosting this process is selected automatically, then TERMINALVIBE_CONTROL_FILE, then a sole live instance. Use --instance FILE otherwise.\nlaunch --inspect includes pane snapshots. JSON also accepts --file FILE|- (UTF-8 BOM supported).');
    return;
  }
  let descriptor = process.env.TERMINALVIBE_CONTROL_FILE;
  const index = args.indexOf('--instance');
  if (index !== -1) {
    if (!args[index + 1]) throw new Error('--instance needs a file');
    descriptor = args[index + 1]; args.splice(index, 2);
  }
  const directory = path.join(os.homedir(), '.terminalvibe', 'control');
  const found = instances(directory);
  // Resolve the distro from the actual UNC cwd; never ask the agent to probe
  // both OSes or feed Linux paths through a Git Bash shell.
  if (process.platform === 'win32' && (descriptor?.startsWith('/') || (!descriptor && !found.some(d => d.alive)))) {
    const relay = wslInvocation(originalArgs, process.cwd());
    if (relay) {
      const fromStdin = originalArgs.some((arg, i) => arg === '--file' && originalArgs[i + 1] === '-');
      console.log(await run('wsl.exe', relay, { timeout: 45000, maxBuffer: 4 * 1024 * 1024,
        input: fromStdin ? fs.readFileSync(0) : undefined }));
      return;
    }
  }
  if (method === 'instances') {
    // Never print the bearer token.
    console.log(JSON.stringify(found, null, 2));
    return;
  }
  if (!['context', 'pair', 'list', 'launch', 'arrange', 'read', 'send', 'focus', 'resize', 'place', 'navigate'].includes(method)) throw new Error('Unknown method (use --help)');
  if (index === -1) descriptor = selectInstance(found, descriptor);
  if (!descriptor) throw new Error('No live instance found. Start TerminalVibe or pass --instance FILE from the backend OS.');
  if (method === 'context' || method === 'pair') {
    const options = {};
    while (args.length) {
      const key = args.shift();
      if (!['--provider', '--prompt', '--cwd'].includes(key) || !args.length || options[key] !== undefined) throw new Error('Use --provider NAME, --prompt TEXT and --cwd DIR');
      options[key] = args.shift();
    }
    if (method === 'pair' && !options['--provider']) throw new Error('pair requires an explicit --provider claude|codex');
    const [state, launcher] = await Promise.all([
      rpc(descriptor, 'list'), options['--provider'] ? resolveLauncher(options['--provider']) : null
    ]);
    const parentPaneId = process.env.TERMINALVIBE_PANE_ID;
    const workspaceId = state.workspaces.find(w => w.panes.some(p => p.id === parentPaneId))?.id || state.activeWorkspaceId;
    const cwd = path.resolve(options['--cwd'] || process.cwd());
    if (method === 'context') {
      console.log(JSON.stringify({ instance: descriptor, platform: process.platform, cwd, workspaceId, launcher, ...state }, null, 2));
      return;
    }
    if (!state.capabilities?.launchIntoWorkspace) throw new Error('Running app is older than this skill; update/restart the backend and refresh the page (closes dev terminals).');
    if (!workspaceId) throw new Error('No active workspace; select one in TerminalVibe first.');
    const prompt = options['--prompt'] || 'Reply with READY, then wait for further instructions.';
    const result = await rpc(descriptor, 'launch', {
      workspaceId, placement: { split: 'column', compact: !!state.capabilities?.compactPanes,
        ...(state.capabilities?.compactPanes ? {} : { sizes: [35, 65] }) },
      layout: { split: 'row', children: [1, 2].map(n => ({ name: `${launcher.provider} ${n}`, cwd, argv: [...launcher.argv, prompt] })) }
    });
    console.log(JSON.stringify({ ...result, launcher, snapshots: await snapshots(descriptor, result.launches),
      note: 'Spawn results and output snapshots only; authentication/readiness is not inferred. Do not retry this launch to wait for output.' }, null, 2));
    return;
  }
  const inspect = args.includes('--inspect');
  if (inspect) {
    if (method !== 'launch') throw new Error('--inspect is only supported for launch');
    args.splice(args.indexOf('--inspect'), 1);
  }
  let params = {};
  if (args[0] === '--file' && args.length === 2) params = readJson(args[1] === '-' ? 0 : args[1]);
  else if (args.length === 1) params = JSON.parse(args[0]);
  else if (args.length) throw new Error('Pass one JSON argument or --file FILE|-');
  const hasBrowser = node => !!node && (node.type === 'browser' || node.url !== undefined ||
    (Array.isArray(node.children) && node.children.some(hasBrowser)));
  if (method === 'launch' && params.placement?.mode === 'tab' && !(await rpc(descriptor, 'list')).capabilities?.launchAsTab) {
    throw new Error('The running TerminalVibe backend/page lacks launchAsTab. No panes were changed. Save active terminal work, restart the backend and refresh the page (or restart Electron), then retry.');
  }
  const capability = method === 'navigate' ? 'browserNavigate'
    : method === 'launch' && hasBrowser(params.layout) ? 'browserLaunch' : null;
  if (capability && !(await rpc(descriptor, 'list')).capabilities?.[capability]) {
    throw new Error(`The running TerminalVibe backend/page lacks ${capability}. No panes were changed. Save active terminal work, restart the dev backend and refresh the tab (or restart Electron), then retry. Do not relaunch to work around this mismatch.`);
  }
  const result = await rpc(descriptor, method, params);
  if (inspect) result.snapshots = await snapshots(descriptor, result.launches);
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { main, linuxPath, wslInvocation, instances, resolveLauncher, ancestorPids, selectInstance };
