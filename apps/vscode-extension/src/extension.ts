import * as vscode from 'vscode';
import { parseDocSpec, type DocFormat, type DocSpec, type Generator } from '@dfg/core';
import {
  probeCapabilities,
  resolveAndGenerate,
  type GenerationOutcome
} from '@dfg/agent';
import { createTemplateGenerator } from '@dfg/generator-template';
import { ByokGenerator } from '@dfg/generator-byok';
import { LmApiGenerator } from './generators/lmApi';
import { ExtensionGenerator } from './generators/extensionApi';
import { createNonce, renderWebviewHtml } from './webview';

const SECRET_KEY = 'docforge.apiKey';

interface FlowOptions {
  forceTemplate: boolean;
  preferredId: string | undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('docforge.newDocument', () => newDocumentFlow(context)),
    vscode.commands.registerCommand('docforge.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('docforge.clearApiKey', async () => {
      await context.secrets.delete(SECRET_KEY);
      void vscode.window.showInformationMessage('DocForge API key cleared.');
    })
  );
}

export function deactivate(): void {
  /* no-op */
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
        model: config.get<string>('model', 'claude-3-5-sonnet-latest')
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
    title: 'DocForge — New Document from Prompt',
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
      'Workspace is not trusted — DocForge used the offline template generator only.'
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

async function generateWithProgress(
  spec: DocSpec,
  generators: Generator[],
  options: { forceTemplate: boolean; preferredId: string | undefined; allowNetwork: boolean }
): Promise<GenerationOutcome | undefined> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DocForge: generating…' },
      () => resolveAndGenerate(spec, { generators, ...options })
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `DocForge failed: ${err instanceof Error ? err.message : String(err)}`
    );
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
    `DocForge — ${initial.document.title}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  let current = initial;
  const render = (): void => {
    panel.webview.html = renderWebviewHtml({
      title: current.document.title,
      bodyHtml: current.document.preview.bodyHtml,
      provenance: current.provenance,
      format: spec.format,
      nonce: createNonce(),
      cspSource: panel.webview.cspSource
    });
  };
  render();
  void vscode.window.setStatusBarMessage(current.provenance, 5000);

  panel.webview.onDidReceiveMessage(
    async (message: { type: string }) => {
      if (message.type === 'insert') {
        await insertIntoEditor(current, spec.format);
      } else if (message.type === 'save') {
        await saveToFile(current, spec.format);
      } else if (message.type === 'regenerate') {
        const next = await generateWithProgress(spec, generators, {
          forceTemplate: flow.forceTemplate,
          preferredId: flow.preferredId,
          allowNetwork: vscode.workspace.isTrusted
        });
        if (next) {
          current = next;
          render();
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
    language: format === 'html' ? 'html' : 'markdown'
  });
  await vscode.window.showTextDocument(doc);
}

async function saveToFile(outcome: GenerationOutcome, format: DocFormat): Promise<void> {
  const ext = format === 'html' ? 'html' : 'md';
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultName = `${outcome.document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'document'}.${ext}`;
  const defaultUri = folder ? vscode.Uri.joinPath(folder, defaultName) : undefined;
  const target = await vscode.window.showSaveDialog({
    ...(defaultUri ? { defaultUri } : {}),
    filters: format === 'html' ? { HTML: ['html'] } : { Markdown: ['md'] }
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(outcome.document.deliverable, 'utf8'));
  void vscode.window.showInformationMessage(`DocForge saved ${target.fsPath}`);
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'DocForge — Set API Key',
    prompt: 'Stored securely in VS Code SecretStorage; never written to settings.',
    password: true
  });
  if (key) {
    await context.secrets.store(SECRET_KEY, key);
    void vscode.window.showInformationMessage('DocForge API key saved to SecretStorage.');
  }
}
