import * as z from 'zod'

import {
  ModelSettingsDecisionSchema,
  ModelSettingsDocumentSchema,
  ModelSettingsImportPreviewSchema,
  ModelSettingsImportResultSchema
} from '@shared/types/modelSettingsBackup'

import { defineRoute } from '../define'

export const modelSettingsRequestSchemas = {
  'model_settings.export': defineRoute({
    input: z.void(),
    output: z.object({ filePath: z.string().nullable() })
  }),
  'model_settings.import_preview': defineRoute({
    input: z.void(),
    output: ModelSettingsImportPreviewSchema.nullable()
  }),
  'model_settings.import_apply': defineRoute({
    input: z.object({
      document: ModelSettingsDocumentSchema,
      decisions: z.record(z.string(), ModelSettingsDecisionSchema)
    }),
    output: ModelSettingsImportResultSchema
  })
}
