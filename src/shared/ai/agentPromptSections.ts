import * as z from 'zod'

/**
 * Blocks of a Pi Durable System Prompt that an Agent may replace with its own text. Identity is not one:
 * it is edited through SOUL.md, USER.md and FACT.md instead.
 */
export const EDITABLE_PROMPT_SECTIONS = [
  'instruction_precedence',
  'report_artifacts',
  'config_tools',
  'bootstrap',
  'memories',
  'citations',
  'project_context',
  'skills',
  'mcp_instructions',
  'workspace_system',
  'custom_base_context',
  'language'
] as const
export type EditablePromptSection = (typeof EDITABLE_PROMPT_SECTIONS)[number]

/** Per-Agent replacement text, keyed by block; a missing key keeps the generated text. */
export const AgentPromptOverridesSchema = z.partialRecord(z.enum(EDITABLE_PROMPT_SECTIONS), z.string())
export type AgentPromptOverrides = z.infer<typeof AgentPromptOverridesSchema>

export function isEditablePromptSection(key: string): key is EditablePromptSection {
  return (EDITABLE_PROMPT_SECTIONS as readonly string[]).includes(key)
}

/** Marks where the Agent's own instructions go inside the previewed instructions block. */
export const AGENT_INSTRUCTIONS_SLOT = '\u0000agent-instructions\u0000'
