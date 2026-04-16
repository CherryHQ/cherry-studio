import type { Painting } from '@shared/data/types/painting'
import { PaintingFilesSchema, PaintingModeSchema, PaintingParamsSchema } from '@shared/data/types/painting'
import * as z from 'zod'

export const PAINTINGS_DEFAULT_LIMIT = 20
export const PAINTINGS_MAX_LIMIT = 100
export const PAINTINGS_DEFAULT_OFFSET = 0

const OptionalTrimmedStringSchema = z.string().trim().min(1)
const OptionalNullableTrimmedStringSchema = OptionalTrimmedStringSchema.nullable()

export const ListPaintingsQuerySchema = z.object({
  providerId: OptionalTrimmedStringSchema.optional(),
  mode: PaintingModeSchema.optional(),
  parentId: OptionalTrimmedStringSchema.optional(),
  limit: z.int().positive().max(PAINTINGS_MAX_LIMIT).default(PAINTINGS_DEFAULT_LIMIT),
  offset: z.int().min(PAINTINGS_DEFAULT_OFFSET).default(PAINTINGS_DEFAULT_OFFSET)
})
export type ListPaintingsQueryParams = z.input<typeof ListPaintingsQuerySchema>
export type ListPaintingsQuery = z.output<typeof ListPaintingsQuerySchema>

export const CreatePaintingSchema = z
  .object({
    id: OptionalTrimmedStringSchema.optional(),
    providerId: OptionalTrimmedStringSchema,
    mode: PaintingModeSchema,
    model: OptionalNullableTrimmedStringSchema.optional(),
    prompt: z.string().optional(),
    params: PaintingParamsSchema.optional(),
    files: PaintingFilesSchema.optional(),
    parentId: OptionalNullableTrimmedStringSchema.optional()
  })
  .strict()
export type CreatePaintingDto = z.infer<typeof CreatePaintingSchema>

export const UpdatePaintingSchema = z
  .object({
    model: OptionalNullableTrimmedStringSchema.optional(),
    prompt: z.string().optional(),
    params: PaintingParamsSchema.optional(),
    files: PaintingFilesSchema.optional(),
    parentId: OptionalNullableTrimmedStringSchema.optional()
  })
  .strict()
export type UpdatePaintingDto = z.infer<typeof UpdatePaintingSchema>

export const ReorderPaintingsSchema = z
  .object({
    orderedIds: z.array(OptionalTrimmedStringSchema).min(1)
  })
  .strict()
export type ReorderPaintingsDto = z.infer<typeof ReorderPaintingsSchema>

export interface PaintingListResponse {
  items: Painting[]
  total: number
  limit: number
  offset: number
}

export interface PaintingsSchemas {
  '/paintings': {
    GET: {
      query?: ListPaintingsQueryParams
      response: PaintingListResponse
    }
    POST: {
      body: CreatePaintingDto
      response: Painting
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

  '/paintings/reorder': {
    POST: {
      body: ReorderPaintingsDto
      response: { reorderedCount: number }
    }
  }
}
