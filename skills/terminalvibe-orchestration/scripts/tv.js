#!/usr/bin/env node
// Portable client: Node.js 18+, no npm dependencies.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

async function main(args) {
  const method = args.shift();
  if (!method || method === '--help') {
    console.log('tv.js instances | list | launch|arrange --file FILE|- | read|send|focus JSON\nAll RPC commands accept --instance /absolute/instance-PID.json.\nJSON can also be passed using --file FILE|- for any RPC command.');
    return;
  }
  let descriptor = process.env.TERMINALVIBE_CONTROL_FILE;
  const index = args.indexOf('--instance');
  if (index !== -1) {
    if (!args[index + 1]) throw new Error('--instance needs a file');
    descriptor = args[index + 1]; args.splice(index, 2);
  }
  const directory = path.join(os.homedir(), '.terminalvibe', 'control');
  const files = () => fs.existsSync(directory) ? fs.readdirSync(directory).filter(f => /^instance-\d+\.json$/.test(f)).map(f => path.join(directory, f)) : [];
  if (method === 'instances') {
    // Never print the bearer token.
    console.log(JSON.stringify(files().map(file => {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      let alive = true;
      try { process.kill(d.pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
      return { file, pid: d.pid, alive };
    }), null, 2));
    return;
  }
  if (!['list', 'launch', 'arrange', 'read', 'send', 'focus'].includes(method)) throw new Error('Unknown method (use --help)');
  if (!descriptor) throw new Error('No instance selected. Run instances, then use --instance FILE (automatic inside TerminalVibe terminals).');
  let params = {};
  if (args[0] === '--file' && args.length === 2) params = JSON.parse(fs.readFileSync(args[1] === '-' ? 0 : args[1], 'utf8'));
  else if (args.length === 1) params = JSON.parse(args[0]);
  else if (args.length) throw new Error('Pass one JSON argument or --file FILE|-');
  const d = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  const url = new URL(d.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/rpc') throw new Error('Invalid local control endpoint');
  const body = JSON.stringify({ method, params });
  const result = await new Promise((resolve, reject) => {
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
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { main };
