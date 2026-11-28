import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { trackMainProductEvent } from '@main/services/productAnalytics'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentChannelEntity, UpdateAgentChannelDto } from '@shared/data/api/schemas/agentChannels'

type CreateAgentChannelInput = Parameters<typeof agentChannelService.createChannel>[0]

export type ChannelChangeOrigin = 'ui' | 'agent_tool'

function trackChannelChange(
  action: 'channel_disconnected' | 'channel_deleted',
  channel: AgentChannelEntity,
  origin: ChannelChangeOrigin
): void {
  trackMainProductEvent({ event: 'feature_used', feature: 'channels', action, target: channel.type, origin })
}

export function createAgentChannel(data: CreateAgentChannelInput): AgentChannelEntity {
  const channel = agentChannelService.createChannel(data)
  application.get('ChannelManager').requestReconcile(channel.id)
  return channel
}

export function updateAgentChannel(
  channelId: string,
  updates: UpdateAgentChannelDto,
  origin: ChannelChangeOrigin
): AgentChannelEntity {
  const wasActive = agentChannelService.getChannel(channelId)?.isActive === true
  const channel = agentChannelService.updateChannel(channelId, updates)
  if (!channel) throw DataApiErrorFactory.notFound('Channel', channelId)
  application.get('ChannelManager').requestReconcile(channelId)
  if (wasActive && !channel.isActive) trackChannelChange('channel_disconnected', channel, origin)
  return channel
}

/** `origin` is omitted only for internal cleanup, which is not reported. */
export async function deleteAgentChannel(channelId: string, origin?: ChannelChangeOrigin): Promise<boolean> {
  const channel = origin ? agentChannelService.getChannel(channelId) : null
  const deleted = agentChannelService.deleteChannel(channelId)
  if (deleted) await application.get('ChannelManager').removeChannel(channelId)
  if (deleted && channel && origin) trackChannelChange('channel_deleted', channel, origin)
  return deleted
}

/** @param beforeConnect Runs once the row exists and before reconciliation can publish an outcome. */
export async function createAgentChannelAndWaitForQr(
  data: CreateAgentChannelInput & { agentId: string },
  timeoutMs = 30_000,
  beforeConnect?: (channel: AgentChannelEntity) => void
): Promise<{ channel: AgentChannelEntity; qrUrl: string }> {
  const channel = agentChannelService.createChannel(data)
  beforeConnect?.(channel)
  try {
    const qrUrl = await application.get('ChannelManager').waitForQrAndReconcile(data.agentId, channel.id, timeoutMs)
    return { channel, qrUrl }
  } catch (error) {
    await deleteAgentChannel(channel.id)
    throw error
  }
}

export async function updateAgentChannelAndWaitForQr(
  channelId: string,
  agentId: string,
  updates: UpdateAgentChannelDto,
  timeoutMs = 30_000
): Promise<{ channel: AgentChannelEntity; qrUrl: string }> {
  const channel = agentChannelService.updateChannel(channelId, updates)
  if (!channel) throw DataApiErrorFactory.notFound('Channel', channelId)
  const qrUrl = await application.get('ChannelManager').waitForQrAndReconcile(agentId, channelId, timeoutMs)
  return { channel, qrUrl }
}

export async function reconnectAgentChannel(channelId: string): Promise<void> {
  await application.get('ChannelManager').reconcileChannel(channelId)
}

export function reconnectAgentChannelWithQr(agentId: string, channelId: string, timeoutMs = 30_000): Promise<string> {
  return application.get('ChannelManager').waitForQrAndReconcile(agentId, channelId, timeoutMs)
}
