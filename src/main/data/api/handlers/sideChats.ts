import { sideChatService } from '@data/services/SideChatService'
import { CreateSavedSideChatSchema, type SideChatSchemas } from '@shared/data/api/schemas/sideChats'
import type { HandlersFor } from '@shared/data/api/types'

export const sideChatHandlers: HandlersFor<SideChatSchemas> = {
  '/side-chats': {
    POST: async ({ body }) => {
      const input = CreateSavedSideChatSchema.parse(body)
      return sideChatService.create(input.source, input.config)
    }
  },
  '/topics/:sourceTopicId/side-chats': {
    GET: async ({ params }) => sideChatService.list(params.sourceTopicId)
  },
  '/side-chats/:topicId': {
    GET: async ({ params }) => sideChatService.get(params.topicId),
    PATCH: async ({ params, body }) => sideChatService.updateConfig(params.topicId, body)
  }
}
