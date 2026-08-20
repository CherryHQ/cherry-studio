import type { PermissionMode } from '@renderer/types/agent'
import { AgentPermissionModeSchema } from '@shared/data/api/schemas/agents'

export const DEFAULT_PERMISSION_MODE = 'default' as const
export const DEFAULT_HEARTBEAT_ENABLED = true
export const DEFAULT_HEARTBEAT_INTERVAL = 30

const permissionModeParser = AgentPermissionModeSchema.catch(DEFAULT_PERMISSION_MODE)

/** Coerces stored / user-supplied values to a mode the SDK accepts, defaulting anything else. */
export function normalizePermissionMode(mode: string | undefined | null): PermissionMode {
  return permissionModeParser.parse(mode)
}
