import type { PermissionMode } from '@renderer/types'
import type { Tool } from '@shared/ai/tool'
import { uniq } from 'lodash'

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
 * Computes tool rules currently approved by the effective main-side policy.
 */
export function computeModeDefaults(_mode: PermissionMode, tools: Tool[]): string[] {
  return tools.filter((tool) => tool.approval === 'auto').map((tool) => tool.id)
}

function matchesToolRule(value: string, tool: Tool): boolean {
  return value === tool.id || value === tool.name
}

function isRuntimeNativeRule(value: string): boolean {
  return !value.includes(':')
}

export function normalizeAllowedToolRules(allowedTools: readonly string[], tools: Tool[]): string[] {
  return uniq(
    allowedTools.flatMap((value) => {
      const tool = tools.find((item) => matchesToolRule(value, item))
      if (tool) return [tool.id]
      return isRuntimeNativeRule(value) ? [value] : []
    })
  )
}

export function mergePermissionModeTools(
  allowedTools: readonly string[],
  _currentMode: PermissionMode,
  _nextMode: PermissionMode,
  tools: Tool[]
): string[] {
  return normalizeAllowedToolRules(allowedTools, tools)
}

export function mergeAutoApprovedTools(
  allowedTools: readonly string[],
  permissionMode: PermissionMode,
  tools: Tool[]
): string[] {
  return uniq([...normalizeAllowedToolRules(allowedTools, tools), ...computeModeDefaults(permissionMode, tools)])
}
