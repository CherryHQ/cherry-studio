import { agentChannelService } from '@data/services/AgentChannelService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import { AgentChannelListQuerySchema, type AgentChannelSchemas } from '@shared/data/api/schemas/agentChannels'
import type { HandlersFor } from '@shared/data/api/types'

export const agentChannelHandlers: HandlersFor<AgentChannelSchemas> = {
  '/agent-channels': {
    GET: async ({ query }) => {
      const parsed = AgentChannelListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const filters = Object.keys(parsed.data).length > 0 ? parsed.data : undefined
      return agentChannelService.listChannels(filters)
    }
  },

  '/agent-channels/:channelId': {
    GET: async ({ params }) => {
      const channel = agentChannelService.getChannel(params.channelId)
      if (!channel) throw DataApiErrorFactory.notFound('Channel', params.channelId)
      return channel
    }
  }
}
