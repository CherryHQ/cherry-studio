export const BUILTIN_AGENT_ROLE = {
  ASSISTANT: 'assistant',
  SUPPORT: 'support',
  DOCTOR: 'doctor'
} as const

export const CHERRY_SUPPORT_AGENT_ID = 'cherry-support'

export type BuiltinAgentRole = (typeof BUILTIN_AGENT_ROLE)[keyof typeof BUILTIN_AGENT_ROLE]

export function isProtectedBuiltinAgentRole(role: unknown): role is BuiltinAgentRole {
  return Object.values(BUILTIN_AGENT_ROLE).includes(role as BuiltinAgentRole)
}

/** Agents whose runtime ignores user-installed skills and only loads the skills bundled with them. */
export function isSealedBuiltinAgentRole(role: unknown): boolean {
  return role === BUILTIN_AGENT_ROLE.SUPPORT || role === BUILTIN_AGENT_ROLE.DOCTOR
}
