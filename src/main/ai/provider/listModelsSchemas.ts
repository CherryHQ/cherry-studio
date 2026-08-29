/**
 * API Response Schemas for model listing
 * Used exclusively by listModels.ts
 *
 * All object schemas use z.looseObject() to tolerate unknown fields
 * from providers — prevents parse failures when APIs add new fields.
 */
import * as z from 'zod'

// === OpenAI-compatible (also used by OpenRouter, PPIO, etc.) ===

export const OpenAIModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string().optional(),
      object: z.string().optional().default('model'),
      created: z.number().optional(),
      owned_by: z.string().optional()
    })
  ),
  object: z.string().optional()
})

const NullablePriceStringSchema = z.string().nullable().optional()

export const OpenAITokenPricingSchema = z.looseObject({
  prompt: NullablePriceStringSchema,
  completion: NullablePriceStringSchema,
  input_cache_read: NullablePriceStringSchema,
  input_cache_reads: NullablePriceStringSchema,
  input_cache_write: NullablePriceStringSchema,
  image: NullablePriceStringSchema,
  request: NullablePriceStringSchema,
  context_pricing: z
    .looseObject({
      tiers: z.array(
        z.looseObject({
          min_tokens: z.number(),
          max_tokens: z.number().nullable().optional(),
          prompt: NullablePriceStringSchema,
          completion: NullablePriceStringSchema,
          input_cache_read: NullablePriceStringSchema,
          input_cache_reads: NullablePriceStringSchema,
          input_cache_write: NullablePriceStringSchema
        })
      )
    })
    .optional()
})

const PPIOPriceBucketSchema = z.looseObject({
  price_per_m_decimal: z.string().optional()
})

const PPIOPricingSchema = z.looseObject({
  prompt: PPIOPriceBucketSchema.optional(),
  completion: PPIOPriceBucketSchema.optional(),
  input_cache_read: PPIOPriceBucketSchema.optional(),
  input_cache_write: PPIOPriceBucketSchema.optional()
})

export const PPIOModelPricingSchema = z.looseObject({
  pricing: PPIOPricingSchema.optional(),
  tiered_billing_configs: z
    .array(
      z.looseObject({
        min_tokens: z.number(),
        max_tokens: z.number().nullable().optional(),
        pricing: PPIOPricingSchema
      })
    )
    .optional()
})

const BaiduPriceTierSchema = z.looseObject({
  up_to: z.number().nullable().optional(),
  price: z.string()
})
const BaiduTokenPriceSchema = z
  .union([z.string(), z.array(BaiduPriceTierSchema)])
  .nullable()
  .optional()

export const BaiduModelPricingSchema = z.looseObject({
  pricing: z
    .looseObject({
      prompt: BaiduTokenPriceSchema,
      completion: BaiduTokenPriceSchema,
      image: NullablePriceStringSchema
    })
    .optional()
})

export const LanyunModelPricingSchema = z.looseObject({
  x_lanyun: z
    .looseObject({
      price_rules: z
        .array(
          z.looseObject({
            token_range_start: z.number().nullable().optional(),
            input_text_token_price: z.number().nullable().optional(),
            output_text_token_price: z.number().nullable().optional(),
            cached_text_token_price: z.number().nullable().optional(),
            cache_creation_5m_token: z.number().nullable().optional()
          })
        )
        .optional()
    })
    .optional()
})

export const HuggingFaceModelPricingSchema = z.looseObject({
  providers: z
    .array(
      z.looseObject({
        pricing: z
          .looseObject({
            input: z.number(),
            output: z.number()
          })
          .nullable()
          .optional()
      })
    )
    .optional()
})

// === OpenRouter (OpenAI-compatible + a per-token price string) ===

export const OpenRouterModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string().optional(),
      object: z.string().optional().default('model'),
      created: z.number().optional(),
      owned_by: z.string().optional(),
      /** Decimal strings, USD per SINGLE token — `"0.0000025"` is $2.50 / 1M. */
      pricing: z
        .looseObject({
          prompt: z.string().optional(),
          completion: z.string().optional(),
          input_cache_read: z.string().optional(),
          input_cache_write: z.string().optional()
        })
        .optional()
    })
  ),
  object: z.string().optional()
})

// === GitHub Copilot (/models) ===
export const CopilotModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      object: z.string().optional().default('model'),
      created: z.number().optional(),
      owned_by: z.string().optional(),
      name: z.string().optional(),
      vendor: z.string().optional(),
      version: z.string().optional(),
      preview: z.boolean().optional(),
      model_picker_enabled: z.boolean().optional(),
      policy: z
        .looseObject({
          state: z.string().optional(),
          terms: z.string().optional()
        })
        .optional()
    })
  ),
  object: z.string().optional()
})

// === Ollama ===

export const OllamaTagsResponseSchema = z.object({
  models: z.array(
    z.looseObject({
      name: z.string(),
      model: z.string().optional(),
      modified_at: z.string().optional(),
      size: z.number().optional(),
      digest: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      details: z
        .looseObject({
          parent_model: z.string().optional(),
          format: z.string().optional(),
          family: z.string().optional(),
          families: z
            .array(z.string())
            .nullable()
            .optional()
            .transform((v) => v ?? undefined),
          parameter_size: z.string().optional(),
          quantization_level: z.string().optional()
        })
        .optional()
    })
  )
})

/**
 * `POST /api/show`. `model_info` keys are architecture-prefixed
 * (`llama.context_length`, `qwen3.context_length`, …), so the architecture has to be
 * read first — `/api/tags` carries no context length at all.
 */
export const OllamaShowResponseSchema = z.looseObject({
  model_info: z.record(z.string(), z.unknown()).optional()
})

// === Gemini ===

export const GeminiModelsResponseSchema = z.object({
  models: z.array(
    z.looseObject({
      name: z.string(),
      displayName: z.string().optional(),
      description: z.string().optional(),
      version: z.string().optional(),
      baseModelId: z.string().optional(),
      inputTokenLimit: z.number().optional(),
      outputTokenLimit: z.number().optional(),
      supportedGenerationMethods: z.array(z.string()).optional()
    })
  ),
  nextPageToken: z.string().optional()
})

// === Vertex AI Model Garden ===

export const VertexPublisherModelsResponseSchema = z.object({
  publisherModels: z
    .array(
      z.looseObject({
        name: z.string(),
        displayName: z.string().optional(),
        description: z.string().optional(),
        versionId: z.string().optional(),
        launchStage: z.string().optional(),
        versionState: z.string().optional()
      })
    )
    .optional()
    .default([]),
  nextPageToken: z.string().optional()
})

// === Together ===

export const TogetherModelsResponseSchema = z.array(
  z.looseObject({
    id: z.string(),
    display_name: z.string().optional(),
    organization: z.string().optional(),
    description: z.string().optional(),
    context_length: z.number().optional(),
    pricing: z
      .looseObject({
        cached_input: z.number().optional(),
        input: z.number().optional(),
        output: z.number().optional()
      })
      .optional()
  })
)

// === NewAPI (extends OpenAI with endpoint types) ===

export const NewApiModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      object: z.string().optional().default('model'),
      created: z.number().optional(),
      owned_by: z.string().optional(),
      supported_endpoint_types: z
        .array(z.string())
        .nullable()
        .optional()
        .transform((v) => v ?? undefined)
    })
  ),
  object: z.string().optional()
})

// === OVMS (OpenVINO Model Server) ===

export const OVMSConfigResponseSchema = z.record(
  z.string(),
  z.object({
    model_version_status: z
      .array(
        z.looseObject({
          state: z.string(),
          status: z
            .looseObject({
              error_code: z.string().optional(),
              error_message: z.string().optional()
            })
            .optional()
        })
      )
      .optional()
  })
)

// === Vercel AI Gateway (/v1/models) ===

const VercelGatewayPricingTierSchema = z.looseObject({
  cost: z.string(),
  // The live catalog may omit min on the first tier; that bucket starts at zero.
  min: z.number().optional().default(0),
  max: z.number().optional()
})

export const VercelGatewayModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      owned_by: z.string().optional(),
      type: z.string().optional(),
      pricing: z
        .looseObject({
          input: z.string().optional(),
          output: z.string().optional(),
          input_cache_read: z.string().optional(),
          input_cache_write: z.string().optional(),
          input_tiers: z.array(VercelGatewayPricingTierSchema).optional(),
          output_tiers: z.array(VercelGatewayPricingTierSchema).optional(),
          input_cache_read_tiers: z.array(VercelGatewayPricingTierSchema).optional(),
          input_cache_write_tiers: z.array(VercelGatewayPricingTierSchema).optional(),
          image: z.string().optional()
        })
        .optional()
    })
  ),
  object: z.string().optional()
})

// === Anthropic (/v1/models) ===

export const AnthropicModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string(),
      display_name: z.string().optional(),
      created_at: z.string().optional()
    })
  ),
  has_more: z.boolean().optional()
})

// === NewAPI (/api/pricing — public on every deployment of the gateway) ===

export const NewApiPricingResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      model_name: z.string(),
      /** 0 = metered per token, 1 = a flat price per request (`model_price`). */
      quota_type: z.number().optional(),
      /** Multiplier over the gateway's quota unit, not a currency amount. */
      model_ratio: z.number().optional(),
      completion_ratio: z.number().optional(),
      cache_ratio: z.number().optional(),
      /** Present when the rate depends on something the ratios can't express, e.g. time of day. */
      billing_mode: z.string().optional(),
      billing_expr: z.string().optional()
    })
  ),
  /** Per-group multiplier applied on top of every ratio. */
  group_ratio: z.record(z.string(), z.number()).optional(),
  /** Groups the caller may bill against — a single entry identifies which `group_ratio` applies. */
  usable_group: z.record(z.string(), z.string()).optional(),
  success: z.boolean().optional()
})

// === AIHubMix ===

export const AIHubMixModelsResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      model_id: z.string(),
      model_name: z.string().optional(),
      developer_id: z.number().optional(),
      desc: z.string().optional(),
      pricing: z
        .looseObject({
          cache_read: z.number().optional(),
          cache_write: z.number().optional(),
          input: z.number().optional(),
          output: z.number().optional()
        })
        .optional(),
      types: z.string().optional(),
      features: z.string().optional(),
      input_modalities: z.string().optional(),
      endpoints: z.string().optional(),
      max_output: z.number().optional(),
      context_length: z.number().optional()
    })
  ),
  message: z.string().optional(),
  success: z.boolean().optional()
})
