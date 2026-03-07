/**
 * Model API Schema definitions
 *
 * Contains all model-related endpoints for CRUD operations.
 * DTO types are derived from Zod schemas in ../../types/model
 */

import * as z from 'zod'

import {
  type Model,
  ParameterSupportDbSchema,
  RuntimeModelPricingSchema,
  RuntimeReasoningSchema
} from '../../types/model'

/** Query parameters for listing models */
const ListModelsQuerySchema = z.object({
  /** Filter by provider ID */
  providerId: z.string().optional(),
  /** Filter by capability */
  capability: z.string().optional(),
  /** Filter by enabled status */
  enabled: z.boolean().optional()
})
export type ListModelsQuery = z.infer<typeof ListModelsQuerySchema>

/** DTO for creating a new model */
const CreateModelDtoSchema = z.object({
  /** Provider ID */
  providerId: z.string(),
  /** Model ID (used in API calls) */
  modelId: z.string(),
  /** Associated preset model ID */
  presetModelId: z.string().optional(),
  /** Display name */
  name: z.string().optional(),
  /** Description */
  description: z.string().optional(),
  /** UI grouping */
  group: z.string().optional(),
  /** Capabilities (numeric ModelCapability enum values) */
  capabilities: z.array(z.number()).optional(),
  /** Input modalities (numeric Modality enum values) */
  inputModalities: z.array(z.number()).optional(),
  /** Output modalities (numeric Modality enum values) */
  outputModalities: z.array(z.number()).optional(),
  /** Endpoint types */
  endpointTypes: z.array(z.number()).optional(),
  /** Context window size */
  contextWindow: z.number().optional(),
  /** Maximum output tokens */
  maxOutputTokens: z.number().optional(),
  /** Streaming support */
  supportsStreaming: z.boolean().optional(),
  /** Reasoning configuration */
  reasoning: RuntimeReasoningSchema.optional(),
  /** Parameter support (DB form) */
  parameterSupport: ParameterSupportDbSchema.optional(),
  /** Pricing configuration */
  pricing: RuntimeModelPricingSchema.optional()
})
export type CreateModelDto = z.infer<typeof CreateModelDtoSchema>

/** DTO for updating an existing model — CreateModelDto minus identity fields, all optional, plus status fields */
const UpdateModelDtoSchema = CreateModelDtoSchema.omit({
  providerId: true,
  modelId: true,
  presetModelId: true
})
  .partial()
  .extend({
    isEnabled: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    sortOrder: z.number().optional(),
    notes: z.string().optional()
  })
export type UpdateModelDto = z.infer<typeof UpdateModelDtoSchema>

/** DTO for resolving raw model entries against catalog presets */
const ResolveModelsDtoSchema = z.object({
  /** Provider ID */
  providerId: z.string(),
  /** Raw model entries from SDK */
  models: z.array(
    z.object({
      modelId: z.string(),
      name: z.string().optional(),
      group: z.string().optional(),
      description: z.string().optional(),
      endpointTypes: z.array(z.number()).optional()
    })
  )
})
export type ResolveModelsDto = z.infer<typeof ResolveModelsDtoSchema>

/**
 * Model API Schema definitions
 */
export interface ModelSchemas {
  /**
   * Models collection endpoint
   * @example GET /models?providerId=openai&capability=REASONING
   * @example POST /models { "providerId": "openai", "modelId": "gpt-5" }
   */
  '/models': {
    /** List models with optional filters */
    GET: {
      query: ListModelsQuery
      response: Model[]
    }
    /** Create a new model */
    POST: {
      body: CreateModelDto
      response: Model
    }
  }

  /**
   * Resolve raw SDK model entries against catalog presets
   * Returns enriched Model[] with capabilities, pricing, etc. from catalog
   * @example POST /models/resolve { "providerId": "openai", "models": [{ "modelId": "gpt-4o" }] }
   */
  '/models/resolve': {
    POST: {
      body: ResolveModelsDto
      response: Model[]
    }
  }

  /**
   * Individual model endpoint (keyed by providerId + modelId)
   * @example GET /models/openai/gpt-5
   * @example PATCH /models/openai/gpt-5 { "isEnabled": false }
   * @example DELETE /models/openai/gpt-5
   */
  '/models/:providerId/:modelId': {
    /** Get a model by provider ID and model ID */
    GET: {
      params: { providerId: string; modelId: string }
      response: Model
    }
    /** Update a model */
    PATCH: {
      params: { providerId: string; modelId: string }
      body: UpdateModelDto
      response: Model
    }
    /** Delete a model */
    DELETE: {
      params: { providerId: string; modelId: string }
      response: void
    }
  }
}
