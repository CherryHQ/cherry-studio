/**
 * Model Service - handles model CRUD operations
 *
 * Provides business logic for:
 * - Model CRUD operations
 * - Row to Model conversion
 * - Registry import support
 */

import type { NewUserModel, UserModel } from '@data/db/schemas/userModel'
import { isRegistryEnrichableField, userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateModelDto, ListModelsQuery, UpdateModelDto } from '@shared/data/api/schemas/models'
import type {
  EndpointType,
  Modality,
  Model,
  ModelCapability,
  RuntimeParameterSupport,
  RuntimeReasoning
} from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import { mergeModelConfig } from '@shared/data/utils/modelMerger'
import { and, eq, inArray, type SQL } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:ModelService')

/**
 * Convert database row to Model entity
 *
 * Since user_model stores fully resolved data (merged at add-time),
 * this is a direct field mapping with no runtime merge needed.
 */
function rowToRuntimeModel(row: UserModel): Model {
  return {
    id: createUniqueModelId(row.providerId, row.modelId),
    providerId: row.providerId,
    apiModelId: row.modelId,
    name: row.name ?? row.modelId,
    description: row.description ?? undefined,
    group: row.group ?? undefined,
    capabilities: row.capabilities ?? [],
    inputModalities: row.inputModalities ?? undefined,
    outputModalities: row.outputModalities ?? undefined,
    contextWindow: row.contextWindow ?? undefined,
    maxOutputTokens: row.maxOutputTokens ?? undefined,
    endpointTypes: row.endpointTypes ?? undefined,
    supportsStreaming: row.supportsStreaming ?? true,
    reasoning: (row.reasoning ?? undefined) as RuntimeReasoning | undefined,
    parameterSupport: (row.parameters ?? undefined) as RuntimeParameterSupport | undefined,
    pricing: row.pricing ?? undefined,
    isEnabled: row.isEnabled ?? true,
    isHidden: row.isHidden ?? false
  }
}

export class ModelService {
  private static instance: ModelService

  private constructor() {}

  public static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService()
    }
    return ModelService.instance
  }

  /**
   * List models with optional filters
   */
  async list(query: ListModelsQuery): Promise<Model[]> {
    const db = application.get('DbService').getDb()

    const conditions: SQL[] = []

    if (query.providerId) {
      conditions.push(eq(userModelTable.providerId, query.providerId))
    }

    if (query.enabled !== undefined) {
      conditions.push(eq(userModelTable.isEnabled, query.enabled))
    }

    const rows = await db
      .select()
      .from(userModelTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(userModelTable.sortOrder)

    let models = rows.map(rowToRuntimeModel)

    // Post-filter by capability (JSON array column, can't filter in SQL easily)
    if (query.capability !== undefined) {
      const cap = query.capability as ModelCapability
      models = models.filter((m) => m.capabilities.includes(cap))
    }

    return models
  }

  /**
   * Get a model by composite key (providerId + modelId)
   */
  async getByKey(providerId: string, modelId: string): Promise<Model> {
    const db = application.get('DbService').getDb()

    const [row] = await db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)
    }

    return rowToRuntimeModel(row)
  }

  /**
   * Create a new model
   *
   * Automatically enriches from registry preset data when a match is found.
   * DTO values take priority over registry (user > registryOverride > preset).
   */
  async create(dto: CreateModelDto): Promise<Model> {
    const db = application.get('DbService').getDb()

    // Look up registry data for auto-enrichment
    const { presetModel, registryOverride, reasoningFormatTypes, defaultChatEndpoint } = await application
      .get('ProviderRegistryService')
      .lookupModel(dto.providerId, dto.modelId)

    let values: NewUserModel

    if (presetModel) {
      // Registry match found — merge DTO with preset data
      const userRow = {
        providerId: dto.providerId,
        modelId: dto.modelId,
        presetModelId: presetModel.id,
        name: dto.name ?? null,
        description: dto.description ?? null,
        group: dto.group ?? null,
        capabilities: (dto.capabilities as ModelCapability[]) ?? null,
        inputModalities: (dto.inputModalities as Modality[]) ?? null,
        outputModalities: (dto.outputModalities as Modality[]) ?? null,
        endpointTypes: (dto.endpointTypes as EndpointType[]) ?? null,
        contextWindow: dto.contextWindow ?? null,
        maxOutputTokens: dto.maxOutputTokens ?? null,
        supportsStreaming: dto.supportsStreaming ?? null,
        reasoning: dto.reasoning ?? null
      }

      const merged = mergeModelConfig(
        userRow,
        registryOverride,
        presetModel,
        dto.providerId,
        reasoningFormatTypes,
        defaultChatEndpoint
      )

      values = {
        providerId: dto.providerId,
        modelId: dto.modelId,
        presetModelId: presetModel.id,
        name: merged.name,
        description: merged.description ?? null,
        group: merged.group ?? null,
        capabilities: merged.capabilities,
        inputModalities: merged.inputModalities ?? null,
        outputModalities: merged.outputModalities ?? null,
        endpointTypes: merged.endpointTypes ?? null,
        contextWindow: merged.contextWindow ?? null,
        maxOutputTokens: merged.maxOutputTokens ?? null,
        supportsStreaming: merged.supportsStreaming,
        reasoning: merged.reasoning ?? null,
        parameters: merged.parameterSupport ?? null,
        pricing: merged.pricing ?? null
      }

      logger.info('Created model with registry enrichment', {
        providerId: dto.providerId,
        modelId: dto.modelId,
        presetModelId: presetModel.id
      })
    } else {
      // No registry match — store as custom model
      values = {
        providerId: dto.providerId,
        modelId: dto.modelId,
        presetModelId: dto.presetModelId ?? null,
        name: dto.name ?? null,
        description: dto.description ?? null,
        group: dto.group ?? null,
        capabilities: (dto.capabilities as ModelCapability[]) ?? null,
        inputModalities: (dto.inputModalities as Modality[]) ?? null,
        outputModalities: (dto.outputModalities as Modality[]) ?? null,
        endpointTypes: (dto.endpointTypes as EndpointType[]) ?? null,
        contextWindow: dto.contextWindow ?? null,
        maxOutputTokens: dto.maxOutputTokens ?? null,
        supportsStreaming: dto.supportsStreaming ?? null,
        reasoning: dto.reasoning ?? null,
        parameters: dto.parameterSupport ?? null,
        pricing: dto.pricing ?? null
      }

      logger.info('Created custom model (no registry match)', {
        providerId: dto.providerId,
        modelId: dto.modelId
      })
    }

    const [row] = await db.insert(userModelTable).values(values).returning()

    return rowToRuntimeModel(row)
  }

  /**
   * Update an existing model
   */
  async update(providerId: string, modelId: string, dto: UpdateModelDto): Promise<Model> {
    const db = application.get('DbService').getDb()

    // Fetch existing row (also verifies existence)
    const [existing] = await db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
      .limit(1)

    if (!existing) {
      throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)
    }

    // Build update object
    const updates: Partial<NewUserModel> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.description !== undefined) updates.description = dto.description
    if (dto.group !== undefined) updates.group = dto.group
    if (dto.capabilities !== undefined) updates.capabilities = dto.capabilities as ModelCapability[]
    if (dto.endpointTypes !== undefined) updates.endpointTypes = dto.endpointTypes as EndpointType[]
    if (dto.supportsStreaming !== undefined) updates.supportsStreaming = dto.supportsStreaming
    if (dto.contextWindow !== undefined) updates.contextWindow = dto.contextWindow
    if (dto.maxOutputTokens !== undefined) updates.maxOutputTokens = dto.maxOutputTokens
    if (dto.reasoning !== undefined) updates.reasoning = dto.reasoning
    if (dto.pricing !== undefined) updates.pricing = dto.pricing
    if (dto.isEnabled !== undefined) updates.isEnabled = dto.isEnabled
    if (dto.isHidden !== undefined) updates.isHidden = dto.isHidden
    if (dto.sortOrder !== undefined) updates.sortOrder = dto.sortOrder
    if (dto.notes !== undefined) updates.notes = dto.notes

    // Track which registry-enrichable fields the user explicitly changed
    const changedEnrichableFields = Object.keys(dto).filter(isRegistryEnrichableField)
    if (changedEnrichableFields.length > 0) {
      const existingOverrides = existing.userOverrides ?? []
      updates.userOverrides = [...new Set([...existingOverrides, ...changedEnrichableFields])]
    }

    const [row] = await db
      .update(userModelTable)
      .set(updates)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
      .returning()

    logger.info('Updated model', { providerId, modelId, changes: Object.keys(dto) })

    return rowToRuntimeModel(row)
  }

  /**
   * Delete a model
   */
  async delete(providerId: string, modelId: string): Promise<void> {
    const db = application.get('DbService').getDb()

    // Verify model exists
    await this.getByKey(providerId, modelId)

    await db
      .delete(userModelTable)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))

    logger.info('Deleted model', { providerId, modelId })
  }

  /**
   * Batch upsert models for a provider (used by RegistryService).
   * Inserts new models, updates existing ones.
   * Respects `userOverrides`: fields the user has explicitly modified are not overwritten.
   */
  async batchUpsert(models: NewUserModel[]): Promise<void> {
    if (models.length === 0) return

    const db = application.get('DbService').getDb()

    // Pre-fetch existing userOverrides for all affected models
    const providerIds = [...new Set(models.map((m) => m.providerId))]
    const existingRows = await db
      .select({
        providerId: userModelTable.providerId,
        modelId: userModelTable.modelId,
        userOverrides: userModelTable.userOverrides
      })
      .from(userModelTable)
      .where(inArray(userModelTable.providerId, providerIds))

    const overridesMap = new Map<string, Set<string>>()
    for (const row of existingRows) {
      if (row.userOverrides && row.userOverrides.length > 0) {
        overridesMap.set(`${row.providerId}:${row.modelId}`, new Set(row.userOverrides))
      }
    }

    for (const model of models) {
      const userOverrides = overridesMap.get(`${model.providerId}:${model.modelId}`)

      // Build the update set, skipping user-overridden fields
      const set: Partial<NewUserModel> = {
        presetModelId: model.presetModelId
      }
      const enrichableFields = {
        name: model.name,
        description: model.description,
        group: model.group,
        capabilities: model.capabilities,
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        endpointTypes: model.endpointTypes,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportsStreaming: model.supportsStreaming,
        reasoning: model.reasoning,
        parameters: model.parameters,
        pricing: model.pricing
      }

      for (const [field, value] of Object.entries(enrichableFields)) {
        if (!userOverrides?.has(field)) {
          ;(set as Record<string, unknown>)[field] = value
        }
      }

      await db
        .insert(userModelTable)
        .values(model)
        .onConflictDoUpdate({
          target: [userModelTable.providerId, userModelTable.modelId],
          set
        })
    }

    logger.info('Batch upserted models', { count: models.length, providerId: models[0]?.providerId })
  }
}

export const modelService = ModelService.getInstance()
