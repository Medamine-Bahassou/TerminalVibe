const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
let now = 0, branch = 'feature/old', reads = 0, updates = 0, fail = false;
const ctx = vm.createContext({ Date: { now: () => now },
  window: { electronAPI: { gitBranch: async () => { reads++; if (fail) throw Error('unavailable'); return branch; } } },
  curChat: () => ({}), syncThreadComposer: () => updates++, renderThreadsSidebar() {},
});
const start = source.indexOf('  const _gitBranch =');
vm.runInContext(source.slice(start, source.indexOf('  // A "No project" thread', start)) + '\nthis.branches = _gitBranch;', ctx);
(async () => {
  await Promise.all([ctx.refreshChatGitBranch('/repo'), ctx.refreshChatGitBranch('/repo')]);
  assert.equal(reads, 1, 'concurrent composer and sidebar requests share one read');
  assert.equal(ctx.branches.get('/repo'), 'feature/old');
  branch = 'master'; now = 1000;
  await ctx.refreshChatGitBranch('/repo'); assert.equal(reads, 1);
  now = 2001; await ctx.refreshChatGitBranch('/repo');
  assert.equal(ctx.branches.get('/repo'), 'master', 'external switches must replace cached branches');
  assert.equal(updates, 2);
  now += 2001; await ctx.refreshChatGitBranch('/repo');
  assert.equal(updates, 2, 'unchanged branches must not cause redraw loops');
  fail = true; now += 2001; await ctx.refreshChatGitBranch('/repo');
  assert.equal(ctx.branches.get('/repo'), 'master', 'transient failures preserve the last known branch');
  fail = false; branch = 'feature/new'; ctx.branches.delete('/repo');
  await ctx.refreshChatGitBranch('/repo');
  assert.equal(ctx.branches.get('/repo'), 'feature/new', 'explicit invalidation must bypass the refresh interval');
  console.log('PASS: branch refresh detects external switches, shares requests and avoids redraw loops');
})().catch(error => { console.error(error); process.exitCode = 1; });
