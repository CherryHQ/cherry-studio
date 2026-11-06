import * as z from 'zod'

import { defineRoute } from '../define'

/** Typed answer kinds returned by the OpenRouter Decisions API (alpha). */
export const DECISION_ANSWER_TYPES = ['choice', 'noul', 'score'] as const

export const DecisionQuestionSchema = z.looseObject({
  id: z.string().min(1)
})

export const DecisionsRequestSchema = z.strictObject({
  model: z.string().min(1),
  state: z.unknown(),
  questions: z.array(DecisionQuestionSchema).min(1)
})

export const DecisionAnswerSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('choice'), id: z.string(), value: z.string() }),
  z.looseObject({ type: z.literal('noul'), id: z.string(), value: z.unknown() }),
  z.looseObject({ type: z.literal('score'), id: z.string(), value: z.number() })
])

export const DecisionsResponseSchema = z.strictObject({ answers: z.array(DecisionAnswerSchema) })

export type DecisionsRequest = z.infer<typeof DecisionsRequestSchema>
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>
export type DecisionsResponse = z.infer<typeof DecisionsResponseSchema>

/** Decisions IPC schema — calls OpenRouter `POST /api/alpha/decisions` from the main process. */
export const decisionsRequestSchemas = {
  'decisions.create': defineRoute({
    input: DecisionsRequestSchema,
    output: DecisionsResponseSchema
  })
}
