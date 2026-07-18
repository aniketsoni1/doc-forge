import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';

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
    async confirm(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = (await rl.question(`${question} (y/N) `)).trim().toLowerCase();
        return answer === 'y' || answer === 'yes';
      } finally {
        rl.close();
      }
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

/** Longest-common-subsequence line diff, rendered as a compact colored unified diff. */
export function diffLines(oldText: string, newText: string): string {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(pc.red(`- ${a[i]}`));
      i++;
    } else {
      out.push(pc.green(`+ ${b[j]}`));
      j++;
    }
  }
  while (i < n) out.push(pc.red(`- ${a[i++]}`));
  while (j < m) out.push(pc.green(`+ ${b[j++]}`));
  return out.join('\n');
}
