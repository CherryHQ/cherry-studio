import { paintingService } from '@data/services/PaintingService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  CreatePaintingSchema,
  ListPaintingsQuerySchema,
  PaintingFileUsageQuerySchema,
  PaintingIdParamSchema,
  type PaintingSchemas,
  ReorderPaintingsSchema,
  UpdatePaintingSchema
} from '@shared/data/api/schemas/paintings'

export const paintingHandlers: HandlersFor<PaintingSchemas> = {
  '/paintings': {
    GET: async ({ query }) => {
      const parsed = ListPaintingsQuerySchema.parse(query ?? {})
      return await paintingService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreatePaintingSchema.parse(body)
      return await paintingService.create(parsed)
    }
  },

  '/paintings/file-usage': {
    GET: async ({ query }) => {
      const parsed = PaintingFileUsageQuerySchema.parse(query)
      return await paintingService.getFileUsage(parsed.fileEntryId)
    }
  },

  '/paintings/order': {
    PATCH: async ({ body }) => {
      const parsed = ReorderPaintingsSchema.parse(body)
      await paintingService.reorder(parsed)
      return undefined
    }
  },

  '/paintings/:id': {
    GET: async ({ params }) => {
      const id = PaintingIdParamSchema.parse(params.id)
      return await paintingService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = PaintingIdParamSchema.parse(params.id)
      const parsed = UpdatePaintingSchema.parse(body)
      return await paintingService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = PaintingIdParamSchema.parse(params.id)
      await paintingService.delete(id)
      return undefined
    }
  }
}
