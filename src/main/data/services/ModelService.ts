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
import { inferReasoningOwnedBy } from '@cherrystudio/provider-registry'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import type { InsertUserModelRow, UserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { defaultHandlersFor, type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { pinService } from '@data/services/PinService'
import {
  createCustomModel,
  inferCustomModelReasoning,
  matchesModelPricingBaseline,
  mergePresetModel,
  projectRuntimeReasoning,
  providerRegistryService,
  type ReasoningProviderContext,
  type ResolvedReasoningProfile,
  type ResolvedServiceTierControl
} from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CreateModelDto, ListModelsQuery, UpdateModelDto } from '@shared/data/api/schemas/models'
import {
  CHERRY_CLOUD_PROVIDER_ID,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID,
  isManagedCherryAiDefaultModel,
  isManagedCherryCloudModel
} from '@shared/data/presets/cherryai'
import type {
  EndpointType,
  Modality,
  Model,
  ModelCapability,
  RuntimeModelPricing,
  RuntimeParameterSupport,
  RuntimeReasoning
} from '@shared/data/types/model'
import { createUniqueModelId, MODEL_CAPABILITY, ReasoningConfigSchema } from '@shared/data/types/model'
import { and, asc, eq, inArray, ne, type SQL } from 'drizzle-orm'
import { isEqual } from 'es-toolkit/compat'

const logger = loggerService.withContext('DataApi:ModelService')
const SQLITE_INARRAY_CHUNK = 500

/** Reason string for DataApiError when deleting a model currently set as a user default */
const MODEL_IN_USE_AS_DEFAULT_REASON = 'model is in use as the default model'

const PRESET_DELTA_FIELDS = [
  'name',
  'description',
  'group',
  'capabilities',
  'inputModalities',
  'outputModalities',
  'endpointTypes',
  'contextWindow',
  'maxInputTokens',
  'maxOutputTokens',
  'supportsStreaming',
  'parameters',
  'pricing'
] as const

type PresetDeltaField = (typeof PRESET_DELTA_FIELDS)[number]

const PRESET_DELTA_FIELD_SET: ReadonlySet<string> = new Set(PRESET_DELTA_FIELDS)

function isPresetDeltaField(field: string): field is PresetDeltaField {
  return PRESET_DELTA_FIELD_SET.has(field)
}

/** Resolve the set of UniqueModelIds currently set as user defaults (chat / quick-assistant / translate). */
function getUserDefaultModelIds(): Set<string> {
  const preferenceService = application.get('PreferenceService')
  const ids = [
    preferenceService.get('chat.default_model_id'),
    preferenceService.get('feature.quick_assistant.model_id'),
    preferenceService.get('feature.translate.model_id')
  ].filter((id): id is string => typeof id === 'string' && id.length > 0)
  return new Set(ids)
}

/** Throw INVALID_OPERATION if the model is currently set as a user default. */
function assertModelNotUsedAsDefaultModel(uniqueModelId: string, operation: string): void {
  if (getUserDefaultModelIds().has(uniqueModelId)) {
    throw DataApiErrorFactory.invalidOperation(operation, MODEL_IN_USE_AS_DEFAULT_REASON)
  }
}

function assertManagedCherryAiDefaultModelPatchAllowed(providerId: string, modelId: string, dto: UpdateModelDto): void {
  if (!isManagedCherryAiDefaultModel(providerId, modelId) || Object.keys(dto).length === 0) {
    return
  }

  assertManagedCherryAiDefaultModelMutationAllowed(providerId, modelId, `update model ${providerId}/${modelId}`)
}

function assertManagedCherryAiDefaultModelMutationAllowed(
  providerId: string,
  modelId: string,
  operation: string
): void {
  if (!isManagedCherryAiDefaultModel(providerId, modelId)) {
    return
  }

  throw DataApiErrorFactory.invalidOperation(operation, 'managed CherryAI default model cannot be modified')
}

function assertProvidersAvailable(providerIds: Iterable<string>): void {
  for (const providerId of new Set(providerIds)) {
    providerService.assertAvailable(providerId)
  }
}

function assertProviderModelsAreUserManaged(providerId: string, operation: string): void {
  if (!isManagedCherryCloudModel(providerId)) return
  throw DataApiErrorFactory.invalidOperation(operation, 'externally managed provider models cannot be modified')
}

/**
 * Registry data for model creation.
 * Must stay in sync with the return type of {@link ProviderRegistryService.lookupModel}.
 * Defined explicitly (not via ReturnType) to avoid a circular import.
 */
type CreateModelRegistryData = ModelLookupResult & {
  reasoningProfile: ResolvedReasoningProfile
  serviceTierControl?: ResolvedServiceTierControl
}

type ReconcileRemovalFilterResult = {
  toRemove: string[]
  presetBackedRemovalIds: Set<string>
}

/**
 * Subset of user-row fields that can override registry-derived baseline values.
 *
 * Status fields (`isEnabled`, `isHidden`) are intentionally excluded: they are
 * user state managed via `PATCH /models/:id`, not preset baseline overrides.
 * They are stored independently from registry-backed configuration.
 */
export interface UserModelOverlay {
  name?: string | null
  description?: string | null
  group?: string | null
  capabilities?: ModelCapability[] | null
  inputModalities?: Modality[] | null
  outputModalities?: Modality[] | null
  endpointTypes?: EndpointType[] | null
  contextWindow?: number | null
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
  supportsStreaming?: boolean | null
  parameterSupport?: RuntimeParameterSupport | null
  pricing?: RuntimeModelPricing | null
  // Persisted reasoning rows may have optional fields the runtime type requires;
  // applyUserOverlay narrows it via cast on copy.
  reasoning?: Partial<RuntimeReasoning> | null
}

/**
 * Apply user-row values on top of a registry-derived baseline Model.
 *
 * Composed with `providerRegistryService.mergePresetModel` to produce the
 * final merged Model: the registry service handles preset → override
 * resolution, and this overlay handles user precedence. `undefined` / `null`
 * mean "not set"; explicit empty strings and arrays are preserved.
 */
export function applyUserOverlay(baseline: Model, overlay: UserModelOverlay): Model {
  const result: Model = { ...baseline }

  if (overlay.capabilities != null) {
    result.capabilities = [...overlay.capabilities]
  }
  if (overlay.endpointTypes != null) {
    result.endpointTypes = [...overlay.endpointTypes]
  }
  if (overlay.inputModalities != null) {
    result.inputModalities = [...overlay.inputModalities]
  }
  if (overlay.outputModalities != null) {
    result.outputModalities = [...overlay.outputModalities]
  }
  if (overlay.name != null) {
    result.name = overlay.name
  }
  if (overlay.description != null) {
    result.description = overlay.description
  }
  if (overlay.contextWindow != null) {
    result.contextWindow = overlay.contextWindow
  }
  if (overlay.maxInputTokens != null) {
    result.maxInputTokens = overlay.maxInputTokens
  }
  if (overlay.maxOutputTokens != null) {
    result.maxOutputTokens = overlay.maxOutputTokens
  }
  if (overlay.reasoning) {
    result.reasoning = overlay.reasoning as RuntimeReasoning
  }
  if (overlay.supportsStreaming != null) {
    result.supportsStreaming = overlay.supportsStreaming
  }
  if (overlay.group != null) {
    result.group = overlay.group
  }
  if (overlay.parameterSupport != null) {
    result.parameterSupport = overlay.parameterSupport
  }
  if (overlay.pricing != null) {
    result.pricing = overlay.pricing
  }

  return result
}

export interface CreateModelInput {
  dto: CreateModelDto
  registryData?: CreateModelRegistryData
}

export interface ManagedModelReconcilePayload {
  toAdd: Array<Omit<CreateModelDto, 'providerId'>>
  toUpdate: Array<{ modelId: string; patch: UpdateModelDto }>
  toRemove: string[]
}

export interface ManagedModelWriter {
  reconcile(payload: ManagedModelReconcilePayload): Model[]
}

interface ProviderModelReconcilePayload {
  toAdd: CreateModelInput[]
  toUpdate: Array<{ modelId: string; patch: UpdateModelDto }>
  toRemove: string[]
}

interface ProviderModelReconcileResult {
  models: Model[]
  deletedIds: string[]
}

type NewUserModelInput = Omit<InsertUserModelRow, 'orderKey'>

function createModelsSqliteHandlers(values: NewUserModelInput[]): SqliteErrorHandlers {
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

function deleteModelsSqliteHandlers(identifier: string): SqliteErrorHandlers {
  return {
    foreignKey: () =>
      DataApiErrorFactory.invalidOperation(`delete model ${identifier}`, 'model is in use by a knowledge base')
  } satisfies SqliteErrorHandlers
}

/**
 * Mapping from UpdateModelDto field → DB column for the update path.
 * Entries are either a shared key name, or [dtoKey, dbColumn] when names differ.
 * Exported for test coverage — ensures no DTO field is silently dropped.
 */
export const UPDATE_MODEL_FIELD_MAP: Array<keyof UpdateModelDto | [keyof UpdateModelDto, keyof InsertUserModelRow]> = [
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
  'maxInputTokens',
  'maxOutputTokens',
  'pricing',
  'isEnabled',
  'isHidden',
  'isDeprecated',
  'notes'
]

/** Convert CreateModelDto to an InsertUserModelRow (shared by preset and custom paths). */
function dtoToNewUserModel(dto: CreateModelDto): NewUserModelInput {
  return {
    id: createUniqueModelId(dto.providerId, dto.modelId),
    providerId: dto.providerId,
    modelId: dto.modelId,
    presetModelId: null,
    name: dto.name ?? dto.modelId,
    description: dto.description ?? null,
    group: dto.group ?? null,
    capabilities: (dto.capabilities ?? []) as ModelCapability[],
    inputModalities: (dto.inputModalities ?? null) as Modality[] | null,
    inputModalitiesExplicit: dto.inputModalities !== undefined,
    outputModalities: (dto.outputModalities ?? null) as Modality[] | null,
    endpointTypes: (dto.endpointTypes ?? null) as EndpointType[] | null,
    contextWindow: dto.contextWindow ?? null,
    maxInputTokens: dto.maxInputTokens ?? null,
    maxOutputTokens: dto.maxOutputTokens ?? null,
    supportsStreaming: dto.supportsStreaming ?? true,
    reasoning: null,
    parameters: dto.parameterSupport ?? null,
    pricing: dto.pricing ?? null,
    isEnabled: true,
    isHidden: false
  }
}

function dtoKeyToDbKey(key: keyof UpdateModelDto): string {
  const mapping = UPDATE_MODEL_FIELD_MAP.find((entry) => (Array.isArray(entry) ? entry[0] === key : false))
  return mapping && Array.isArray(mapping) ? mapping[1] : key
}

function getBaselineField(model: Model, field: PresetDeltaField): unknown {
  if (field === 'parameters') return model.parameterSupport
  return model[field as keyof Model]
}

function matchesBaseline(value: unknown, baseline: unknown, field: PresetDeltaField): boolean {
  if (field === 'pricing') {
    return matchesModelPricingBaseline(value, baseline)
  }
  return isEqual(value, baseline)
}

function collectPresetDeltaFields(dto: CreateModelDto | UpdateModelDto, baseline: Model | null): PresetDeltaField[] {
  const deltaFields = new Set<PresetDeltaField>()

  for (const key of Object.keys(dto) as (keyof UpdateModelDto)[]) {
    const field = dtoKeyToDbKey(key)
    if (!isPresetDeltaField(field)) continue

    const value = dto[key]
    if (value === undefined) continue
    if (!baseline || !matchesBaseline(value, getBaselineField(baseline, field), field)) {
      deltaFields.add(field)
    }
  }

  return [...deltaFields]
}

function presetDeltaToNewUserModel(
  dto: CreateModelDto,
  presetModelId: string,
  deltaFields: readonly PresetDeltaField[]
): NewUserModelInput {
  const fields = new Set(deltaFields)
  return {
    id: createUniqueModelId(dto.providerId, dto.modelId),
    providerId: dto.providerId,
    modelId: dto.modelId,
    presetModelId,
    name: fields.has('name') ? (dto.name ?? null) : null,
    description: fields.has('description') ? (dto.description ?? null) : null,
    group: fields.has('group') ? (dto.group ?? null) : null,
    capabilities: fields.has('capabilities') ? ((dto.capabilities ?? null) as ModelCapability[] | null) : null,
    inputModalities: fields.has('inputModalities') ? ((dto.inputModalities ?? null) as Modality[] | null) : null,
    inputModalitiesExplicit: fields.has('inputModalities'),
    outputModalities: fields.has('outputModalities') ? ((dto.outputModalities ?? null) as Modality[] | null) : null,
    endpointTypes: fields.has('endpointTypes') ? ((dto.endpointTypes ?? null) as EndpointType[] | null) : null,
    contextWindow: fields.has('contextWindow') ? (dto.contextWindow ?? null) : null,
    maxInputTokens: fields.has('maxInputTokens') ? (dto.maxInputTokens ?? null) : null,
    maxOutputTokens: fields.has('maxOutputTokens') ? (dto.maxOutputTokens ?? null) : null,
    supportsStreaming: fields.has('supportsStreaming') ? (dto.supportsStreaming ?? null) : null,
    reasoning: null,
    parameters: fields.has('parameters') ? (dto.parameterSupport ?? null) : null,
    pricing: fields.has('pricing') ? (dto.pricing ?? null) : null,
    isEnabled: true,
    isHidden: false
  }
}

function applyStoredPresetDeltas(baseline: Model, row: UserModelRow): Model {
  return applyUserOverlay(baseline, {
    name: row.name,
    description: row.description,
    group: row.group,
    capabilities: row.capabilities,
    inputModalities: row.inputModalities,
    outputModalities: row.outputModalities,
    endpointTypes: row.endpointTypes,
    contextWindow: row.contextWindow,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    supportsStreaming: row.supportsStreaming,
    parameterSupport: row.parameters as RuntimeParameterSupport | null,
    pricing: row.pricing
  })
}

/** Convert a complete custom-model row to a runtime entity. */
type CompleteCustomModelRow = UserModelRow & {
  presetModelId: null
  name: string
  capabilities: ModelCapability[]
  supportsStreaming: boolean
}

function assertCompleteCustomModelRow(row: UserModelRow): asserts row is CompleteCustomModelRow {
  if (row.presetModelId !== null || row.name === null || row.capabilities === null || row.supportsStreaming === null) {
    throw new Error(`Custom model row '${row.id}' violates user_model_custom_config_check`)
  }
}

function customRowToRuntimeModel(row: UserModelRow): Model {
  assertCompleteCustomModelRow(row)
  const reasoning = row.reasoning ? ReasoningConfigSchema.parse(row.reasoning) : undefined

  return {
    id: createUniqueModelId(row.providerId, row.modelId),
    providerId: row.providerId,
    apiModelId: row.modelId,
    presetModelId: row.presetModelId,
    name: row.name,
    description: row.description ?? undefined,
    group: row.group ?? undefined,
    capabilities: row.capabilities,
    inputModalities: row.inputModalities ?? undefined,
    outputModalities: row.outputModalities ?? undefined,
    contextWindow: row.contextWindow ?? undefined,
    maxInputTokens: row.maxInputTokens ?? undefined,
    maxOutputTokens: row.maxOutputTokens ?? undefined,
    endpointTypes: row.endpointTypes ?? undefined,
    supportsStreaming: row.supportsStreaming,
    // Strip legacy fields (notably `type`) and materialize the runtime-only
    // selection list until registry enrichment projects the active profile.
    reasoning: reasoning ? { ...reasoning, selectableEfforts: reasoning.selectableEfforts ?? [] } : undefined,
    parameterSupport: (row.parameters ?? undefined) as RuntimeParameterSupport | undefined,
    pricing: row.pricing ?? undefined,
    isEnabled: row.isEnabled,
    isHidden: row.isHidden,
    isDeprecated: row.isDeprecated,
    notes: row.notes ?? undefined
  }
}

function applyStoredModelState(model: Model, row: UserModelRow): Model {
  return {
    ...model,
    id: createUniqueModelId(row.providerId, row.modelId),
    providerId: row.providerId,
    apiModelId: row.modelId,
    presetModelId: row.presetModelId,
    isEnabled: row.isEnabled,
    isHidden: row.isHidden,
    isDeprecated: row.isDeprecated,
    notes: row.notes ?? undefined
  }
}

function createPresetFallback(
  row: UserModelRow,
  profile?: ResolvedReasoningProfile['wire'],
  serviceTierControl?: ResolvedServiceTierControl
): Model {
  const baseline = createCustomModel(row.providerId, row.modelId, profile, serviceTierControl)
  return applyStoredModelState(applyStoredPresetDeltas(baseline, row), row)
}

class ModelService {
  private getRegistryBaseline(
    providerId: string,
    modelId: string,
    reasoningConfigCache?: Map<string, ReasoningProviderContext>
  ): Model | null {
    const { presetModel, registryOverride, reasoningProfile, serviceTierControl } = providerRegistryService.lookupModel(
      providerId,
      modelId,
      reasoningConfigCache
    )
    if (!presetModel) return null
    return mergePresetModel(
      presetModel,
      registryOverride,
      providerId,
      reasoningProfile.wire,
      reasoningProfile.support,
      serviceTierControl
    )
  }

  private buildCreateValues(dto: CreateModelDto, registryData?: CreateModelRegistryData): NewUserModelInput {
    const presetModel = registryData?.presetModel ?? null
    const dtoValues = dtoToNewUserModel(dto)

    if (presetModel) {
      const baseline = mergePresetModel(
        presetModel,
        registryData?.registryOverride ?? null,
        dto.providerId,
        registryData?.reasoningProfile.wire,
        registryData?.reasoningProfile.support,
        registryData?.serviceTierControl
      )
      const deltaFields = collectPresetDeltaFields(dto, baseline)
      return presetDeltaToNewUserModel(dto, presetModel.id, deltaFields)
    }

    // No preset: a custom model. When the id/capabilities say the model reasons,
    // infer the controls from the registry heuristics so custom rows are
    // descriptor-driven like catalog rows (#16598).
    if (dtoValues.reasoning == null) {
      const declaredReasoning = (dtoValues.capabilities ?? []).includes(MODEL_CAPABILITY.REASONING)
      const inferred =
        inferCustomModelReasoning(dto.modelId, registryData?.reasoningProfile.wire, { declaredReasoning }) ??
        (declaredReasoning && registryData?.reasoningProfile.format === 'ollama'
          ? projectRuntimeReasoning(
              {
                controls: [{ kind: 'toggle' }, { kind: 'effort', values: ['low', 'medium', 'high'] }]
              },
              registryData.reasoningProfile.wire
            )
          : undefined)
      if (inferred) dtoValues.reasoning = inferred
    }

    return dtoValues
  }

  private buildUpdates(existing: UserModelRow, dto: UpdateModelDto): Partial<InsertUserModelRow> {
    const updates: Partial<InsertUserModelRow> = {}
    const hasPresetDeltaField = (Object.keys(dto) as (keyof UpdateModelDto)[])
      .map(dtoKeyToDbKey)
      .some(isPresetDeltaField)

    let baseline: Model | null = null
    if (existing.presetModelId && hasPresetDeltaField) {
      try {
        baseline = this.getRegistryBaseline(existing.providerId, existing.modelId)
      } catch (error) {
        logger.warn('Registry baseline lookup failed; preserving model fields as user overrides', {
          providerId: existing.providerId,
          modelId: existing.modelId,
          error
        })
      }
    }

    for (const entry of UPDATE_MODEL_FIELD_MAP) {
      const [dtoKey, dbKey] = Array.isArray(entry) ? entry : [entry, entry as keyof InsertUserModelRow]
      const value = dto[dtoKey]
      if (value === undefined) continue

      if (existing.presetModelId && isPresetDeltaField(String(dbKey))) {
        const field = String(dbKey) as PresetDeltaField
        if (baseline && matchesBaseline(value, getBaselineField(baseline, field), field)) {
          ;(updates as Record<string, unknown>)[dbKey] = null
        } else {
          ;(updates as Record<string, unknown>)[dbKey] = value
        }
      } else {
        ;(updates as Record<string, unknown>)[dbKey] = value
      }
    }
    if (dto.inputModalities !== undefined) updates.inputModalitiesExplicit = true
    return updates
  }

  private filterReconcileRemovals(providerId: string, toRemove: string[], db: DbType): ReconcileRemovalFilterResult {
    if (toRemove.length === 0) {
      return { toRemove, presetBackedRemovalIds: new Set() }
    }

    const rows: { id: string; presetModelId: string | null }[] = []
    for (let i = 0; i < toRemove.length; i += SQLITE_INARRAY_CHUNK) {
      const chunk = toRemove.slice(i, i + SQLITE_INARRAY_CHUNK)
      rows.push(
        ...db
          .select({
            id: userModelTable.id,
            presetModelId: userModelTable.presetModelId
          })
          .from(userModelTable)
          .where(and(eq(userModelTable.providerId, providerId), inArray(userModelTable.id, chunk)))
          .all()
      )
    }

    const managedDefaultIds = new Set<string>()
    const presetBackedRemovalIds = new Set<string>()
    const customModelIds = new Set<string>()
    for (const row of rows) {
      if (providerId === CHERRYAI_PROVIDER_ID && row.id === CHERRYAI_DEFAULT_UNIQUE_MODEL_ID) {
        managedDefaultIds.add(row.id)
      } else if (row.presetModelId != null && row.presetModelId !== '') {
        presetBackedRemovalIds.add(row.id)
      } else {
        customModelIds.add(row.id)
      }
    }

    // Protect models currently set as user defaults (chat / quick-assistant / translate)
    // from being deleted during pull-reconcile. Deleting the user's chosen model while
    // the preference still points to it causes 404s on every readDefaultModel() call.
    const userDefaultIds = new Set<string>()
    const userDefaultsSet = getUserDefaultModelIds()
    for (const row of rows) {
      if (userDefaultsSet.has(row.id)) {
        userDefaultIds.add(row.id)
      }
    }
    if (userDefaultIds.size > 0) {
      logger.warn('Skipped user-default model removal during reconcile', {
        providerId,
        skippedCount: userDefaultIds.size,
        skippedIds: [...userDefaultIds]
      })
    }

    const removableCustomModelIds = new Set([...customModelIds].filter((id) => !userDefaultIds.has(id)))

    if (managedDefaultIds.size > 0) {
      logger.warn('Skipped managed CherryAI default model removal during reconcile', {
        providerId,
        skippedCount: managedDefaultIds.size,
        skippedIds: [...managedDefaultIds]
      })
    }

    if (removableCustomModelIds.size > 0) {
      logger.warn('Skipped custom model removal during reconcile', {
        providerId,
        skippedCount: removableCustomModelIds.size,
        skippedIds: [...removableCustomModelIds]
      })
    }

    return {
      toRemove: toRemove.filter(
        (id) => !managedDefaultIds.has(id) && !userDefaultIds.has(id) && !removableCustomModelIds.has(id)
      ),
      presetBackedRemovalIds
    }
  }

  /**
   * List models with optional filters
   */
  list(query: ListModelsQuery): Model[] {
    const db = application.get('DbService').getDb()

    if (query.providerId && !providerService.isAvailableByProviderId(query.providerId)) {
      return []
    }

    const availableProviderIds = query.providerId ? undefined : providerService.listAvailableProviderIds()

    const conditions: SQL[] = []

    if (query.providerId) {
      conditions.push(eq(userModelTable.providerId, query.providerId))
    }

    if (query.enabled !== undefined) {
      conditions.push(eq(userModelTable.isEnabled, query.enabled))
    }

    if (!query.includeAgentOnly) {
      conditions.push(ne(userModelTable.providerId, CHERRY_CLOUD_PROVIDER_ID))
    }

    const rows = db
      .select()
      .from(userModelTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(userModelTable.providerId), asc(userModelTable.orderKey))
      .all()

    let models = this.enrichRowsFromRegistry(
      availableProviderIds ? rows.filter((row) => availableProviderIds.has(row.providerId)) : rows
    )

    // Post-filter by capability (JSON array column, can't filter in SQL easily)
    if (query.capability !== undefined) {
      const cap = query.capability as ModelCapability
      models = models.filter((m) => m.capabilities.includes(cap))
    }

    return models
  }

  /**
   * Registry resolution shared by every row-serving path. Preset-backed rows
   * use the current registry as their baseline and apply every non-null sparse
   * config column. Complete custom rows keep their row-owned identity and
   * capabilities while recognized models receive narrow metadata/reasoning
   * enrichment plus missing limits and pricing. Nothing is written back.
   */
  private enrichRowsFromRegistry(rows: UserModelRow[]): Model[] {
    const reasoningConfigCache = new Map<string, ReasoningProviderContext>()
    return rows.map((row) => {
      if (row.presetModelId) {
        try {
          const { presetModel, registryOverride, reasoningProfile, serviceTierControl } =
            providerRegistryService.lookupModel(row.providerId, row.modelId, reasoningConfigCache)
          if (!presetModel) {
            return createPresetFallback(row, reasoningProfile.wire, serviceTierControl)
          }

          const baseline = mergePresetModel(
            presetModel,
            registryOverride,
            row.providerId,
            reasoningProfile.wire,
            reasoningProfile.support,
            serviceTierControl
          )
          const resolved = applyStoredPresetDeltas(baseline, row)
          const imageGeneration = registryOverride?.imageGeneration ?? presetModel.imageGeneration
          return applyStoredModelState(imageGeneration ? { ...resolved, imageGeneration } : resolved, row)
        } catch (error) {
          logger.warn('Registry enrichment failed; serving preset-backed model with a minimal fallback', {
            providerId: row.providerId,
            modelId: row.modelId,
            error
          })
          return createPresetFallback(row)
        }
      }

      const model = customRowToRuntimeModel(row)
      const modelId = model.apiModelId
      if (!modelId) return model
      try {
        const { presetModel, registryOverride, reasoningProfile, serviceTierControl } =
          providerRegistryService.lookupModel(model.providerId, modelId, reasoningConfigCache)
        const imageGeneration = registryOverride?.imageGeneration ?? presetModel?.imageGeneration
        const registryModel = presetModel
          ? mergePresetModel(
              presetModel,
              registryOverride,
              model.providerId,
              reasoningProfile.wire,
              reasoningProfile.support,
              serviceTierControl
            )
          : undefined

        const updates: Partial<Model> = {}
        if (imageGeneration) updates.imageGeneration = imageGeneration
        if (model.description === undefined && registryModel?.description !== undefined) {
          updates.description = registryModel.description
        }
        const hasExplicitInputModalities =
          row.inputModalitiesExplicit || (row.inputModalities !== null && row.inputModalities.length > 0)
        if (!hasExplicitInputModalities && registryModel?.inputModalities !== undefined) {
          updates.inputModalities = registryModel.inputModalities
        }
        if (model.outputModalities === undefined && registryModel?.outputModalities !== undefined) {
          updates.outputModalities = registryModel.outputModalities
        }
        if (model.contextWindow === undefined && registryModel?.contextWindow !== undefined) {
          updates.contextWindow = registryModel.contextWindow
        }
        if (model.maxInputTokens === undefined && registryModel?.maxInputTokens !== undefined) {
          updates.maxInputTokens = registryModel.maxInputTokens
        }
        if (model.maxOutputTokens === undefined && registryModel?.maxOutputTokens !== undefined) {
          updates.maxOutputTokens = registryModel.maxOutputTokens
        }
        if (model.pricing === undefined && registryModel?.pricing !== undefined) {
          updates.pricing = registryModel.pricing
        }
        if (registryOverride?.supportsFastMode) updates.supportsFastMode = true
        if (serviceTierControl) {
          updates.requestControls = {
            serviceTier: { default: serviceTierControl.default, options: serviceTierControl.options }
          }
        }
        const ownedBy = registryOverride?.ownedBy ?? presetModel?.ownedBy ?? inferReasoningOwnedBy(modelId)
        if (ownedBy) updates.ownedBy = ownedBy
        let reasoning: RuntimeReasoning | undefined
        if (registryModel) {
          reasoning = registryModel.reasoning
        } else if (model.reasoning?.controls?.length) {
          reasoning = projectRuntimeReasoning(model.reasoning, reasoningProfile.wire)
        } else {
          reasoning = inferCustomModelReasoning(modelId, reasoningProfile.wire, {
            declaredReasoning: model.capabilities.includes(MODEL_CAPABILITY.REASONING)
          })
        }
        if (reasoning) updates.reasoning = reasoning
        else if (model.reasoning) updates.reasoning = undefined
        return Object.keys(updates).length > 0 ? { ...model, ...updates } : model
      } catch (error) {
        // A registry-lookup failure must not silently strip a model's
        // imageGeneration / capabilities — log so a real registry/IO fault
        // is diagnosable rather than masquerading as "model isn't image-gen".
        logger.warn('Registry enrichment failed; serving model without registry metadata', {
          providerId: model.providerId,
          modelId,
          error
        })
        return model
      }
    })
  }

  /**
   * Nullable lookup by UniqueModelId (`providerId::modelId`).
   *
   * Foreign services call this inside their own transaction when they need a
   * soft fallback instead of a thrown not-found error. The caller owns the
   * domain-specific validation message. Providers unavailable in the current
   * edition are treated as missing before the row is enriched.
   */
  findByIdTx(tx: Pick<DbType, 'select'>, id: string): Model | null {
    const [row] = tx.select().from(userModelTable).where(eq(userModelTable.id, id)).limit(1).all()
    return row && providerService.isAvailableByProviderId(row.providerId) ? this.enrichRowsFromRegistry([row])[0] : null
  }

  /** Check model existence under a provider available in the current edition. */
  existsByIdTx(tx: Pick<DbType, 'select'>, id: string): boolean {
    const [row] = tx
      .select({ id: userModelTable.id, providerId: userModelTable.providerId })
      .from(userModelTable)
      .where(eq(userModelTable.id, id))
      .limit(1)
      .all()
    return row !== undefined && providerService.isAvailableByProviderId(row.providerId)
  }

  /**
   * Batch-resolve `Model.name` for a set of UniqueModelIds.
   *
   * Foreign services use this on read paths to embed `modelName` on their
   * entity shape (e.g. `Assistant.modelName`) without N round-trips. Returns
   * a Map keyed by UniqueModelId; missing entries are absent so callers can
   * fall back to `null` without extra null-checks. Empty runtime names are
   * intentionally omitted — a blank label is no more useful than a missing
   * one for UI display.
   *
   * Input may include `null` / `undefined` / empty strings (convenient when
   * caller passes `rows.map(r => r.modelId)` and modelId is nullable); these
   * are filtered and the unique non-empty set is queried in a single
   * `IN (...)`.
   *
   * The `Tx` suffix and tx-first argument match the service-layer convention
   * for methods that may be composed inside another service's transaction.
   */
  getNamesByUniqueIdsTx(tx: Pick<DbType, 'select'>, uniqueIds: (string | null | undefined)[]): Map<string, string> {
    const result = new Map<string, string>()
    const ids = Array.from(new Set(uniqueIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    if (ids.length === 0) return result

    const rows = tx.select().from(userModelTable).where(inArray(userModelTable.id, ids)).all()

    const availableProviderIds = providerService.listAvailableProviderIds(rows.map((row) => row.providerId))
    for (const model of this.enrichRowsFromRegistry(rows.filter((row) => availableProviderIds.has(row.providerId)))) {
      if (model.name) result.set(model.id, model.name)
    }
    return result
  }

  /**
   * Get a model by composite key (providerId + modelId)
   */
  getByKey(providerId: string, modelId: string): Model {
    providerService.assertAvailable(providerId)

    const db = application.get('DbService').getDb()

    const [row] = db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
      .limit(1)
      .all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)
    }

    return this.enrichRowsFromRegistry([row])[0]
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
  create(items: CreateModelInput[]): Model[] {
    if (items.length === 0) return []
    assertProvidersAvailable(items.map(({ dto }) => dto.providerId))
    for (const { dto } of items) {
      assertProviderModelsAreUserManaged(dto.providerId, `create model ${dto.providerId}/${dto.modelId}`)
      assertManagedCherryAiDefaultModelMutationAllowed(
        dto.providerId,
        dto.modelId,
        `create model ${dto.providerId}/${dto.modelId}`
      )
    }

    const db = application.get('DbService').getDb()
    const values = items.map(({ dto, registryData }) => this.buildCreateValues(dto, registryData))

    const rows = withSqliteErrors(
      () =>
        db.transaction((tx) => {
          const results: UserModelRow[] = []
          for (const providerId of new Set(values.map((value) => value.providerId))) {
            const scopedValues = values.filter((value) => value.providerId === providerId)
            const inserted = insertManyWithOrderKey(tx, userModelTable, scopedValues, {
              pkColumn: userModelTable.id,
              scope: eq(userModelTable.providerId, providerId)
            }) as UserModelRow[]
            results.push(...inserted)
          }
          return results
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

    return this.enrichRowsFromRegistry(rows)
  }

  /**
   * Update an existing model
   */
  update(providerId: string, modelId: string, dto: UpdateModelDto): Model {
    providerService.assertAvailable(providerId)
    assertProviderModelsAreUserManaged(providerId, `update model ${providerId}/${modelId}`)
    assertManagedCherryAiDefaultModelPatchAllowed(providerId, modelId, dto)

    const db = application.get('DbService').getDb()

    // Fetch existing row (also verifies existence)
    const [existing] = db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
      .limit(1)
      .all()

    if (!existing) {
      throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)
    }

    const updates = this.buildUpdates(existing, dto)

    if (Object.keys(updates).length === 0) {
      return this.enrichRowsFromRegistry([existing])[0]
    }

    const [row] = db
      .update(userModelTable)
      .set(updates)
      .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
      .returning()
      .all()

    logger.info('Updated model', { providerId, modelId, changes: Object.keys(dto) })

    return this.enrichRowsFromRegistry([row])[0]
  }

  /**
   * Update many models atomically in a single transaction.
   *
   * Per-item semantics — field mapping via {@link UPDATE_MODEL_FIELD_MAP},
   * sparse-delta reduction, and the empty-patch short-circuit — exactly
   * mirror the row-level {@link ModelService.update} path; only the I/O shape
   * differs. Any not-found rolls the whole batch back so callers don't have
   * to reason about partial failure.
   *
   * @param items handler-parsed (providerId, modelId, patch) tuples
   */
  bulkUpdate(items: Array<{ providerId: string; modelId: string; patch: UpdateModelDto }>): Model[] {
    if (items.length === 0) return []
    assertProvidersAvailable(items.map((item) => item.providerId))

    const db = application.get('DbService').getDb()

    for (const { providerId, modelId, patch } of items) {
      assertProviderModelsAreUserManaged(providerId, `update model ${providerId}/${modelId}`)
      assertManagedCherryAiDefaultModelPatchAllowed(providerId, modelId, patch)
    }

    const rows = db.transaction((tx) => {
      const results: UserModelRow[] = []

      for (const { providerId, modelId, patch } of items) {
        const [existing] = tx
          .select()
          .from(userModelTable)
          .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
          .limit(1)
          .all()

        if (!existing) {
          throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)
        }

        const updates = this.buildUpdates(existing, patch)

        if (Object.keys(updates).length === 0) {
          results.push(existing)
          continue
        }

        const [row] = tx
          .update(userModelTable)
          .set(updates)
          .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
          .returning()
          .all()

        results.push(row)
      }

      return results
    })

    logger.info('Bulk updated models', {
      count: rows.length,
      providers: [...new Set(items.map((item) => item.providerId))]
    })

    return this.enrichRowsFromRegistry(rows)
  }

  /**
   * Apply a pull-reconcile diff atomically: remove the listed rows and insert
   * the new ones inside one transaction, then return the full model list for
   * the provider so the caller revalidates with the post-reconcile state.
   *
   * Removals are scoped by `providerId` so a caller cannot delete rows owned
   * by a different provider even if it passes a `UniqueModelId` that mentions
   * one. Pins for removed models are purged in the same transaction.
   */
  reconcileForProvider(providerId: string, payload: { toAdd: CreateModelInput[]; toRemove: string[] }): Model[] {
    providerService.assertAvailable(providerId)
    assertProviderModelsAreUserManaged(providerId, `reconcile models for provider ${providerId}`)
    if (payload.toAdd.length === 0 && payload.toRemove.length === 0) {
      return this.list({ providerId })
    }

    const db = application.get('DbService').getDb()
    const removalFilter = this.filterReconcileRemovals(providerId, payload.toRemove, db)
    const toRemove = removalFilter.toRemove
    const result = this.applyProviderModelReconcile(providerId, {
      toAdd: payload.toAdd,
      toUpdate: [],
      toRemove
    })
    const actuallyDeleted = result.deletedIds.length

    if (actuallyDeleted < toRemove.length) {
      // Stale renderer state — caller's toRemove referenced IDs that no longer
      // exist (concurrent edit, second window, race with another sync). The
      // transaction still succeeded but the renderer's diff was based on a
      // stale snapshot. Warn so debugging can correlate; the next /models
      // refetch will reconcile what the user actually sees.
      logger.warn('Reconcile toRemove count mismatch', {
        providerId,
        requestedRemove: toRemove.length,
        actuallyDeleted
      })
    }

    const deletedPresetBackedIds = result.deletedIds.filter((id) => removalFilter.presetBackedRemovalIds.has(id))
    if (deletedPresetBackedIds.length > 0) {
      logger.info('Deleted preset-backed models during reconcile', {
        providerId,
        deletedCount: deletedPresetBackedIds.length,
        deletedIds: deletedPresetBackedIds
      })
    }

    logger.info('Reconciled provider models', {
      providerId,
      added: payload.toAdd.length,
      removed: actuallyDeleted
    })

    return result.models
  }

  createManagedWriter(providerId: string): ManagedModelWriter {
    if (!isManagedCherryCloudModel(providerId)) {
      throw DataApiErrorFactory.invalidOperation(
        `create managed model writer for ${providerId}`,
        'provider models are not externally managed'
      )
    }

    return Object.freeze({
      reconcile: (payload: ManagedModelReconcilePayload): Model[] => {
        if (payload.toAdd.length === 0 && payload.toUpdate.length === 0 && payload.toRemove.length === 0) {
          return this.list({ providerId, includeAgentOnly: true })
        }

        const result = this.applyProviderModelReconcile(providerId, {
          toAdd: payload.toAdd.map((dto) => ({ dto: { ...dto, providerId } })),
          toUpdate: payload.toUpdate,
          toRemove: payload.toRemove.map((modelId) => createUniqueModelId(providerId, modelId))
        })
        notifyDataApiDataChange([{ endpoint: '/models', kind: 'membership' }])
        logger.info('Reconciled externally managed provider models', {
          providerId,
          added: payload.toAdd.length,
          updated: payload.toUpdate.length,
          removed: result.deletedIds.length
        })
        return result.models
      }
    })
  }

  private applyProviderModelReconcile(
    providerId: string,
    payload: ProviderModelReconcilePayload
  ): ProviderModelReconcileResult {
    const dbService = application.get('DbService')
    const values = payload.toAdd.map(({ dto, registryData }) => this.buildCreateValues(dto, registryData))
    const deletedIds: string[] = []
    const rows = withSqliteErrors(
      () =>
        dbService.withWriteTx((tx) => {
          for (let i = 0; i < payload.toRemove.length; i += SQLITE_INARRAY_CHUNK) {
            const chunk = payload.toRemove.slice(i, i + SQLITE_INARRAY_CHUNK)
            const deletedRows = tx
              .delete(userModelTable)
              .where(and(eq(userModelTable.providerId, providerId), inArray(userModelTable.id, chunk)))
              .returning({ id: userModelTable.id })
              .all()
            deletedIds.push(...deletedRows.map((row) => row.id))
            if (deletedRows.length > 0) {
              pinService.purgeForEntitiesTx(
                tx,
                'model',
                deletedRows.map((row) => row.id)
              )
            }
          }

          for (const { modelId, patch } of payload.toUpdate) {
            const [existing] = tx
              .select()
              .from(userModelTable)
              .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
              .limit(1)
              .all()
            if (!existing) throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)

            const updates = this.buildUpdates(existing, patch)
            if (Object.keys(updates).length > 0) {
              tx.update(userModelTable)
                .set(updates)
                .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
                .run()
            }
          }

          // Chunk per-INSERT to stay under SQLite's compound-statement parameter limit.
          const INSERT_CHUNK_SIZE = 500
          for (let offset = 0; offset < values.length; offset += INSERT_CHUNK_SIZE) {
            insertManyWithOrderKey(tx, userModelTable, values.slice(offset, offset + INSERT_CHUNK_SIZE), {
              pkColumn: userModelTable.id,
              scope: eq(userModelTable.providerId, providerId)
            })
          }

          return tx
            .select()
            .from(userModelTable)
            .where(eq(userModelTable.providerId, providerId))
            .orderBy(asc(userModelTable.orderKey))
            .all() as UserModelRow[]
        }),
      createModelsSqliteHandlers(values)
    )

    if (deletedIds.length > 0) pinService.notifyPurged()
    return { models: this.enrichRowsFromRegistry(rows), deletedIds }
  }

  /**
   * Delete a model
   */
  delete(providerId: string, modelId: string): void {
    providerService.assertAvailable(providerId)
    assertProviderModelsAreUserManaged(providerId, `delete model ${providerId}/${modelId}`)
    assertManagedCherryAiDefaultModelMutationAllowed(providerId, modelId, `delete model ${providerId}/${modelId}`)

    const uniqueModelId = createUniqueModelId(providerId, modelId)
    assertModelNotUsedAsDefaultModel(uniqueModelId, `delete model ${uniqueModelId}`)

    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const rows = tx
            .delete(userModelTable)
            .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
            .returning({ id: userModelTable.id })
            .all()

          if (rows.length === 0) {
            throw DataApiErrorFactory.notFound('Model', `${providerId}/${modelId}`)
          }

          pinService.purgeForEntityTx(tx, 'model', rows[0].id)
        }),
      deleteModelsSqliteHandlers(`${providerId}/${modelId}`)
    )
    pinService.notifyPurged()

    logger.info('Deleted model', { providerId, modelId })
  }

  /**
   * Delete multiple models atomically.
   */
  bulkDelete(items: { providerId: string; modelId: string }[]): void {
    if (items.length === 0) return
    assertProvidersAvailable(items.map((item) => item.providerId))

    const uniqueItems = new Map<string, { providerId: string; modelId: string }>()

    for (const item of items) {
      assertProviderModelsAreUserManaged(item.providerId, `delete model ${item.providerId}/${item.modelId}`)
      assertManagedCherryAiDefaultModelMutationAllowed(
        item.providerId,
        item.modelId,
        `delete model ${item.providerId}/${item.modelId}`
      )
      uniqueItems.set(createUniqueModelId(item.providerId, item.modelId), item)
    }

    for (const [id, item] of uniqueItems) {
      assertModelNotUsedAsDefaultModel(id, `delete model ${item.providerId}/${item.modelId}`)
    }

    const ids = [...uniqueItems.keys()]

    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const existingIds = new Set<string>()
          for (let i = 0; i < ids.length; i += SQLITE_INARRAY_CHUNK) {
            const chunk = ids.slice(i, i + SQLITE_INARRAY_CHUNK)
            const existingRows = tx
              .select({ id: userModelTable.id })
              .from(userModelTable)
              .where(inArray(userModelTable.id, chunk))
              .all()
            for (const row of existingRows) existingIds.add(row.id)
          }

          const missingId = ids.find((id) => !existingIds.has(id))
          if (missingId) {
            throw DataApiErrorFactory.notFound('Model', missingId)
          }

          for (let i = 0; i < ids.length; i += SQLITE_INARRAY_CHUNK) {
            const chunk = ids.slice(i, i + SQLITE_INARRAY_CHUNK)
            const deletedRows = tx
              .delete(userModelTable)
              .where(inArray(userModelTable.id, chunk))
              .returning({ id: userModelTable.id })
              .all()

            if (deletedRows.length > 0) {
              pinService.purgeForEntitiesTx(
                tx,
                'model',
                deletedRows.map((row) => row.id)
              )
            }
          }
        }),
      deleteModelsSqliteHandlers(ids.length === 1 ? ids[0] : `batch(${ids.length} items)`)
    )
    pinService.notifyPurged()

    logger.info('Bulk deleted models', {
      count: ids.length,
      providers: [...new Set([...uniqueItems.values()].map((item) => item.providerId))]
    })
  }
}

const modelServiceImplementation = new ModelService()

export const modelService: Omit<ModelService, 'createManagedWriter'> = modelServiceImplementation

export function createManagedModelWriter(providerId: string): ManagedModelWriter {
  return modelServiceImplementation.createManagedWriter(providerId)
}
