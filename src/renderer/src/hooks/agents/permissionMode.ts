import type { PermissionMode, Tool } from '@renderer/types'

export const DEFAULT_MAX_TURNS = 100
export const DEFAULT_PERMISSION_MODE = 'default' as const
export const DEFAULT_HEARTBEAT_ENABLED = true
export const DEFAULT_HEARTBEAT_INTERVAL = 30

export function normalizePermissionMode(mode: string | undefined | null): PermissionMode {
  if (mode === 'plan' || mode === 'acceptEdits' || mode === 'bypassPermissions') {
    return mode
  }
  return DEFAULT_PERMISSION_MODE
}

/**
 * Computes tool IDs that are implicitly approved by a permission mode.
 * This mirrors the legacy AgentSettings popup behavior.
 */
export function computeModeDefaults(mode: PermissionMode, tools: Tool[]): string[] {
  const defaultToolIds = tools.filter((tool) => !tool.requirePermissions).map((tool) => tool.id)
  switch (mode) {
    case 'acceptEdits':
      return [
        ...defaultToolIds,
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'Write',
        'Bash(mkdir:*)',
        'Bash(touch:*)',
        'Bash(rm:*)',
        'Bash(mv:*)',
        'Bash(cp:*)'
      ]
    case 'bypassPermissions':
      return tools.map((tool) => tool.id)
    case 'default':
    case 'plan':
      return defaultToolIds
  }
}

export function mergePermissionModeTools(
  allowedTools: readonly string[],
  currentMode: PermissionMode,
  nextMode: PermissionMode,
  tools: Tool[]
): string[] {
  const currentDefaults = new Set(computeModeDefaults(currentMode, tools))
  const userAddedIds = allowedTools.filter((id) => !currentDefaults.has(id))
  return uniq([...userAddedIds, ...computeModeDefaults(nextMode, tools)])
}

export function mergeAutoApprovedTools(
  allowedTools: readonly string[],
  permissionMode: PermissionMode,
  tools: Tool[]
): string[] {
  return uniq([...allowedTools, ...computeModeDefaults(permissionMode, tools)])
}

export function uniq(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}
