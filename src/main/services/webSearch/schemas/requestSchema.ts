import { WebSearchProviderIdSchema } from '@shared/data/presets/web-search-providers'
import * as z from 'zod'

const WebSearchQuestionSchema = z.string().trim().min(1, {
  message: 'Question cannot be empty'
})

export const WebSearchRequestSchema = z
  .object({
    providerId: WebSearchProviderIdSchema,
    questions: z.array(WebSearchQuestionSchema).min(1, {
      message: 'At least one question is required'
    }),
    requestId: z.string().min(1)
  })
  .strict()
