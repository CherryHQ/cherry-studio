/**
 * Migrates legacy Redux llm providers/models into v2 user tables.
 *
 * Also owns the one-shot migration of the legacy Dexie `pinned:models` key
 * into the `pin` table (entityType='model'). `pinned:models` is therefore
 * intentionally NOT classified as a preference in classification.json —
 * codegen must not emit a generic preference mapping for it, or the same
 * data would be written twice.
 */

import { application } from '@application'
import type { EndpointType, Modality, ModelCapability } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { pinTable } from '@data/db/schemas/pin'
import type { NewUserModel } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { NewUserProvider } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { assignOrderKeysByScope, assignOrderKeysInSequence } from '@data/migration/v2/utils/orderKey'
import { applyUserOverlay } from '@data/services/ModelService'
import { extractReasoningFormatTypes, mergePresetModel } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ApiFeatures, EndpointConfig } from '@shared/data/types/provider'
import type { Provider as LegacyProvider } from '@types'
import { eq, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { type OldLlmSettings, transformModel, transformProvider } from './mappings/ProviderModelMappings'

const logger = loggerService.withContext('ProviderModelMigrator')

const BATCH_SIZE = 100

const PROVIDER_MODEL_MIGRATION_ERROR_IDS = {
  prepare: 'provider_model_prepare_failed',
  execute: 'provider_model_execute_failed',
  validate: 'provider_model_validate_failed'
} as const

type NewUserProviderInput = Omit<NewUserProvider, 'orderKey'>

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function createPhaseError(message: string, cause: unknown): Error {
  const causeError = toError(cause)
  return new Error(`${message}: ${causeError.message}`, { cause: causeError })
}

function formatPhaseError(errorId: string, error: Error): string {
  return `${errorId}: ${error.message}`
}

interface LlmState {
  providers?: LegacyProvider[]
  settings?: OldLlmSettings
}

function createModelId(providerId: string, modelId: string): UniqueModelId | null {
  try {
    return createUniqueModelId(providerId, modelId)
  } catch {
    return null
  }
}

function normalizePinnedModelObject(value: unknown): UniqueModelId | null {
  if (!value || typeof value !== 'object') return null

  const { id, provider } = value as { id?: unknown; provider?: unknown }
  if (typeof provider !== 'string' || typeof id !== 'string') return null

  return createModelId(provider.trim(), id.trim())
}

function normalizePinnedModelId(value: unknown): UniqueModelId | null {
  const objectModelId = normalizePinnedModelObject(value)
  if (objectModelId) return objectModelId

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null
  if (isUniqueModelId(trimmed)) return trimmed

  if (trimmed.startsWith('{')) {
    try {
      return normalizePinnedModelObject(JSON.parse(trimmed))
    } catch {
      return null
    }
  }

  const separatorIndex = trimmed.indexOf('/')
  if (separatorIndex <= 0) return null

  const providerId = trimmed.slice(0, separatorIndex).trim()
  const modelId = trimmed.slice(separatorIndex + 1).trim()
  if (!providerId || !modelId) return null

  return createModelId(providerId, modelId)
}

function normalizePinnedModelIds(rawValue: unknown, validModelIds: ReadonlySet<string>): UniqueModelId[] {
  if (!Array.isArray(rawValue)) return []

  const normalized: UniqueModelId[] = []
  const seen = new Set<string>()

  for (const value of rawValue) {
    const modelId = normalizePinnedModelId(value)
    if (!modelId || !validModelIds.has(modelId) || seen.has(modelId)) {
      continue
    }

    seen.add(modelId)
    normalized.push(modelId)
  }

  return normalized
}

export class ProviderModelMigrator extends BaseMigrator {
  readonly id = 'provider_model'
  readonly name = 'Provider Model'
  readonly description = 'Migrate provider and model configuration from Redux to SQLite'
  readonly order = 1.75

  private providers: LegacyProvider[] = []
  private settings: OldLlmSettings = {}
  private totalModelCount = 0
  private pinnedModelIds: UniqueModelId[] = []
  private loader: RegistryLoader | null = null

  override reset(): void {
    this.providers = []
    this.settings = {}
    this.totalModelCount = 0
    this.pinnedModelIds = []
  }

  private getLoader(): RegistryLoader {
    if (!this.loader) {
      this.loader = new RegistryLoader({
        models: application.getPath('feature.provider_registry.data', 'models.json'),
        providers: application.getPath('feature.provider_registry.data', 'providers.json'),
        providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
      })
    }
    return this.loader
  }

  /**
   * Enrich a legacy-mapped provider row with registry preset baseline.
   *
   * `transformProvider` only derives from legacy data, so migrated rows for
   * system providers (those present in providers.json) miss the registry
   * baseline that fresh installs get from `PresetProviderSeeder`. Specifically
   * this fills in non-default endpoint configs (e.g. OPENAI_RESPONSES baseUrl
   * + reasoningFormat), `defaultChatEndpoint` precision, and `apiFeatures`
   * defaults (e.g. providers that explicitly don't support `serviceTier`).
   * Legacy fields win — they capture user customization from v1.
   */
  private enrichProviderRow(row: NewUserProviderInput, legacy: LegacyProvider): NewUserProviderInput {
    const preset = this.getLoader()
      .loadProviders()
      .find((p) => p.id === legacy.id)
    if (!preset) return row

    const presetEndpointConfigs = buildRuntimeEndpointConfigs(preset.endpointConfigs) as Partial<
      Record<EndpointType, EndpointConfig>
    > | null
    const userEndpointConfigs = row.endpointConfigs ?? null
    const allEndpointKeys = new Set([
      ...Object.keys(presetEndpointConfigs ?? {}),
      ...Object.keys(userEndpointConfigs ?? {})
    ])
    const mergedEndpointConfigs: Partial<Record<EndpointType, EndpointConfig>> = {}
    for (const k of allEndpointKeys) {
      const ep = k as EndpointType
      mergedEndpointConfigs[ep] = {
        ...presetEndpointConfigs?.[ep],
        ...userEndpointConfigs?.[ep]
      }
    }

    const presetApiFeatures = (preset.apiFeatures ?? null) as ApiFeatures | null
    const mergedApiFeatures = presetApiFeatures || row.apiFeatures ? { ...presetApiFeatures, ...row.apiFeatures } : null

    return {
      ...row,
      endpointConfigs: Object.keys(mergedEndpointConfigs).length > 0 ? mergedEndpointConfigs : null,
      defaultChatEndpoint: row.defaultChatEndpoint ?? preset.defaultChatEndpoint ?? null,
      apiFeatures: mergedApiFeatures
    }
  }

  /**
   * Enrich a legacy-mapped model row with registry preset data.
   *
   * Legacy v1 rows leave registry-derived fields (modalities, contextWindow,
   * limits, etc.) null. Without enrichment, migrated users end up with
   * skeleton model rows. Composes `mergePresetModel` (registry preset →
   * override) with `applyUserOverlay` (user fields win) — the same chain
   * `ModelService.create` uses for new models.
   */
  private enrichModelRow(
    row: Omit<NewUserModel, 'orderKey'>,
    providerRow: NewUserProvider
  ): Omit<NewUserModel, 'orderKey'> {
    const loader = this.getLoader()
    const presetModel = loader.findModel(row.modelId)
    if (!presetModel) return row

    const registryOverride = loader.findOverride(row.providerId, row.modelId)
    const reasoningFormatTypes = extractReasoningFormatTypes(providerRow.endpointConfigs)
    const defaultChatEndpoint = providerRow.defaultChatEndpoint ?? undefined

    const baseline = mergePresetModel(
      presetModel,
      registryOverride,
      row.providerId,
      reasoningFormatTypes,
      defaultChatEndpoint
    )

    const overlayName = row.name && row.name !== row.modelId ? row.name : null
    const merged = applyUserOverlay(baseline, { ...row, name: overlayName })

    return {
      ...row,
      presetModelId: presetModel.id,
      name: merged.name,
      description: merged.description ?? null,
      capabilities: merged.capabilities as ModelCapability[],
      inputModalities: (merged.inputModalities ?? null) as Modality[] | null,
      outputModalities: (merged.outputModalities ?? null) as Modality[] | null,
      endpointTypes: (merged.endpointTypes ?? null) as EndpointType[] | null,
      contextWindow: merged.contextWindow ?? null,
      maxInputTokens: merged.maxInputTokens ?? null,
      maxOutputTokens: merged.maxOutputTokens ?? null,
      supportsStreaming: merged.supportsStreaming,
      reasoning: merged.reasoning ?? null,
      pricing: merged.pricing ?? row.pricing
    }
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const warnings: string[] = []
      const llmState = ctx.sources.reduxState.getCategory<LlmState>('llm')

      if (!llmState?.providers || !Array.isArray(llmState.providers)) {
        logger.warn('No llm.providers found in Redux state')
        return {
          success: true,
          itemCount: 0,
          warnings: ['No provider data found - skipping provider/model migration']
        }
      }

      // Filter out corrupted v1 rows before dedup. Missing/empty providerId
      // would otherwise land in userProvider as an empty-string PK (SQLite
      // text PK accepts '') and shadow lookups across the v2 data layer.
      // Symmetric treatment for model rows: invalid/duplicate model ids are
      // dropped here with explicit warns so silently-lost rows are visible.
      const seenIds = new Set<string>()
      const dedupedProviders: LegacyProvider[] = []
      let skippedProviders = 0
      let skippedInvalidId = 0
      let skippedInvalidModels = 0
      let skippedDuplicateModels = 0
      const cleanProviderModels = (provider: LegacyProvider): LegacyProvider['models'] => {
        const cleaned: NonNullable<LegacyProvider['models']> = []
        const seenModelIds = new Set<string>()
        for (const model of provider.models ?? []) {
          if (typeof model?.id !== 'string' || model.id.length === 0) {
            skippedInvalidModels++
            logger.warn('Model with missing or empty id skipped', { providerId: provider.id, name: model?.name })
            continue
          }
          if (seenModelIds.has(model.id)) {
            skippedDuplicateModels++
            logger.warn('Duplicate model id skipped', { providerId: provider.id, modelId: model.id })
            continue
          }
          seenModelIds.add(model.id)
          cleaned.push(model)
        }
        return cleaned
      }
      for (const provider of llmState.providers) {
        if (typeof provider?.id !== 'string' || provider.id.length === 0) {
          skippedInvalidId++
          logger.warn('Provider with missing or empty id skipped', { name: provider?.name })
          continue
        }
        if (seenIds.has(provider.id)) {
          skippedProviders++
          logger.warn('Duplicate provider ID skipped', { providerId: provider.id })
          continue
        }
        seenIds.add(provider.id)
        dedupedProviders.push({ ...provider, models: cleanProviderModels(provider) })
      }

      this.providers = dedupedProviders
      this.settings = llmState.settings ?? {}
      this.totalModelCount = this.providers.reduce((count, provider) => {
        const uniqueModelIds = new Set((provider.models ?? []).map((model) => model.id))
        return count + uniqueModelIds.size
      }, 0)
      const validModelIds = new Set(
        this.providers.flatMap((provider) =>
          Array.from(new Set((provider.models ?? []).map((model) => model.id)))
            .map((modelId) => createModelId(provider.id, modelId))
            .filter((modelId): modelId is UniqueModelId => Boolean(modelId))
        )
      )
      this.pinnedModelIds = normalizePinnedModelIds(ctx.sources.dexieSettings.get('pinned:models'), validModelIds)

      if (skippedProviders > 0) {
        warnings.push(`Skipped ${skippedProviders} duplicate provider(s)`)
      }
      if (skippedInvalidId > 0) {
        warnings.push(`Skipped ${skippedInvalidId} provider(s) with missing or empty id`)
      }
      if (skippedInvalidModels > 0) {
        warnings.push(`Skipped ${skippedInvalidModels} model(s) with missing or empty id`)
      }
      if (skippedDuplicateModels > 0) {
        warnings.push(`Skipped ${skippedDuplicateModels} duplicate model(s)`)
      }

      logger.info('Preparation completed', {
        providerCount: this.providers.length,
        skippedProviders,
        modelCount: this.totalModelCount,
        pinnedModelCount: this.pinnedModelIds.length
      })

      return {
        success: true,
        itemCount: this.providers.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      const phaseError = createPhaseError('Provider/model preparation failed', error)
      logger.error('Preparation failed', phaseError)
      return {
        success: false,
        itemCount: 0,
        error: formatPhaseError(PROVIDER_MODEL_MIGRATION_ERROR_IDS.prepare, phaseError)
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.providers.length === 0) {
      return { success: true, processedCount: 0 }
    }

    let processedProviders = 0
    let processedModels = 0

    try {
      await ctx.db.transaction(async (tx) => {
        const providerRows = assignOrderKeysInSequence(
          this.providers.map((provider) => this.enrichProviderRow(transformProvider(provider, this.settings), provider))
        )

        for (let providerIndex = 0; providerIndex < this.providers.length; providerIndex++) {
          const provider = this.providers[providerIndex]
          const providerRow = providerRows[providerIndex]
          await tx.insert(userProviderTable).values(providerRow)
          processedProviders++

          // Model dedup + invalid-id filtering happens in prepare(); use the
          // cleaned list directly here.
          const modelRows = assignOrderKeysByScope(
            (provider.models ?? []).map((model) =>
              this.enrichModelRow(transformModel(model, provider.id), providerRow)
            ),
            (model) => model.providerId
          )

          for (let modelIndex = 0; modelIndex < modelRows.length; modelIndex += BATCH_SIZE) {
            const batch = modelRows.slice(modelIndex, modelIndex + BATCH_SIZE)

            if (batch.length > 0) {
              await tx.insert(userModelTable).values(batch)
              processedModels += batch.length
            }
          }

          this.reportProgress(
            Math.round(((providerIndex + 1) / this.providers.length) * 100),
            `Migrated ${processedProviders}/${this.providers.length} providers and ${processedModels} models`
          )
        }

        const pinRows = assignOrderKeysInSequence(
          this.pinnedModelIds.map((entityId) => ({
            entityType: 'model' as const,
            entityId
          }))
        )
        if (pinRows.length > 0) {
          await tx.insert(pinTable).values(pinRows).onConflictDoNothing()
        }
      })

      logger.info('Execute completed', {
        processedProviders,
        processedModels,
        processedPins: this.pinnedModelIds.length
      })

      return {
        success: true,
        processedCount: processedProviders
      }
    } catch (error) {
      const phaseError = createPhaseError(
        `Provider/model execution failed after ${processedProviders} provider(s)`,
        error
      )
      logger.error('Execute failed', phaseError)
      return {
        success: false,
        processedCount: processedProviders,
        error: formatPhaseError(PROVIDER_MODEL_MIGRATION_ERROR_IDS.execute, phaseError)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const errors: { key: string; message: string }[] = []

      const providerResult = await ctx.db.select({ count: sql<number>`count(*)` }).from(userProviderTable).get()
      const modelResult = await ctx.db.select({ count: sql<number>`count(*)` }).from(userModelTable).get()
      const pinResult = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(pinTable)
        .where(eq(pinTable.entityType, 'model'))
        .get()
      const targetProviderCount = providerResult?.count ?? 0
      const targetModelCount = modelResult?.count ?? 0
      const targetPinCount = pinResult?.count ?? 0

      if (targetProviderCount !== this.providers.length) {
        errors.push({
          key: 'provider_count_mismatch',
          message: `Expected ${this.providers.length} providers but found ${targetProviderCount}`
        })
      }

      if (targetModelCount !== this.totalModelCount) {
        errors.push({
          key: 'model_count_mismatch',
          message: `Expected ${this.totalModelCount} models but found ${targetModelCount}`
        })
      }

      if (targetPinCount !== this.pinnedModelIds.length) {
        errors.push({
          key: 'pin_count_mismatch',
          message: `Expected ${this.pinnedModelIds.length} model pins but found ${targetPinCount}`
        })
      }

      const sampleProviders = await ctx.db.select().from(userProviderTable).limit(5).all()
      for (const provider of sampleProviders) {
        const sourceProvider = this.providers.find((item) => item.id === provider.providerId)
        if (sourceProvider?.apiKey && (!provider.apiKeys || provider.apiKeys.length === 0)) {
          errors.push({
            key: `missing_api_key_${provider.providerId}`,
            message: `Provider ${provider.providerId} should include migrated API keys`
          })
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.providers.length,
          targetCount: targetProviderCount,
          skippedCount: 0
        }
      }
    } catch (error) {
      const phaseError = createPhaseError('Provider/model validation failed', error)
      logger.error('Validation failed', phaseError)
      return {
        success: false,
        errors: [
          {
            key: PROVIDER_MODEL_MIGRATION_ERROR_IDS.validate,
            message: formatPhaseError(PROVIDER_MODEL_MIGRATION_ERROR_IDS.validate, phaseError)
          }
        ],
        stats: {
          sourceCount: this.providers.length,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }
  }
}
