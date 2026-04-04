import { loggerService } from '@logger'
import { channelManager } from '@main/services/agents/services/channels/ChannelManager'
import { channelService } from '@main/services/agents/services/ChannelService'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('ApiServerChannelsHandlers')

export const createChannel = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { type, name, agent_id, config, is_active, permission_mode } = req.body
    logger.debug('Creating channel', { type, name })
    const channel = await channelService.createChannel({
      type,
      name,
      agentId: agent_id,
      config: { type, ...config },
      isActive: is_active,
      permissionMode: permission_mode
    })

    if (channel.agentId) {
      await channelManager.syncAgent(channel.agentId)
    }

    logger.info('Channel created', { channelId: channel.id, type })
    return res.status(201).json(channel)
  } catch (error: any) {
    logger.error('Error creating channel', { error })
    return res.status(500).json({
      error: {
        message: `Failed to create channel: ${error.message}`,
        type: 'internal_error',
        code: 'channel_creation_failed'
      }
    })
  }
}

export const listChannels = async (req: Request, res: Response): Promise<Response> => {
  try {
    const agentId = req.query.agent_id as string | undefined
    const type = req.query.type as string | undefined

    logger.debug('Listing channels', { agentId, type })
    const channels = await channelService.listChannels({ agentId, type })

    return res.json({ data: channels, total: channels.length })
  } catch (error: any) {
    logger.error('Error listing channels', { error })
    return res.status(500).json({
      error: { message: 'Failed to list channels', type: 'internal_error', code: 'channel_list_failed' }
    })
  }
}

export const getChannel = async (req: Request, res: Response): Promise<Response> => {
  const { channelId } = req.params
  try {
    logger.debug('Getting channel', { channelId })
    const channel = await channelService.getChannel(channelId)

    if (!channel) {
      return res.status(404).json({
        error: { message: 'Channel not found', type: 'not_found', code: 'channel_not_found' }
      })
    }

    return res.json(channel)
  } catch (error: any) {
    logger.error('Error getting channel', { error, channelId })
    return res.status(500).json({
      error: { message: 'Failed to get channel', type: 'internal_error', code: 'channel_get_failed' }
    })
  }
}

export const updateChannel = async (req: Request, res: Response): Promise<Response> => {
  const { channelId } = req.params
  try {
    logger.debug('Updating channel', { channelId })

    const updates: Record<string, unknown> = {}
    if (req.body.name !== undefined) updates.name = req.body.name
    if (req.body.agent_id !== undefined) updates.agentId = req.body.agent_id
    if (req.body.session_id !== undefined) updates.sessionId = req.body.session_id
    if (req.body.config !== undefined) updates.config = req.body.config
    if (req.body.is_active !== undefined) updates.isActive = req.body.is_active
    if (req.body.permission_mode !== undefined) updates.permissionMode = req.body.permission_mode

    const channel = await channelService.updateChannel(channelId, updates)

    if (!channel) {
      return res.status(404).json({
        error: { message: 'Channel not found', type: 'not_found', code: 'channel_not_found' }
      })
    }

    if (channel.agentId) {
      await channelManager.syncAgent(channel.agentId)
    }

    logger.info('Channel updated', { channelId })
    return res.json(channel)
  } catch (error: any) {
    logger.error('Error updating channel', { error, channelId })
    return res.status(500).json({
      error: {
        message: `Failed to update channel: ${error.message}`,
        type: 'internal_error',
        code: 'channel_update_failed'
      }
    })
  }
}

export const deleteChannel = async (req: Request, res: Response): Promise<Response> => {
  const { channelId } = req.params
  try {
    logger.debug('Deleting channel', { channelId })

    const channel = await channelService.getChannel(channelId)
    if (!channel) {
      return res.status(404).json({
        error: { message: 'Channel not found', type: 'not_found', code: 'channel_not_found' }
      })
    }

    const agentId = channel.agentId
    await channelService.deleteChannel(channelId)

    if (agentId) {
      await channelManager.syncAgent(agentId)
    }

    logger.info('Channel deleted', { channelId })
    return res.status(204).send()
  } catch (error: any) {
    logger.error('Error deleting channel', { error, channelId })
    return res.status(500).json({
      error: { message: 'Failed to delete channel', type: 'internal_error', code: 'channel_delete_failed' }
    })
  }
}
