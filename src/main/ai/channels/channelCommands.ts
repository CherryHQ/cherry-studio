import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentChannelEntity, UpdateAgentChannelDto } from '@shared/data/api/schemas/agentChannels'

type CreateAgentChannelInput = Parameters<typeof agentChannelService.createChannel>[0]

export function createAgentChannel(data: CreateAgentChannelInput): AgentChannelEntity {
  const channel = agentChannelService.createChannel(data)
  application.get('ChannelManager').requestReconcile(channel.id)
  return channel
}

export function updateAgentChannel(channelId: string, updates: UpdateAgentChannelDto): AgentChannelEntity {
  const channel = agentChannelService.updateChannel(channelId, updates)
  if (!channel) throw DataApiErrorFactory.notFound('Channel', channelId)
  application.get('ChannelManager').requestReconcile(channelId)
  return channel
}

export async function deleteAgentChannel(channelId: string): Promise<boolean> {
  const deleted = agentChannelService.deleteChannel(channelId)
  if (deleted) await application.get('ChannelManager').removeChannel(channelId)
  return deleted
}

export async function createAgentChannelAndWaitForQr(
  data: CreateAgentChannelInput & { agentId: string },
  timeoutMs = 30_000
): Promise<{ channel: AgentChannelEntity; qrUrl: string }> {
  const channel = agentChannelService.createChannel(data)
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
