import type { Creation } from '@shared/data/types/creation'
import { CreationFilesSchema, CreationKindSchema } from '@shared/data/types/creation'
import * as z from 'zod'

import type { CursorPaginationParams, CursorPaginationResponse } from '../apiTypes'
import type { OrderEndpoints } from './_endpointHelpers'

export const CREATIONS_DEFAULT_LIMIT = 20
export const CREATIONS_MAX_LIMIT = 100

const TrimmedStringSchema = z.string().trim().min(1)
const OptionalNullableTrimmedStringSchema = TrimmedStringSchema.nullable()

export const ListCreationsQuerySchema = z
  .object({
    /** Optional media-kind filter; omit it for the unified Creation gallery. */
    kind: CreationKindSchema.optional(),
    providerId: TrimmedStringSchema.optional(),
    cursor: z.string().optional(),
    limit: z.int().positive().max(CREATIONS_MAX_LIMIT).default(CREATIONS_DEFAULT_LIMIT)
  })
  .strict()
export type ListCreationsQueryParams = z.input<typeof ListCreationsQuerySchema>
export type ListCreationsQuery = z.output<typeof ListCreationsQuerySchema> & CursorPaginationParams

export const CreateCreationSchema = z
  .object({
    id: TrimmedStringSchema.optional(),
    kind: CreationKindSchema,
    providerId: TrimmedStringSchema,
    modelId: OptionalNullableTrimmedStringSchema.optional(),
    prompt: z.string(),
    files: CreationFilesSchema
  })
  .strict()
export type CreateCreationDto = z.infer<typeof CreateCreationSchema>

export const UpdateCreationSchema = z
  .object({
    providerId: TrimmedStringSchema.optional(),
    modelId: OptionalNullableTrimmedStringSchema.optional(),
    prompt: z.string().optional(),
    files: CreationFilesSchema.optional()
  })
  .strict()
export type UpdateCreationDto = z.infer<typeof UpdateCreationSchema>

export interface CreationListResponse extends CursorPaginationResponse<Creation> {
  items: Creation[]
  total: number
}

export type CreationsSchemas = {
  '/creations': {
    GET: {
      query?: ListCreationsQueryParams
      response: CreationListResponse
    }
    POST: {
      body: CreateCreationDto
      response: Creation
    }
  }

  '/creations/:id': {
    GET: {
      params: { id: string }
      response: Creation
    }
    PATCH: {
      params: { id: string }
      body: UpdateCreationDto
      response: Creation
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }
} & OrderEndpoints<'/creations'>
