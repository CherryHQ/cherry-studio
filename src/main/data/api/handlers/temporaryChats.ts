/**
 * Temporary Chat API Handlers
 *
 * Implements the 5 endpoints backing in-memory temporary chat sessions:
 * - POST   /temporary/topics
 * - DELETE /temporary/topics/:id
 * - POST   /temporary/topics/:topicId/messages
 * - GET    /temporary/topics/:topicId/messages
 * - POST   /temporary/topics/:id/persist
 *
 * All routing / validation / storage logic lives in TemporaryChatService.
 */

import { temporaryChatService } from '@data/services/TemporaryChatService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { TemporaryChatSchemas } from '@shared/data/api/schemas/temporaryChats'

type TemporaryChatHandler<Path extends keyof TemporaryChatSchemas, Method extends ApiMethods<Path>> = ApiHandler<
  Path,
  Method
>

export const temporaryChatHandlers: {
  [Path in keyof TemporaryChatSchemas]: {
    [Method in keyof TemporaryChatSchemas[Path]]: TemporaryChatHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/temporary/topics': {
    POST: async ({ body }) => {
      return await temporaryChatService.createTopic(body)
    }
  },

  '/temporary/topics/:id': {
    DELETE: async ({ params }) => {
      await temporaryChatService.deleteTopic(params.id)
      return undefined
    }
  },

  '/temporary/topics/:topicId/messages': {
    POST: async ({ params, body }) => {
      return await temporaryChatService.appendMessage(params.topicId, body)
    },
    GET: async ({ params }) => {
      return await temporaryChatService.listMessages(params.topicId)
    }
  },

  '/temporary/topics/:id/persist': {
    POST: async ({ params }) => {
      return await temporaryChatService.persist(params.id)
    }
  }
}
