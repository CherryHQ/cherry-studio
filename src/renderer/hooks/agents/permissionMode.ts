import type { PermissionMode } from '@renderer/types'

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
