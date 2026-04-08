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
      object: z.string().optional().default('model'),
      created: z.number().optional(),
      owned_by: z.string().optional()
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
      details: z
        .looseObject({
          parent_model: z.string().optional(),
          format: z.string().optional(),
          family: z.string().optional(),
          families: z.array(z.string()).optional(),
          parameter_size: z.string().optional(),
          quantization_level: z.string().optional()
        })
        .optional()
    })
  )
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

// === GitHub Models ===

export const GitHubModelsResponseSchema = z.array(
  z.looseObject({
    id: z.string(),
    summary: z.string().optional(),
    publisher: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional()
  })
)

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
