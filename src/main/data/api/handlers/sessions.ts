/**
 * Session domain API handlers.
 *
 * Sessions are pure agent instances. Config (model / instructions / mcps /
 * allowedTools / accessiblePaths / configuration) lives on the parent agent
 * and is fetched separately — these handlers only read/write session-level
 * state (id, agentId, name, description, orderKey, timestamps).
 */

import { agentSessionMessageService as sessionMessageService } from '@data/services/AgentSessionMessageService'
import { sessionService } from '@data/services/SessionService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import { ListQuerySchema } from '@shared/data/api/schemas/agents'
import {
  CreateSessionSchema,
  ListSessionsQuerySchema,
  type SessionSchemas,
  UpdateSessionSchema
} from '@shared/data/api/schemas/sessions'

export const sessionHandlers: HandlersFor<SessionSchemas> = {
  '/sessions': {
    GET: async ({ query }) => {
      const parsed = ListSessionsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await sessionService.listByCursor(parsed.data)
    },

    POST: async ({ body }) => {
      const parsed = CreateSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await sessionService.createSession(parsed.data)
    }
  },

  '/sessions/:sessionId': {
    GET: async ({ params }) => {
      return await sessionService.getById(params.sessionId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await sessionService.update(params.sessionId, parsed.data)
    },

    DELETE: async ({ params }) => {
      await sessionService.delete(params.sessionId)
      return undefined
    }
  },

  '/sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const parsed = ListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      const { page, limit } = parsed.data
      const { messages, total } = await sessionMessageService.listSessionMessages(params.sessionId, {
        limit,
        offset: (page - 1) * limit
      })
      return { items: messages, total, page }
    }
  },

  '/sessions/:sessionId/messages/:messageId': {
    DELETE: async ({ params }) => {
      await sessionMessageService.deleteSessionMessage(params.sessionId, params.messageId)
      return undefined
    }
  },

  '/sessions/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await sessionService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/sessions/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await sessionService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
