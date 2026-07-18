import { z } from 'zod';
import type { DocSpec } from './types';

export const docFormatSchema = z.enum(['md', 'html']);
export const docToneSchema = z.enum(['neutral', 'formal', 'friendly', 'technical', 'marketing']);
export const docLengthSchema = z.enum(['short', 'medium', 'long']);

/**
 * Input schema for a generation request. Applies defaults so downstream code
 * always receives a fully-populated {@link DocSpec}.
 */
export const docSpecInputSchema = z
  .object({
    prompt: z.string().trim().min(1, 'prompt must not be empty'),
    format: docFormatSchema.default('md'),
    tone: docToneSchema.default('neutral'),
    length: docLengthSchema.default('medium'),
    template: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    variables: z.record(z.string(), z.string()).default({})
  })
  .strict();

export type DocSpecInput = z.input<typeof docSpecInputSchema>;

/** Parse and normalize arbitrary input into a validated {@link DocSpec}. Throws ZodError on failure. */
export function parseDocSpec(input: unknown): DocSpec {
  return docSpecInputSchema.parse(input);
}

/** Non-throwing variant. */
export function safeParseDocSpec(input: unknown): z.SafeParseReturnType<unknown, DocSpec> {
  return docSpecInputSchema.safeParse(input);
}

export const docResultSchema = z.object({
  content: z.string(),
  format: docFormatSchema,
  generatorUsed: z.string().min(1),
  warnings: z.array(z.string()),
  meta: z.object({
    sections: z.array(z.string()).optional(),
    tokens: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    cached: z.boolean().optional(),
    repaired: z.boolean().optional(),
    fellBackFrom: z.array(z.string()).optional()
  })
});
