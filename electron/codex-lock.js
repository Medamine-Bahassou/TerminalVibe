const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

// Match the kernel lock by device and inode. A lock file can remain after its
// owner exits, and processes waiting to resume can have the same session in argv.
async function writerPid(file) {
  const stat = await fs.stat(file, { bigint: true }).catch(err => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  if (!stat) return null;
  const major = ((stat.dev >> 8n) & 0xfffn) | ((stat.dev >> 32n) & 0xfffff000n);
  const minor = (stat.dev & 0xffn) | ((stat.dev >> 12n) & 0xffffff00n);
  const locks = await fs.readFile('/proc/locks', 'utf8');
  for (const match of locks.matchAll(/^\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+(\d+)\s+([\da-f]+):([\da-f]+):(\d+)\s/gim)) {
    if (BigInt('0x' + match[2]) === major && BigInt('0x' + match[3]) === minor && BigInt(match[4]) === stat.ino)
      return Number(match[1]);
  }
  return null;
}

async function isInTree(pid, root) {
  while (pid > 1) {
    if (pid === root) return true;
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  }
  return false;
}

async function releaseCodexLock(sessionId, ownPid, isCurrent) {
  const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'thread-writer-locks', sessionId + '.lock');
  const pid = await writerPid(file);
  if (pid === null) return true;
  if (pid <= 1 || await isInTree(pid, ownPid)) return false;
  const exe = await fs.readlink(`/proc/${pid}/exe`);
  const { uid } = await fs.stat(`/proc/${pid}`);
  if (path.basename(exe.replace(/ \(deleted\)$/, '')) !== 'codex' || uid !== process.getuid()) return false;

  const current = await writerPid(file);
  if (current !== pid || !isCurrent()) return current === null;
  try { process.kill(pid, 'SIGTERM'); }
  catch (err) { if (err.code !== 'ESRCH') throw err; }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const owner = await writerPid(file);
    if (owner !== pid) return owner === null;
    await delay(100);
  }
  return false;
}

module.exports = { releaseCodexLock };
