/**
 * Model API Schema definitions
 *
 * Contains all model-related endpoints for CRUD operations.
 * DTO types are derived from Zod schemas in ../../types/model
 */

import * as z from 'zod'

import {
  ENDPOINT_TYPE,
  MODALITY,
  type Model,
  MODEL_CAPABILITY,
  objectValues,
  ParameterSupportDbSchema,
  RuntimeModelPricingSchema,
  RuntimeReasoningSchema
} from '../../types/model'

/** Query parameters for listing models */
export const ListModelsQuerySchema = z.object({
  /** Filter by provider ID */
  providerId: z.string().optional(),
  /** Filter by capability (ModelCapability string value) */
  capability: z.enum(objectValues(MODEL_CAPABILITY)).optional(),
  /** Filter by enabled status */
  enabled: z.boolean().optional()
})
export type ListModelsQuery = z.infer<typeof ListModelsQuerySchema>

/** DTO for creating a new model */
export const CreateModelDtoSchema = z.object({
  /** Provider ID */
  providerId: z.string().min(1),
  /** Model ID (used in API calls) */
  modelId: z.string().min(1),
  /** Associated preset model ID */
  presetModelId: z.string().optional(),
  /** Display name */
  name: z.string().optional(),
  /** Description */
  description: z.string().optional(),
  /** UI grouping */
  group: z.string().optional(),
  /** Capabilities */
  capabilities: z.array(z.enum(objectValues(MODEL_CAPABILITY))).optional(),
  /** Input modalities */
  inputModalities: z.array(z.enum(objectValues(MODALITY))).optional(),
  /** Output modalities */
  outputModalities: z.array(z.enum(objectValues(MODALITY))).optional(),
  /** Endpoint types */
  endpointTypes: z.array(z.enum(objectValues(ENDPOINT_TYPE))).optional(),
  /** Context window size */
  contextWindow: z.number().int().positive().optional(),
  /** Maximum output tokens */
  maxOutputTokens: z.number().int().positive().optional(),
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

export const MODELS_BATCH_MAX_ITEMS = 100

export const CreateModelsBatchDtoSchema = z.object({
  items: z.array(CreateModelDtoSchema).min(1).max(MODELS_BATCH_MAX_ITEMS)
})
export type CreateModelsBatchDto = z.infer<typeof CreateModelsBatchDtoSchema>

/** DTO for updating an existing model — CreateModelDto minus identity fields, all optional, plus status fields */
export const UpdateModelDtoSchema = CreateModelDtoSchema.omit({
  providerId: true,
  modelId: true,
  presetModelId: true
})
  .partial()
  .extend({
    isEnabled: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    notes: z.string().optional()
  })
export type UpdateModelDto = z.infer<typeof UpdateModelDtoSchema>

/** DTO for resolving raw model IDs against registry presets */
export const EnrichModelsDtoSchema = z.object({
  /** Raw model IDs from SDK listModels() */
  models: z.array(
    z.object({
      modelId: z.string().min(1)
    })
  )
})
export type EnrichModelsDto = z.infer<typeof EnrichModelsDtoSchema>

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

  '/models/batch': {
    POST: {
      body: CreateModelsBatchDto
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
