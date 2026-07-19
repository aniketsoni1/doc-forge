# Capturing screenshots and the demo GIF

The branding assets (icon, hero, logo, architecture/workflow diagrams) are
generated reproducibly from editable SVG sources:

```bash
python3 -m pip install cairosvg
python3 - <<'PY'
import cairosvg
for src, out, w, h in [
    ("assets/icon.svg","apps/vscode-extension/media/icon.png",128,128),
    ("assets/logo.svg","assets/logo.png",720,180),
    ("assets/hero.svg","assets/hero.png",1280,640),
    ("assets/architecture.svg","assets/architecture.png",960,620),
    ("assets/workflow.svg","assets/workflow.png",960,470),
]:
    cairosvg.svg2png(url=src, write_to=out, output_width=w, output_height=h)
PY
```

Genuine document output (no VS Code required) is emitted to `samples/`:

```bash
npx tsx scripts/emit-samples.mjs
# open samples/preview-webview.html and samples/q3-report.html in a browser
```

## Real VS Code UI screenshots (manual, reproducible)

UI screenshots require a running VS Code with the extension installed - capture
them like this and save PNGs into `assets/screenshots/`:

1. `npm run build:ext && npm run package:vsix`
2. `code --install-extension artifacts/docforge-<version>.vsix --profile docforge-demo`
3. `code --profile docforge-demo samples/demo-workspace/docforge-demo.code-workspace`
4. Run **DocForge: New Document from Prompt** and capture, at 1280×800:
   - the prompt input and the generator picker
   - Markdown generation with the live preview
   - HTML generation with the themed preview
   - the provenance line and the Insert / Save actions
5. Record a short happy-path GIF (e.g. with an OS recorder or `asciinema`+`agg`
   for the CLI) and save it as `assets/demo.gif`.

Use consistent 1280×800 dimensions, include descriptive alt text in the README,
and verify readability in both light and dark themes. Do not commit placeholder
mockups - only real captures.
