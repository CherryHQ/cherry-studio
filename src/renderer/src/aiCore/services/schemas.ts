/**
 * API Response Schemas for model listing
 * Used exclusively by listModels.ts
 */
import * as z from 'zod'

// === OpenAI-compatible (also used by OpenRouter, PPIO, etc.) ===

export const OpenAIModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      object: z.literal('model').optional().default('model'),
      created: z.number().optional(),
      owned_by: z.string().optional()
    })
  ),
  object: z.literal('list').optional()
})

// === Ollama ===

export const OllamaTagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      model: z.string().optional(),
      modified_at: z.string().optional(),
      size: z.number().optional(),
      digest: z.string().optional(),
      details: z
        .object({
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
    z.object({
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
  z.object({
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
  z.object({
    id: z.string(),
    display_name: z.string().optional(),
    organization: z.string().optional(),
    description: z.string().optional(),
    context_length: z.number().optional(),
    pricing: z
      .object({
        input: z.number().optional(),
        output: z.number().optional()
      })
      .optional()
  })
)

// === NewAPI (extends OpenAI with endpoint types) ===

export const NewApiModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      object: z.literal('model').optional().default('model'),
      created: z.number().optional(),
      owned_by: z.string().optional(),
      supported_endpoint_types: z
        .array(z.enum(['openai', 'anthropic', 'gemini', 'openai-response', 'image-generation']))
        .optional()
    })
  ),
  object: z.literal('list').optional()
})

// === OVMS (OpenVINO Model Server) ===

export const OVMSConfigResponseSchema = z.record(
  z.string(),
  z.object({
    model_version_status: z
      .array(
        z.object({
          state: z.string(),
          status: z
            .object({
              error_code: z.string().optional(),
              error_message: z.string().optional()
            })
            .optional()
        })
      )
      .optional()
  })
)
