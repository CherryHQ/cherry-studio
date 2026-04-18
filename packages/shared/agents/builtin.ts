/**
 * Built-in agent IDs shared across main and renderer processes.
 *
 * Main process: use from '@main/services/agents/services/builtin/BuiltinAgentIds'
 * Renderer process: use from '@shared/agents/builtin'
 */

/** CherryClaw default agent ID */
export const CHERRY_CLAW_AGENT_ID = 'cherry-claw-default'

/** Cherry Assistant default agent ID */
export const CHERRY_ASSISTANT_AGENT_ID = 'cherry-assistant-default'

/** All builtin agent IDs as a readonly array */
export const BUILTIN_AGENT_IDS = [CHERRY_CLAW_AGENT_ID, CHERRY_ASSISTANT_AGENT_ID] as const

/** Check if an agent ID belongs to a builtin agent */
export function isBuiltinAgentId(id: string): boolean {
  return BUILTIN_AGENT_IDS.includes(id as (typeof BUILTIN_AGENT_IDS)[number])
}