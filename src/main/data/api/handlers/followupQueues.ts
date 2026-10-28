/**
 * Follow-up queue API handlers.
 *
 * All input validation happens here at the system boundary. Business logic —
 * limit enforcement, orderKey computation, claim arbitration — lives in
 * FollowupQueueService.
 */

import { followupQueueService } from '@data/services/FollowupQueueService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  ClaimFollowupQueueBodySchema,
  ClaimFollowupQueueHeadSchema,
  CreateFollowupQueueSchema,
  FollowupQueueScopeQuerySchema,
  FollowupQueueSettlementBodySchema,
  SetFollowupQueueStateSchema,
  RemoveFollowupQueueSchema,
  type FollowupQueueSchemas
} from '@shared/data/api/schemas/followupQueues'
import type { HandlersFor } from '@shared/data/api/types'

export const followupQueueHandlers: HandlersFor<FollowupQueueSchemas> = {
  '/followup-queues': {
    GET: async ({ query }) => {
      const parsed = FollowupQueueScopeQuerySchema.parse(query)
      return followupQueueService.listByScope(parsed.scopeKey)
    },

    POST: async ({ body }) => {
      const parsed = CreateFollowupQueueSchema.parse(body)
      return followupQueueService.enqueue(parsed)
    }
  },

  '/followup-queues/:id': {
    DELETE: async ({ params, body }) => {
      const parsed = RemoveFollowupQueueSchema.parse(body ?? {})
      followupQueueService.remove(params.id, parsed.transferHeldId)
      return undefined
    }
  },

  '/followup-queues/:id/claim': {
    POST: async ({ params, body }) => {
      const parsed = ClaimFollowupQueueBodySchema.parse(body)
      return followupQueueService.claim(params.id, parsed.claimToken, parsed.completionAt)
    }
  },

  '/followup-queues/:id/fail': {
    POST: async ({ params, body }) => {
      const parsed = FollowupQueueSettlementBodySchema.parse(body)
      followupQueueService.markFailed(params.id, parsed.claimToken)
      return undefined
    }
  },

  '/followup-queues/:id/sent': {
    POST: async ({ params, body }) => {
      const parsed = FollowupQueueSettlementBodySchema.parse(body)
      followupQueueService.markSent(params.id, parsed.claimToken)
      return undefined
    }
  },

  '/followup-queues/:id/heartbeat': {
    POST: async ({ params, body }) => {
      const parsed = FollowupQueueSettlementBodySchema.parse(body)
      return followupQueueService.heartbeat(params.id, parsed.claimToken)
    }
  },

  '/followup-queues/claim:head': {
    POST: async ({ body }) => {
      const parsed = ClaimFollowupQueueHeadSchema.parse(body)
      return followupQueueService.claimHead(parsed.scopeKey, parsed.claimToken, parsed.completionAt)
    }
  },

  '/followup-queue-states': {
    GET: async ({ query }) => {
      const parsed = FollowupQueueScopeQuerySchema.parse(query)
      return followupQueueService.getState(parsed.scopeKey)
    },

    PUT: async ({ body }) => {
      const parsed = SetFollowupQueueStateSchema.parse(body)
      return followupQueueService.setPaused(parsed.scopeKey, parsed.paused)
    }
  },

  '/followup-queues/:id/order': {
    PATCH: async ({ params, body }) => {
      const anchor = OrderRequestSchema.parse(body)
      followupQueueService.reorder(params.id, anchor)
      return undefined
    }
  },

  '/followup-queues/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      followupQueueService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
