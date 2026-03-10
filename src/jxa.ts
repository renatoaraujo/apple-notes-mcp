import { spawn } from 'node:child_process';

export class JxaError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string
  ) {
    super(message);
  }
}

export interface ScriptRunOptions {
  timeoutMs?: number;
}

export interface ScriptRuntime {
  runJxa<T>(script: string, options?: ScriptRunOptions): Promise<T>;
  runAppleScript(
    script: string,
    options?: ScriptRunOptions
  ): Promise<string>;
}

async function runScript(
  args: string[],
  script: string,
  timeoutMs = 20_000
): Promise<string> {
  const proc = spawn('osascript', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];

  proc.stdout.on('data', (d) => chunks.push(Buffer.from(d)));
  proc.stderr.on('data', (d) => errChunks.push(Buffer.from(d)));

  proc.stdin.write(script);
  proc.stdin.end();

  const code: number = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new JxaError(`osascript timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (closeCode) => {
      clearTimeout(timer);
      resolve(closeCode ?? 1);
    });
  });

  const stdout = Buffer.concat(chunks).toString('utf8').trim();
  const stderr = Buffer.concat(errChunks).toString('utf8').trim();

  if (code !== 0) {
    throw new JxaError(`osascript exited with code ${code}`, stderr || stdout);
  }

  return stdout;
}

export async function runJxa<T = unknown>(
  script: string,
  options?: ScriptRunOptions
): Promise<T> {
  const stdout = await runScript(
    ['-l', 'JavaScript'],
    script,
    options?.timeoutMs
  );

  try {
    return JSON.parse(stdout) as T;
  } catch {
    return stdout as unknown as T;
  }
}

export async function runAppleScript(
  script: string,
  options?: ScriptRunOptions
): Promise<string> {
  return runScript([], script, options?.timeoutMs);
}
