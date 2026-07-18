import type { Template, TemplateContext } from './types';
import { extraSectionsFor, lead, sectionBody } from './prose';

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

function bulletList(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

function renderSections(
  headings: string[],
  ctx: TemplateContext
): string {
  const { analysis, spec } = ctx;
  return headings
    .map((h) => `## ${h}\n\n${sectionBody(h, analysis.topic, spec.tone, spec.length)}`)
    .join('\n\n');
}

/** Pick section headings: caller-provided first, padded with defaults to a length-scaled count. */
function sectionsFor(defaults: string[], ctx: TemplateContext): string[] {
  const requested = ctx.analysis.requestedSections;
  const base = requested.length ? requested : defaults;
  const target = base.length + extraSectionsFor(ctx.spec.length) - (requested.length ? 1 : 0);
  const extras = ['Details', 'Examples', 'Notes', 'FAQ', 'Next Steps'];
  const out = [...base];
  for (const extra of extras) {
    if (out.length >= target) break;
    if (!out.includes(extra)) out.push(extra);
  }
  return out;
}

const readme: Template = {
  id: 'readme',
  title: 'README',
  description: 'Project README with install, usage, and contributing sections.',
  aliases: ['read-me', 'readme.md', 'project'],
  build(ctx) {
    const { analysis, spec } = ctx;
    const name = analysis.name ?? analysis.title;
    const pkg = slug(name);
    const features = analysis.bullets.length
      ? analysis.bullets
      : ['Fast and dependency-light', 'Works offline', 'Simple, documented API'];
    return [
      `# ${name}`,
      '',
      `> ${lead(analysis.topic, spec.tone)}`,
      '',
      '## Overview',
      '',
      sectionBody('overview', analysis.topic, spec.tone, spec.length),
      '',
      '## Features',
      '',
      bulletList(features),
      '',
      '## Installation',
      '',
      '```bash',
      `npm install ${pkg}`,
      '```',
      '',
      '## Usage',
      '',
      '```bash',
      `${pkg} --help`,
      '```',
      '',
      '## Contributing',
      '',
      'Contributions are welcome. Please open an issue to discuss substantial changes before submitting a pull request.',
      '',
      '## License',
      '',
      'Apache-2.0'
    ].join('\n');
  }
};

const blog: Template = {
  id: 'blog',
  title: 'Blog post',
  description: 'Article with introduction, body sections, and a conclusion.',
  aliases: ['post', 'article'],
  build(ctx) {
    const { analysis, spec } = ctx;
    const headings = sectionsFor(['Background', 'Key Ideas', 'Takeaways'], ctx);
    return [
      `# ${analysis.title}`,
      '',
      lead(analysis.topic, spec.tone),
      '',
      '## Introduction',
      '',
      sectionBody('introduction', analysis.topic, spec.tone, spec.length),
      '',
      renderSections(headings, ctx),
      '',
      '## Conclusion',
      '',
      sectionBody('conclusion', analysis.topic, spec.tone, spec.length)
    ].join('\n');
  }
};

const report: Template = {
  id: 'report',
  title: 'Report',
  description: 'Structured report with summary, findings, and recommendations.',
  aliases: ['analysis', 'memo', 'whitepaper'],
  build(ctx) {
    const { analysis, spec } = ctx;
    const findings = analysis.bullets.length
      ? analysis.bullets
      : ['Finding one', 'Finding two', 'Finding three'];
    const headings = sectionsFor(['Background', 'Analysis', 'Recommendations'], ctx);
    return [
      `# ${analysis.title}`,
      '',
      '## Executive Summary',
      '',
      lead(analysis.topic, spec.tone),
      '',
      sectionBody('summary', analysis.topic, spec.tone, spec.length),
      '',
      '## Findings',
      '',
      bulletList(findings),
      '',
      renderSections(headings, ctx),
      '',
      '## Conclusion',
      '',
      sectionBody('conclusion', analysis.topic, spec.tone, spec.length)
    ].join('\n');
  }
};

const landing: Template = {
  id: 'landing',
  title: 'Landing page',
  description: 'Marketing landing page with hero, benefits, and a call to action.',
  aliases: ['landing-page', 'marketing', 'product', 'homepage'],
  build(ctx) {
    const { analysis, spec } = ctx;
    const name = analysis.name ?? analysis.title;
    const benefits = analysis.bullets.length
      ? analysis.bullets
      : ['Save time', 'Reduce cost', 'Delight your users'];
    return [
      `# ${name}`,
      '',
      `**${lead(analysis.topic, 'marketing')}**`,
      '',
      '## Why ' + name,
      '',
      bulletList(benefits),
      '',
      '## Features',
      '',
      sectionBody('features', analysis.topic, spec.tone, spec.length),
      '',
      '## How it works',
      '',
      sectionBody('workflow', analysis.topic, spec.tone, spec.length),
      '',
      '## Get started',
      '',
      `Ready to try ${name}? Get started today.`
    ].join('\n');
  }
};

const changelog: Template = {
  id: 'changelog',
  title: 'Changelog',
  description: 'Keep a Changelog / SemVer formatted release notes.',
  aliases: ['change-log', 'release-notes', 'releases'],
  build(ctx) {
    const { analysis } = ctx;
    const subject = analysis.name ?? analysis.topic;
    const added = analysis.bullets.length ? analysis.bullets : ['Initial feature set'];
    return [
      '# Changelog',
      '',
      `All notable changes to ${subject} are documented in this file.`,
      '',
      'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      bulletList(added),
      '',
      '### Changed',
      '',
      '- _Nothing yet._',
      '',
      '### Fixed',
      '',
      '- _Nothing yet._'
    ].join('\n');
  }
};

const letter: Template = {
  id: 'letter',
  title: 'Letter',
  description: 'Formal letter or cover letter with greeting and sign-off.',
  aliases: ['cover-letter', 'email', 'correspondence'],
  build(ctx) {
    const { analysis, spec } = ctx;
    const recipient = spec.variables.recipient ?? 'Hiring Manager';
    const sender = spec.variables.sender ?? '[Your Name]';
    const subject = analysis.title;
    return [
      `# ${subject}`,
      '',
      '[Date]',
      '',
      `Dear ${recipient},`,
      '',
      sectionBody('opening', analysis.topic, spec.tone, spec.length),
      '',
      sectionBody('body', analysis.topic, spec.tone, spec.length),
      '',
      'Thank you for your time and consideration.',
      '',
      'Sincerely,',
      '',
      sender
    ].join('\n');
  }
};

export const PRESETS: readonly Template[] = [readme, blog, report, landing, changelog, letter];
