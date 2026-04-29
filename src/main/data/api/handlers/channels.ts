import { agentChannelService } from '@data/services/AgentChannelService'
import { agentChannelWorkflowService } from '@data/services/AgentChannelWorkflowService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  ActiveChannelConfigSchemasByType,
  ChannelConfigSchemasByType,
  ChannelListQuerySchema,
  type ChannelSchemas,
  CreateChannelSchema,
  UpdateChannelSchema
} from '@shared/data/api/schemas/channels'

export const channelHandlers: HandlersFor<ChannelSchemas> = {
  '/channels': {
    GET: async ({ query }) => {
      const parsed = ChannelListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const filters = Object.keys(parsed.data).length > 0 ? parsed.data : undefined
      return await agentChannelService.listChannels(filters)
    },

    POST: async ({ body }) => {
      const parsed = CreateChannelSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      if (parsed.data.isActive !== false) {
        const activeConfig = ActiveChannelConfigSchemasByType[parsed.data.type].safeParse(parsed.data.config)
        if (!activeConfig.success) throw toDataApiError(activeConfig.error)
      }
      return await agentChannelWorkflowService.createChannel(parsed.data)
    }
  },

  '/channels/:channelId': {
    GET: async ({ params }) => {
      const channel = await agentChannelService.getChannel(params.channelId)
      if (!channel) throw DataApiErrorFactory.notFound('Channel', params.channelId)
      return channel
    },

    PATCH: async ({ params, body }) => {
      const existing = await agentChannelService.getChannel(params.channelId)
      if (!existing) throw DataApiErrorFactory.notFound('Channel', params.channelId)

      const parsed = UpdateChannelSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      if (parsed.data.type && parsed.data.type !== existing.type) {
        throw DataApiErrorFactory.validation({ type: ['channel type cannot be changed'] })
      }

      const validatedConfig =
        parsed.data.config !== undefined
          ? ChannelConfigSchemasByType[existing.type].safeParse(parsed.data.config)
          : undefined
      if (validatedConfig && !validatedConfig.success) {
        throw toDataApiError(validatedConfig.error)
      }

      const nextIsActive = parsed.data.isActive ?? existing.isActive
      const nextConfig = validatedConfig?.success ? validatedConfig.data : existing.config
      if (nextIsActive) {
        const activeConfig = ActiveChannelConfigSchemasByType[existing.type].safeParse(nextConfig)
        if (!activeConfig.success) throw toDataApiError(activeConfig.error)
      }

      const channel = await agentChannelWorkflowService.updateChannel(params.channelId, {
        ...parsed.data,
        type: existing.type,
        ...(validatedConfig?.success ? { config: validatedConfig.data } : {})
      })
      if (!channel) throw DataApiErrorFactory.notFound('Channel', params.channelId)
      return channel
    },

    DELETE: async ({ params }) => {
      const deleted = await agentChannelWorkflowService.deleteChannel(params.channelId)
      if (!deleted) throw DataApiErrorFactory.notFound('Channel', params.channelId)
      return undefined
    }
  }
}
