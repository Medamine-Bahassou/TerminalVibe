const fs = require('node:fs/promises');
const path = require('node:path');
async function readAttachmentPreview(file) {
  if (typeof file !== 'string' || file.length > 4096 || !path.isAbsolute(file)) return { error: 'Invalid path' };
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) return { error: 'Not a file' };
    if (stat.size > 1024 * 1024) return { error: 'File is too large to preview (1 MB limit)' };
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 1024 * 1024) return { error: 'File is too large to preview' };
    const data = buffer.subarray(0, bytesRead);
    if (data.includes(0)) return { error: 'Binary files cannot be previewed' };
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data) };
  } catch { return { error: 'Cannot preview this file as text' }; }
  finally { await handle?.close(); }
}
module.exports = { readAttachmentPreview };
