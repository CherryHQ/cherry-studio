import type { Painting } from '@shared/data/types/painting'
import {
  PaintingFilesSchema,
  PaintingMediaTypeSchema,
  PaintingModeSchema,
  PaintingParamsSchema
} from '@shared/data/types/painting'
import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const PAINTINGS_DEFAULT_LIMIT = 20
export const PAINTINGS_MAX_LIMIT = 100
export const PAINTINGS_DEFAULT_OFFSET = 0

const OptionalTrimmedStringSchema = z.string().trim().min(1)
const OptionalNullableTrimmedStringSchema = OptionalTrimmedStringSchema.nullable()

export const ListPaintingsQuerySchema = z
  .object({
    providerId: OptionalTrimmedStringSchema.optional(),
    mode: PaintingModeSchema.optional(),
    mediaType: PaintingMediaTypeSchema.optional(),
    limit: z.int().positive().max(PAINTINGS_MAX_LIMIT).default(PAINTINGS_DEFAULT_LIMIT),
    offset: z.int().min(PAINTINGS_DEFAULT_OFFSET).default(PAINTINGS_DEFAULT_OFFSET)
  })
  .strict()
export type ListPaintingsQueryParams = z.input<typeof ListPaintingsQuerySchema>
export type ListPaintingsQuery = z.output<typeof ListPaintingsQuerySchema>

export const CreatePaintingSchema = z
  .object({
    id: OptionalTrimmedStringSchema.optional(),
    providerId: OptionalTrimmedStringSchema,
    modelId: OptionalNullableTrimmedStringSchema.optional(),
    mode: PaintingModeSchema,
    mediaType: PaintingMediaTypeSchema,
    prompt: z.string(),
    params: PaintingParamsSchema,
    files: PaintingFilesSchema
  })
  .strict()
export type CreatePaintingDto = z.infer<typeof CreatePaintingSchema>

export const UpdatePaintingSchema = z
  .object({
    providerId: OptionalTrimmedStringSchema.optional(),
    modelId: OptionalNullableTrimmedStringSchema.optional(),
    mode: PaintingModeSchema.optional(),
    mediaType: PaintingMediaTypeSchema.optional(),
    prompt: z.string().optional(),
    params: PaintingParamsSchema.optional(),
    files: PaintingFilesSchema.optional()
  })
  .strict()
export type UpdatePaintingDto = z.infer<typeof UpdatePaintingSchema>

export interface PaintingListResponse {
  items: Painting[]
  total: number
  limit: number
  offset: number
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
      response: void
    }
  }
} & OrderEndpoints<'/paintings'>
