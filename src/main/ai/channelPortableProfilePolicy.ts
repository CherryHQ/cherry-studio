import { sanitizePermissionMode } from '@main/ai/agents/portableProfilePolicy'

/** Reference-bearing channel values read from an untrusted detached database. */
export interface AgentChannelCapabilityInput {
  readonly config: unknown
  readonly permissionMode: unknown
}

export interface AgentChannelCapabilityPatch {
  readonly isActive: false
  readonly activeChatIds: readonly string[]
  readonly permissionMode: string | null
}

export interface AgentChannelCapabilitySanitization {
  readonly patch: AgentChannelCapabilityPatch
  readonly malformedFields: readonly string[]
}

/**
 * Restore channel credentials and continuity state as inert configuration.
 *
 * `isActive` defaults true in the database and causes ChannelManager to connect
 * at startup, so every restored row is explicitly deactivated. Malformed config
 * is disclosed but preserved: activation validates the adapter-specific shape,
 * while deleting credentials here would lose user data without making the
 * already-inactive row safer.
 */
export function sanitizeAgentChannelCapability(input: AgentChannelCapabilityInput): AgentChannelCapabilitySanitization {
  const malformedFields: string[] = []
  if (typeof input.config !== 'object' || input.config === null || Array.isArray(input.config)) {
    malformedFields.push('config')
  }
  return {
    patch: { isActive: false, activeChatIds: [], permissionMode: sanitizePermissionMode(input.permissionMode) },
    malformedFields
  }
}
