/**
 * Provider configuration schema definitions
 * Defines the structure for provider connections and API configurations
 */

import * as z from 'zod'

import { MetadataSchema, ProviderIdSchema, VersionSchema } from './common'
import { ENDPOINT_TYPE, type EndpointType, GEMINI_THINKING_LEVEL, objectValues, REASONING_EFFORT } from './enums'
import { CommonReasoningFieldsSchema } from './model'

export const EndpointTypeSchema = z.enum(objectValues(ENDPOINT_TYPE))
const endpointTypeValues: readonly string[] = objectValues(ENDPOINT_TYPE)

// ═══════════════════════════════════════════════════════════════════════════════
// API Features
// ═══════════════════════════════════════════════════════════════════════════════

/** API feature flags controlling request construction at the SDK level */
export const ApiFeaturesSchema = z.object({
  // --- Request format flags ---

  /** Whether the provider supports array-formatted content in messages */
  arrayContent: z.boolean().default(true),
  /** Whether the provider supports stream_options for usage data */
  streamOptions: z.boolean().default(true),

  // --- Provider-specific parameter flags ---

  /** Whether the provider supports the 'developer' role (OpenAI-specific) */
  developerRole: z.boolean().default(false),
  /** Whether the provider supports service tier selection (OpenAI/Groq-specific) */
  serviceTier: z.boolean().default(false),
  /** Whether the provider supports verbosity settings (Gemini-specific) */
  verbosity: z.boolean().default(false),
  /** Whether the provider supports enable_thinking parameter */
  enableThinking: z.boolean().default(true)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Reasoning Format
//
// Describes HOW a provider's API expects reasoning parameters to be formatted.
// This is a provider-level concern — model-level reasoning capabilities
// (effort levels, token limits) are in model.ts ReasoningSupportSchema.
// ═══════════════════════════════════════════════════════════════════════════════

const ReasoningEffortSchema = z.enum(objectValues(REASONING_EFFORT))

/** Provider reasoning format — discriminated union by format type */
export const ProviderReasoningFormatSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('openai-chat'),
    params: z
      .object({
        reasoningEffort: ReasoningEffortSchema.optional()
      })
      .optional()
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
      .optional()
  }),
  z.object({
    type: z.literal('anthropic'),
    params: z
      .object({
        type: z.union([z.literal('enabled'), z.literal('disabled'), z.literal('adaptive')]),
        budgetTokens: z.number().optional(),
        effort: ReasoningEffortSchema.optional()
      })
      .optional()
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
            thinkingLevel: z.enum(objectValues(GEMINI_THINKING_LEVEL)).optional()
          })
          .optional()
      ])
      .optional()
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
      .optional()
  }),
  z.object({
    type: z.literal('enable-thinking'),
    params: z
      .object({
        enableThinking: z.boolean(),
        thinkingBudget: z.number().optional()
      })
      .optional(),
    ...CommonReasoningFieldsSchema
  }),
  z.object({
    type: z.literal('thinking-type'),
    params: z
      .object({
        thinking: z.object({
          type: z.union([z.literal('enabled'), z.literal('disabled'), z.literal('auto')])
        })
      })
      .optional()
  }),
  z.object({
    type: z.literal('dashscope'),
    params: z
      .object({
        enableThinking: z.boolean(),
        incrementalOutput: z.boolean().optional()
      })
      .optional()
  }),
  // TODO: API layer must convert camelCase → snake_case (chat_template_kwargs, enable_thinking, thinking_budget)
  // when building the actual request payload for vLLM/SGLang/nvidia endpoints
  z.object({
    type: z.literal('self-hosted'),
    params: z
      .object({
        chatTemplateKwargs: z.object({
          enableThinking: z.boolean().optional(),
          thinking: z.boolean().optional(),
          thinkingBudget: z.number().optional()
        })
      })
      .optional()
  })
])

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Config
// ═══════════════════════════════════════════════════════════════════════════════

export const ProviderWebsiteSchema = z.object({
  website: z.object({
    official: z.url().optional(),
    docs: z.url().optional(),
    apiKey: z.url().optional(),
    models: z.url().optional()
  })
})

/** Per-endpoint-type configuration in registry */
export const RegistryEndpointConfigSchema = z.object({
  /** Base URL for this endpoint type's API */
  baseUrl: z.url().optional(),
  /** URLs for fetching available models via this endpoint type */
  modelsApiUrls: z
    .object({
      /** Default models listing endpoint */
      default: z.url().optional(),
      /** Embedding models listing endpoint (if separate from default) */
      embedding: z.url().optional(),
      /** Reranker models listing endpoint (if separate from default) */
      reranker: z.url().optional()
    })
    .optional(),
  /** How this endpoint type expects reasoning parameters to be formatted */
  reasoningFormat: ProviderReasoningFormatSchema.optional()
})

export const ProviderConfigSchema = z
  .object({
    /** Unique provider identifier */
    id: ProviderIdSchema,
    /** Display name */
    name: z.string(),
    /** Provider description */
    description: z.string().optional(),
    /** Per-endpoint-type configuration (partial record — not all endpoint types need to be present) */
    endpointConfigs: z
      .record(
        z.string().refine((k): k is EndpointType => endpointTypeValues.includes(k), {
          message: `Invalid endpoint type key, must be one of: ${objectValues(ENDPOINT_TYPE).join(', ')}`
        }),
        RegistryEndpointConfigSchema
      )
      .optional(),
    /** Default endpoint type for chat requests — null for providers not bound by this (e.g. AWS, Vertex) */
    defaultChatEndpoint: EndpointTypeSchema.nullable().default(null),
    /** API feature flags controlling request construction */
    apiFeatures: ApiFeaturesSchema.optional(),
    /** Additional metadata including website URLs */
    metadata: MetadataSchema.and(ProviderWebsiteSchema)
  })
  .refine(
    (data) => {
      if (data.endpointConfigs && data.defaultChatEndpoint) {
        return data.defaultChatEndpoint in data.endpointConfigs
      }
      return true
    },
    {
      message: 'defaultChatEndpoint must exist as a key in endpointConfigs'
    }
  )

export const ProviderListSchema = z.object({
  version: VersionSchema,
  providers: z.array(ProviderConfigSchema)
})

export { ENDPOINT_TYPE } from './enums'
export type ApiFeatures = z.infer<typeof ApiFeaturesSchema>
export type ProviderReasoningFormat = z.infer<typeof ProviderReasoningFormatSchema>
export type RegistryEndpointConfig = z.infer<typeof RegistryEndpointConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderList = z.infer<typeof ProviderListSchema>
