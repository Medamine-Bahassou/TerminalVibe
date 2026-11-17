const assert = require('node:assert/strict');
if (process.platform !== 'win32') { console.log('SKIP: native Windows snapshot'); process.exit(0); }
const { snapshot } = require('../electron/windows-process-snapshot');
(async () => {
 const read = async () => { const output = await snapshot(); assert(output.split(/\r?\n/).some(line => line.startsWith(process.pid + ':')), 'snapshot must contain this live process'); };
 await read();
 const start = performance.now();
 for (let i = 0; i < 10; i++) await read();
 const average = (performance.now() - start) / 10;
 assert(average < 200, `warm snapshots took ${average}ms`);
 console.log(`PASS: 10 fresh native Windows process snapshots averaged ${average.toFixed(1)}ms`);
})().catch(error => { console.error(error); process.exitCode = 1; });
