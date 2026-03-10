import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function withFakeOsaScript(handler, run) {
  const tmpdir = mkdtempSync(path.join(os.tmpdir(), 'apple-notes-mcp-test-'));
  const binDir = path.join(tmpdir, 'bin');
  const logFile = path.join(tmpdir, 'invocations.jsonl');
  mkdirSync(binDir, { recursive: true });

  writeFileSync(
    path.join(binDir, 'osascript'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ args, stdin }) + '\\n');
  const mode = args.includes('-l') ? 'jxa' : 'applescript';
  const res = (${handler.toString()})(mode, stdin, args);
  process.stdout.write(JSON.stringify(res));
});
`,
    { mode: 0o755 }
  );

  const prevPath = process.env.PATH || '';
  process.env.PATH = `${binDir}:${prevPath}`;

  try {
    await run(logFile);
  } finally {
    process.env.PATH = prevPath;
    rmSync(tmpdir, { recursive: true, force: true });
  }
}

test('listNotes walks nested folders recursively', async () => {
  const { listNotes } = await import(
    pathToFileURL(path.resolve('dist/notes.js')).href
  );

  await withFakeOsaScript(
    (mode, stdin) => {
      if (mode !== 'jxa') return '';
      if (!stdin.includes('function walkFolders(container, visit)')) {
        throw new Error('missing recursive folder walker');
      }
      if (!stdin.includes('allFolders(Notes)')) {
        throw new Error('listNotes did not use recursive folder collection');
      }
      return [];
    },
    async () => {
      const notes = await listNotes({ limit: 5 });
      assert.deepEqual(notes, []);
    }
  );
});

test('getNote searches notes through recursive traversal helper', async () => {
  const { getNote } = await import(
    pathToFileURL(path.resolve('dist/notes.js')).href
  );

  await withFakeOsaScript(
    (mode, stdin) => {
      if (mode !== 'jxa') return '';
      if (!stdin.includes('findNoteWithFolderById(Notes, "note-123")')) {
        throw new Error('getNote did not use recursive note lookup');
      }
      return null;
    },
    async () => {
      const note = await getNote('note-123');
      assert.equal(note, null);
    }
  );
});
