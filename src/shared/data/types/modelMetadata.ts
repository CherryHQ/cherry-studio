import * as z from 'zod'

import { MODEL_CAPABILITY, objectValues } from '@cherrystudio/provider-registry'

export const ProviderModelMetadataSchema = z.strictObject({
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  capabilities: z.array(z.enum(objectValues(MODEL_CAPABILITY))).optional()
})
export type ProviderModelMetadata = z.infer<typeof ProviderModelMetadataSchema>

/** Independent of the model schema to avoid registry/model import cycles. */
export const ModelMetadataSourceSchema = z.enum(['provider', 'registry', 'user', 'unknown'])
export type ModelMetadataSource = z.infer<typeof ModelMetadataSourceSchema>
export const MODEL_METADATA_FIELDS = ['contextWindow', 'maxOutputTokens', 'capabilities'] as const
export type ModelMetadataField = (typeof MODEL_METADATA_FIELDS)[number]
export const ModelMetadataSourcesSchema = z.object({
  contextWindow: ModelMetadataSourceSchema,
  maxOutputTokens: ModelMetadataSourceSchema,
  capabilities: ModelMetadataSourceSchema
})
export type ModelMetadataSources = z.infer<typeof ModelMetadataSourcesSchema>
