import type { Capability, DocResult, DocSpec, Generator } from '@dfg/core';
import { DocForgeError } from '@dfg/core';
import { formatProvenance } from '@dfg/reporting';
import { finalizeDocument, type FinalDocument } from './finalize';
import { repairResult, validateResult } from './validate';

export interface LadderOptions {
  /** Ordered generators, highest priority first. Assembled by the host. */
  generators: Generator[];
  /** Force the deterministic template generator (CLI `--no-ai`). */
  forceTemplate?: boolean;
  /** Move a specific generator id/family to the front (picker / `--model`). */
  preferredId?: string;
  /** When false, generators that require the network are skipped. Default true. */
  allowNetwork?: boolean;
}

export interface GenerationOutcome {
  /** The raw result from the chosen generator (post-repair if repaired). */
  result: DocResult;
  /** Capability of the chosen generator. */
  capability: Capability;
  /** Writable deliverable + preview. */
  document: FinalDocument;
  /** "Generating with: …" provenance line. */
  provenance: string;
}

const isTemplateFamily = (g: Generator): boolean => g.id === 'template';

function order(generators: Generator[], preferredId?: string): Generator[] {
  if (!preferredId) return generators;
  const preferred = generators.filter((g) => g.id === preferredId || g.id.startsWith(`${preferredId}:`));
  const rest = generators.filter((g) => !preferred.includes(g));
  return [...preferred, ...rest];
}

/** Probe every generator's capability (never throws). */
export async function probeCapabilities(generators: Generator[]): Promise<Capability[]> {
  return Promise.all(
    generators.map(async (g) => {
      try {
        return await g.capability();
      } catch {
        return { id: g.id, available: false, label: g.id, requiresNetwork: false };
      }
    })
  );
}

/**
 * Resolve the best available generator and produce a document. Every failure -
 * unavailable, offline, error, or invalid output that a single repair can't fix -
 * falls through to the next generator, always ending at the template fallback.
 */
export async function resolveAndGenerate(
  spec: DocSpec,
  options: LadderOptions
): Promise<GenerationOutcome> {
  const allowNetwork = options.allowNetwork ?? true;
  let candidates = options.forceTemplate
    ? options.generators.filter(isTemplateFamily)
    : options.generators;
  candidates = order(candidates, options.preferredId);

  const fellBackFrom: string[] = [];

  for (const generator of candidates) {
    const capability = await generator.capability().catch(() => undefined);
    if (!capability || !capability.available) continue;
    if (capability.requiresNetwork && !allowNetwork) {
      fellBackFrom.push(generator.id);
      continue;
    }

    try {
      let result = await generator.generate(spec);
      let issues = validateResult(result);

      if (issues.length > 0) {
        const repaired = repairResult(result);
        issues = validateResult(repaired);
        if (issues.length > 0) {
          fellBackFrom.push(generator.id);
          continue;
        }
        result = repaired;
      }

      const document = finalizeDocument(spec, result);
      const warnings = [...result.warnings, ...document.warnings];
      const finalResult: DocResult = {
        ...result,
        warnings,
        meta: {
          ...result.meta,
          ...(fellBackFrom.length ? { fellBackFrom: [...fellBackFrom] } : {})
        }
      };

      return {
        result: finalResult,
        capability,
        document,
        provenance: formatProvenance(capability)
      };
    } catch {
      fellBackFrom.push(generator.id);
      continue;
    }
  }

  throw new DocForgeError(
    'no_generator',
    'No generator could produce a document. Include the template generator in the ladder.'
  );
}
