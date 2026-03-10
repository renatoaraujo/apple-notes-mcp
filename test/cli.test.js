import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertSupportedPlatform } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distCli = path.resolve(__dirname, '../dist/index.js');

test('prints version with --version', () => {
  const res = spawnSync(process.execPath, [distCli, '--version'], {
    encoding: 'utf8',
  });
  assert.equal(
    res.status,
    0,
    `exit ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`
  );
  assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+(-.*)?$/);
});

test('prints help with --help', () => {
  const res = spawnSync(process.execPath, [distCli, '--help'], {
    encoding: 'utf8',
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /local MCP server for Apple Notes/);
  assert.match(res.stdout, /NOTES_MCP_WARMUP=0\|1/);
});

test('assertSupportedPlatform rejects non-macOS startup', () => {
  assert.throws(
    () => assertSupportedPlatform('linux'),
    /requires macOS to automate Apple Notes/
  );
});
