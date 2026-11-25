#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = process.env.GITHUB_REPOSITORY || 'Medamine-Bahassou/TerminalVibe';
const ref = process.env.GITHUB_REF || '';
const event = process.env.GITHUB_EVENT_NAME;
const nightly = event === 'push';

if (ref !== 'refs/heads/master' || (!nightly && event !== 'workflow_dispatch')) {
  throw new Error('Releases must run from master via a push or manual dispatch');
}

// 1. Parse all semantic tags from git
const allTags = cp.execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).trim().split('\n');

// Also read current package.json version
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const pkgVersion = pkg.version || '0.1.0';

function parseSemver(str) {
  if (!str) return null;
  const cleaned = str.replace(/^v/, '');
  const match = cleaned.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return {
    raw: str,
    major,
    minor,
    patch,
  };
}

const parsedTags = allTags.map(parseSemver).filter(Boolean);
function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

parsedTags.sort((a, b) => compareVersions(b, a));
const stableInput = nightly ? '' : (process.env.STABLE_VERSION || '').trim();
const requested = parseSemver(stableInput);
const requestedTag = requested && `v${requested.raw.replace(/^v/, '')}`;
const existingTag = parsedTags.find(tag => tag.raw === requestedTag);
const previousTag = parsedTags.find(tag => tag !== existingTag);
const highest = previousTag || parseSemver(pkgVersion);

let targetVersion;
if (nightly) {
  const runNumber = process.env.GITHUB_RUN_NUMBER;
  if (!/^[1-9]\d*$/.test(runNumber || '')) throw new Error('Missing workflow run number');
  targetVersion = `${highest.major}.${highest.minor}.${highest.patch + 1}-nightly.${runNumber}`;
} else {
  if (!requested || compareVersions(requested, highest) <= 0) {
    throw new Error(`Specify a stable version newer than ${highest.raw}`);
  }
  if (existingTag && cp.execFileSync('git', ['rev-parse', `${requestedTag}^{commit}`], { encoding: 'utf8' }).trim() !== process.env.GITHUB_SHA) {
    throw new Error(`${requestedTag} already points to a different commit`);
  }
  targetVersion = requested.raw.replace(/^v/, '');
}

const targetTag = `v${targetVersion}`;
const releaseTitle = `TerminalVibe ${targetTag}`;

// 2. Collect commits since the previous release tag for the changelog
const prevTag = previousTag?.raw;
let commits = [];
try {
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD~5..HEAD';
  const out = cp.execSync(`git log ${range} --pretty=format:"%H|%h|%s"`, { encoding: 'utf8' }).trim();
  commits = out.split('\n').filter(Boolean);
} catch {
  try {
    const out = cp.execSync('git log -n 5 --pretty=format:"%H|%h|%s"', { encoding: 'utf8' }).trim();
    commits = out.split('\n').filter(Boolean);
  } catch {}
}

let changelogLines = [];
for (const line of commits) {
  const parts = line.split('|');
  if (parts.length >= 3) {
    const fullSha = parts[0];
    const shortSha = parts[1];
    const subject = parts.slice(2).join('|');
    const commitUrl = `https://github.com/${repo}/commit/${fullSha}`;
    changelogLines.push(`* [\`${shortSha}\`](${commitUrl}) - ${subject}`);
  }
}

if (!changelogLines.length) {
  changelogLines.push('* Automated release update');
}

const releaseBody = `## What's Changed\n\n${changelogLines.join('\n')}\n`;

// Write release notes to file
const notesFile = path.join(__dirname, '..', 'release_notes.md');
fs.writeFileSync(notesFile, releaseBody, 'utf8');

console.log('--- Release Info ---');
console.log('Highest existing version:', `${highest.major}.${highest.minor}.${highest.patch}`);
console.log('Release version:', targetVersion);
console.log('Target Tag:', targetTag);
console.log('Release Title:', releaseTitle);
console.log('\n--- Release Notes ---');
console.log(releaseBody);

// Output to GitHub Actions environment if GITHUB_OUTPUT is set
if (process.env.GITHUB_OUTPUT) {
  const outPath = process.env.GITHUB_OUTPUT;
  fs.appendFileSync(outPath, `version=${targetVersion}\n`);
  fs.appendFileSync(outPath, `tag=${targetTag}\n`);
  fs.appendFileSync(outPath, `title=${releaseTitle}\n`);
  fs.appendFileSync(outPath, `notes_file=${notesFile}\n`);
}
