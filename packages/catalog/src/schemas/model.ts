/**
 * Model configuration schema definitions
 * Defines the structure for model metadata, capabilities, and configurations
 */

import * as z from 'zod'

import {
  CurrencySchema,
  MetadataSchema,
  ModelIdSchema,
  PricePerTokenSchema,
  TimestampSchema,
  VersionSchema
} from './common'

// Modality types - supported input/output modalities
export const ModalitySchema = z.enum(['TEXT', 'VISION', 'AUDIO', 'VIDEO', 'VECTOR'])

// Model capability types
export const ModelCapabilityTypeSchema = z.enum([
  'FUNCTION_CALL', // Function calling
  'REASONING', // Reasoning/thinking
  'IMAGE_RECOGNITION', // Image recognition
  'IMAGE_GENERATION', // Image generation
  'AUDIO_RECOGNITION', // Audio recognition
  'AUDIO_GENERATION', // Audio generation
  'EMBEDDING', // Embedding vector generation
  'RERANK', // Text reranking
  'AUDIO_TRANSCRIPT', // Audio transcription
  'VIDEO_RECOGNITION', // Video recognition
  'VIDEO_GENERATION', // Video generation
  'STRUCTURED_OUTPUT', // Structured output
  'FILE_INPUT', // File input support
  'WEB_SEARCH', // Built-in web search
  'CODE_EXECUTION', // Code execution
  'FILE_SEARCH', // File search
  'COMPUTER_USE' // Computer use
])

// Reasoning configuration
export const ReasoningSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('openai-chat'),
    params: z.object({
      reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional()
    })
  }),
  z.object({
    type: z.literal('openai-responses'),
    params: z.object({
      reasoning: z.object({
        effort: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),
        summary: z.enum(['auto', 'concise', 'detailed']).optional()
      })
    })
  }),
  z.object({
    type: z.literal('anthropic'),
    params: z.object({
      type: z.union([z.literal('enabled'), z.literal('disabled')]),
      budgetTokens: z.number().optional()
    })
  }),
  z.object({
    type: z.literal('gemini'),
    params: z.union([
      z
        .object({
          thinking_config: z.object({
            include_thoughts: z.boolean().optional(),
            thinking_budget: z.number().optional()
          })
        })
        .optional(),
      z
        .object({
          thinking_level: z.enum(['low', 'medium', 'high']).optional()
        })
        .optional()
    ])
  }),
  z.object({
    type: z.literal('openrouter'),
    params: z.object({
      reasoning: z
        .object({
          effort: z
            .union([z.literal('none'), z.literal('minimal'), z.literal('low'), z.literal('medium'), z.literal('high')])
            .optional(),
          max_tokens: z.number().optional(),
          exclude: z.boolean().optional()
        })
        .refine((v) => {
          v.effort == null || v.max_tokens == null
        }, 'One of the following (not both)')
    })
  }),
  z.object({
    type: z.literal('qwen'),
    params: z.object({
      enable_thinking: z.boolean(),
      thinking_budget: z.number().optional()
    })
  }),
  z.object({
    type: z.literal('doubao'),
    params: z.object({
      thinking: z.object({
        type: z.union([z.literal('enabled'), z.literal('disabled'), z.literal('auto')])
      })
    })
  }),
  z.object({
    type: z.literal('dashscope'),
    params: z.object({
      enable_thinking: z.boolean(),
      incremental_output: z.boolean().optional()
    })
  }),
  z.object({
    type: z.literal('self-hosted'),
    params: z.object({
      chat_template_kwargs: z.object({
        enable_thinking: z.boolean().optional(),
        thinking: z.boolean().optional()
      })
    })
  })
])

// Parameter support configuration
export const ParameterSupportSchema = z.object({
  temperature: z
    .object({
      supported: z.boolean(),
      min: z.number().min(0).max(2).optional(),
      max: z.number().min(0).max(2).optional(),
      default: z.number().min(0).max(2).optional()
    })
    .optional(),

  topP: z
    .object({
      supported: z.boolean(),
      min: z.number().min(0).max(1).optional(),
      max: z.number().min(0).max(1).optional(),
      default: z.number().min(0).max(1).optional()
    })
    .optional(),

  topK: z
    .object({
      supported: z.boolean(),
      min: z.number().positive().optional(),
      max: z.number().positive().optional()
    })
    .optional(),

  frequencyPenalty: z.boolean().optional(),
  presencePenalty: z.boolean().optional(),
  maxTokens: z.boolean().optional(),
  stopSequences: z.boolean().optional(),
  systemMessage: z.boolean().optional(),
  developerRole: z.boolean().optional()
})

// Model pricing configuration
export const ModelPricingSchema = z.object({
  input: PricePerTokenSchema,
  output: PricePerTokenSchema,

  // Cache pricing (optional) - for providers like AIHubMix, Anthropic, OpenAI
  cache_read: PricePerTokenSchema.optional(),
  cache_write: PricePerTokenSchema.optional(),

  // Image pricing (optional)
  per_image: z
    .object({
      price: z.number(),
      currency: CurrencySchema.default('USD'),
      unit: z.enum(['image', 'pixel']).optional()
    })
    .optional(),

  // Audio/video pricing (optional)
  per_minute: z
    .object({
      price: z.number(),
      currency: CurrencySchema.default('USD')
    })
    .optional()
})

// Model configuration schema
export const ModelConfigSchema = z.object({
  // Basic information
  id: ModelIdSchema,
  name: z.string().optional(),
  owned_by: z.string().optional(),
  description: z.string().optional(),

  // Capabilities (core)
  capabilities: z
    .array(ModelCapabilityTypeSchema)
    .min(1, 'At least one capability is required')
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Capabilities must be unique'
    })
    .optional(),

  // Modalities
  input_modalities: z
    .array(ModalitySchema)
    .min(1, 'At least one input modality is required')
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Input modalities must be unique'
    })
    .optional(),
  output_modalities: z
    .array(ModalitySchema)
    .min(1, 'At least one output modality is required')
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Output modalities must be unique'
    })
    .optional(),

  // Limits
  context_window: z.number().optional(),
  max_output_tokens: z.number().optional(),
  max_input_tokens: z.number().optional(),

  // Pricing
  pricing: ModelPricingSchema.optional(),

  // Reasoning configuration
  reasoning: ReasoningSchema.optional(),

  // Parameter support
  parameters: ParameterSupportSchema.optional(),

  // Endpoint types (will reference provider schema)
  endpoint_types: z.array(z.string()).optional(),

  // Metadata
  release_date: TimestampSchema.optional(),
  deprecation_date: TimestampSchema.optional(),
  replaced_by: ModelIdSchema.optional(),

  // Version control
  version: VersionSchema.optional(),
  compatibility: z
    .object({
      min_version: VersionSchema.optional(),
      max_version: VersionSchema.optional()
    })
    .optional(),

  // Additional metadata
  metadata: MetadataSchema
})

// Model list container schema for JSON files
export const ModelListSchema = z.object({
  version: VersionSchema,
  models: z.array(ModelConfigSchema)
})

// Type exports
export type Modality = z.infer<typeof ModalitySchema>
export type ModelCapabilityType = z.infer<typeof ModelCapabilityTypeSchema>
export type Reasoning = z.infer<typeof ReasoningSchema>
export type ParameterSupport = z.infer<typeof ParameterSupportSchema>
export type ModelPricing = z.infer<typeof ModelPricingSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ModelList = z.infer<typeof ModelListSchema>
