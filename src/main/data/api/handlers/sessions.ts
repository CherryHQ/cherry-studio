/**
 * Session domain API handlers.
 *
 * Sessions are pure agent instances. Cognitive config (model / instructions /
 * mcps / allowedTools / configuration) lives on the parent agent and is
 * fetched separately; the selected workspace is exposed as a normalized
 * session relation.
 */

import { agentSessionMessageService as sessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  CreateSessionSchema,
  ListSessionsQuerySchema,
  SessionMessagesListQuerySchema,
  type SessionSchemas,
  UpdateSessionSchema
} from '@shared/data/api/schemas/sessions'

export const sessionHandlers: HandlersFor<SessionSchemas> = {
  '/sessions': {
    GET: async ({ query }) => {
      const parsed = ListSessionsQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.listByCursor(parsed.data)
    },

    POST: async ({ body }) => {
      const parsed = CreateSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.createSession(parsed.data)
    }
  },

  '/sessions/:sessionId': {
    GET: async ({ params }) => {
      return await agentSessionService.getById(params.sessionId)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateSessionSchema.safeParse(body)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await agentSessionService.update(params.sessionId, parsed.data)
    },

    DELETE: async ({ params }) => {
      await agentSessionService.delete(params.sessionId)
      return undefined
    }
  },

  '/sessions/:sessionId/messages': {
    GET: async ({ params, query }) => {
      const parsed = SessionMessagesListQuerySchema.safeParse(query ?? {})
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await sessionMessageService.listSessionMessages(params.sessionId, parsed.data)
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
      await agentSessionService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/sessions/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await agentSessionService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
