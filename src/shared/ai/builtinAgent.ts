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

export const PROTECTED_BUILTIN_AGENT_ROLES: readonly BuiltinAgentRole[] = Object.values(BUILTIN_AGENT_ROLE)

/** True when `role` is a protected built-in role that the user chose to hide from the Agents list. */
export function isHiddenBuiltinAgentRole(hiddenRoles: readonly string[] | undefined, role: unknown): boolean {
  return isProtectedBuiltinAgentRole(role) && (hiddenRoles ?? []).includes(role)
}

export function sanitizeHiddenBuiltinRoles(roles: readonly string[] | undefined): BuiltinAgentRole[] {
  return [...new Set((roles ?? []).filter(isProtectedBuiltinAgentRole))]
}
