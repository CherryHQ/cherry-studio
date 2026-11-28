import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'

export type NotifyChannel = Pick<AgentChannelEntity, 'id' | 'type'>
export type LinkedChannelSnapshot = NotifyChannel | null

/**
 * The Session's linked channel, or null unless it belongs to `agentId`. The ownership check is the
 * boundary that keeps one Agent's task output out of another's channel — never project without it.
 */
export function resolveLinkedNotifyChannel(sessionId: string, agentId: string): LinkedChannelSnapshot {
  const channel = channelService.findBySessionId(sessionId)
  return channel?.agentId === agentId ? { id: channel.id, type: channel.type } : null
}
