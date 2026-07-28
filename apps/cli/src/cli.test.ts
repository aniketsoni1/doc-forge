import { describe, expect, it } from 'vitest';
import type { IoContext } from './io';
import { runCreate, resolveOutputPath } from './commands/create';
import { runConfigure, runDoctor, runInit } from './commands/misc';
import { runOutline, runRewrite, runTransforms } from './commands/rewrite';
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

  it('writes a config file that the very next run reads back', async () => {
    const io = memoryIo();
    await runInit(io, { nonInteractive: true });
    await runDoctor(io);
    expect(io.out.join('\n')).toContain('docforge.config.json');
  });

  it('refuses to clobber an existing config without --force', async () => {
    const io = memoryIo();
    io.files.set('/work/docforge.config.json', '{}');
    expect(await runInit(io, { nonInteractive: true })).toBe(1);
    expect(io.files.get('/work/docforge.config.json')).toBe('{}');
  });
});

describe('docforge.config.json', () => {
  it('changes the default format for a run', async () => {
    const io = memoryIo();
    io.files.set('/work/docforge.config.json', '{"defaultFormat":"html"}');
    const code = await runCreate({ prompt: 'Report on sales', ai: false }, io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('<!doctype html>');
  });

  it('is overridden by an explicit flag', async () => {
    const io = memoryIo();
    io.files.set('/work/docforge.config.json', '{"defaultFormat":"html"}');
    await runCreate({ prompt: 'Report on sales', format: 'md', ai: false }, io);
    expect(io.out.join('\n')).not.toContain('<!doctype html>');
  });

  it('reports a malformed config but still produces a document', async () => {
    const io = memoryIo();
    io.files.set('/work/docforge.config.json', '{ broken');
    const code = await runCreate({ prompt: 'readme for Acme', ai: false }, io);
    expect(code).toBe(0);
    expect(io.err.join('\n')).toContain('not valid JSON');
    expect(io.out.join('\n')).toContain('# ');
  });

  it('reports an unknown key rather than ignoring a typo', async () => {
    const io = memoryIo();
    io.files.set('/work/docforge.config.json', '{"defaultFromat":"html"}');
    await runCreate({ prompt: 'readme', ai: false }, io);
    expect(io.err.join('\n')).toContain('docforge.config.json');
  });

  it('is absent by default, and doctor says so', async () => {
    const io = memoryIo();
    await runDoctor(io);
    expect(io.out.join('\n')).toContain('none (using defaults)');
  });
});

describe('resolveOutputPath', () => {
  it('infers an extension from the format', () => {
    expect(resolveOutputPath('/work', 'out', 'md').target).toBe('/work/out.md');
    expect(resolveOutputPath('/work', 'out', 'html').target).toBe('/work/out.html');
  });

  it('keeps an extension the user already supplied', () => {
    expect(resolveOutputPath('/work', 'notes.markdown', 'md').target).toBe('/work/notes.markdown');
  });

  it('reports a path that escapes the working directory', () => {
    const outside = resolveOutputPath('/work', '../elsewhere/out', 'md');
    expect(outside.escapesCwd).toBe(true);
    expect(outside.display).toBe('/elsewhere/out.md');

    const inside = resolveOutputPath('/work', 'docs/out', 'md');
    expect(inside.escapesCwd).toBe(false);
    expect(inside.display).toBe('docs/out.md');
  });

  it('treats an absolute path outside the cwd as escaping', () => {
    expect(resolveOutputPath('/work', '/tmp/out', 'md').escapesCwd).toBe(true);
  });
});

describe('docforge transforms', () => {
  it('lists transforms and marks which run offline', () => {
    const io = memoryIo();
    expect(runTransforms(io)).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('to-bullets');
    expect(text).toContain('offline');
    expect(text).toContain('improve-clarity');
    expect(text).toContain('needs AI');
  });
});

describe('docforge outline', () => {
  it('prints the heading structure with slugs', async () => {
    const io = memoryIo();
    io.files.set('/work/doc.md', '# Title\n\n## Alpha\n\nbody\n\n## Beta\n\nbody\n');
    expect(await runOutline('doc.md', io)).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('Title');
    expect(text).toContain('Alpha');
    expect(text).toContain('beta');
  });

  it('says so when there are no headings', async () => {
    const io = memoryIo();
    io.files.set('/work/plain.md', 'just prose\n');
    await runOutline('plain.md', io);
    expect(io.out.join('\n')).toContain('No headings');
  });

  it('reports a missing file', async () => {
    const io = memoryIo();
    expect(await runOutline('nope.md', io)).toBe(1);
    expect(io.err.join('\n')).toContain('No such file');
  });
});

describe('docforge rewrite', () => {
  const doc = 'First point. Second point.\n';

  it('applies an offline transform and prints the result', async () => {
    const io = memoryIo();
    io.files.set('/work/notes.md', doc);
    const code = await runRewrite(
      { file: 'notes.md', transform: 'to-bullets', ai: false },
      io
    );
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('- First point.');
    // Without --write the file is untouched.
    expect(io.files.get('/work/notes.md')).toBe(doc);
  });

  it('shows a diff before proposing any change', async () => {
    const io = memoryIo();
    io.files.set('/work/notes.md', doc);
    await runRewrite({ file: 'notes.md', transform: 'to-bullets', ai: false }, io);
    const err = io.err.join('\n');
    expect(err).toContain('Proposed changes');
    expect(err).toContain('+ - First point.');
  });

  it('writes the file with --write --force', async () => {
    const io = memoryIo();
    io.files.set('/work/notes.md', doc);
    const code = await runRewrite(
      { file: 'notes.md', transform: 'to-bullets', ai: false, write: true, force: true },
      io
    );
    expect(code).toBe(0);
    expect(io.files.get('/work/notes.md')).toContain('- First point.');
  });

  it('refuses to write non-interactively without --force', async () => {
    const io = memoryIo();
    io.files.set('/work/notes.md', doc);
    const code = await runRewrite(
      {
        file: 'notes.md',
        transform: 'to-bullets',
        ai: false,
        write: true,
        nonInteractive: true
      },
      io
    );
    expect(code).toBe(1);
    expect(io.files.get('/work/notes.md')).toBe(doc);
    expect(io.err.join('\n')).toContain('--force');
  });

  it('reports an unknown transform with a pointer to the list', async () => {
    const io = memoryIo();
    io.files.set('/work/notes.md', doc);
    const code = await runRewrite({ file: 'notes.md', transform: 'nonsense', ai: false }, io);
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('docforge transforms');
  });

  it('reports a missing file', async () => {
    const io = memoryIo();
    expect(await runRewrite({ file: 'nope.md', ai: false }, io)).toBe(1);
    expect(io.err.join('\n')).toContain('No such file');
  });

  it('explains that an AI transform cannot run with --no-ai', async () => {
    const io = memoryIo();
    io.files.set('/work/notes.md', doc);
    const code = await runRewrite(
      { file: 'notes.md', transform: 'improve-clarity', ai: false },
      io
    );
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/needs an AI provider/i);
  });

  it('rejects an unknown section by name and lists the real ones', async () => {
    const io = memoryIo();
    io.files.set('/work/doc.md', '# T\n\n## Alpha\n\nbody\n');
    const code = await runRewrite(
      { file: 'doc.md', section: 'missing', ai: false },
      io
    );
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('alpha');
  });

  it('reports no changes when a transform is a no-op', async () => {
    const io = memoryIo();
    io.files.set('/work/list.md', '- already a bullet\n');
    const code = await runRewrite(
      { file: 'list.md', transform: 'to-bullets', ai: false },
      io
    );
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('No changes');
  });

  it('is wired into the commander program', async () => {
    const io = memoryIo();
    io.files.set('/work/notes.md', doc);
    process.exitCode = 0;
    await buildProgram(io).parseAsync(
      argv('rewrite', 'notes.md', '--transform', 'to-bullets', '--no-ai')
    );
    expect(io.out.join('\n')).toContain('- First point.');
    expect(process.exitCode).toBe(0);
    process.exitCode = 0;
  });
});

describe('docforge configure', () => {
  it('explains credential sources and precedence', async () => {
    const io = memoryIo();
    expect(await runConfigure(io)).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('ANTHROPIC_API_KEY');
    expect(text).toContain('Precedence');
  });
});
