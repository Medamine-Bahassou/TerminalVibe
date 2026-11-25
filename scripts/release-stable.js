const { spawnSync } = require('node:child_process');

const [version, ...extraArgs] = process.argv.slice(2);
if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '') || extraArgs.length) {
  console.error('Usage: npm run release:stable -- <major.minor.patch>');
  process.exit(1);
}

const result = spawnSync('gh', [
  'workflow', 'run', 'release.yml',
  '--repo', 'Medamine-Bahassou/TerminalVibe',
  '--ref', 'master',
  '--raw-field', `version=${version}`,
], { stdio: 'inherit' });

if (result.error) console.error(`Could not run GitHub CLI: ${result.error.message}`);
process.exitCode = result.status ?? 1;
