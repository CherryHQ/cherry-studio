import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { toDataApiError } from '@shared/data/api'
import {
  ActiveAgentChannelConfigSchemasByType,
  AgentChannelConfigSchemasByType,
  type UpdateAgentChannelDto
} from '@shared/data/api/schemas/agentChannels'

import { agentChannelService } from './AgentChannelService'

const logger = loggerService.withContext('AgentChannelWorkflowService')

export class AgentChannelWorkflowService {
  async createChannel(data: Parameters<typeof agentChannelService.createChannel>[0]) {
    const channel = await agentChannelService.createChannel(data)

    try {
      await application.get('ChannelManager').syncChannel(channel.id, { awaitConnect: true, strictDisconnect: true })
      return channel
    } catch (error) {
      await agentChannelService.deleteChannel(channel.id).catch((cleanupError) => {
        logger.warn('Failed to clean up channel after sync failure', {
          channelId: channel.id,
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      })
      await application
        .get('ChannelManager')
        .disconnectChannel(channel.id)
        .catch((disconnectError) => {
          logger.warn('Failed to disconnect channel after sync failure', {
            channelId: channel.id,
            disconnectError: disconnectError instanceof Error ? disconnectError.message : String(disconnectError)
          })
        })
      throw error
    }
  }

  async updateChannel(channelId: string, updates: UpdateAgentChannelDto) {
    const existing = await agentChannelService.getChannel(channelId)
    if (!existing) return null

    const validatedConfig =
      updates.config !== undefined
        ? AgentChannelConfigSchemasByType[existing.type].safeParse(updates.config)
        : undefined
    if (validatedConfig && !validatedConfig.success) {
      throw toDataApiError(validatedConfig.error)
    }

    const nextIsActive = updates.isActive ?? existing.isActive
    const nextConfig = validatedConfig?.success ? validatedConfig.data : existing.config
    if (nextIsActive) {
      const activeConfig = ActiveAgentChannelConfigSchemasByType[existing.type].safeParse(nextConfig)
      if (!activeConfig.success) throw toDataApiError(activeConfig.error)
    }

    const serviceUpdates = {
      ...updates,
      ...(validatedConfig?.success ? { config: validatedConfig.data } : {})
    }

    const channel = await agentChannelService.updateChannel(channelId, serviceUpdates)
    if (!channel) {
      logger.warn('updateChannel: row disappeared mid-update', { channelId })
      return null
    }

    try {
      await application.get('ChannelManager').syncChannel(channelId, { awaitConnect: true, strictDisconnect: true })
      return channel
    } catch (error) {
      // `existing` came from rowToEntity which runs nullsToUndefined; without
      // an explicit ?? null Drizzle's set() treats undefined as "skip column"
      // and the failed update's value would persist for nullable fields.
      const restoreUpdates = {
        name: existing.name,
        agentId: existing.agentId ?? null,
        sessionId: existing.sessionId ?? null,
        workspace: existing.workspace,
        config: existing.config,
        isActive: existing.isActive,
        activeChatIds: existing.activeChatIds,
        permissionMode: existing.permissionMode ?? null
      }

      await agentChannelService.updateChannel(channelId, restoreUpdates).catch((restoreError) => {
        logger.warn('Failed to restore channel after sync failure', {
          channelId,
          restoreError: restoreError instanceof Error ? restoreError.message : String(restoreError)
        })
      })
      await application
        .get('ChannelManager')
        .syncChannel(channelId)
        .catch((resyncError) => {
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

    await application.get('ChannelManager').disconnectChannel(channelId, { suppressErrors: false })
    try {
      return await agentChannelService.deleteChannel(channelId)
    } catch (error) {
      await application
        .get('ChannelManager')
        .syncChannel(channelId)
        .catch((resyncError) => {
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
