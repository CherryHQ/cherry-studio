import { agentChannelService } from '@data/services/AgentChannelService'
import { agentChannelWorkflowService } from '@data/services/AgentChannelWorkflowService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  ActiveAgentChannelConfigSchemasByType,
  AgentChannelListQuerySchema,
  type AgentChannelSchemas,
  CreateAgentChannelSchema,
  UpdateAgentChannelSchema
} from '@shared/data/api/schemas/agentChannels'

export const agentChannelHandlers: HandlersFor<AgentChannelSchemas> = {
  '/channels': {
    GET: async ({ query }) => {
      const parsed = AgentChannelListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const filters = Object.keys(parsed.data).length > 0 ? parsed.data : undefined
      return await agentChannelService.listChannels(filters)
    },

    POST: async ({ body }) => {
      const parsed = CreateAgentChannelSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      if (parsed.data.isActive !== false) {
        const activeConfig = ActiveAgentChannelConfigSchemasByType[parsed.data.type].safeParse(parsed.data.config)
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
      const parsed = UpdateAgentChannelSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      const channel = await agentChannelWorkflowService.updateChannel(params.channelId, parsed.data)
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
