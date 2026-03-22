import { WEB_SEARCH_PROVIDER_IDS } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

const WebSearchQuestionSchema = z.string().trim().min(1, {
  message: 'Question cannot be empty'
})

export const WebSearchRequestSchema = z
  .object({
    providerId: z.enum(WEB_SEARCH_PROVIDER_IDS),
    questions: z.array(WebSearchQuestionSchema),
    requestId: z.string().min(1)
  })
  .strict()
