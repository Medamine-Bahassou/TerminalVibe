const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

function verifyPackage(archive) {
  asar.uncache(archive);
  const visit = (directory, prefix = '') => {
    for (const [name, entry] of Object.entries(directory.files || {})) {
      const file = prefix ? `${prefix}/${name}` : name;
      if (entry.files) visit(entry, file);
      else if (!entry.link && entry.integrity) {
        const bytes = asar.extractFile(archive, file);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        if (hash !== entry.integrity.hash) throw new Error(`Corrupt packaged file: ${file}. Rebuild before distributing the executable.`);
      }
    }
  };
  visit(asar.getRawHeader(archive).header);
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (!manifest.main || !asar.extractFile(archive, manifest.main).length) throw new Error('Packaged startup script is missing');
  console.log('[build] packaged archive integrity verified');
}

module.exports = context => verifyPackage(path.join(context.appOutDir, 'resources', 'app.asar'));
module.exports.verifyPackage = verifyPackage;
if (require.main === module) verifyPackage(process.argv[2]);
