import { DEFAULT_DOCUMENT_CSS, escapeHtml } from '@dfg/render';

export function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export interface WebviewInput {
  title: string;
  /** Sanitized HTML fragment. */
  bodyHtml: string;
  provenance: string;
  format: 'md' | 'html';
  nonce: string;
  /** `webview.cspSource` from VS Code. */
  cspSource: string;
}

const CHROME_CSS = `
.df-toolbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; gap: .5rem; align-items: center;
  padding: .5rem .75rem;
  background: var(--vscode-editorWidget-background, #1e1e1e);
  border-bottom: 1px solid var(--vscode-editorWidget-border, #333);
  font-family: var(--vscode-font-family, sans-serif);
}
.df-toolbar button {
  font: inherit; cursor: pointer;
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #0e639c);
  border: none; border-radius: 4px; padding: .35rem .8rem;
}
.df-toolbar button.secondary {
  color: var(--vscode-button-secondaryForeground, #fff);
  background: var(--vscode-button-secondaryBackground, #3a3d41);
}
.df-toolbar .df-prov {
  margin-left: auto; opacity: .8; font-size: .85em;
  color: var(--vscode-descriptionForeground, #999);
}
`;

/** Build a strict-CSP webview page around a sanitized document fragment. */
export function renderWebviewHtml(input: WebviewInput): string {
  const csp = [
    "default-src 'none'",
    `img-src ${input.cspSource} https: data:`,
    `style-src 'nonce-${input.nonce}'`,
    `script-src 'nonce-${input.nonce}'`
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style nonce="${input.nonce}">${DEFAULT_DOCUMENT_CSS}${CHROME_CSS}</style>
</head>
<body>
<div class="df-toolbar" role="toolbar" aria-label="DocForge actions">
  <button id="df-insert" type="button">Insert into editor</button>
  <button id="df-save" type="button" class="secondary">Save as…</button>
  <button id="df-regen" type="button" class="secondary">Regenerate</button>
  <span class="df-prov">${escapeHtml(input.provenance)}</span>
</div>
<main class="docforge-doc" aria-label="Document preview">
${input.bodyHtml}
</main>
<script nonce="${input.nonce}">
  const vscode = acquireVsCodeApi();
  const send = (type) => vscode.postMessage({ type });
  document.getElementById('df-insert').addEventListener('click', () => send('insert'));
  document.getElementById('df-save').addEventListener('click', () => send('save'));
  document.getElementById('df-regen').addEventListener('click', () => send('regenerate'));
</script>
</body>
</html>
`;
}
