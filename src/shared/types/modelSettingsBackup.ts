import * as z from 'zod'

import { CreateModelSchema } from '@shared/data/api/schemas/models'
import { CreateProviderSchema } from '@shared/data/api/schemas/providers'

export const MODEL_SETTINGS_FORMAT = 'cherry-studio-model-settings' as const
export const MODEL_SETTINGS_VERSION = 1 as const
export const MODEL_SETTINGS_MAX_FILE_BYTES = 10 * 1024 * 1024

const ExportedProviderSchema = CreateProviderSchema.omit({ logo: true }).extend({
  isEnabled: z.boolean().optional()
})

const ExportedModelSchema = CreateModelSchema.extend({
  isEnabled: z.boolean().optional(),
  isHidden: z.boolean().optional()
})

export const ModelSettingsDocumentSchema = z.strictObject({
  format: z.literal(MODEL_SETTINGS_FORMAT),
  version: z.literal(MODEL_SETTINGS_VERSION),
  exportedAt: z.number().int().nonnegative(),
  providers: z.array(ExportedProviderSchema),
  models: z.array(ExportedModelSchema)
})
export type ModelSettingsDocument = z.infer<typeof ModelSettingsDocumentSchema>

export const ModelSettingsDecisionSchema = z.enum(['replace', 'skip'])
export type ModelSettingsDecision = z.infer<typeof ModelSettingsDecisionSchema>

/** Keyed by `provider:<providerId>` or `model:<uniqueModelId>`; unlisted conflicts are skipped. */
export const ModelSettingsConflictSchema = z.object({
  key: z.string(),
  kind: z.enum(['provider', 'model']),
  label: z.string()
})
export type ModelSettingsConflict = z.infer<typeof ModelSettingsConflictSchema>

export const ModelSettingsImportPreviewSchema = z.object({
  document: ModelSettingsDocumentSchema,
  conflicts: z.array(ModelSettingsConflictSchema)
})
export type ModelSettingsImportPreview = z.infer<typeof ModelSettingsImportPreviewSchema>

export const ModelSettingsImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
  replaced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.array(
    z.object({
      kind: z.enum(['provider', 'model']),
      id: z.string(),
      reason: z.string()
    })
  )
})
export type ModelSettingsImportResult = z.infer<typeof ModelSettingsImportResultSchema>
