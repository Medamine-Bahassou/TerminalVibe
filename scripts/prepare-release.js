#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = process.env.GITHUB_REPOSITORY || 'Medamine-Bahassou/TerminalVibe';
const ref = process.env.GITHUB_REF || '';
const refName = process.env.GITHUB_REF_NAME || '';

// 1. Parse all semantic tags from git
let allTags = [];
try {
  allTags = cp.execSync('git tag -l', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch (e) {
  console.warn('Could not list git tags:', e.message);
}

// Also read current package.json version
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const pkgVersion = pkg.version || '0.1.0';

function parseSemver(str) {
  if (!str) return null;
  const cleaned = str.trim().replace(/^v/, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    raw: str.trim(),
    hasV: str.trim().startsWith('v'),
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

const parsedTags = allTags.map(parseSemver).filter(Boolean);
const parsedPkg = parseSemver(pkgVersion);
if (parsedPkg) parsedTags.push(parsedPkg);

// Sort descending by semver
parsedTags.sort((a, b) => {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
});

const highest = parsedTags[0] || { raw: '0.1.0', hasV: false, major: 0, minor: 1, patch: 0 };

let targetVersion = '';
let targetTag = '';

// If triggered directly by a tag push
if (ref.startsWith('refs/tags/')) {
  targetTag = refName;
  targetVersion = refName.replace(/^v/, '');
} else {
  // Push to main/master: bump patch version by +0.0.1
  const nextMajor = highest.major;
  const nextMinor = highest.minor;
  const nextPatch = highest.patch + 1;
  targetVersion = `${nextMajor}.${nextMinor}.${nextPatch}`;
  targetTag = highest.hasV ? `v${targetVersion}` : `v${targetVersion}`;
}

const releaseTitle = `TerminalVibe v${targetVersion}`;

// 2. Collect commits since the previous release tag for the changelog
const prevTag = parsedTags.find(t => t.raw !== targetTag)?.raw || null;
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
console.log('Next Version (+0.0.1):', targetVersion);
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
