import type { AgentChannelRow } from '@data/db/schemas/agentChannel'
import type { PortableProfileSanitization } from '@data/portableProfilePolicy'
import { type PortableAgentPermissionMode, sanitizePermissionMode } from '@main/ai/agents/portableProfilePolicy'
import { AgentChannelConfigSchemasByType, AgentChannelTypeSchema } from '@shared/data/api/schemas/agentChannels'
import { AgentPermissionModeSchema } from '@shared/data/api/schemas/agents'

/** Reference-bearing channel values read from an untrusted detached database. */
export interface AgentChannelCapabilityInput {
  readonly type: unknown
  readonly config: unknown
  readonly permissionMode: unknown
}

export interface AgentChannelCapabilityPatch {
  readonly isActive: false
  readonly activeChatIds: AgentChannelRow['activeChatIds']
  readonly permissionMode: PortableAgentPermissionMode | null
}

export type AgentChannelCapabilityMalformedField = keyof AgentChannelCapabilityInput

export type AgentChannelCapabilitySanitization = PortableProfileSanitization<
  AgentChannelCapabilityPatch,
  AgentChannelCapabilityMalformedField
>

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
  const malformedFields: AgentChannelCapabilityMalformedField[] = []
  const type = AgentChannelTypeSchema.safeParse(input.type)
  if (!type.success) {
    malformedFields.push('type')
  } else if (!AgentChannelConfigSchemasByType[type.data].safeParse(input.config).success) {
    malformedFields.push('config')
  }
  if (
    input.permissionMode !== null &&
    input.permissionMode !== undefined &&
    !AgentPermissionModeSchema.safeParse(input.permissionMode).success
  ) {
    malformedFields.push('permissionMode')
  }
  const patch = {
    isActive: false,
    activeChatIds: [],
    permissionMode: sanitizePermissionMode(input.permissionMode)
  } satisfies AgentChannelCapabilityPatch
  return {
    patch,
    malformedFields
  }
}
