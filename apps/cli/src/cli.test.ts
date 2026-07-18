import { describe, expect, it } from 'vitest';
import type { IoContext } from './io';
import { runCreate } from './commands/create';
import { runDoctor, runInit } from './commands/misc';
import { buildProgram } from './program';

interface MemoryIo extends IoContext {
  files: Map<string, string>;
  out: string[];
  err: string[];
}

function memoryIo(env: Record<string, string | undefined> = {}): MemoryIo {
  const files = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  return {
    env,
    cwd: '/work',
    interactive: false,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    confirm: () => Promise.resolve(true),
    fileExists: (p) => Promise.resolve(files.has(p)),
    readFile: (p) => Promise.resolve(files.get(p) ?? ''),
    writeFile: (p, d) => {
      files.set(p, d);
      return Promise.resolve();
    },
    files,
    out,
    err
  };
}

const argv = (...args: string[]) => ['node', 'docforge', ...args];

describe('docforge create', () => {
  it('prints Markdown to stdout with the template generator', async () => {
    const io = memoryIo();
    const code = await runCreate(
      { prompt: 'README for a tool called Acme', ai: false },
      io
    );
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('# Acme');
    expect(io.err.join('\n')).toContain('Built-in templates');
  });

  it('writes a full HTML document to a file (with extension inferred)', async () => {
    const io = memoryIo();
    const code = await runCreate(
      { prompt: 'Report on sales', format: 'html', ai: false, output: 'report', nonInteractive: true, force: true },
      io
    );
    expect(code).toBe(0);
    const written = io.files.get('/work/report.html');
    expect(written).toBeDefined();
    expect(written!.startsWith('<!doctype html>')).toBe(true);
    expect(written).not.toContain('<script');
  });

  it('refuses to overwrite without --force in non-interactive mode', async () => {
    const io = memoryIo();
    io.files.set('/work/x.md', '# Old\n');
    const code = await runCreate(
      { prompt: 'readme', ai: false, output: 'x', nonInteractive: true },
      io
    );
    expect(code).toBe(1);
    expect(io.files.get('/work/x.md')).toBe('# Old\n');
  });

  it('reports invalid options', async () => {
    const io = memoryIo();
    const code = await runCreate({ prompt: 'x', tone: 'sarcastic', ai: false }, io);
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('Invalid options');
  });

  it('is wired into the commander program', async () => {
    const io = memoryIo();
    process.exitCode = 0;
    await buildProgram(io).parseAsync(argv('create', 'Blog about TypeScript', '--no-ai', '--template', 'blog'));
    expect(io.out.join('\n')).toContain('# ');
    expect(process.exitCode).toBe(0);
    process.exitCode = 0;
  });
});

describe('docforge doctor', () => {
  it('lists generators and templates', async () => {
    const io = memoryIo();
    const code = await runDoctor(io);
    expect(code).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('Generators');
    expect(text).toContain('Built-in templates');
    expect(text).toContain('readme');
  });

  it('detects an API key from the environment', async () => {
    const io = memoryIo({ ANTHROPIC_API_KEY: 'sk-test' });
    await runDoctor(io);
    expect(io.out.join('\n')).toContain('detected');
  });
});

describe('docforge init', () => {
  it('writes a config file', async () => {
    const io = memoryIo();
    const code = await runInit(io, { nonInteractive: true });
    expect(code).toBe(0);
    expect(io.files.get('/work/docforge.config.json')).toContain('defaultFormat');
  });
});
