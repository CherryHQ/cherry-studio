/**
 * Model Service - handles model CRUD operations
 *
 * Provides business logic for:
 * - Model CRUD operations
 * - Row to Model conversion
 * - Catalog import support
 */

import type { EndpointType, Modality, ModelCapability } from '@cherrystudio/provider-catalog'
import { dbService } from '@data/db/DbService'
import type { NewUserModel, UserModel } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateModelDto, ListModelsQuery, UpdateModelDto } from '@shared/data/api/schemas/models'
import type { Model, RuntimeModelPricing, RuntimeParameterSupport, RuntimeReasoning } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import { mergeModelConfig } from '@shared/data/utils/modelMerger'
import { and, eq, type SQL } from 'drizzle-orm'

import { catalogService } from './CatalogService'

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
    apiModelId: row.modelApiId ?? row.modelId,
    name: row.name ?? row.modelId,
    description: row.description ?? undefined,
    group: row.group ?? undefined,
    capabilities: (row.capabilities ?? []) as ModelCapability[],
    inputModalities: (row.inputModalities ?? undefined) as Modality[] | undefined,
    outputModalities: (row.outputModalities ?? undefined) as Modality[] | undefined,
    contextWindow: row.contextWindow ?? undefined,
    maxOutputTokens: row.maxOutputTokens ?? undefined,
    endpointTypes: (row.endpointTypes ?? undefined) as EndpointType[] | undefined,
    supportsStreaming: row.supportsStreaming ?? true,
    reasoning: (row.reasoning ?? undefined) as RuntimeReasoning | undefined,
    parameters: (row.parameters ?? undefined) as RuntimeParameterSupport | undefined,
    pricing: (row.pricing ?? undefined) as RuntimeModelPricing | undefined,
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
    const db = dbService.getDb()

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
    if (query.capability) {
      const cap = query.capability
      models = models.filter((m) => m.capabilities.includes(cap as ModelCapability))
    }

    return models
  }

  /**
   * Get a model by composite key (providerId + modelId)
   */
  async getByKey(providerId: string, modelId: string): Promise<Model> {
    const db = dbService.getDb()

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
   * Automatically enriches from catalog preset data when a match is found.
   * DTO values take priority over catalog (user > catalogOverride > preset).
   */
  async create(dto: CreateModelDto): Promise<Model> {
    const db = dbService.getDb()

    // Look up catalog data for auto-enrichment
    const { presetModel, catalogOverride } = catalogService.lookupModel(dto.providerId, dto.modelId)

    let values: NewUserModel

    if (presetModel) {
      // Catalog match found — merge DTO with preset data
      const userRow = {
        providerId: dto.providerId,
        modelId: dto.modelId,
        presetModelId: presetModel.id,
        name: dto.name ?? null,
        description: dto.description ?? null,
        group: dto.group ?? null,
        capabilities: dto.capabilities ?? null,
        inputModalities: dto.inputModalities ?? null,
        outputModalities: dto.outputModalities ?? null,
        endpointTypes: dto.endpointTypes ?? null,
        contextWindow: dto.contextWindow ?? null,
        maxOutputTokens: dto.maxOutputTokens ?? null,
        supportsStreaming: dto.supportsStreaming ?? null,
        reasoning: dto.reasoning ?? null
      }

      const merged = mergeModelConfig(userRow, catalogOverride, presetModel, dto.providerId)

      values = {
        providerId: dto.providerId,
        modelId: dto.modelId,
        modelApiId: catalogOverride?.apiModelId ?? null,
        presetModelId: presetModel.id,
        name: merged.name,
        description: merged.description ?? null,
        group: merged.group ?? null,
        capabilities: merged.capabilities as string[],
        inputModalities: (merged.inputModalities as string[]) ?? null,
        outputModalities: (merged.outputModalities as string[]) ?? null,
        endpointTypes: (merged.endpointTypes as string[]) ?? null,
        contextWindow: merged.contextWindow ?? null,
        maxOutputTokens: merged.maxOutputTokens ?? null,
        supportsStreaming: merged.supportsStreaming,
        reasoning: merged.reasoning ?? null,
        parameters: merged.parameters ?? null,
        pricing: merged.pricing ?? null
      }

      logger.info('Created model with catalog enrichment', {
        providerId: dto.providerId,
        modelId: dto.modelId,
        presetModelId: presetModel.id
      })
    } else {
      // No catalog match — store as custom model
      values = {
        providerId: dto.providerId,
        modelId: dto.modelId,
        presetModelId: dto.presetModelId ?? null,
        name: dto.name ?? null,
        description: dto.description ?? null,
        group: dto.group ?? null,
        capabilities: dto.capabilities ?? null,
        inputModalities: dto.inputModalities ?? null,
        outputModalities: dto.outputModalities ?? null,
        endpointTypes: dto.endpointTypes ?? null,
        contextWindow: dto.contextWindow ?? null,
        maxOutputTokens: dto.maxOutputTokens ?? null,
        supportsStreaming: dto.supportsStreaming ?? null,
        reasoning: dto.reasoning ?? null,
        parameters: dto.parameters ?? null,
        pricing: dto.pricing ?? null
      }

      logger.info('Created custom model (no catalog match)', {
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
    const db = dbService.getDb()

    // Verify model exists
    await this.getByKey(providerId, modelId)

    // Build update object
    const updates: Partial<NewUserModel> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.description !== undefined) updates.description = dto.description
    if (dto.group !== undefined) updates.group = dto.group
    if (dto.capabilities !== undefined) updates.capabilities = dto.capabilities
    if (dto.endpointTypes !== undefined) updates.endpointTypes = dto.endpointTypes
    if (dto.supportsStreaming !== undefined) updates.supportsStreaming = dto.supportsStreaming
    if (dto.contextWindow !== undefined) updates.contextWindow = dto.contextWindow
    if (dto.maxOutputTokens !== undefined) updates.maxOutputTokens = dto.maxOutputTokens
    if (dto.reasoning !== undefined) updates.reasoning = dto.reasoning
    if (dto.pricing !== undefined) updates.pricing = dto.pricing
    if (dto.isEnabled !== undefined) updates.isEnabled = dto.isEnabled
    if (dto.isHidden !== undefined) updates.isHidden = dto.isHidden
    if (dto.sortOrder !== undefined) updates.sortOrder = dto.sortOrder
    if (dto.notes !== undefined) updates.notes = dto.notes

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
    const db = dbService.getDb()

    // Verify model exists
    await this.getByKey(providerId, modelId)

    await db
      .delete(userModelTable)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))

    logger.info('Deleted model', { providerId, modelId })
  }

  /**
   * Batch upsert models for a provider (used by CatalogService)
   * Inserts new models, updates existing ones.
   */
  async batchUpsert(models: NewUserModel[]): Promise<void> {
    if (models.length === 0) return

    const db = dbService.getDb()

    for (const model of models) {
      await db
        .insert(userModelTable)
        .values(model)
        .onConflictDoUpdate({
          target: [userModelTable.providerId, userModelTable.modelId],
          set: {
            presetModelId: model.presetModelId,
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
        })
    }

    logger.info('Batch upserted models', { count: models.length, providerId: models[0]?.providerId })
  }
}

export const modelService = ModelService.getInstance()
