import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import pc from 'picocolors';
import { formatTextDiff } from '@dfg/diff';

/** Injectable I/O boundary so command logic is unit-testable without real fs/tty. */
export interface IoContext {
  env: Record<string, string | undefined>;
  cwd: string;
  interactive: boolean;
  stdout(text: string): void;
  stderr(text: string): void;
  confirm(question: string): Promise<boolean>;
  fileExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
}

export function nodeIo(overrides: Partial<IoContext> = {}): IoContext {
  return {
    env: process.env,
    cwd: process.cwd(),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    stdout: (t) => process.stdout.write(`${t}\n`),
    stderr: (t) => process.stderr.write(`${t}\n`),
    confirm(question) {
      // Event-based stdin read (no node:readline) so the CLI's types stay stable
      // across @types/node major versions.
      process.stdout.write(`${question} (y/N) `);
      return new Promise<boolean>((resolve) => {
        const stdin = process.stdin;
        const onData = (chunk: Buffer): void => {
          stdin.off('data', onData);
          stdin.pause();
          const answer = chunk.toString('utf8').trim().toLowerCase();
          resolve(answer === 'y' || answer === 'yes');
        };
        stdin.resume();
        stdin.once('data', onData);
      });
    },
    async fileExists(path) {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (path) => readFile(path, 'utf8'),
    async writeFile(path, data) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, 'utf8');
    },
    ...overrides
  };
}

/**
 * Colourise the shared line differ for a terminal.
 *
 * The diff algorithm itself lives in `@dfg/diff` so the extension can render the
 * same comparison in a webview; only the ANSI decoration belongs here.
 */
export function diffLines(oldText: string, newText: string): string {
  return formatTextDiff(oldText, newText, {
    full: true,
    decorate: (line, rendered) => {
      if (line.op === 'add') return pc.green(rendered);
      if (line.op === 'remove') return pc.red(rendered);
      return rendered;
    }
  });
}
