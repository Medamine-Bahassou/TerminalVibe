const assert = require('node:assert/strict');
const net = require('net');
const { once } = require('events');
const { parseSs, parseLsof, normalize, listRunningServers } = require('../electron/servers');

async function main() {
  const parsed = normalize(parseSs([
    'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=123,fd=9))',
    'LISTEN 0 511 [::]:8443 [::]:* users:(("python",pid=456,fd=9))',
    'LISTEN 0 511 0.0.0.0:8443 0.0.0.0:*',
    'LISTEN 0 511 127.0.0.53%lo:53 0.0.0.0:*',
    'LISTEN 0 511 [::1]:5000 [::]:*'
  ].join('\n')));
  assert.equal(parsed.length, 4, 'Wildcard IPv4/IPv6 listeners are deduplicated');
  assert.equal(parsed.find(row => row.port === 3000).process, 'node');
  assert.equal(parsed.find(row => row.port === 3000).pid, 123);
  assert.equal(parsed.find(row => row.port === 8443).url, 'https://localhost:8443');
  assert.equal(parsed.find(row => row.port === 8443).process, 'python');
  assert.equal(parsed.find(row => row.port === 53).address, '127.0.0.53');
  assert.equal(parsed.find(row => row.port === 5000).url, 'http://[::1]:5000');
  assert.deepEqual(parseSs(''), []);
  assert.deepEqual(normalize([{ address: 'localhost', port: 0 }]), []);
  const mac = normalize(parseLsof('p42\ncnode\nn*:5173\nn[::1]:8080\n'));
  assert.equal(mac[0].url, 'http://localhost:5173');
  assert.equal(mac[1].pid, 42);
  const server = net.createServer();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const rows = await listRunningServers();
    const found = rows.find(row => row.port === server.address().port && row.address === '127.0.0.1');
    assert(found, 'Actual listening test server is discovered');
    assert.equal(found.pid, process.pid);
    console.log('Servers: IPv4/IPv6, process metadata, deduplication and real listening port passed');
  } finally { server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
