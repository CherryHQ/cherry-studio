import { type AgentPermissionMode, AgentPermissionModeSchema } from '@shared/data/api/schemas/agents'

export const DEFAULT_PERMISSION_MODE = 'default' as const

const permissionModeParser = AgentPermissionModeSchema.catch(DEFAULT_PERMISSION_MODE)

/** Coerces stored / user-supplied values to a mode the SDK accepts, defaulting anything else. */
export function normalizePermissionMode(mode: string | undefined | null): AgentPermissionMode {
  return permissionModeParser.parse(mode)
}
