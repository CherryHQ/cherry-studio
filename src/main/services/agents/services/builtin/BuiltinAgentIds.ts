export const CHERRY_CLAW_AGENT_ID = 'cherry-claw-default'
export const CHERRY_ASSISTANT_AGENT_ID = 'cherry-assistant-default'

/** All builtin agent IDs as a readonly array — single source of truth */
export const BUILTIN_AGENT_IDS = [CHERRY_CLAW_AGENT_ID, CHERRY_ASSISTANT_AGENT_ID] as const

const BUILTIN_AGENT_IDS_SET = new Set<string>(BUILTIN_AGENT_IDS)

export function isBuiltinAgentId(id: string): boolean {
  return BUILTIN_AGENT_IDS_SET.has(id)
}
