import * as z from 'zod'

import { defineRoute } from '../define'

/** Typed question kinds accepted by the OpenRouter Decisions API (alpha). */
export const DECISION_QUESTION_TYPES = ['noul', 'choice', 'score', 'box'] as const

/** Typed answer kinds returned by the OpenRouter Decisions API (alpha). */
export const DECISION_ANSWER_TYPES = ['noul', 'choice', 'score', 'box', 'refusal'] as const

/** A plain string, or a JSON object or array of structured guidance. */
const GuidanceSchema = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
const NullableGuidanceSchema = GuidanceSchema.nullable()

/**
 * One Decisions question, discriminated by `type`. Questions travel as a map
 * keyed by question ID, so the ID never appears inside the question itself.
 * Shapes follow the official OpenAPI examples: `noul` needs only `type`,
 * `choice`/`score` add a required `criteria`, `box` requires `instructions`.
 */
export const DecisionQuestionSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('noul'),
    instructions: NullableGuidanceSchema.optional(),
    criteria: z
      .looseObject({
        true: NullableGuidanceSchema.optional(),
        false: NullableGuidanceSchema.optional()
      })
      .optional()
  }),
  z.looseObject({
    type: z.literal('choice'),
    instructions: NullableGuidanceSchema.optional(),
    criteria: z.record(z.string(), NullableGuidanceSchema)
  }),
  z.looseObject({
    type: z.literal('score'),
    instructions: NullableGuidanceSchema.optional(),
    criteria: z.array(GuidanceSchema).min(1)
  }),
  z.looseObject({
    type: z.literal('box'),
    instructions: GuidanceSchema
  })
])

export const DecisionsRequestSchema = z.strictObject({
  model: z.string().min(1),
  state: z.unknown(),
  questions: z
    .record(z.string().min(1), DecisionQuestionSchema)
    .refine((questions) => Object.keys(questions).length > 0, { message: 'At least one question is required' })
})

/** One Decisions answer, discriminated by `type`; values are keyed by question ID in `answers`. */
export const DecisionAnswerSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('noul'), noul: z.number() }),
  z.looseObject({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: z.number().optional(),
    probabilities: z.record(z.string(), z.number()).optional()
  }),
  z.looseObject({
    type: z.literal('score'),
    score: z.number(),
    confidence: z.number().optional(),
    legend: z.record(z.string(), GuidanceSchema).optional(),
    probabilities: z.record(z.string(), z.number()).optional()
  }),
  z.looseObject({
    type: z.literal('box'),
    box: z.strictObject({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() }),
    confidence: z.number().optional()
  }),
  z.looseObject({ type: z.literal('refusal') })
])

const DecisionsUsageSchema = z.looseObject({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cost: z.number().optional(),
  is_byok: z.boolean().optional()
})

/**
 * Decisions response envelope. `answers` is a map keyed by question ID with
 * type-specific value fields; the envelope also carries `id`, `model`,
 * `provider`, `usage` and optional `annotations`. Loose so providers may add
 * metadata without breaking parsing.
 */
export const DecisionsResponseSchema = z.looseObject({
  answers: z.record(z.string(), DecisionAnswerSchema),
  id: z.string().optional(),
  model: z.string(),
  provider: z.string().optional(),
  usage: DecisionsUsageSchema,
  annotations: z.array(z.unknown()).optional()
})

export type DecisionsRequest = z.infer<typeof DecisionsRequestSchema>
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>
export type DecisionsResponse = z.infer<typeof DecisionsResponseSchema>

/** Decisions IPC schema — calls OpenRouter `POST /api/alpha/decisions` from the main process. */
export const decisionsRequestSchemas = {
  'decisions.create': defineRoute({
    input: DecisionsRequestSchema,
    output: DecisionsResponseSchema
  })
}
