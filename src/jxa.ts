import { spawn } from 'node:child_process';

export class JxaError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string
  ) {
    super(message);
  }
}

export async function runJxa<T = unknown>(script: string): Promise<T> {
  const proc = spawn('osascript', ['-l', 'JavaScript'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];

  proc.stdout.on('data', (d) => chunks.push(Buffer.from(d)));
  proc.stderr.on('data', (d) => errChunks.push(Buffer.from(d)));

  // Write script directly; JXA prints the value of the last expression.
  proc.stdin.write(script);
  proc.stdin.end();

  const code: number = await new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => resolve(code ?? 1));
  });

  const stdout = Buffer.concat(chunks).toString('utf8').trim();
  const stderr = Buffer.concat(errChunks).toString('utf8').trim();

  if (code !== 0) {
    throw new JxaError(`osascript exited with code ${code}`, stderr || stdout);
  }

  // Allow scripts to print plain text or JSON.
  try {
    return JSON.parse(stdout) as T;
  } catch {
    // If not JSON, return as any string
    return stdout as unknown as T;
  }
}

export async function runAppleScript(script: string): Promise<string> {
  const proc = spawn('osascript', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  proc.stdout.on('data', (d) => chunks.push(Buffer.from(d)));
  proc.stderr.on('data', (d) => errChunks.push(Buffer.from(d)));
  proc.stdin.write(script);
  proc.stdin.end();
  const code: number = await new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (c) => resolve(c ?? 1));
  });
  const stdout = Buffer.concat(chunks).toString('utf8').trim();
  const stderr = Buffer.concat(errChunks).toString('utf8').trim();
  if (code !== 0) {
    throw new JxaError(
      `osascript (AppleScript) exited with code ${code}`,
      stderr || stdout
    );
  }
  return stdout;
}
