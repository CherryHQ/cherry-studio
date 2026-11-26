export const AGENT_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'] as const

export type AgentPermissionMode = (typeof AGENT_PERMISSION_MODES)[number]

export type PermissionModeApplication = 'session' | 'next-turn' | 'reconnect'

export interface PermissionModeChoice {
  value: string
  name: string
  permissionMode?: AgentPermissionMode
  requiresConfirmation?: true
  restrictHost?: true
}

export interface PermissionModeCatalog {
  id: string
  currentValue: string
  application: PermissionModeApplication
  options: readonly (PermissionModeChoice & { permissionMode: AgentPermissionMode })[]
}

export function selectedPermissionMode(selection?: {
  currentValue: string
  options: readonly PermissionModeChoice[]
}): AgentPermissionMode | undefined {
  return selection?.options.find(({ value }) => value === selection.currentValue)?.permissionMode
}

export function isAgentFullAccessMode(mode?: AgentPermissionMode): boolean {
  return mode === 'bypassPermissions'
}

export function requiresPermissionConfirmation(choice?: PermissionModeChoice): boolean {
  return choice?.requiresConfirmation === true || isAgentFullAccessMode(choice?.permissionMode)
}
