/**
 * Client-only model list pull preview shapes (Zod + inferred types).
 * No DataApi route; keep out of @shared to avoid implying a main-process contract.
 */

import { ModelSyncReferenceImpactSchema } from '@shared/data/api/schemas/providers'
import { ModelSchema, UniqueModelIdSchema } from '@shared/data/types/model'
import * as z from 'zod'

/** Client-only: optional catalog preset trace for sync diff (not on shared `Model`). */
export const ModelSyncPreviewModelSchema = ModelSchema.extend({
  presetModelId: z.string().nullable().optional()
})
export type ModelSyncPreviewModel = z.infer<typeof ModelSyncPreviewModelSchema>

export const ModelSyncReplacementSuggestionSchema = z.strictObject({
  uniqueModelId: UniqueModelIdSchema,
  replacement: UniqueModelIdSchema.optional()
})
export type ModelSyncReplacementSuggestion = z.infer<typeof ModelSyncReplacementSuggestionSchema>

export const ModelSyncPreviewMissingItemSchema = z.strictObject({
  model: ModelSyncPreviewModelSchema,
  assistantCount: z.number().int().nonnegative(),
  knowledgeCount: z.number().int().nonnegative(),
  preferenceReferences: z.array(z.string()),
  strongReferenceCount: z.number().int().nonnegative(),
  replacement: UniqueModelIdSchema.optional()
})
export type ModelSyncPreviewMissingItem = z.infer<typeof ModelSyncPreviewMissingItemSchema>

export const ModelSyncReferenceSummarySchema = z.strictObject({
  impactedModelCount: z.number().int().nonnegative(),
  totalStrongReferences: z.number().int().nonnegative(),
  items: z.array(ModelSyncReferenceImpactSchema)
})
export type ModelSyncReferenceSummary = z.infer<typeof ModelSyncReferenceSummarySchema>

export const ModelSyncPreviewResponseSchema = z.strictObject({
  added: z.array(ModelSyncPreviewModelSchema),
  missing: z.array(ModelSyncPreviewMissingItemSchema),
  referenceSummary: ModelSyncReferenceSummarySchema,
  replacementSuggestions: z.array(ModelSyncReplacementSuggestionSchema)
})
export type ModelSyncPreviewResponse = z.infer<typeof ModelSyncPreviewResponseSchema>
