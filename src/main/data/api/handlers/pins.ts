/**
 * Pin API Handlers
 *
 * Implements all pin-related API endpoints:
 * - Pin CRUD (list by entityType, idempotent pin, get, unpin)
 * - Scoped reorder (single + batch)
 *
 * All input validation happens here at the system boundary. Business logic —
 * scope inference, orderKey computation, concurrency handling — lives in
 * PinService.
 */

import { pinService } from '@data/services/PinService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import { CreatePinSchema, ListPinsQuerySchema, PinIdSchema, type PinSchemas } from '@shared/data/api/schemas/pins'

export const pinHandlers: HandlersFor<PinSchemas> = {
  '/pins': {
    GET: async ({ query }) => {
      const parsed = ListPinsQuerySchema.parse(query)
      return await pinService.listByEntityType(parsed.entityType)
    },

    POST: async ({ body }) => {
      const parsed = CreatePinSchema.parse(body)
      return await pinService.pin(parsed)
    }
  },

  '/pins/:id': {
    GET: async ({ params }) => {
      const id = PinIdSchema.parse(params.id)
      return await pinService.getById(id)
    },

    DELETE: async ({ params }) => {
      const id = PinIdSchema.parse(params.id)
      await pinService.unpin(id)
      return undefined
    }
  },

  '/pins/:id/order': {
    PATCH: async ({ params, body }) => {
      const id = PinIdSchema.parse(params.id)
      const anchor = OrderRequestSchema.parse(body)
      await pinService.reorder(id, anchor)
      return undefined
    }
  },

  '/pins/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await pinService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
