/**
 * Model Service - handles model CRUD operations
 *
 * Provides business logic for:
 * - Model CRUD operations
 * - Row to Model conversion
 * - Registry import support
 */

import { application } from '@application'
import type { ModelLookupResult } from '@cherrystudio/provider-registry'
import type { NewUserModel, UserModel } from '@data/db/schemas/userModel'
import { isRegistryEnrichableField, userModelTable } from '@data/db/schemas/userModel'
import { defaultHandlersFor, type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
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
import type { ReasoningFormatType } from '@shared/data/types/provider'
import { mergeModelWithUser } from '@shared/data/utils/modelMerger'
import { and, eq, inArray, type SQL } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:ModelService')

/**
 * Registry data for model creation.
 * Must stay in sync with the return type of {@link ProviderRegistryService.lookupModel}.
 * Defined explicitly (not via ReturnType) to avoid a circular import.
 */
type CreateModelRegistryData = ModelLookupResult & {
  reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  defaultChatEndpoint?: EndpointType
}

export interface CreateModelInput {
  dto: CreateModelDto
  registryData?: CreateModelRegistryData
}

function createModelsSqliteHandlers(values: NewUserModel[]): SqliteErrorHandlers {
  const providerIds = [...new Set(values.map((value) => value.providerId))]
  const identifier =
    values.length === 1 ? `${values[0].providerId}/${values[0].modelId}` : `batch(${values.length} items)`
  const uniqueMessage =
    values.length === 1 ? `Model '${identifier}' already exists` : 'One or more models already exist'

  return {
    ...defaultHandlersFor('Model', identifier),
    unique: () => DataApiErrorFactory.conflict(uniqueMessage, 'Model'),
    foreignKey: () =>
      DataApiErrorFactory.notFound('Provider', providerIds.length === 1 ? providerIds[0] : providerIds.join(', '))
  }
}

/**
 * Mapping from UpdateModelDto field → DB column for the update path.
 * Entries are either a shared key name, or [dtoKey, dbColumn] when names differ.
 * Exported for test coverage — ensures no DTO field is silently dropped.
 */
export const UPDATE_MODEL_FIELD_MAP: Array<keyof UpdateModelDto | [keyof UpdateModelDto, keyof NewUserModel]> = [
  'name',
  'description',
  'group',
  'capabilities',
  'inputModalities',
  'outputModalities',
  'endpointTypes',
  ['parameterSupport', 'parameters'],
  'supportsStreaming',
  'contextWindow',
  'maxOutputTokens',
  'reasoning',
  'pricing',
  'isEnabled',
  'isHidden',
  'isDeprecated',
  'sortOrder',
  'notes'
]

/** Convert CreateModelDto to a NewUserModel row (shared by preset and custom paths). */
function dtoToNewUserModel(dto: CreateModelDto): NewUserModel {
  return {
    id: createUniqueModelId(dto.providerId, dto.modelId),
    providerId: dto.providerId,
    modelId: dto.modelId,
    presetModelId: null,
    name: dto.name ?? null,
    description: dto.description ?? null,
    group: dto.group ?? null,
    capabilities: (dto.capabilities ?? null) as ModelCapability[] | null,
    inputModalities: (dto.inputModalities ?? null) as Modality[] | null,
    outputModalities: (dto.outputModalities ?? null) as Modality[] | null,
    endpointTypes: (dto.endpointTypes ?? null) as EndpointType[] | null,
    contextWindow: dto.contextWindow ?? null,
    maxOutputTokens: dto.maxOutputTokens ?? null,
    supportsStreaming: dto.supportsStreaming ?? null,
    reasoning: dto.reasoning ?? null,
    parameters: dto.parameterSupport ?? null,
    pricing: dto.pricing ?? null
  }
}

/** Convert a merged Model back to a NewUserModel row for DB insert. */
function mergedModelToNewUserModel(
  providerId: string,
  modelId: string,
  presetModelId: string,
  merged: Model
): NewUserModel {
  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    modelId,
    presetModelId,
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
    pricing: merged.pricing ?? null,
    isEnabled: merged.isEnabled,
    isHidden: merged.isHidden
  }
}

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
    presetModelId: row.presetModelId ?? undefined,
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
    isHidden: row.isHidden ?? false,
    isDeprecated: row.isDeprecated ?? false,
    sortOrder: row.sortOrder ?? undefined,
    notes: row.notes ?? undefined
  }
}

class ModelService {
  private buildCreateValues(dto: CreateModelDto, registryData?: CreateModelRegistryData): NewUserModel {
    const presetModel = registryData?.presetModel ?? null
    const registryOverride = registryData?.registryOverride ?? null
    const reasoningFormatTypes = registryData?.reasoningFormatTypes
    const defaultChatEndpoint = registryData?.defaultChatEndpoint

    const dtoValues = dtoToNewUserModel(dto)

    if (presetModel) {
      const merged = mergeModelWithUser(
        { ...dtoValues, presetModelId: presetModel.id },
        registryOverride,
        presetModel,
        dto.providerId,
        reasoningFormatTypes,
        defaultChatEndpoint
      )

      return mergedModelToNewUserModel(dto.providerId, dto.modelId, presetModel.id, merged)
    }

    return { ...dtoValues, presetModelId: dto.presetModelId ?? null }
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
   * Create one or more models under a single collection-oriented contract.
   *
   * Automatically enriches from registry preset data when a match is found.
   * DTO values take priority over registry (user > registryOverride > preset).
   *
   * Design intent:
   * - Service exposes one `create` entrypoint instead of separate single/batch variants.
   * - Input is always an array so create semantics stay aligned with `POST /models`.
   * - Transaction atomicity remains identical for single-item and multi-item calls.
   * - Renderer and other callers can still offer single-item convenience by
   *   wrapping one DTO into a one-element array before crossing the boundary.
   *
   * This is a deliberate service-boundary choice, not an implementation shortcut.
   *
   * @param items - Create inputs with optional pre-looked-up registry data so
   * the handler can resolve registry metadata without introducing a circular
   * dependency between ModelService and ProviderRegistryService.
   */
  async create(items: CreateModelInput[]): Promise<Model[]> {
    if (items.length === 0) return []

    const db = application.get('DbService').getDb()
    const values = items.map(({ dto, registryData }) => this.buildCreateValues(dto, registryData))

    const rows = await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          return await tx.insert(userModelTable).values(values).returning()
        }),
      createModelsSqliteHandlers(values)
    )

    if (items.length === 1) {
      const [{ dto, registryData }] = items
      const firstValue = values[0]

      if (registryData?.presetModel) {
        logger.info('Created model with registry enrichment', {
          providerId: dto.providerId,
          modelId: dto.modelId,
          presetModelId: firstValue?.presetModelId
        })
      } else {
        logger.info('Created custom model (no registry match)', {
          providerId: dto.providerId,
          modelId: dto.modelId
        })
      }
    } else {
      logger.info('Created models', {
        count: rows.length,
        providers: [...new Set(values.map((value) => value.providerId))]
      })
    }

    return rows.map(rowToRuntimeModel)
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

    const updates: Partial<NewUserModel> = {}
    for (const entry of UPDATE_MODEL_FIELD_MAP) {
      const [dtoKey, dbKey] = Array.isArray(entry) ? entry : [entry, entry as keyof NewUserModel]
      if (dto[dtoKey] !== undefined) {
        ;(updates as Record<string, unknown>)[dbKey] = dto[dtoKey]
      }
    }

    // Track which registry-enrichable fields the user explicitly changed
    // Map DTO keys to DB column names (e.g. parameterSupport → parameters)
    const dtoToDbKey = (key: string): string => {
      const mapping = UPDATE_MODEL_FIELD_MAP.find((entry) => (Array.isArray(entry) ? entry[0] === key : false))
      return mapping && Array.isArray(mapping) ? mapping[1] : key
    }
    const changedEnrichableFields = Object.keys(dto).map(dtoToDbKey).filter(isRegistryEnrichableField)
    if (changedEnrichableFields.length > 0) {
      const existingOverrides = existing.userOverrides ?? []
      updates.userOverrides = [...new Set([...existingOverrides, ...changedEnrichableFields])]
    }

    if (Object.keys(updates).length === 0) {
      return rowToRuntimeModel(existing)
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

    const deleted = await db
      .delete(userModelTable)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
      .returning({ id: userModelTable.id })

    if (deleted.length === 0) {
      throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)
    }

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

    await db.transaction(async (tx) => {
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

        await tx
          .insert(userModelTable)
          .values(model)
          .onConflictDoUpdate({
            target: [userModelTable.providerId, userModelTable.modelId],
            set
          })
      }
    })

    logger.info('Batch upserted models', { count: models.length, providerId: models[0]?.providerId })
  }
}

export const modelService = new ModelService()
