import { creationService } from '@data/services/CreationService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreationsSchemas } from '@shared/data/api/schemas/creations'
import {
  CreateCreationSchema,
  ListCreationsQuerySchema,
  UpdateCreationSchema
} from '@shared/data/api/schemas/creations'
import type { HandlersFor } from '@shared/data/api/types'

export const creationHandlers: HandlersFor<CreationsSchemas> = {
  '/creations': {
    GET: async ({ query }) => {
      const parsed = ListCreationsQuerySchema.parse(query ?? {})
      return creationService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreateCreationSchema.parse(body)
      return creationService.create(parsed)
    }
  },

  '/creations/:id': {
    GET: async ({ params }) => {
      return creationService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateCreationSchema.parse(body)
      return creationService.update(params.id, parsed)
    },
    DELETE: async ({ params }) => {
      creationService.delete(params.id)
      return undefined
    }
  },

  '/creations/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      creationService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/creations/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      creationService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
