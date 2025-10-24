import * as z from 'zod'

import { DbOcrProviderSchema } from './data'
import { OcrProviderSchema } from './provider/base'
import { OcrProviderNameSchema } from './provider/base'
import { OcrProviderIdSchema } from './provider/base'
import { OcrProviderConfigSchema } from './provider/base'

// ==========================================================
//    API layer Types
// ==========================================================

export type ListOcrProvidersQuery = { registered?: boolean }
export const ListOcrProvidersResponseSchema = z.object({
  data: z.array(DbOcrProviderSchema)
})
export type ListOcrProvidersResponse = z.infer<typeof ListOcrProvidersResponseSchema>
export const GetOcrProviderResponseSchema = z.object({
  data: DbOcrProviderSchema
})
export type GetOcrProviderResponse = z.infer<typeof GetOcrProviderResponseSchema>

/**
 * Request payload for updating an OCR provider.
 * Only the following fields are modifiable:
 * - `name`: provider display name
 * - `config`: provider-specific configuration object (all properties optional)
 */
export const UpdateOcrProviderRequestSchema = z.object({
  id: OcrProviderIdSchema,
  name: OcrProviderNameSchema.optional(),
  config: OcrProviderConfigSchema.partial().optional()
})

export type UpdateOcrProviderRequest = z.infer<typeof UpdateOcrProviderRequestSchema>

export const UpdateOcrProviderResponseSchema = z.object({
  data: DbOcrProviderSchema
})

export type UpdateOcrProviderResponse = z.infer<typeof UpdateOcrProviderResponseSchema>

export const CreateOcrProviderRequestSchema = OcrProviderSchema

export type CreateOcrProviderRequest = z.infer<typeof CreateOcrProviderRequestSchema>

export const CreateOcrProviderResponseSchema = z.object({
  data: DbOcrProviderSchema
})

export type CreateOcrProviderResponse = z.infer<typeof CreateOcrProviderResponseSchema>

export const ReplaceOcrProviderRequestSchema = OcrProviderSchema

export type ReplaceOcrProviderRequest = z.infer<typeof ReplaceOcrProviderRequestSchema>

export const ReplaceOcrProviderResponseSchema = z.object({
  data: DbOcrProviderSchema
})

export type ReplaceOcrProviderResponse = z.infer<typeof ReplaceOcrProviderResponseSchema>
