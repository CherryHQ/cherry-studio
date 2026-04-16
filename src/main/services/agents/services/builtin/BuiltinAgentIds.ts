export const CHERRY_CLAW_AGENT_ID = 'cherry-claw-default'
export const CHERRY_ASSISTANT_AGENT_ID = 'cherry-assistant-default'

const BUILTIN_AGENT_IDS = new Set([CHERRY_CLAW_AGENT_ID, CHERRY_ASSISTANT_AGENT_ID])

export function isBuiltinAgentId(id: string): boolean {
  return BUILTIN_AGENT_IDS.has(id)
}
