import * as vscode from 'vscode';
import type { DocFormat, Generator } from '@dfg/core';
import { DocForgeError } from '@dfg/core';
import { regenerateSection, runTransform, type EditResult } from '@dfg/agent';
import { formatTextDiff, summarizeDiff, diffLines } from '@dfg/diff';
import {
  findBySlug,
  parseOutline,
  sectionAt,
  type Section
} from '@dfg/document-model';
import {
  missingInput,
  transformsForFormat,
  type Transform,
  type TransformContext
} from '@dfg/transforms';
import { describeFailure } from './errors';
import { formatForLanguage } from './naming';

interface TransformPick extends vscode.QuickPickItem {
  transform: Transform;
}

/**
 * Offer the transform list, marking which entries work without a provider so the
 * choice is informed rather than a guess that fails afterwards.
 */
async function pickTransform(
  format: DocFormat,
  aiAvailable: boolean
): Promise<Transform | undefined> {
  const items: TransformPick[] = transformsForFormat(format).map((transform) => ({
    label: transform.label,
    description: transform.description,
    ...(transform.kind === 'ai' && !aiAvailable
      ? { detail: '$(warning) Needs an AI provider - none available right now' }
      : {}),
    transform
  }));

  // Offline-capable options first when there is no provider to run the rest.
  if (!aiAvailable) {
    items.sort((a, b) => Number(a.transform.kind === 'ai') - Number(b.transform.kind === 'ai'));
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: aiAvailable
      ? 'Transform the selection…'
      : 'No AI provider available - built-in transforms are listed first',
    matchOnDescription: true
  });
  return pick?.transform;
}

/** Collect whatever extra input the chosen transform still needs. */
async function collectInput(
  transform: Transform,
  ctx: TransformContext
): Promise<TransformContext | undefined> {
  const needs = missingInput(transform, ctx);
  if (!needs) return ctx;

  if (needs === 'tone') {
    const tone = await vscode.window.showQuickPick(
      ['neutral', 'formal', 'friendly', 'technical', 'marketing'],
      { placeHolder: 'Target tone' }
    );
    return tone ? { ...ctx, tone: tone as TransformContext['tone'] } : undefined;
  }

  const prompts: Record<string, { title: string; placeHolder: string }> = {
    audience: { title: 'Rewrite for audience', placeHolder: 'e.g. non-technical executives' },
    language: { title: 'Translate into', placeHolder: 'e.g. French' },
    instruction: { title: 'Custom instruction', placeHolder: 'e.g. add a worked example' }
  };
  const config = prompts[needs];
  if (!config) return ctx;

  const value = await vscode.window.showInputBox({
    title: config.title,
    placeHolder: config.placeHolder
  });
  if (!value?.trim()) return undefined;
  return { ...ctx, [needs]: value.trim() };
}

export type ReviewChoice = 'accept' | 'reject' | 'regenerate';

/**
 * Show the change and ask what to do with it.
 *
 * The diff is presented before anything is written, and rejecting is the
 * default outcome of dismissing the prompt - the destructive path always needs
 * a deliberate click.
 */
async function reviewChange(
  original: string,
  replacement: string,
  title: string,
  producedBy: string
): Promise<ReviewChoice> {
  const lines = diffLines(original, replacement);
  const summary = summarizeDiff(lines);

  if (original.trim() === replacement.trim()) {
    void vscode.window.showInformationMessage(`DocForge: ${title} produced no change.`);
    return 'reject';
  }

  const choice = await vscode.window.showInformationMessage(
    `${title} (${summary}) via ${producedBy}`,
    { modal: true, detail: buildPreview(lines) },
    'Apply',
    'Regenerate'
  );

  if (choice === 'Apply') return 'accept';
  if (choice === 'Regenerate') return 'regenerate';
  return 'reject';
}

/** A compact diff preview sized for a modal dialog. */
function buildPreview(lines: ReturnType<typeof diffLines>): string {
  const rendered = formatTextDiff(
    lines.filter((l) => l.op !== 'add').map((l) => l.text).join('\n'),
    lines.filter((l) => l.op !== 'remove').map((l) => l.text).join('\n'),
    { context: 2 }
  );
  const capped = rendered.split('\n').slice(0, 30);
  if (rendered.split('\n').length > 30) capped.push('…');
  return capped.join('\n');
}

export interface EditingDeps {
  buildGenerators: () => Promise<Generator[]>;
  log: (line: string) => void;
  showLogs: () => void;
}

/** DocForge: Improve Selected Text - the selection-based editing flow. */
export async function editSelectionFlow(deps: EditingDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('DocForge: open a file and select some text first.');
    return;
  }
  if (editor.selection.isEmpty) {
    void vscode.window.showWarningMessage('DocForge: select some text to transform.');
    return;
  }

  const selectionRange = editor.selection;
  const original = editor.document.getText(selectionRange);
  const format = formatForLanguage(editor.document.languageId);

  const generators = await deps.buildGenerators();
  const trusted = vscode.workspace.isTrusted;
  const aiEnabled = trusted && vscode.workspace.getConfiguration('docforge').get('enableAi', true);
  const aiAvailable = aiEnabled && (await hasAvailableAi(generators));

  const transform = await pickTransform(format, aiAvailable);
  if (!transform) return;

  let context: TransformContext = {
    selection: original,
    format,
    languageId: editor.document.languageId
  };
  const withInput = await collectInput(transform, context);
  if (!withInput) return;
  context = withInput;

  // Regenerate loops here; accept and reject both leave.
  for (;;) {
    const result = await runWithProgress(transform, generators, context, aiEnabled, deps);
    if (!result) return;

    const choice = await reviewChange(original, result.text, transform.label, result.producedBy);
    if (choice === 'reject') return;
    if (choice === 'regenerate') continue;

    // Re-check the range: the user may have edited while the dialog was open.
    const stillThere = editor.document.getText(selectionRange) === original;
    if (!stillThere) {
      void vscode.window.showWarningMessage(
        'DocForge: the selected text changed while the preview was open, so nothing was replaced.'
      );
      return;
    }

    const applied = await editor.edit((edit) => edit.replace(selectionRange, result.text));
    if (applied) {
      void vscode.window.setStatusBarMessage(`DocForge: ${transform.label} applied`, 3000);
      for (const warning of result.warnings) void vscode.window.showWarningMessage(warning);
    }
    return;
  }
}

async function hasAvailableAi(generators: Generator[]): Promise<boolean> {
  for (const generator of generators) {
    if (generator.id === 'template') continue;
    const capability = await generator.capability().catch(() => undefined);
    if (capability?.available) return true;
  }
  return false;
}

async function runWithProgress(
  transform: Transform,
  generators: Generator[],
  context: TransformContext,
  aiEnabled: boolean,
  deps: EditingDeps
): Promise<EditResult | undefined> {
  const title = transform.label;
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `DocForge: ${title}…`,
        cancellable: true
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => controller.abort());
        try {
          const result = await runTransform({
            transform,
            context,
            generators,
            allowNetwork: aiEnabled,
            signal: controller.signal
          });
          deps.log(`${title}: ${result.producedBy}`);
          return result;
        } finally {
          sub.dispose();
        }
      }
    );
  } catch (err) {
    if (err instanceof DocForgeError && err.code === 'cancelled') return undefined;
    reportEditFailure(err, deps);
    return undefined;
  }
}

function reportEditFailure(err: unknown, deps: EditingDeps): void {
  const described = describeFailure(err, []);
  deps.log(`FAILED: ${described.message}`);
  void vscode.window
    .showErrorMessage(
      `${described.message} ${described.dataPreserved}`,
      'Show Logs'
    )
    .then((choice) => {
      if (choice === 'Show Logs') deps.showLogs();
    });
}

/** DocForge: Regenerate Section - pick a heading and rewrite just that section. */
export async function regenerateSectionFlow(deps: EditingDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('DocForge: open a document first.');
    return;
  }

  const source = editor.document.getText();
  const format = formatForLanguage(editor.document.languageId);
  const outline = parseOutline(source, format);

  if (outline.flat.length === 0) {
    void vscode.window.showWarningMessage(
      'DocForge: no headings found, so there is no section to regenerate.'
    );
    return;
  }

  const section = await pickSection(outline, editor);
  if (!section) return;

  const instruction = await vscode.window.showInputBox({
    title: `Regenerate "${section.title}"`,
    prompt: 'Optional instruction (leave blank to simply rewrite)',
    placeHolder: 'e.g. make it shorter, add an example'
  });
  if (instruction === undefined) return;

  const generators = await deps.buildGenerators();
  const aiEnabled =
    vscode.workspace.isTrusted &&
    vscode.workspace.getConfiguration('docforge').get('enableAi', true);

  for (;;) {
    let result;
    try {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `DocForge: regenerating "${section.title}"…`,
          cancellable: true
        },
        async (_progress, token) => {
          const controller = new AbortController();
          const sub = token.onCancellationRequested(() => controller.abort());
          try {
            return await regenerateSection({
              source,
              section,
              format,
              ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
              generators,
              allowNetwork: aiEnabled,
              signal: controller.signal
            });
          } finally {
            sub.dispose();
          }
        }
      );
    } catch (err) {
      if (err instanceof DocForgeError && err.code === 'cancelled') return;
      reportEditFailure(err, deps);
      return;
    }

    const choice = await reviewChange(
      result.originalBody,
      result.newBody,
      `Regenerate "${section.title}"`,
      result.producedBy
    );
    if (choice === 'reject') return;
    if (choice === 'regenerate') continue;

    if (editor.document.getText() !== source) {
      void vscode.window.showWarningMessage(
        'DocForge: the document changed while the preview was open, so nothing was replaced.'
      );
      return;
    }

    // Replace only the section's range, not the whole document, so the editor
    // records a tight undo step and unrelated text is provably untouched.
    const range = new vscode.Range(
      editor.document.positionAt(section.bodyStart),
      editor.document.positionAt(section.end)
    );
    const applied = await editor.edit((edit) => edit.replace(range, `\n${result.newBody}\n\n`));
    if (applied) {
      void vscode.window.setStatusBarMessage(`DocForge: "${section.title}" regenerated`, 3000);
      for (const warning of result.warnings) void vscode.window.showWarningMessage(warning);
    }
    return;
  }
}

/** Offer the outline, pre-selecting whichever section holds the cursor. */
async function pickSection(
  outline: ReturnType<typeof parseOutline>,
  editor: vscode.TextEditor
): Promise<Section | undefined> {
  const cursor = editor.document.offsetAt(editor.selection.active);
  const current = sectionAt(outline, cursor);

  const items = outline.flat.map((section) => ({
    label: `${'  '.repeat(Math.max(0, section.level - 1))}${section.title || '(untitled)'}`,
    description: section.path.join(' > '),
    ...(section.slug === current?.slug ? { detail: '$(arrow-right) cursor is here' } : {}),
    slug: section.slug
  }));

  // Put the cursor's section first so the common case is one keypress.
  if (current) {
    const index = items.findIndex((i) => i.slug === current.slug);
    if (index > 0) items.unshift(...items.splice(index, 1));
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Which section should DocForge regenerate?',
    matchOnDescription: true
  });
  return pick ? findBySlug(outline, pick.slug) : undefined;
}
