import { paintingService } from '@data/services/PaintingService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { PaintingsSchemas } from '@shared/data/api/schemas/paintings'
import {
  CreatePaintingSchema,
  ListPaintingsQuerySchema,
  ReorderPaintingsSchema,
  UpdatePaintingSchema
} from '@shared/data/api/schemas/paintings'

type PaintingHandler<Path extends keyof PaintingsSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const paintingHandlers: {
  [Path in keyof PaintingsSchemas]: {
    [Method in keyof PaintingsSchemas[Path]]: PaintingHandler<Path, Method & ApiMethods<Path>>
  }
} = {
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

  '/paintings/:id': {
    GET: async ({ params }) => {
      return await paintingService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdatePaintingSchema.parse(body)
      return await paintingService.update(params.id, parsed)
    },
    DELETE: async ({ params }) => {
      await paintingService.delete(params.id)
      return undefined
    }
  },

  '/paintings/reorder': {
    POST: async ({ body }) => {
      const parsed = ReorderPaintingsSchema.parse(body)
      return await paintingService.reorder(parsed)
    }
  }
}
