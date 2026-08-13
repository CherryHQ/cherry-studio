export const BUILTIN_AGENT_ROLE = {
  ASSISTANT: 'assistant',
  SUPPORT: 'support'
} as const

export const CHERRY_SUPPORT_AGENT_ID = 'cherry-support'

export type BuiltinAgentRole = (typeof BUILTIN_AGENT_ROLE)[keyof typeof BUILTIN_AGENT_ROLE]

export function isProtectedBuiltinAgentRole(role: unknown): role is BuiltinAgentRole {
  return role === BUILTIN_AGENT_ROLE.ASSISTANT || role === BUILTIN_AGENT_ROLE.SUPPORT
}
