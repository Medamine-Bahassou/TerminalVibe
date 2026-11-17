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
  assert.equal(await ctx.privateClipboardText('C:\\Users\\Alice\\repo'), 'C:\\Users\\[user-' + hash('Alice') + ']\\repo');
  assert.equal(await ctx.privateClipboardText('\\\\wsl.localhost\\Ubuntu\\home\\med\\repo'), '\\\\wsl.localhost\\Ubuntu\\home\\[user-' + hash('med') + ']\\repo');
  assert.equal(await ctx.privateClipboardText('Contact alice@example.com', true), 'Contact [email-' + hash('alice@example.com') + ']');
  assert.equal(await ctx.privateClipboardText('alice@example.com'), 'alice@example.com', 'email privacy is scoped to terminal copies');
  await ctx.copyPrivateText('/home/med/repo alice@example.com', true);
  assert(!writes[0].includes('med/') && !writes[0].includes('alice@example.com'));
  settings.usernames = 'show'; ctx.hideEmails = false;
  assert.equal(await ctx.privateClipboardText('/home/med/repo alice@example.com', true), '/home/med/repo alice@example.com');
  ctx.crypto = {};
  assert.equal(await ctx.privateCopyToken('secret', 'user'), '[user-hidden]', 'hash failure must not expose originals');
  console.log('PASS: SHA-256 clipboard tokens, username and email privacy settings, and safe failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
