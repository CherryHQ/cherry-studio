import * as z from 'zod'

/**
 * Blocks of an Agent System Prompt that an Agent may replace with its own text. Identity is not one:
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
  'workspace_system',
  'language'
] as const
export type EditablePromptSection = (typeof EDITABLE_PROMPT_SECTIONS)[number]

/** Existing Agents may still carry overrides for server or runtime-owned context. They are ignored during prompt assembly. */
export const AgentPromptOverridesSchema = z.partialRecord(
  z.enum([...EDITABLE_PROMPT_SECTIONS, 'mcp_instructions', 'custom_base_context']),
  z.string()
)
export type AgentPromptOverrides = z.infer<typeof AgentPromptOverridesSchema>
/** An update to some blocks only: text replaces a block, `null` restores it, a missing key leaves it alone. */
export const AgentPromptOverridesPatchSchema = z.partialRecord(z.enum(EDITABLE_PROMPT_SECTIONS), z.string().nullable())
export type AgentPromptOverridesPatch = z.infer<typeof AgentPromptOverridesPatchSchema>

export function isEditablePromptSection(key: string): key is EditablePromptSection {
  return (EDITABLE_PROMPT_SECTIONS as readonly string[]).includes(key)
}

/** Marks where the Agent's own instructions go inside the previewed instructions block. */
export const AGENT_INSTRUCTIONS_SLOT = '\u0000agent-instructions\u0000'
