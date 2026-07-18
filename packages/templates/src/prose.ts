import type { DocLength, DocTone } from '@dfg/core';

/** Deterministic prose helpers. No randomness: same input → same output. */

const TONE_LEAD: Record<DocTone, string> = {
  neutral: 'This document covers',
  formal: 'This document provides a structured overview of',
  friendly: "Here's a friendly walkthrough of",
  technical: 'This document specifies the technical details of',
  marketing: 'Discover everything you need to know about'
};

const TONE_CONNECTOR: Record<DocTone, string> = {
  neutral: 'It describes',
  formal: 'The following sections detail',
  friendly: "We'll walk through",
  technical: 'The sections below define',
  marketing: 'Below, you will see how'
};

/** Rough paragraph budget per section, scaled by requested length. */
export function paragraphsFor(length: DocLength): number {
  switch (length) {
    case 'short':
      return 1;
    case 'long':
      return 3;
    case 'medium':
    default:
      return 2;
  }
}

/** How many extra generic sections a template should add for the requested length. */
export function extraSectionsFor(length: DocLength): number {
  switch (length) {
    case 'short':
      return 0;
    case 'long':
      return 3;
    case 'medium':
    default:
      return 1;
  }
}

function ensureSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Opening sentence for a document about `topic`. */
export function lead(topic: string, tone: DocTone): string {
  return ensureSentence(`${TONE_LEAD[tone]} ${topic}`);
}

/** A body paragraph for a section heading, referencing the overall topic. */
export function sectionParagraph(heading: string, topic: string, tone: DocTone): string {
  const h = heading.toLowerCase();
  return ensureSentence(
    `${TONE_CONNECTOR[tone]} the ${h} of ${topic}, so readers can act on it with confidence`
  );
}

/** Build N body paragraphs for a section, deterministically. */
export function sectionBody(
  heading: string,
  topic: string,
  tone: DocTone,
  length: DocLength
): string {
  const count = paragraphsFor(length);
  const paras: string[] = [sectionParagraph(heading, topic, tone)];
  if (count >= 2) {
    paras.push(
      ensureSentence(
        `Replace this placeholder with the specifics of ${topic}; DocForge produced the structure so you can focus on the content`
      )
    );
  }
  if (count >= 3) {
    paras.push(
      ensureSentence(
        `For a richer draft, run this prompt with an AI generator available; the deterministic template path always yields this reliable baseline`
      )
    );
  }
  return paras.join('\n\n');
}
