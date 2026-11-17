const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let worker, pending, buffer = '';
function snapshot() {
  if (pending) return pending.promise;
  if (!worker) {
    // Read the script in Node: PowerShell cannot open a file inside app.asar.
    const script = fs.readFileSync(path.join(__dirname, 'windows-process-worker.ps1'), 'utf8');
    worker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const child = worker;
    const fail = () => {
      if (worker !== child) return;
      worker = null; buffer = '';
      if (pending) { const job = pending; pending = null; clearTimeout(job.timer); job.reject(new Error('Native process snapshot unavailable')); }
      child.kill();
    };
    child.on('error', fail); child.on('exit', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', data => {
      buffer += data.toString();
      const end = buffer.indexOf('END\r\n');
      if (end < 0) return;
      const result = buffer.slice(0, end); buffer = buffer.slice(end + 5);
      if (!pending) return;
      const job = pending; pending = null; clearTimeout(job.timer);
      if (result.includes('ERROR')) job.reject(new Error('Native process snapshot failed'));
      else job.resolve(result);
    });
    child.unref(); child.stdin.unref(); child.stdout.unref();
  }
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const child = worker;
  const timer = setTimeout(() => { if (worker === child) { worker = null; buffer = ''; pending = null; child.kill(); reject(new Error('Process snapshot timed out')); } }, 5000);
  pending = { promise, resolve, reject, timer };
  child.stdin.write('snapshot\n');
  return promise;
}
module.exports = { snapshot };
