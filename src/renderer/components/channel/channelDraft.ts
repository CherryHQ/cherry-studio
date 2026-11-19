import {
  ActiveAgentChannelConfigSchemasByType,
  type AgentChannelDraft,
  AgentChannelDraftSchema,
  type AgentChannelType,
  isQrLoginChannel
} from '@shared/data/api/schemas/agentChannels'

import type { AvailableChannel, ChannelData } from './channelTypes'

/** A channel being configured before its Agent exists; `id` is local only. */
export type ChannelDraftItem = ChannelData & { type: AgentChannelType }

/** A new inactive draft named after its platform, numbered when the platform is already used. */
export function createChannelDraft(
  platform: AvailableChannel,
  title: string,
  existing: readonly ChannelDraftItem[]
): ChannelDraftItem {
  const sameType = existing.filter((channel) => channel.type === platform.type).length
  return {
    id: crypto.randomUUID(),
    type: platform.type,
    name: sameType ? `${title} ${sameType + 1}` : title,
    config: { ...platform.defaultConfig },
    isActive: false,
    permissionMode: null
  }
}

/**
 * The create payload for a draft, checked with the same schemas the main process applies,
 * or `null` when that create would be rejected.
 */
export function toAgentChannelDraft(channel: ChannelDraftItem): AgentChannelDraft | null {
  const parsed = AgentChannelDraftSchema.safeParse({
    type: channel.type,
    name: channel.name.trim(),
    config: channel.config,
    isActive: channel.isActive,
    permissionMode: channel.permissionMode ?? null
  })
  if (!parsed.success || !parsed.data.name) return null
  const draft = parsed.data
  // QR-login channels are created inactive, so their missing credentials are expected.
  if (draft.isActive && !isQrLoginChannel(draft)) {
    if (!ActiveAgentChannelConfigSchemasByType[draft.type].safeParse(draft.config).success) return null
  }
  return draft
}
