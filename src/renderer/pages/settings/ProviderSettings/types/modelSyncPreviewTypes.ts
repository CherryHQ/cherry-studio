/**
 * Client-only model list pull preview shapes (Zod + inferred types).
 * No DataApi route; keep out of @shared to avoid implying a main-process contract.
 */

import { ModelSchema } from '@shared/data/types/model'
import * as z from 'zod'

export const ModelSyncPreviewModelSchema = ModelSchema
export type ModelSyncPreviewModel = z.infer<typeof ModelSyncPreviewModelSchema>

export const ModelSyncPreviewMissingItemSchema = z.strictObject({
  model: ModelSyncPreviewModelSchema,
  removalReason: z.enum(['missing_from_provider'])
})
export type ModelSyncPreviewMissingItem = z.infer<typeof ModelSyncPreviewMissingItemSchema>

export const ModelSyncPreviewResponseSchema = z.strictObject({
  added: z.array(ModelSyncPreviewModelSchema),
  missing: z.array(ModelSyncPreviewMissingItemSchema)
})
export type ModelSyncPreviewResponse = z.infer<typeof ModelSyncPreviewResponseSchema>
