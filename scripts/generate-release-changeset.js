import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const packageName = '@rnto1/apple-notes-mcp';
const changesetDir = path.resolve(process.cwd(), '.changeset');

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

function listPendingChangesets() {
  try {
    return readdirSync(changesetDir).filter(
      (name) => name.endsWith('.md') && name !== 'README.md'
    );
  } catch {
    return [];
  }
}

function latestTag() {
  const tags = git(['tag', '--list', 'v*', '--sort=-version:refname']);
  return tags
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)[0];
}

function commitMessages(range) {
  const output = git(['log', '--format=%s%n%b', range]);
  return output.trim();
}

function commitSubjects(range) {
  const output = git(['log', '--format=%s', '--no-merges', range]);
  return output
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function determineBump(messages) {
  if (/BREAKING CHANGE|^[a-z]+(?:\([^)]*\))?!:/im.test(messages)) {
    return 'major';
  }
  if (/^feat(?:\([^)]*\))?:/im.test(messages)) {
    return 'minor';
  }
  return 'patch';
}

function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const existing = listPendingChangesets();
if (existing.length > 0) {
  console.log(`Found existing changeset(s): ${existing.join(', ')}`);
  process.exit(0);
}

const tag = latestTag();
const range = tag ? `${tag}..HEAD` : 'HEAD';
const messages = commitMessages(range);

if (!messages) {
  console.log(
    'No commits found since the latest release tag. Skipping changeset generation.'
  );
  process.exit(0);
}

const subjects = commitSubjects(range);
if (subjects.length === 0) {
  console.log(
    'No non-merge commits found since the latest release tag. Skipping changeset generation.'
  );
  process.exit(0);
}

const bump = determineBump(messages);
const summary = subjects.slice(0, 5);
const shortSha = git(['rev-parse', '--short', 'HEAD']);
const lead = summary[0] || `release ${shortSha}`;
const filename = `${toSlug(lead)}-${shortSha}.md`;

mkdirSync(changesetDir, { recursive: true });
writeFileSync(
  path.join(changesetDir, filename),
  [
    '---',
    `"${packageName}": ${bump}`,
    '---',
    '',
    `Auto-generated release changeset from commits since ${tag || 'repository start'}.`,
    '',
    ...summary.map((entry) => `- ${entry}`),
    '',
  ].join('\n'),
  'utf8'
);

console.log(`Generated .changeset/${filename}`);
