import * as z from 'zod'

import { UniqueModelIdSchema } from '@shared/data/types/model'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

export const ModelSettingsUpdateSchema = z.strictObject({
  modelId: UniqueModelIdSchema,
  settings: z.strictObject({
    enableWebSearch: z.boolean().optional(),
    reasoning_effort: ReasoningEffortOptionSchema.optional()
  })
})
