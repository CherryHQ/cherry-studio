export const AGENT_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'] as const

export type AgentPermissionMode = (typeof AGENT_PERMISSION_MODES)[number]

export type PermissionModeApplication = 'session' | 'next-turn' | 'reconnect'

export interface PermissionModeChoice {
  value: string
  name: string
  permissionMode?: AgentPermissionMode
  requiresConfirmation?: true
  restrictHost?: true
  workflowOnly?: true
}

export interface PermissionModeCatalog {
  id: string
  currentValue: string
  application: PermissionModeApplication
  nativePermissionNames?: true
  options: readonly (PermissionModeChoice & { permissionMode: AgentPermissionMode })[]
}

export function selectedPermissionMode(selection?: {
  currentValue: string
  options: readonly PermissionModeChoice[]
}): AgentPermissionMode | undefined {
  return selection?.options.find(({ value }) => value === selection.currentValue)?.permissionMode
}

export function hasPermissionModeChoices(selection?: {
  currentValue: string
  options: readonly PermissionModeChoice[]
  nativePermissionNames?: true
}): boolean {
  return (
    !!selection &&
    selection.options.some(({ value }) => value === selection.currentValue) &&
    selection.options.every(
      (option) => (option.permissionMode || option.workflowOnly) && !option.requiresConfirmation
    ) &&
    new Set(
      selection.options.flatMap(({ permissionMode, value }) =>
        permissionMode ? [selection.nativePermissionNames ? value : permissionMode] : []
      )
    ).size >= 2
  )
}

export function isAgentFullAccessMode(mode?: AgentPermissionMode): boolean {
  return mode === 'bypassPermissions'
}

export function requiresPermissionConfirmation(choice?: PermissionModeChoice): boolean {
  return choice?.requiresConfirmation === true || isAgentFullAccessMode(choice?.permissionMode)
}
