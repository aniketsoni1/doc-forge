export type {
  DocFormat,
  DocTone,
  DocLength,
  DocSpec,
  DocMeta,
  DocResult,
  Capability,
  Generator
} from './types';

export type { ToolAction, ToolDescriptor } from './permissions';
export {
  WRITE_FILE_TOOL,
  OVERWRITE_FILE_TOOL,
  AI_GENERATE_TOOL,
  BUILTIN_TOOLS
} from './permissions';

export { DocForgeError, GeneratorUnavailableError, DocValidationError } from './errors';

export {
  docFormatSchema,
  docToneSchema,
  docLengthSchema,
  docSpecInputSchema,
  docResultSchema,
  parseDocSpec,
  safeParseDocSpec
} from './schema';
export type { DocSpecInput } from './schema';
