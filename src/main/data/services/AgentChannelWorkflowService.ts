import { loggerService } from '@logger'
import { channelManager } from '@main/services/agents/services/channels'
import type { UpdateChannelDto } from '@shared/data/api/schemas/channels'

import { agentChannelService } from './AgentChannelService'

const logger = loggerService.withContext('AgentChannelWorkflowService')

export class AgentChannelWorkflowService {
  async createChannel(data: Parameters<typeof agentChannelService.createChannel>[0]) {
    const channel = await agentChannelService.createChannel(data)

    try {
      await channelManager.syncChannel(channel.id, { awaitConnect: true, strictDisconnect: true })
      return channel
    } catch (error) {
      await agentChannelService.deleteChannel(channel.id).catch((cleanupError) => {
        logger.warn('Failed to clean up channel after sync failure', {
          channelId: channel.id,
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      })
      await channelManager.disconnectChannel(channel.id).catch((disconnectError) => {
        logger.warn('Failed to disconnect channel after sync failure', {
          channelId: channel.id,
          disconnectError: disconnectError instanceof Error ? disconnectError.message : String(disconnectError)
        })
      })
      throw error
    }
  }

  async updateChannel(channelId: string, updates: UpdateChannelDto) {
    const existing = await agentChannelService.getChannel(channelId)
    if (!existing) return null

    const { type: _type, ...serviceUpdates } = updates
    const channel = await agentChannelService.updateChannel(channelId, serviceUpdates)
    if (!channel) return null

    try {
      await channelManager.syncChannel(channelId, { awaitConnect: true, strictDisconnect: true })
      return channel
    } catch (error) {
      const restoreUpdates = {
        name: existing.name,
        agentId: existing.agentId,
        sessionId: existing.sessionId,
        config: existing.config,
        isActive: existing.isActive,
        activeChatIds: existing.activeChatIds,
        permissionMode: existing.permissionMode
      }

      await agentChannelService.updateChannel(channelId, restoreUpdates).catch((restoreError) => {
        logger.warn('Failed to restore channel after sync failure', {
          channelId,
          restoreError: restoreError instanceof Error ? restoreError.message : String(restoreError)
        })
      })
      await channelManager.syncChannel(channelId).catch((resyncError) => {
        logger.warn('Failed to resync restored channel after sync failure', {
          channelId,
          resyncError: resyncError instanceof Error ? resyncError.message : String(resyncError)
        })
      })
      throw error
    }
  }

  async deleteChannel(channelId: string) {
    const existing = await agentChannelService.getChannel(channelId)
    if (!existing) return false

    await channelManager.disconnectChannel(channelId, { suppressErrors: false })
    try {
      return await agentChannelService.deleteChannel(channelId)
    } catch (error) {
      await channelManager.syncChannel(channelId).catch((resyncError) => {
        logger.warn('Failed to resync channel after delete failure', {
          channelId,
          resyncError: resyncError instanceof Error ? resyncError.message : String(resyncError)
        })
      })
      throw error
    }
  }
}

export const agentChannelWorkflowService = new AgentChannelWorkflowService()
