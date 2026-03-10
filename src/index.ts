import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppleNotesAdapter } from './adapter.js';
import { loadPolicyConfig, SafetyPolicy } from './policy.js';
import { createNotesServer } from './server.js';

function getPackageVersion(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageJson = JSON.parse(
    readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
  ) as { version?: string };

  return packageJson.version || '0.0.0';
}

export function parseCliArgs(argv: string[]) {
  return {
    help: argv.includes('--help'),
    version: argv.includes('--version'),
  };
}

export function assertSupportedPlatform(platform = process.platform) {
  if (platform !== 'darwin') {
    throw new Error('apple-notes-mcp requires macOS to automate Apple Notes.');
  }
}

function readBooleanEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean
): boolean {
  const value = env[name];
  if (value === undefined) {
    return defaultValue;
  }

  if (value === '1') {
    return true;
  }
  if (value === '0') {
    return false;
  }

  return defaultValue;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.version) {
    console.log(getPackageVersion());
    return;
  }

  if (args.help) {
    console.log(
      [
        'apple-notes-mcp: start a local MCP server for Apple Notes over stdio.',
        'Usage: apple-notes-mcp [--help] [--version]',
        '',
        'Environment:',
        '  NOTES_MCP_ALLOW_WRITES=0|1    Disable or enable write operations (default: 1).',
        '  NOTES_MCP_ALLOW_DELETES=0|1   Allow destructive delete tools without interactive confirmation (default: 0).',
        '  NOTES_MCP_WARMUP=0|1          Trigger Notes/Automation readiness on startup (default: 1).',
      ].join('\n')
    );
    return;
  }

  assertSupportedPlatform();

  const adapter = new AppleNotesAdapter(undefined, {
    enableWarmup: readBooleanEnv(process.env, 'NOTES_MCP_WARMUP', true),
  });
  void adapter.warmup().catch(() => {});

  const server = createNotesServer({
    adapter,
    policy: new SafetyPolicy(loadPolicyConfig()),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : `Failed to start server: ${String(error)}`
    );
    process.exit(1);
  });
}
