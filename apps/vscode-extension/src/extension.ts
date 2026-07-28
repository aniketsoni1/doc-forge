import * as vscode from 'vscode';
import {
  DocForgeError,
  parseDocSpec,
  type DocFormat,
  type DocSpec,
  type Generator
} from '@dfg/core';
import {
  formatAttemptTrail,
  probeCapabilities,
  resolveAndGenerate,
  type GenerationAttempt,
  type GenerationOutcome
} from '@dfg/agent';
import { createTemplateGenerator } from '@dfg/generator-template';
import { ByokGenerator } from '@dfg/generator-byok';
import { setPricingOverrides, summarizeResult, type CostModel } from '@dfg/reporting';
import { LmApiGenerator } from './generators/lmApi';
import { ExtensionGenerator } from './generators/extensionApi';
import { createNonce, renderWebviewHtml } from './webview';
import { parseInboundMessage, RequestTracker, type OutboundMessage } from './protocol';
import { describeFailure, describeFallback, formatDiagnostics } from './errors';
import { defaultFileName, filtersFor, languageFor } from './naming';

const SECRET_KEY = 'docforge.apiKey';

interface FlowOptions {
  forceTemplate: boolean;
  preferredId: string | undefined;
}

let output: vscode.OutputChannel | undefined;
/** The most recent attempt trail, for `DocForge: Run Diagnostics`. */
let lastAttempts: GenerationAttempt[] = [];

function log(line: string): void {
  output?.appendLine(`[${new Date().toISOString()}] ${line}`);
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('DocForge');
  context.subscriptions.push(output);

  applyPricingOverrides();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('docforge.pricing')) applyPricingOverrides();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('docforge.newDocument', () => newDocumentFlow(context)),
    vscode.commands.registerCommand('docforge.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('docforge.clearApiKey', async () => {
      await context.secrets.delete(SECRET_KEY);
      void vscode.window.showInformationMessage('DocForge API key cleared.');
    }),
    vscode.commands.registerCommand('docforge.runDiagnostics', () => runDiagnostics(context))
  );
}

export function deactivate(): void {
  output = undefined;
}

/** Let users correct stale built-in pricing without waiting for a release. */
function applyPricingOverrides(): void {
  const configured = vscode.workspace
    .getConfiguration('docforge')
    .get<Record<string, CostModel>>('pricing', {});
  setPricingOverrides(configured ?? {});
}

async function buildGenerators(context: vscode.ExtensionContext): Promise<Generator[]> {
  const config = vscode.workspace.getConfiguration('docforge');
  const generators: Generator[] = [new LmApiGenerator(), new ExtensionGenerator()];
  const key = await context.secrets.get(SECRET_KEY);
  if (key) {
    generators.push(
      new ByokGenerator({
        provider: config.get<'anthropic' | 'openai'>('provider', 'anthropic'),
        apiKey: key,
        model: config.get<string>('model', 'claude-3-5-sonnet-latest'),
        timeoutMs: config.get<number>('requestTimeoutMs', 60_000)
      })
    );
  }
  generators.push(createTemplateGenerator());
  return generators;
}

async function pickFormat(defaultFormat: DocFormat): Promise<DocFormat | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Markdown', description: '.md', value: 'md' as DocFormat },
      { label: 'HTML', description: '.html (sanitized, themed)', value: 'html' as DocFormat }
    ],
    { placeHolder: `Output format (default: ${defaultFormat})` }
  );
  return pick?.value;
}

async function pickGenerator(generators: Generator[]): Promise<FlowOptions | undefined> {
  const caps = (await probeCapabilities(generators)).filter((c) => c.available);
  const items: Array<vscode.QuickPickItem & { value: string }> = [
    { label: 'Auto', description: 'Use the best available generator', value: 'auto' },
    ...caps.map((c) => ({ label: c.label, description: c.detail, value: c.id }))
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Generate with…' });
  if (!pick) return undefined;
  return {
    forceTemplate: pick.value === 'template',
    preferredId: pick.value === 'auto' || pick.value === 'template' ? undefined : pick.value
  };
}

async function newDocumentFlow(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('docforge');
  const trusted = vscode.workspace.isTrusted;

  const prompt = await vscode.window.showInputBox({
    title: 'DocForge - New Document from Prompt',
    prompt: 'Describe the document you want to generate',
    placeHolder: 'e.g. README for a CLI tool called Acme with features: fast, tiny, typed'
  });
  if (!prompt) return;

  const defaultFormat = config.get<DocFormat>('defaultFormat', 'md');
  const format = (await pickFormat(defaultFormat)) ?? defaultFormat;

  const generators = await buildGenerators(context);
  const flow = trusted
    ? await pickGenerator(generators)
    : { forceTemplate: true, preferredId: undefined };
  if (!flow) return;

  if (!trusted) {
    void vscode.window.showWarningMessage(
      'Workspace is not trusted - DocForge used the offline template generator only.'
    );
  }

  const spec = parseDocSpec({
    prompt,
    format,
    tone: config.get<string>('tone', 'neutral'),
    length: config.get<string>('length', 'medium')
  });

  const aiEnabled = trusted && config.get<boolean>('enableAi', true);
  const outcome = await generateWithProgress(spec, generators, {
    forceTemplate: flow.forceTemplate || !aiEnabled,
    preferredId: flow.preferredId,
    allowNetwork: aiEnabled
  });
  if (!outcome) return;

  showPreview(context, spec, generators, outcome, {
    forceTemplate: flow.forceTemplate,
    preferredId: flow.preferredId
  });
}

interface GenerateFlags {
  forceTemplate: boolean;
  preferredId: string | undefined;
  allowNetwork: boolean;
}

/**
 * Run a generation behind a cancellable progress notification. Failures are
 * reported with what failed, why, and what to do next - never a bare message.
 */
async function generateWithProgress(
  spec: DocSpec,
  generators: Generator[],
  options: GenerateFlags
): Promise<GenerationOutcome | undefined> {
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'DocForge: generating…',
        cancellable: true
      },
      async (_progress, token) => {
        // Bridge the editor's cancellation token onto the AbortSignal the core
        // pipeline understands, so Cancel actually aborts the provider request.
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => controller.abort());
        try {
          const outcome = await resolveAndGenerate(spec, {
            generators,
            ...options,
            signal: controller.signal
          });
          lastAttempts = outcome.attempts;
          log(`Generated with ${outcome.capability.label}`);
          log(formatAttemptTrail(outcome.attempts));
          return outcome;
        } finally {
          sub.dispose();
        }
      }
    );
  } catch (err) {
    if (err instanceof DocForgeError && err.code === 'cancelled') {
      log('Generation cancelled by the user.');
      return undefined;
    }
    const described = describeFailure(err, lastAttempts);
    log(`FAILED: ${described.message}`);
    void vscode.window
      .showErrorMessage(
        `${described.message} ${described.recovery} ${described.dataPreserved}`,
        'Show Logs'
      )
      .then((choice) => {
        if (choice === 'Show Logs') output?.show(true);
      });
    return undefined;
  }
}

function showPreview(
  context: vscode.ExtensionContext,
  spec: DocSpec,
  generators: Generator[],
  initial: GenerationOutcome,
  flow: FlowOptions
): void {
  const panel = vscode.window.createWebviewPanel(
    'docforge.preview',
    `DocForge - ${initial.document.title}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  let current = initial;
  const tracker = new RequestTracker();
  let inFlight: AbortController | undefined;

  const post = (message: OutboundMessage): void => {
    void panel.webview.postMessage(message);
  };

  const render = (): void => {
    const fallbackNote = describeFallback(current.attempts);
    panel.webview.html = renderWebviewHtml({
      title: current.document.title,
      bodyHtml: current.document.preview.bodyHtml,
      provenance: current.provenance,
      format: spec.format,
      nonce: createNonce(),
      cspSource: panel.webview.cspSource,
      summary: summarizeResult(current.result),
      ...(fallbackNote ? { fallbackNote } : {})
    });
  };
  render();
  void vscode.window.setStatusBarMessage(current.provenance, 5000);

  panel.onDidDispose(() => inFlight?.abort(), undefined, context.subscriptions);

  panel.webview.onDidReceiveMessage(
    async (raw: unknown) => {
      // Everything from the webview is untrusted input: validate before acting.
      const message = parseInboundMessage(raw);
      if (!message) {
        log('Ignored a malformed webview message.');
        return;
      }

      switch (message.type) {
        case 'insert':
          await insertIntoEditor(current, spec.format);
          return;
        case 'save':
          await saveToFile(current, spec.format);
          return;
        case 'copy':
          await vscode.env.clipboard.writeText(current.document.deliverable);
          void vscode.window.setStatusBarMessage('DocForge: copied to clipboard', 3000);
          return;
        case 'cancel':
          inFlight?.abort();
          post({ type: 'state', busy: false });
          return;
        case 'regenerate': {
          const requestId = tracker.next();
          inFlight?.abort();
          const controller = new AbortController();
          inFlight = controller;
          post({ type: 'state', busy: true });

          const next = await generateWithProgress(spec, generators, {
            forceTemplate: flow.forceTemplate,
            preferredId: flow.preferredId,
            allowNetwork: vscode.workspace.isTrusted
          });

          // A newer regenerate superseded this one: drop the stale result rather
          // than letting it overwrite fresher output.
          if (!tracker.isCurrent(requestId)) {
            log(`Discarded stale generation #${requestId}.`);
            return;
          }
          inFlight = undefined;
          if (next) {
            current = next;
            render();
          } else {
            post({ type: 'state', busy: false });
          }
          return;
        }
      }
    },
    undefined,
    context.subscriptions
  );
}

async function insertIntoEditor(outcome: GenerationOutcome, format: DocFormat): Promise<void> {
  const deliverable = outcome.document.deliverable;
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    await editor.edit((edit) => edit.insert(editor.selection.active, deliverable));
    return;
  }
  const doc = await vscode.workspace.openTextDocument({
    content: deliverable,
    language: languageFor(format)
  });
  await vscode.window.showTextDocument(doc);
}

async function saveToFile(outcome: GenerationOutcome, format: DocFormat): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const name = defaultFileName(outcome.document.title, format);
  const defaultUri = folder ? vscode.Uri.joinPath(folder, name) : undefined;
  const target = await vscode.window.showSaveDialog({
    ...(defaultUri ? { defaultUri } : {}),
    filters: filtersFor(format)
  });
  if (!target) return;

  // The save dialog already confirms an overwrite, but when the file exists and
  // differs, a diff is far more useful than a yes/no prompt.
  const existing = await readIfExists(target);
  if (existing !== undefined && existing !== outcome.document.deliverable) {
    const choice = await vscode.window.showWarningMessage(
      `${target.fsPath} already exists and differs from the generated document.`,
      { modal: true },
      'Show Diff',
      'Overwrite'
    );
    if (choice === 'Show Diff') {
      await showDiff(target, outcome.document.deliverable, format);
      return;
    }
    if (choice !== 'Overwrite') return;
  }

  await vscode.workspace.fs.writeFile(target, Buffer.from(outcome.document.deliverable, 'utf8'));
  void vscode.window.showInformationMessage(`DocForge saved ${target.fsPath}`);
}

async function readIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return undefined;
  }
}

/** Open a side-by-side diff of the existing file against the generated document. */
async function showDiff(target: vscode.Uri, deliverable: string, format: DocFormat): Promise<void> {
  const generated = await vscode.workspace.openTextDocument({
    content: deliverable,
    language: languageFor(format)
  });
  await vscode.commands.executeCommand(
    'vscode.diff',
    target,
    generated.uri,
    'Existing ↔ DocForge output'
  );
}

async function runDiagnostics(context: vscode.ExtensionContext): Promise<void> {
  const generators = await buildGenerators(context);
  const caps = await probeCapabilities(generators);
  const config = vscode.workspace.getConfiguration('docforge');

  output?.clear();
  output?.appendLine('DocForge diagnostics');
  output?.appendLine(`Workspace trusted: ${vscode.workspace.isTrusted}`);
  output?.appendLine(`AI enabled: ${config.get('enableAi', true)}`);
  output?.appendLine(`Provider: ${config.get('provider', 'anthropic')}`);
  output?.appendLine(`Model: ${config.get('model', '')}`);
  output?.appendLine('');
  output?.appendLine('Generators:');
  for (const cap of caps) {
    output?.appendLine(
      `  ${cap.available ? '✓' : '·'} ${cap.label}${cap.detail ? ` - ${cap.detail}` : ''}`
    );
  }
  output?.appendLine('');
  output?.appendLine('Last generation:');
  output?.appendLine(formatDiagnostics(lastAttempts));
  output?.show(true);
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'DocForge - Set API Key',
    prompt: 'Stored securely in VS Code SecretStorage; never written to settings.',
    password: true
  });
  if (key) {
    await context.secrets.store(SECRET_KEY, key);
    void vscode.window.showInformationMessage('DocForge API key saved to SecretStorage.');
  }
}
