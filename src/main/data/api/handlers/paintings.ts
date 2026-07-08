import { paintingService } from '@data/services/PaintingService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { PaintingsSchemas } from '@shared/data/api/schemas/paintings'
import {
  CreatePaintingSchema,
  ListPaintingsQuerySchema,
  UpdatePaintingSchema
} from '@shared/data/api/schemas/paintings'
import type { HandlersFor } from '@shared/data/api/types'

export const paintingHandlers: HandlersFor<PaintingsSchemas> = {
  '/paintings': {
    GET: async ({ query }) => {
      const parsed = ListPaintingsQuerySchema.parse(query ?? {})
      return paintingService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreatePaintingSchema.parse(body)
      return paintingService.create(parsed)
    }
  },

  '/paintings/:id': {
    GET: async ({ params }) => {
      return paintingService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdatePaintingSchema.parse(body)
      return paintingService.update(params.id, parsed)
    },
    DELETE: async ({ params }) => {
      paintingService.delete(params.id)
      return undefined
    }
  },

  '/paintings/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      paintingService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/paintings/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      paintingService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
