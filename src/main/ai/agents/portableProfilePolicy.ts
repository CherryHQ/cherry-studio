import type { PortableProfileSanitization } from '@data/portableProfilePolicy'
import {
  type AgentConfiguration,
  type AgentConfigurationField,
  type AgentPermissionMode,
  AgentPermissionModeSchema,
  sanitizeAgentConfiguration
} from '@shared/data/api/schemas/agents'

/**
 * Restore keeps agent configuration as data, but it must not carry automation
 * or producer-device permission bypasses into an active target profile.
 */
export type PortableAgentPermissionMode = Exclude<AgentPermissionMode, 'bypassPermissions'>

export type PortableAgentConfiguration = Omit<
  AgentConfiguration,
  'heartbeat_enabled' | 'scheduler_enabled' | 'permission_mode'
> & {
  heartbeat_enabled: false
  scheduler_enabled: false
  permission_mode?: PortableAgentPermissionMode
}

export interface AgentAutomationPatch {
  readonly configuration: PortableAgentConfiguration
}

export type AgentAutomationMalformedField = AgentConfigurationField | '<root>'

export type AgentAutomationSanitization = PortableProfileSanitization<
  AgentAutomationPatch,
  AgentAutomationMalformedField
>

/** Target-local parent for workspace rows that cannot retain their source binding. */
export const DISCONNECTED_AGENT_WORKSPACE_DIRECTORY = 'disconnected-workspaces'

/** Reduce an untrusted row id to one inert, portable path segment. */
export function toDisconnectedAgentWorkspaceSegment(id: string): string {
  return `ws-${id
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 64)
    .replace(/\.+$/, '')}`
}

/**
 * Keep a known, non-bypassing permission mode. Unknown values and
 * `bypassPermissions` fall back to the target default.
 */
export function sanitizePermissionMode(value: unknown): PortableAgentPermissionMode | null {
  const parsed = AgentPermissionModeSchema.safeParse(value)
  return parsed.success && parsed.data !== 'bypassPermissions' ? parsed.data : null
}

/**
 * Return the inert configuration an archive may carry for one agent.
 *
 * The heartbeat reader is opt-out, so both automation flags must be written
 * `false` even when the stored root is absent or malformed. Unknown,
 * non-automatic configuration remains available for a later user-initiated run.
 */
export function sanitizeAgentAutomation(raw: unknown): AgentAutomationSanitization {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  const { permission_mode: permissionMode, ...preserved } = data ?? {}
  const configuration: PortableAgentConfiguration = {
    ...preserved,
    heartbeat_enabled: false,
    scheduler_enabled: false
  }
  const mode = sanitizePermissionMode(permissionMode)
  if (mode !== null) configuration.permission_mode = mode

  return { patch: { configuration }, malformedFields: invalidKeys }
}
