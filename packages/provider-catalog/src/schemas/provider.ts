/**
 * Provider configuration schema definitions
 * Defines the structure for provider connections and API configurations
 */

import * as z from 'zod'

import { MetadataSchema, ProviderIdSchema, VersionSchema } from './common'
import { EndpointType, ReasoningEffort } from './enums'
import { CommonReasoningFieldsSchema } from './model'

export const EndpointTypeSchema = z.enum(EndpointType)

// ═══════════════════════════════════════════════════════════════════════════════
// API Features
// ═══════════════════════════════════════════════════════════════════════════════

/** API feature flags controlling request construction at the SDK level */
export const ApiFeaturesSchema = z.object({
  // --- Request format flags ---

  /** Whether the provider supports array-formatted content in messages */
  arrayContent: z.boolean().optional(),
  /** Whether the provider supports stream_options for usage data */
  streamOptions: z.boolean().optional(),

  // --- Provider-specific parameter flags ---

  /** Whether the provider supports the 'developer' role (OpenAI-specific) */
  developerRole: z.boolean().optional(),
  /** Whether the provider supports service tier selection (OpenAI/Groq-specific) */
  serviceTier: z.boolean().optional(),
  /** Whether the provider supports verbosity settings (Gemini-specific) */
  verbosity: z.boolean().optional(),
  /** Whether the provider supports enable_thinking parameter */
  enableThinking: z.boolean().optional()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Reasoning Format
//
// Describes HOW a provider's API expects reasoning parameters to be formatted.
// This is a provider-level concern — model-level reasoning capabilities
// (effort levels, token limits) are in model.ts ReasoningSupportSchema.
// ═══════════════════════════════════════════════════════════════════════════════

const ReasoningEffortSchema = z.enum(ReasoningEffort)

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
            thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional()
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
  z.object({
    type: z.literal('self-hosted'),
    params: z
      .object({
        chatTemplateKwargs: z.object({
          enableThinking: z.boolean().optional(),
          thinking: z.boolean().optional()
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

export const ProviderConfigSchema = z
  .object({
    /** Unique provider identifier */
    id: ProviderIdSchema,
    /** Display name */
    name: z.string(),
    /** Provider description */
    description: z.string().optional(),
    /** Base URLs keyed by endpoint type */
    baseUrls: z.record(EndpointTypeSchema, z.url()).optional(),
    /** Default endpoint type for chat requests (must exist in baseUrls) */
    defaultChatEndpoint: EndpointTypeSchema.optional(),
    /** API feature flags controlling request construction */
    apiFeatures: ApiFeaturesSchema.optional(),
    /** URLs for fetching available models, separated by model category */
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
    /** Additional metadata including website URLs */
    metadata: MetadataSchema.and(ProviderWebsiteSchema),
    /** How this provider's API expects reasoning parameters to be formatted */
    reasoningFormat: ProviderReasoningFormatSchema.optional()
  })
  .refine(
    (data) => {
      if (data.defaultChatEndpoint && data.baseUrls) {
        return data.defaultChatEndpoint in data.baseUrls
      }
      return true
    },
    {
      message: 'defaultChatEndpoint must exist as a key in baseUrls'
    }
  )

export const ProviderListSchema = z.object({
  version: VersionSchema,
  providers: z.array(ProviderConfigSchema)
})

export { ENDPOINT_TYPE } from './enums'
export type ApiFeatures = z.infer<typeof ApiFeaturesSchema>
export type ProviderReasoningFormat = z.infer<typeof ProviderReasoningFormatSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderList = z.infer<typeof ProviderListSchema>
