import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { CredentialStoreError } from '@main/services/credential'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentChannelEntity, UpdateAgentChannelDto } from '@shared/data/api/schemas/agentChannels'

type CreateAgentChannelInput = Parameters<typeof agentChannelService.createChannel>[0]

async function createChannelBinding(data: CreateAgentChannelInput): Promise<AgentChannelEntity> {
  const create = () => agentChannelService.createChannel(data)
  const channel =
    data.type === 'feishu'
      ? await withApplication(
          'applicationCredentialId' in data.config ? data.config.applicationCredentialId : undefined,
          create
        )
      : create()
  return channel
}

async function updateChannelBinding(channelId: string, updates: UpdateAgentChannelDto): Promise<AgentChannelEntity> {
  const current = agentChannelService.getChannel(channelId)
  if (!current) throw DataApiErrorFactory.notFound('Channel', channelId)
  const config = updates.config ?? { ...current.config, ...updates.configPatch }
  const id = 'applicationCredentialId' in config ? config.applicationCredentialId : undefined
  const update = () => {
    const latest = agentChannelService.getChannel(channelId)
    if (
      current.type === 'feishu' &&
      latest?.type === 'feishu' &&
      latest.config.applicationCredentialId !== current.config.applicationCredentialId
    )
      throw new CredentialStoreError('conflict')
    return agentChannelService.updateChannel(channelId, updates)
  }
  const channel = current.type === 'feishu' ? await withApplication(id, update) : update()
  if (!channel) throw DataApiErrorFactory.notFound('Channel', channelId)
  return channel
}

export async function createAgentChannel(data: CreateAgentChannelInput): Promise<AgentChannelEntity> {
  const channel = await createChannelBinding(data)
  application.get('ChannelManager').requestReconcile(channel.id)
  return channel
}

export async function updateAgentChannel(
  channelId: string,
  updates: UpdateAgentChannelDto
): Promise<AgentChannelEntity> {
  const channel = await updateChannelBinding(channelId, updates)
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
  const channel = await createChannelBinding(data)
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
  const channel = await updateChannelBinding(channelId, updates)
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

async function withApplication<T>(id: unknown, commit: () => T extends PromiseLike<unknown> ? never : T): Promise<T> {
  if (id === null) return commit()
  if (typeof id !== 'string') throw new CredentialStoreError('invalid')
  return application.get('CredentialStoreService').withReferences([id], (records) => {
    if (records[0].kind !== 'application') throw new CredentialStoreError('invalid')
    return commit()
  })
}
