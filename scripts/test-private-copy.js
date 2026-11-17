const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const begin = source.indexOf('  const EMAIL_RE ='), end = source.indexOf('  function blurTermEmails(', begin);
const helpers = source.slice(begin, end);
const settings = { usernames: 'blur' }, writes = [];
const ctx = vm.createContext({ crypto: webcrypto, TextEncoder, Uint8Array, threadSettings: settings, hideEmails: true,
  document: { addEventListener() {} }, window: { electronAPI: { clipboardWrite: text => writes.push(text) } } });
vm.runInContext(helpers, ctx);
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
(async () => {
  const first = await ctx.privateClipboardText('C:\\Users\\Alice\\repo');
  assert.match(first, /^C:\\Users\\\[user-[a-f0-9]{12}\]\\repo$/);
  assert.notEqual(await ctx.privateClipboardText('C:\\Users\\Alice\\repo'), first, 'Username copy tokens must be random rather than derived from the original');
  assert.match(await ctx.privateClipboardText('\\\\wsl.localhost\\Ubuntu\\home\\med\\repo'), /\\home\\\[user-[a-f0-9]{12}\]\\repo$/);
  assert.equal(await ctx.privateClipboardText('Contact alice@example.com', true), 'Contact [email-' + hash('alice@example.com') + ']');
  assert.equal(await ctx.privateClipboardText('alice@example.com'), 'alice@example.com', 'email privacy is scoped to terminal copies');
  await ctx.copyPrivateText('/home/med/repo alice@example.com', true);
  assert(!writes[0].includes('med/') && !writes[0].includes('alice@example.com'));
  settings.usernames = 'show'; ctx.hideEmails = false;
  assert.equal(await ctx.privateClipboardText('/home/med/repo alice@example.com', true), '/home/med/repo alice@example.com');
  ctx.crypto = {};
  assert.equal(await ctx.privateCopyToken('secret', 'user'), '[user-xxxxxxxxxxxx]', 'Unavailable randomness must not expose originals');
  console.log('PASS: randomized fixed-length usernames, SHA-256 email tokens, privacy settings, and safe failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
