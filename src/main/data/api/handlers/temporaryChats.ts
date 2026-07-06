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
import type { TemporaryChatSchemas } from '@shared/data/api/schemas/temporaryChats'
import type { HandlersFor } from '@shared/data/api/types'

export const temporaryChatHandlers: HandlersFor<TemporaryChatSchemas> = {
  '/temporary/topics': {
    POST: async ({ body }) => {
      return temporaryChatService.createTopic(body)
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
      return temporaryChatService.appendMessage(params.topicId, body)
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
