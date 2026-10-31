/**
 * Temporary Chat API Handlers
 *
 * Implements the endpoints backing in-memory temporary chat sessions:
 * - POST   /temporary/topics
 * - DELETE /temporary/topics/:id
 * - POST   /temporary/topics/:topicId/messages
 * - GET    /temporary/topics/:topicId/messages
 * - POST   /temporary/topics/:id/persist
 *
 * All routing / validation / storage logic lives in TemporaryChatService.
 */

import { temporaryChatService } from '@data/services/TemporaryChatService'
import { CreateMessageSchema } from '@shared/data/api/schemas/messages'
import { CreateTemporaryTopicSchema, type TemporaryChatSchemas } from '@shared/data/api/schemas/temporaryChats'
import type { HandlersFor } from '@shared/data/api/types'

export const temporaryChatHandlers: HandlersFor<TemporaryChatSchemas> = {
  '/temporary/topics': {
    POST: async ({ body }) => {
      // Parse at the boundary (matches the messages endpoint below): a direct trusted-renderer
      // request with `maxMessages: 0` must not override a valid general cap and then be served
      // as unlimited history.
      return temporaryChatService.createTopic(CreateTemporaryTopicSchema.parse(body))
    }
  },

  '/temporary/topics/:id': {
    DELETE: async ({ params }) => {
      temporaryChatService.deleteTopic(params.id)
      return undefined
    }
  },

  '/temporary/topics/:topicId/messages': {
    POST: async ({ params, body }) => {
      // Parse at the boundary (matches `messages.ts`) so a malformed structured `messageSnapshot`
      // can't be stored in memory and later persisted via `persist()`.
      const parsed = CreateMessageSchema.parse(body)
      return temporaryChatService.appendMessage(params.topicId, parsed)
    },
    GET: async ({ params }) => {
      return temporaryChatService.listMessages(params.topicId)
    }
  },

  '/temporary/topics/:id/persist': {
    POST: async ({ params }) => {
      return temporaryChatService.persist(params.id)
    }
  }
}
