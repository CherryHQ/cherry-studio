import type { Painting } from '@shared/data/types/painting'
import { PaintingFilesSchema } from '@shared/data/types/painting'
import * as z from 'zod'

import type { CursorPaginationParams, CursorPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'

export const PAINTINGS_DEFAULT_LIMIT = 20
export const PAINTINGS_MAX_LIMIT = 100

const TrimmedStringSchema = z.string().trim().min(1)
const OptionalNullableTrimmedStringSchema = TrimmedStringSchema.nullable()

export const ListPaintingsQuerySchema = z
  .object({
    providerId: TrimmedStringSchema.optional(),
    /** true = list the trash (archived paintings only); omitted/false = active only. */
    inTrash: z.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.int().positive().max(PAINTINGS_MAX_LIMIT).default(PAINTINGS_DEFAULT_LIMIT)
  })
  .strict()
export type ListPaintingsQueryParams = z.input<typeof ListPaintingsQuerySchema>
export type ListPaintingsQuery = z.output<typeof ListPaintingsQuerySchema> & CursorPaginationParams

export const CreatePaintingSchema = z
  .object({
    id: TrimmedStringSchema.optional(),
    providerId: TrimmedStringSchema,
    modelId: OptionalNullableTrimmedStringSchema.optional(),
    prompt: z.string(),
    files: PaintingFilesSchema
  })
  .strict()
export type CreatePaintingDto = z.infer<typeof CreatePaintingSchema>

export const UpdatePaintingSchema = z
  .object({
    providerId: TrimmedStringSchema.optional(),
    modelId: OptionalNullableTrimmedStringSchema.optional(),
    prompt: z.string().optional(),
    files: PaintingFilesSchema.optional()
  })
  .strict()
export type UpdatePaintingDto = z.infer<typeof UpdatePaintingSchema>

export const DeletePaintingQuerySchema = z.strictObject({
  /**
   * true = hard-delete the DB row (skips/empties the trash; `painting_file_ref`
   * rows are removed by the FK cascade). Omitted/false archives the painting
   * into the trash (soft delete, restorable via POST /paintings/:id/restore).
   */
  permanent: z.boolean().optional()
})
export type DeletePaintingQueryParams = z.input<typeof DeletePaintingQuerySchema>

export interface PaintingListResponse extends CursorPaginationResponse<Painting> {
  items: Painting[]
  total: number
}

export type PaintingsSchemas = {
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
      query?: DeletePaintingQueryParams
      response: void
    }
  }

  '/paintings/:id/restore': {
    POST: {
      params: { id: string }
      response: Painting
    }
  }
} & OrderEndpoints<'/paintings'>
