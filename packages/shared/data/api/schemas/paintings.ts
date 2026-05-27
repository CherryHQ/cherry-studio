import type { OffsetPaginationResponse } from '@shared/data/api'
import { type FileEntryId, FileEntryIdSchema } from '@shared/data/types/file'
import {
  type Painting,
  PaintingIdSchema,
  PaintingModeSchema,
  PaintingParamsSchema,
  PaintingProviderSchema
} from '@shared/data/types/painting'
import * as z from 'zod'

export const PAINTINGS_DEFAULT_PAGE = 1
export const PAINTINGS_DEFAULT_LIMIT = 100
export const PAINTINGS_MAX_LIMIT = 5000

export const PaintingIdParamSchema = PaintingIdSchema

export const CreatePaintingSchema = z.strictObject({
  id: PaintingIdSchema.optional(),
  provider: PaintingProviderSchema,
  mode: PaintingModeSchema,
  model: z.string().min(1).optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  status: z.string().min(1).optional(),
  urls: z.array(z.string()).default([]),
  fileEntryIds: z.array(FileEntryIdSchema).default([]),
  params: PaintingParamsSchema.default({})
})
export type CreatePaintingDto = z.input<typeof CreatePaintingSchema>
export type CreatePainting = z.output<typeof CreatePaintingSchema>

export const UpdatePaintingSchema = z
  .strictObject({
    provider: PaintingProviderSchema.optional(),
    mode: PaintingModeSchema.optional(),
    model: z.string().min(1).nullable().optional(),
    prompt: z.string().nullable().optional(),
    negativePrompt: z.string().nullable().optional(),
    status: z.string().min(1).nullable().optional(),
    urls: z.array(z.string()).optional(),
    fileEntryIds: z.array(FileEntryIdSchema).optional(),
    params: PaintingParamsSchema.optional()
  })
  .refine((dto) => Object.keys(dto).length > 0, { message: 'At least one field is required' })
export type UpdatePaintingDto = z.infer<typeof UpdatePaintingSchema>

export const ListPaintingsQuerySchema = z.strictObject({
  provider: PaintingProviderSchema.optional(),
  mode: PaintingModeSchema.optional(),
  status: z.string().min(1).optional(),
  fileEntryId: FileEntryIdSchema.optional(),
  page: z.int().positive().default(PAINTINGS_DEFAULT_PAGE),
  limit: z.int().positive().max(PAINTINGS_MAX_LIMIT).default(PAINTINGS_DEFAULT_LIMIT)
})
export type ListPaintingsQueryParams = z.input<typeof ListPaintingsQuerySchema>
export type ListPaintingsQuery = z.output<typeof ListPaintingsQuerySchema>

export const ReorderPaintingsSchema = z.strictObject({
  provider: PaintingProviderSchema,
  mode: PaintingModeSchema,
  ids: z.array(PaintingIdSchema)
})
export type ReorderPaintingsDto = z.infer<typeof ReorderPaintingsSchema>

export const PaintingFileUsageQuerySchema = z.strictObject({
  fileEntryId: FileEntryIdSchema
})
export type PaintingFileUsageQuery = z.infer<typeof PaintingFileUsageQuerySchema>

export interface PaintingFileUsage {
  fileEntryId: FileEntryId
  paintingIds: string[]
  count: number
}

export type PaintingSchemas = {
  '/paintings': {
    GET: {
      query?: ListPaintingsQueryParams
      response: OffsetPaginationResponse<Painting>
    }
    POST: {
      body: CreatePaintingDto
      response: Painting
    }
  }

  '/paintings/file-usage': {
    GET: {
      query: PaintingFileUsageQuery
      response: PaintingFileUsage
    }
  }

  '/paintings/order': {
    PATCH: {
      body: ReorderPaintingsDto
      response: void
    }
  }

  '/paintings/:id': {
    GET: {
      params: { id: string }
      response: Painting
    }
    PATCH: {
      params: { id: string }
      body: UpdatePaintingDto
      response: Painting
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
