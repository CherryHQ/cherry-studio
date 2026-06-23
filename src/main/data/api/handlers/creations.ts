import { creationService } from '@data/services/CreationService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreationsSchemas } from '@shared/data/api/schemas/creations'
import {
  CreateCreationSchema,
  ListCreationsQuerySchema,
  UpdateCreationSchema
} from '@shared/data/api/schemas/creations'

export const creationHandlers: HandlersFor<CreationsSchemas> = {
  '/creations': {
    GET: async ({ query }) => {
      const parsed = ListCreationsQuerySchema.parse(query ?? {})
      return await creationService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreateCreationSchema.parse(body)
      return await creationService.create(parsed)
    }
  },

  '/creations/:id': {
    GET: async ({ params }) => {
      return await creationService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateCreationSchema.parse(body)
      return await creationService.update(params.id, parsed)
    },
    DELETE: async ({ params }) => {
      await creationService.delete(params.id)
      return undefined
    }
  },

  '/creations/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await creationService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/creations/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await creationService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
