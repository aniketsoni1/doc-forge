import { Command } from 'commander';
import { nodeIo, type IoContext } from './io';
import { runCreate, type CreateOptions } from './commands/create';
import { runConfigure, runDoctor, runInit } from './commands/misc';
import {
  runOutline,
  runRewrite,
  runTransforms,
  type RewriteOptions
} from './commands/rewrite';
import { VERSION } from './version';

/** Build the DocForge CLI program. Pure: no parsing side effects on import. */
export function buildProgram(io: IoContext = nodeIo()): Command {
  const program = new Command();
  program
    .name('docforge')
    .description('Deterministic-first document generator: a prompt in, a polished Markdown or HTML file out.')
    .version(VERSION);

  program
    .command('create')
    .description('Generate a Markdown or HTML document from a prompt')
    .argument('<prompt>', 'what the document should be about')
    .option('-f, --format <format>', 'output format: md | html')
    .option('-t, --template <id>', 'preset: readme | blog | report | landing | changelog | letter')
    .option('--tone <tone>', 'neutral | formal | friendly | technical | marketing')
    .option('--length <length>', 'short | medium | long')
    .option('--title <title>', 'explicit document title')
    .option('-m, --model <model>', 'AI model id to use (requires an API key)')
    .option('-o, --output <path>', 'write to a file instead of stdout')
    .option('--no-ai', 'force the deterministic built-in template generator')
    .option('--non-interactive', 'never prompt; requires --force to overwrite existing files')
    .option('--force', 'overwrite existing files without prompting')
    .action(async (prompt: string, options: Omit<CreateOptions, 'prompt'>) => {
      process.exitCode = await runCreate({ prompt, ...options }, io);
    });

  program
    .command('rewrite')
    .description('Apply a transform to a document, or to one of its sections')
    .argument('<file>', 'path to the Markdown or HTML file')
    .option('-t, --transform <id>', 'transform id (see `docforge transforms`)', 'improve-clarity')
    .option('-s, --section <slug>', 'restrict the rewrite to one section')
    .option('--tone <tone>', 'target tone, for change-tone')
    .option('--audience <audience>', 'target audience, for rewrite-for-audience')
    .option('--language <language>', 'target language, for translate')
    .option('--instruction <text>', 'instruction, for custom rewrites')
    .option('-w, --write', 'write the result back to the file')
    .option('--no-ai', 'only allow transforms that run offline')
    .option('--non-interactive', 'never prompt; requires --force to write')
    .option('--force', 'write without prompting')
    .action(async (file: string, options: Omit<RewriteOptions, 'file'>) => {
      process.exitCode = await runRewrite({ file, ...options }, io);
    });

  program
    .command('transforms')
    .description('List the available text transforms')
    .action(() => {
      process.exitCode = runTransforms(io);
    });

  program
    .command('outline')
    .description('Print the heading structure of a document')
    .argument('<file>', 'path to the Markdown or HTML file')
    .action(async (file: string) => {
      process.exitCode = await runOutline(file, io);
    });

  program
    .command('doctor')
    .description('Report environment info and which generators are available')
    .action(async () => {
      process.exitCode = await runDoctor(io);
    });

  program
    .command('init')
    .description('Write a starter docforge.config.json to the current directory')
    .option('--force', 'overwrite an existing config')
    .option('--non-interactive', 'never prompt')
    .action(async (options: { force?: boolean; nonInteractive?: boolean }) => {
      process.exitCode = await runInit(io, options);
    });

  program
    .command('configure')
    .description('Explain how to supply AI credentials (the CLI uses environment variables)')
    .action(async () => {
      process.exitCode = await runConfigure(io);
    });

  return program;
}

export async function main(argv: string[] = process.argv, io?: IoContext): Promise<void> {
  await buildProgram(io).parseAsync(argv);
}
