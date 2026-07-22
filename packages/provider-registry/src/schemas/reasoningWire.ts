import * as z from 'zod'

import { objectValues, REASONING_EFFORT } from './enums'

/** Closed set of leaves the main-process reasoning interpreter may write. */
export const REASONING_WIRE_TARGETS = [
  'reasoningEffort',
  'reasoningSummary',
  'reasoning_effort',
  'reasoning.effort',
  'reasoning.enabled',
  'reasoning.exclude',
  'reasoning.max_tokens',
  'thinking.type',
  'thinking.budget_tokens',
  'thinking.budgetTokens',
  'thinking.display',
  'effort',
  'sendReasoning',
  'enable_thinking',
  'thinking_budget',
  'incremental_output',
  'disable_reasoning',
  'chat_template_kwargs.enable_thinking',
  'chat_template_kwargs.thinking',
  'chat_template_kwargs.thinking_budget',
  'extra_body.google.thinking_config.thinking_budget',
  'extra_body.google.thinking_config.include_thoughts',
  'extra_body.thinking.type',
  'extra_body.thinking_budget',
  'extra_body.reasoning_effort',
  'thinkingConfig.includeThoughts',
  'thinkingConfig.thinkingBudget',
  'thinkingConfig.thinkingLevel',
  'reasoningConfig.type',
  'reasoningConfig.budgetTokens',
  'reasoningConfig.maxReasoningEffort',
  'think'
] as const

export const ReasoningWireTargetSchema = z.enum(REASONING_WIRE_TARGETS)
export type ReasoningWireTarget = z.infer<typeof ReasoningWireTargetSchema>

const ReasoningEffortSchema = z.enum(objectValues(REASONING_EFFORT))

export const ReasoningWireValueSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('literal'), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ source: z.literal('effort') }),
  z.object({ source: z.literal('budget') }),
  z.object({ source: z.literal('assistant-summary') })
])
export type ReasoningWireValue = z.infer<typeof ReasoningWireValueSchema>

export const ReasoningWireOperationSchema = z.object({
  target: ReasoningWireTargetSchema,
  value: ReasoningWireValueSchema
})
export type ReasoningWireOperation = z.infer<typeof ReasoningWireOperationSchema>

const NonBudgetReasoningWireValueSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('literal'), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ source: z.literal('effort') }),
  z.object({ source: z.literal('assistant-summary') })
])

const NonBudgetReasoningWireOperationSchema = z.object({
  target: ReasoningWireTargetSchema,
  value: NonBudgetReasoningWireValueSchema
})

const ReasoningBudgetPolicySchema = z.object({
  min: z.number().nonnegative().optional(),
  autoValue: z.number().optional(),
  clampToMaxTokens: z.boolean().optional(),
  missing: z.discriminatedUnion('type', [
    z.object({ type: z.literal('omit-value') }),
    z.object({ type: z.literal('omit-mode') }),
    z.object({ type: z.literal('fallback'), value: z.number() })
  ])
})

const ReasoningEffortMapSchema = z.partialRecord(ReasoningEffortSchema, ReasoningEffortSchema).optional()

export const ReasoningWireModeSchema = z.union([
  z.object({
    operations: z.array(NonBudgetReasoningWireOperationSchema).min(1),
    effortMap: ReasoningEffortMapSchema
  }),
  z.object({
    operations: z
      .array(ReasoningWireOperationSchema)
      .min(1)
      .refine((operations) => operations.some((operation) => operation.value.source === 'budget'), {
        message: 'reasoning budget mode must contain a budget operation'
      }),
    effortMap: ReasoningEffortMapSchema,
    budget: ReasoningBudgetPolicySchema
  })
])
export type ReasoningWireMode = z.infer<typeof ReasoningWireModeSchema>

export const ReasoningWireProfileSchema = z
  .object({
    /** Endpoint deliberately emits no reasoning parameters. */
    disabled: z.literal(true).optional(),
    default: ReasoningWireModeSchema.optional(),
    off: ReasoningWireModeSchema.optional(),
    auto: ReasoningWireModeSchema.optional(),
    effort: ReasoningWireModeSchema.optional()
  })
  .refine((profile) => profile.disabled === true || profile.default || profile.off || profile.auto || profile.effort, {
    message: 'reasoning wire profile must declare a mode or be disabled'
  })

export type ReasoningWireProfile = z.infer<typeof ReasoningWireProfileSchema>

export const ReasoningFormatWireProfileSchema = z.object({
  wire: ReasoningWireProfileSchema
})
export type ReasoningFormatWireProfile = z.infer<typeof ReasoningFormatWireProfileSchema>
