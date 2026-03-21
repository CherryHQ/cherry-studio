import { WEB_SEARCH_PROVIDER_IDS } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

const WebSearchQuestionSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Question cannot be empty'
})

export const WebSearchQueryInputSchema = z
  .object({
    question: z.array(WebSearchQuestionSchema)
  })
  .strict()

export const WebSearchRequestSchema = z
  .object({
    providerId: z.enum(WEB_SEARCH_PROVIDER_IDS),
    input: WebSearchQueryInputSchema,
    requestId: z.string().min(1)
  })
  .strict()
