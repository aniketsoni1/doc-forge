/**
 * Minimal permission model. DocForge is deterministic and local-first: any action
 * that writes files or touches the network is described up-front and gated on
 * explicit approval by the host (CLI prompt / editor confirmation).
 */

export type ToolAction = 'read' | 'write' | 'network';

export interface ToolDescriptor {
  name: string;
  action: ToolAction;
  description: string;
  /** Host must obtain explicit user approval before performing this. */
  requiresApproval: boolean;
  /** True if performing this action sends data over the network. */
  network: boolean;
}

export const WRITE_FILE_TOOL: ToolDescriptor = {
  name: 'write-file',
  action: 'write',
  description: 'Write a generated document to disk.',
  requiresApproval: true,
  network: false
};

export const OVERWRITE_FILE_TOOL: ToolDescriptor = {
  name: 'overwrite-file',
  action: 'write',
  description: 'Overwrite an existing file after showing a diff.',
  requiresApproval: true,
  network: false
};

export const AI_GENERATE_TOOL: ToolDescriptor = {
  name: 'ai-generate',
  action: 'network',
  description: 'Send the prompt to a remote AI model to generate the document.',
  requiresApproval: true,
  network: true
};

export const BUILTIN_TOOLS: readonly ToolDescriptor[] = [
  WRITE_FILE_TOOL,
  OVERWRITE_FILE_TOOL,
  AI_GENERATE_TOOL
];
