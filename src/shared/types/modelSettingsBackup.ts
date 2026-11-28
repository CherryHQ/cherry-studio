import * as z from 'zod'

import { CreateModelSchema } from '@shared/data/api/schemas/models'
import { CreateProviderSchema } from '@shared/data/api/schemas/providers'
import { ENDPOINT_TYPE, objectValues } from '@shared/data/types/model'
import { EndpointConfigOverrideSchema } from '@shared/data/types/provider'

export const MODEL_SETTINGS_FORMAT = 'cherry-studio-model-settings' as const
export const MODEL_SETTINGS_VERSION = 1 as const
export const MODEL_SETTINGS_MAX_FILE_BYTES = 10 * 1024 * 1024

const ExportedProviderSchema = CreateProviderSchema.omit({ logo: true }).extend({
  isEnabled: z.boolean().optional(),
  // Only backups may carry the legacy routing hints of migrated custom relays.
  endpointConfigs: z
    .partialRecord(
      z.enum(objectValues(ENDPOINT_TYPE)),
      EndpointConfigOverrideSchema.extend({
        adapterFamily: z.string().optional()
      })
    )
    .optional()
})

const ExportedModelSchema = CreateModelSchema.extend({
  // Omission preserves a destination override. Null explicitly restores inheritance.
  inputModalities: CreateModelSchema.shape.inputModalities.unwrap().nullable().optional(),
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
  handle: z.string().min(1),
  conflicts: z.array(ModelSettingsConflictSchema)
})
export type ModelSettingsImportPreview = z.infer<typeof ModelSettingsImportPreviewSchema>

export const ModelSettingsImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
  replaced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  warnings: z
    .array(z.object({ kind: z.literal('provider'), id: z.string(), reason: z.literal('adapter_family_dropped') }))
    .optional(),
  failed: z.array(
    z.object({
      kind: z.enum(['provider', 'model']),
      id: z.string(),
      reason: z.string()
    })
  )
})
export type ModelSettingsImportResult = z.infer<typeof ModelSettingsImportResultSchema>
