/**
 * Temporary runtime API handlers
 *
 * Implements the endpoints backing in-memory temporary topics and agent
 * sessions:
 * - POST   /temporary/topics
 * - PATCH  /temporary/topics/:id
 * - DELETE /temporary/topics/:id
 * - POST   /temporary/topics/:topicId/messages
 * - GET    /temporary/topics/:topicId/messages
 * - POST   /temporary/topics/:id/persist
 * - POST   /temporary/sessions
 * - DELETE /temporary/sessions/:id
 * - POST   /temporary/sessions/:id/persist
 *
 * Topic/message logic lives in TemporaryChatService. Agent session draft logic
 * lives in TemporarySessionService. Handlers stay thin: validate request bodies
 * when needed, then forward to the owning service.
 */

import { temporaryChatService } from '@data/services/TemporaryChatService'
import { temporarySessionService } from '@data/services/TemporarySessionService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  CreateTemporarySessionSchema,
  type TemporaryChatSchemas,
  UpdateTemporaryTopicSchema
} from '@shared/data/api/schemas/temporaryChats'

export const temporaryChatHandlers: HandlersFor<TemporaryChatSchemas> = {
  '/temporary/topics': {
    POST: async ({ body }) => {
      return await temporaryChatService.createTopic(body)
    }
  },

  '/temporary/topics/:id': {
    PATCH: async ({ params, body }) => {
      const parsed = UpdateTemporaryTopicSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await temporaryChatService.updateTopic(params.id, parsed.data)
    },
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
  },

  '/temporary/sessions': {
    POST: async ({ body }) => {
      const parsed = CreateTemporarySessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await temporarySessionService.createSession(parsed.data)
    }
  },

  '/temporary/sessions/:id': {
    DELETE: async ({ params }) => {
      await temporarySessionService.deleteSession(params.id)
      return undefined
    }
  },

  '/temporary/sessions/:id/persist': {
    POST: async ({ params }) => {
      return await temporarySessionService.persist(params.id)
    }
  }
}
