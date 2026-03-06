/**
 * Model configuration schema definitions
 * Defines the structure for model metadata, capabilities, and configurations
 */

import * as z from 'zod'

import {
  CurrencySchema,
  MetadataSchema,
  ModelIdSchema,
  NumericRangeSchema,
  PricePerTokenSchema,
  VersionSchema
} from './common'
import { MODALITY, MODEL_CAPABILITY, objectValues } from './enums'

export const ModalitySchema = z.enum(objectValues(MODALITY))
export type ModalityType = z.infer<typeof ModalitySchema>

export const ModelCapabilityTypeSchema = z.enum(objectValues(MODEL_CAPABILITY))
export type ModelCapabilityType = z.infer<typeof ModelCapabilityTypeSchema>

// Thinking token limits schema (shared across reasoning types)
export const ThinkingTokenLimitsSchema = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().positive().optional(),
  default: z.number().nonnegative().optional()
})

/** Reasoning effort levels shared across providers */
export const ReasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

// Common reasoning fields shared across all reasoning type variants
// Exported for shared/runtime types to reuse
export const CommonReasoningFieldsSchema = {
  thinkingTokenLimits: ThinkingTokenLimitsSchema.optional(),
  supportedEfforts: z.array(ReasoningEffortSchema).optional(),
  interleaved: z.boolean().optional()
}

const commonReasoningFields = CommonReasoningFieldsSchema

// Reasoning configuration
export const ReasoningSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('openai-chat'),
    params: z
      .object({
        reasoningEffort: ReasoningEffortSchema.optional()
      })
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('openai-responses'),
    params: z
      .object({
        reasoning: z.object({
          effort: ReasoningEffortSchema.optional(),
          summary: z.enum(['auto', 'concise', 'detailed']).optional()
        })
      })
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('anthropic'),
    params: z
      .object({
        type: z.union([z.literal('enabled'), z.literal('disabled'), z.literal('adaptive')]),
        budgetTokens: z.number().optional(),
        effort: ReasoningEffortSchema.optional()
      })
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('gemini'),
    params: z
      .union([
        z
          .object({
            thinkingConfig: z.object({
              includeThoughts: z.boolean().optional(),
              thinkingBudget: z.number().optional()
            })
          })
          .optional(),
        z
          .object({
            thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional()
          })
          .optional()
      ])
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('openrouter'),
    params: z
      .object({
        reasoning: z
          .object({
            effort: z
              .union([
                z.literal('none'),
                z.literal('minimal'),
                z.literal('low'),
                z.literal('medium'),
                z.literal('high')
              ])
              .optional(),
            maxTokens: z.number().optional(),
            exclude: z.boolean().optional()
          })
          .refine(
            (v) => v.effort == null || v.maxTokens == null,
            'Only one of effort or maxTokens can be specified, not both'
          )
      })
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('qwen'),
    params: z
      .object({
        enableThinking: z.boolean(),
        thinkingBudget: z.number().optional()
      })
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('doubao'),
    params: z
      .object({
        thinking: z.object({
          type: z.union([z.literal('enabled'), z.literal('disabled'), z.literal('auto')])
        })
      })
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('dashscope'),
    params: z
      .object({
        enableThinking: z.boolean(),
        incrementalOutput: z.boolean().optional()
      })
      .optional(),
    ...commonReasoningFields
  }),
  z.object({
    type: z.literal('self-hosted'),
    params: z
      .object({
        chatTemplateKwargs: z.object({
          enableThinking: z.boolean().optional(),
          thinking: z.boolean().optional()
        })
      })
      .optional(),
    ...commonReasoningFields
  })
])

// Parameter support configuration
export const ParameterSupportSchema = z.object({
  temperature: z
    .object({
      supported: z.boolean(),
      range: NumericRangeSchema.optional()
    })
    .optional(),

  topP: z
    .object({
      supported: z.boolean(),
      range: NumericRangeSchema.optional()
    })
    .optional(),

  topK: z
    .object({
      supported: z.boolean(),
      range: NumericRangeSchema.optional()
    })
    .optional(),

  frequencyPenalty: z.boolean().optional(),
  presencePenalty: z.boolean().optional(),
  maxTokens: z.boolean().optional(),
  stopSequences: z.boolean().optional(),
  systemMessage: z.boolean().optional(),

  /**
   * Groups of parameter names that cannot be specified simultaneously.
   * e.g. [["temperature", "topP"]] means only one can be set at a time (Claude, etc.)
   */
  mutuallyExclusive: z.array(z.array(z.string())).optional()
})

// Model pricing configuration
export const ModelPricingSchema = z.object({
  input: PricePerTokenSchema,
  output: PricePerTokenSchema,

  cacheRead: PricePerTokenSchema.optional(),
  cacheWrite: PricePerTokenSchema.optional(),

  perImage: z
    .object({
      price: z.number(),
      currency: CurrencySchema,
      unit: z.enum(['image', 'pixel']).optional()
    })
    .optional(),

  perMinute: z
    .object({
      price: z.number(),
      currency: CurrencySchema
    })
    .optional()
})

// Model configuration schema
export const ModelConfigSchema = z.object({
  // Basic information
  id: ModelIdSchema,
  name: z.string().optional(),
  description: z.string().optional(),

  // Capabilities
  capabilities: z
    .array(ModelCapabilityTypeSchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Capabilities must be unique'
    })
    .optional(),

  // Modalities
  inputModalities: z
    .array(ModalitySchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Input modalities must be unique'
    })
    .optional(),
  outputModalities: z
    .array(ModalitySchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Output modalities must be unique'
    })
    .optional(),

  // Limits
  contextWindow: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  maxInputTokens: z.number().optional(),

  // Pricing
  pricing: ModelPricingSchema.optional(),

  // Reasoning configuration
  reasoning: ReasoningSchema.optional(),

  // Parameter support
  parameterSupport: ParameterSupportSchema.optional(),

  // Model family (e.g., "GPT-4", "Claude 3")
  family: z.string().optional(),

  // Original creator of the model (e.g., "anthropic", "google", "openai")
  // This is the original publisher/creator, not the aggregator that hosts the model
  ownedBy: z.string().optional(),

  // Whether the model has open weights (from models.dev)
  openWeights: z.boolean().optional(),

  // Date version variants (same capabilities, different snapshots)
  // Example: gpt-4-turbo's variants: ["gpt-4-turbo-2024-04-09", "gpt-4-turbo-2024-01-25"]
  alias: z.array(ModelIdSchema).optional(),

  // Additional metadata
  metadata: MetadataSchema
})

// Model list container schema for JSON files
export const ModelListSchema = z.object({
  version: VersionSchema,
  models: z.array(ModelConfigSchema)
})

export type ThinkingTokenLimits = z.infer<typeof ThinkingTokenLimitsSchema>
export type Reasoning = z.infer<typeof ReasoningSchema>
export type ParameterSupport = z.infer<typeof ParameterSupportSchema>
export type ModelPricing = z.infer<typeof ModelPricingSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ModelList = z.infer<typeof ModelListSchema>
