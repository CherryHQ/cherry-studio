import * as z from 'zod'

import { ImageGenerationSupportSchema } from '@cherrystudio/provider-registry'

export const resolvedImageGenerationSupportSchema = ImageGenerationSupportSchema.extend({
  inputCapabilities: z.object({
    files: z.boolean().optional(),
    mask: z.boolean().optional()
  })
})

export type ResolvedImageGenerationSupport = z.infer<typeof resolvedImageGenerationSupportSchema>
