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
  RuntimeReasoningSchema,
  type UniqueModelId,
  UniqueModelIdSchema
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
export const CreateModelSchema = z.strictObject({
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
  /** Maximum input tokens */
  maxInputTokens: z.number().int().positive().optional(),
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
export type CreateModelDto = z.infer<typeof CreateModelSchema>

export const MODELS_BATCH_MAX_ITEMS = 500
export const MODELS_BULK_UPDATE_MAX_ITEMS = 1000

/**
 * `POST /models` intentionally accepts arrays only.
 *
 * This keeps the transport contract and response shape stable: callers always
 * send `CreateModelDto[]` and always receive `Model[]`, while single-item
 * convenience is handled by higher layers such as renderer hooks.
 */
export const CreateModelsSchema = z.array(CreateModelSchema).min(1).max(MODELS_BATCH_MAX_ITEMS)
export type CreateModelsDto = z.infer<typeof CreateModelsSchema>

/** DTO for updating an existing model — CreateModelDto minus identity fields, all optional, plus status fields */
export const UpdateModelSchema = CreateModelSchema.omit({
  providerId: true,
  modelId: true,
  presetModelId: true
})
  .partial()
  .extend({
    isEnabled: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    isDeprecated: z.boolean().optional(),
    notes: z.string().optional()
  })
export type UpdateModelDto = z.infer<typeof UpdateModelSchema>

/**
 * `PATCH /models` body item: a single (uniqueModelId, patch) pair.
 *
 * Mirrors the row-level `PATCH /models/:uniqueModelId*` contract so callers can
 * lift one-off updates into a batch without changing field semantics.
 */
export const BulkUpdateModelItemSchema = z.object({
  uniqueModelId: UniqueModelIdSchema,
  patch: UpdateModelSchema
})
export type BulkUpdateModelItem = z.infer<typeof BulkUpdateModelItemSchema>

/**
 * `PATCH /models` accepts arrays only, applied atomically in one transaction.
 *
 * Matches the `POST /models` array-only convention: callers always send an
 * array and always receive `Model[]`, while single-item convenience stays at
 * the row-level `PATCH /models/:uniqueModelId*` endpoint.
 */
export const BulkUpdateModelsSchema = z.array(BulkUpdateModelItemSchema).min(1).max(MODELS_BULK_UPDATE_MAX_ITEMS)
export type BulkUpdateModelsDto = z.infer<typeof BulkUpdateModelsSchema>

/**
 * Model API Schema definitions
 */
export type ModelSchemas = {
  /**
   * Models collection endpoint
   *
   * Design note: create is array-only on purpose. We do not support a parallel
   * single-object body because the uniform array contract keeps DataApi typing,
   * handler logic, and renderer wrappers aligned.
   *
   * @example GET /models?providerId=openai&capability=REASONING
   * @example POST /models [{ "providerId": "openai", "modelId": "gpt-5" }]
   */
  '/models': {
    /** List models with optional filters */
    GET: {
      query: ListModelsQuery
      response: Model[]
    }
    /** Create one or more models in a single request */
    POST: {
      body: CreateModelsDto
      response: Model[]
    }
    /**
     * Update one or more models in a single transaction.
     *
     * Each item carries its own `uniqueModelId` + `patch`, with the same
     * per-field semantics as `PATCH /models/:uniqueModelId*`. The whole batch
     * is atomic: a single not-found rolls everything back.
     */
    PATCH: {
      body: BulkUpdateModelsDto
      response: Model[]
    }
  }

  /**
   * Individual model endpoint (keyed by UniqueModelId "providerId::modelId").
   * Uses a greedy tail param so modelIds containing `/` are captured verbatim.
   * @example GET /models/openai::gpt-5
   * @example PATCH /models/openai::gpt-5 { "isEnabled": false }
   * @example DELETE /models/qwen::qwen/qwen3-vl
   */
  '/models/:uniqueModelId*': {
    /** Get a model by UniqueModelId */
    GET: {
      params: { uniqueModelId: UniqueModelId }
      response: Model
    }
    /** Update a model */
    PATCH: {
      params: { uniqueModelId: UniqueModelId }
      body: UpdateModelDto
      response: Model
    }
    /** Delete a model */
    DELETE: {
      params: { uniqueModelId: UniqueModelId }
      response: void
    }
  }
}
