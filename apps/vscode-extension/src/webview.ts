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
  /** One-line usage summary (tokens, cost, duration). Optional. */
  summary?: string;
  /** Why an earlier generator was passed over, if any. Optional. */
  fallbackNote?: string;
}

const CHROME_CSS = `
.df-toolbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; gap: .5rem; align-items: center; flex-wrap: wrap;
  padding: .5rem .75rem;
  background: var(--vscode-editorWidget-background, #1e1e1e);
  border-bottom: 1px solid var(--vscode-editorWidget-border, #333);
  font-family: var(--vscode-font-family, sans-serif);
}
.df-toolbar button {
  font: inherit; cursor: pointer;
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #0e639c);
  border: 1px solid transparent; border-radius: 4px; padding: .35rem .8rem;
}
.df-toolbar button.secondary {
  color: var(--vscode-button-secondaryForeground, #fff);
  background: var(--vscode-button-secondaryBackground, #3a3d41);
}
.df-toolbar button:focus-visible {
  outline: 2px solid var(--vscode-focusBorder, #0078d4);
  outline-offset: 2px;
}
.df-toolbar button[disabled] { opacity: .5; cursor: not-allowed; }
.df-toolbar button[hidden] { display: none; }
.df-meta {
  margin-left: auto; display: flex; flex-direction: column; align-items: flex-end;
  font-size: .85em; color: var(--vscode-descriptionForeground, #999);
}
.df-status {
  padding: .4rem .75rem;
  font-family: var(--vscode-font-family, sans-serif);
  font-size: .85em;
  color: var(--vscode-descriptionForeground, #999);
  background: var(--vscode-editorWidget-background, #1e1e1e);
  border-bottom: 1px solid var(--vscode-editorWidget-border, #333);
}
.df-status[hidden] { display: none; }
.df-note { color: var(--vscode-editorWarning-foreground, #cca700); }
body.df-busy .docforge-doc { opacity: .6; }
/* A streaming draft is rendered as pre-formatted text, never as HTML: it has
   not been sanitized yet, so it must not be able to become live markup. */
.df-draft {
  display: none;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 1.5rem 1.25rem;
  font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
  font-size: .9em;
  color: var(--vscode-descriptionForeground, #999);
  border-left: 3px solid var(--vscode-focusBorder, #0078d4);
}
body.df-streaming .df-draft { display: block; }
body.df-streaming .docforge-doc { display: none; }
`;

/** Build a strict-CSP webview page around a sanitized document fragment. */
export function renderWebviewHtml(input: WebviewInput): string {
  const csp = [
    "default-src 'none'",
    `img-src ${input.cspSource} https: data:`,
    `style-src 'nonce-${input.nonce}'`,
    `script-src 'nonce-${input.nonce}'`
  ].join('; ');

  const fallbackNote = input.fallbackNote
    ? `<div class="df-note">${escapeHtml(input.fallbackNote)}</div>`
    : '';
  const summary = input.summary ? `<div class="df-summary">${escapeHtml(input.summary)}</div>` : '';

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
  <button id="df-copy" type="button" class="secondary">Copy</button>
  <button id="df-regen" type="button" class="secondary">Regenerate</button>
  <button id="df-cancel" type="button" class="secondary" hidden>Cancel</button>
  <div class="df-meta">
    <div>${escapeHtml(input.provenance)}</div>
    ${summary}
    ${fallbackNote}
  </div>
</div>
<div class="df-status" id="df-status" role="status" aria-live="polite" hidden></div>
<pre class="df-draft" id="df-draft" aria-label="Streaming draft"></pre>
<main class="docforge-doc" aria-label="Document preview">
${input.bodyHtml}
</main>
<script nonce="${input.nonce}">
  const vscode = acquireVsCodeApi();
  const actionIds = ['df-insert', 'df-save', 'df-copy', 'df-regen'];
  const cancelBtn = document.getElementById('df-cancel');
  const status = document.getElementById('df-status');
  const draft = document.getElementById('df-draft');
  let requestId = 0;

  const send = (type) => vscode.postMessage({ type: type, requestId: ++requestId });

  // Disable the actions while a generation is in flight, so a second click
  // cannot start a competing request whose result would race the first.
  const setBusy = (busy) => {
    document.body.classList.toggle('df-busy', busy);
    for (const id of actionIds) document.getElementById(id).disabled = busy;
    cancelBtn.hidden = !busy;
    status.hidden = !busy;
    status.textContent = busy ? 'Generating…' : '';
    if (!busy) {
      document.body.classList.remove('df-streaming');
      draft.textContent = '';
    }
  };

  document.getElementById('df-insert').addEventListener('click', () => send('insert'));
  document.getElementById('df-save').addEventListener('click', () => send('save'));
  document.getElementById('df-copy').addEventListener('click', () => send('copy'));
  document.getElementById('df-regen').addEventListener('click', () => {
    setBusy(true);
    send('regenerate');
  });
  cancelBtn.addEventListener('click', () => send('cancel'));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'state') {
      setBusy(Boolean(message.busy));
    } else if (message.type === 'draft') {
      // textContent, never innerHTML: this text has not been sanitized yet.
      document.body.classList.add('df-streaming');
      draft.textContent = String(message.text || '');
      status.hidden = false;
      status.textContent = 'Streaming draft…';
      draft.scrollTop = draft.scrollHeight;
    } else if (message.type === 'error') {
      setBusy(false);
      status.hidden = false;
      status.textContent = String(message.message || 'Generation failed.');
    }
  });
</script>
</body>
</html>
`;
}
