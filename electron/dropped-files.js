const fs = require('fs');
const path = require('path');
const os = require('os');
const MAX_DROP_BYTES = 64 * 1024 * 1024;

async function saveDroppedFile(name, bytes, root = os.tmpdir()) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DROP_BYTES) throw new Error('Dropped files must be at most 64 MiB each');
  if (typeof name !== 'string' || name.includes('\0')) throw new Error('Invalid dropped filename');
  let filename = path.posix.basename(name.replace(/\\/g, '/'));
  if (!filename || filename === '.' || filename === '..') filename = 'drop';
  const dir = await fs.promises.mkdtemp(path.join(root, 'terminalvibe-drop-'));
  try {
    const file = path.join(dir, filename);
    await fs.promises.writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
    return file;
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function decodeDroppedFile(data) {
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_DROP_BYTES / 3) * 4 ||
      data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error('Invalid file upload or file exceeds 64 MiB');
  }
  return Buffer.from(data, 'base64');
}
module.exports = { saveDroppedFile, decodeDroppedFile, MAX_DROP_BYTES };
