# Security Policy

## Supported versions

DocForge is pre-1.0. Security fixes target the latest `main` and the most recent
released version.

## Reporting a vulnerability

Please **do not** open a public issue for security reports. Instead, use GitHub's
private vulnerability reporting on this repository
(https://github.com/aniketsoni1/docforge/security/advisories/new), or email the
maintainer listed on the GitHub profile `aniketsoni1`.

We aim to acknowledge reports within a few days.

## Security model

- **Local-first.** The CLI and the template generator work fully offline.
- **AI/network is opt-in and disclosed.** No network calls happen without an
  explicit key or an editor-provided model, and Workspace Trust is respected.
- **All model output is untrusted.** Generated HTML is sanitized against an
  allowlist (scripts, inline handlers, and unsafe URLs are stripped) before it is
  written or shown, and every webview uses a strict Content-Security-Policy.
- **Secrets** are stored in VS Code SecretStorage (extension) or read from
  environment variables (CLI); they are never written to settings or logs.
