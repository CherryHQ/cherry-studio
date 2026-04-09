/**
 * Registry Service — merge-dependent operations that bridge registry data with SQLite.
 *
 * Responsibilities (after F3 split):
 * - C: enrichExistingModels (per-startup reconciliation, version-gated)
 * - D: getRegistryModelsByProvider, resolveModels (merge-dependent queries)
 * - E: initializeProvider (on-demand bulk import)
 * - lookupModel (DB-aware lookup with reasoning config)
 *
 * Pure JSON loading, caching, and lookups live in @cherrystudio/provider-registry
 * (RegistryLoader, lookupRegistryModel, buildRuntimeEndpointConfigs).
 */

import type { ProtoModelConfig, ProtoProviderModelOverride } from '@cherrystudio/provider-registry'
import type { EndpointType } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs, lookupRegistryModel, normalizeModelId } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import type { NewUserModel } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { Model } from '@shared/data/types/model'
import type { EndpointConfig, ReasoningFormatType } from '@shared/data/types/provider'
import { extractReasoningFormatTypes, mergeModelConfig } from '@shared/data/utils/modelMerger'
import { eq, isNotNull } from 'drizzle-orm'

import { modelService } from './ModelService'

const logger = loggerService.withContext('DataApi:ProviderRegistryService')

class ProviderRegistryService {
  private loader: RegistryLoader | null = null

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

  // ─────────────────────────────────────────────────────────────────────────
  // Reasoning config helpers (needs DB for user overrides)
  // ─────────────────────────────────────────────────────────────────────────

  private getRegistryReasoningConfig(providerId: string): {
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  } {
    const loader = this.getLoader()
    const providers = loader.loadProviders()
    const provider = providers.find((p) => p.id === providerId)
    const endpointConfigs = provider
      ? (buildRuntimeEndpointConfigs(provider.endpointConfigs) as Partial<Record<EndpointType, EndpointConfig>> | null)
      : null

    return {
      defaultChatEndpoint: provider?.defaultChatEndpoint ?? undefined,
      reasoningFormatTypes: extractReasoningFormatTypes(endpointConfigs)
    }
  }

  private async getEffectiveReasoningConfig(providerId: string): Promise<{
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  }> {
    const db = application.get('DbService').getDb()
    const registryConfig = this.getRegistryReasoningConfig(providerId)
    const [provider] = await db
      .select({
        defaultChatEndpoint: userProviderTable.defaultChatEndpoint,
        endpointConfigs: userProviderTable.endpointConfigs
      })
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)

    if (provider) {
      const defaultChatEndpoint = provider.defaultChatEndpoint ?? registryConfig.defaultChatEndpoint
      const reasoningFormatTypes =
        extractReasoningFormatTypes(provider.endpointConfigs) ?? registryConfig.reasoningFormatTypes

      return { defaultChatEndpoint, reasoningFormatTypes }
    }

    return registryConfig
  }

  // ─────────────────────────────────────────────────────────────────────────
  // E: On-demand provider initialization
  // ─────────────────────────────────────────────────────────────────────────

  async initializeProvider(providerId: string): Promise<Model[]> {
    const loader = this.getLoader()
    const registryModels = loader.loadModels()
    const providerModels = loader.loadProviderModels()
    const { defaultChatEndpoint, reasoningFormatTypes } = await this.getEffectiveReasoningConfig(providerId)

    const overrides = providerModels.filter((pm) => pm.providerId === providerId)

    if (overrides.length === 0) {
      logger.info('No registry overrides found for provider', { providerId })
      return []
    }

    const modelMap = new Map<string, ProtoModelConfig>()
    for (const model of registryModels) {
      modelMap.set(model.id, model)
    }

    const mergedModels: Model[] = []
    const dbRows: NewUserModel[] = []

    for (const override of overrides) {
      const baseModel = modelMap.get(override.modelId) ?? null

      if (!baseModel) {
        logger.warn('Base model not found for override', { providerId, modelId: override.modelId })
        continue
      }

      const merged = mergeModelConfig(null, override, baseModel, providerId, reasoningFormatTypes, defaultChatEndpoint)
      mergedModels.push(merged)

      dbRows.push({
        providerId,
        modelId: baseModel.id,
        presetModelId: baseModel.id,
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
        isEnabled: merged.isEnabled,
        isHidden: merged.isHidden
      })
    }

    await modelService.batchUpsert(dbRows)

    logger.info('Initialized provider models from registry', { providerId, count: mergedModels.length })

    return mergedModels
  }

  // ─────────────────────────────────────────────────────────────────────────
  // D: Merge-dependent runtime queries
  // ─────────────────────────────────────────────────────────────────────────

  getRegistryModelsByProvider(providerId: string): Model[] {
    const loader = this.getLoader()
    const registryModels = loader.loadModels()
    const providerModels = loader.loadProviderModels()
    const { defaultChatEndpoint, reasoningFormatTypes } = this.getRegistryReasoningConfig(providerId)

    const overrides = providerModels.filter((pm) => pm.providerId === providerId)
    if (overrides.length === 0) return []

    const modelMap = new Map<string, ProtoModelConfig>()
    for (const model of registryModels) {
      modelMap.set(model.id, model)
    }

    const mergedModels: Model[] = []
    for (const override of overrides) {
      const baseModel = modelMap.get(override.modelId) ?? null
      if (!baseModel) continue
      mergedModels.push(
        mergeModelConfig(null, override, baseModel, providerId, reasoningFormatTypes, defaultChatEndpoint)
      )
    }

    return mergedModels
  }

  async lookupModel(
    providerId: string,
    modelId: string
  ): Promise<{
    presetModel: ProtoModelConfig | null
    registryOverride: ProtoProviderModelOverride | null
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  }> {
    const loader = this.getLoader()
    const { presetModel, registryOverride } = lookupRegistryModel(
      loader.loadModels(),
      loader.loadProviderModels(),
      providerId,
      modelId
    )
    const reasoningConfig = await this.getEffectiveReasoningConfig(providerId)

    return { presetModel, registryOverride, ...reasoningConfig }
  }

  async resolveModels(
    providerId: string,
    rawModels: Array<{
      modelId: string
      name?: string
      group?: string
      description?: string
      endpointTypes?: string[]
    }>
  ): Promise<Model[]> {
    const loader = this.getLoader()
    const registryModels = loader.loadModels()
    const providerModels = loader.loadProviderModels()
    const { defaultChatEndpoint, reasoningFormatTypes } = await this.getEffectiveReasoningConfig(providerId)

    const modelMap = new Map<string, ProtoModelConfig>()
    for (const m of registryModels) {
      modelMap.set(m.id, m)
    }
    const overrideMap = new Map<string, ProtoProviderModelOverride>()
    for (const pm of providerModels) {
      if (pm.providerId === providerId) {
        overrideMap.set(pm.modelId, pm)
      }
    }

    const results: Model[] = []
    const seen = new Set<string>()

    for (const raw of rawModels) {
      if (!raw.modelId || seen.has(raw.modelId)) continue
      seen.add(raw.modelId)

      const presetModel = modelMap.get(raw.modelId) ?? null
      const registryOverride = overrideMap.get(raw.modelId) ?? null

      const userRow = {
        providerId,
        modelId: raw.modelId,
        presetModelId: presetModel ? presetModel.id : null,
        name: raw.name ?? null,
        group: raw.group ?? null,
        description: raw.description ?? null,
        endpointTypes: raw.endpointTypes ?? null
      }

      try {
        if (presetModel) {
          results.push(
            mergeModelConfig(
              userRow,
              registryOverride,
              presetModel,
              providerId,
              reasoningFormatTypes,
              defaultChatEndpoint
            )
          )
        } else {
          results.push(mergeModelConfig({ ...userRow, presetModelId: null }, null, null, providerId))
        }
      } catch (error) {
        logger.error('Failed to resolve model — model will be missing from results', {
          providerId,
          modelId: raw.modelId,
          error
        })
      }
    }

    return results
  }

  async enrichExistingModels(): Promise<void> {
    const loader = this.getLoader()
    const registryModels = loader.loadModels()
    const providerModels = loader.loadProviderModels()

    if (registryModels.length === 0) {
      logger.warn('No registry models loaded, skipping model enrichment')
      return
    }

    // Build lookup maps keyed by exact ID + normalized ID for fallback matching
    const modelMap = new Map<string, ProtoModelConfig>()
    const normalizedModelMap = new Map<string, ProtoModelConfig>()
    for (const m of registryModels) {
      modelMap.set(m.id, m)
      const normalized = normalizeModelId(m.id)
      if (!normalizedModelMap.has(normalized)) {
        normalizedModelMap.set(normalized, m)
      }
    }

    const overridesByProvider = new Map<string, Map<string, ProtoProviderModelOverride>>()
    const normalizedOverridesByProvider = new Map<string, Map<string, ProtoProviderModelOverride>>()
    for (const pm of providerModels) {
      let providerMap = overridesByProvider.get(pm.providerId)
      if (!providerMap) {
        providerMap = new Map()
        overridesByProvider.set(pm.providerId, providerMap)
      }
      providerMap.set(pm.modelId, pm)

      let normalizedProviderMap = normalizedOverridesByProvider.get(pm.providerId)
      if (!normalizedProviderMap) {
        normalizedProviderMap = new Map()
        normalizedOverridesByProvider.set(pm.providerId, normalizedProviderMap)
      }
      const normalizedPmId = normalizeModelId(pm.modelId)
      if (!normalizedProviderMap.has(normalizedPmId)) {
        normalizedProviderMap.set(normalizedPmId, pm)
      }
    }

    const db = application.get('DbService').getDb()
    const userModels = await db.select().from(userModelTable).where(isNotNull(userModelTable.presetModelId))

    if (userModels.length === 0) {
      logger.info('No user models with presetModelId found, skipping enrichment')
      return
    }

    const updateRows: NewUserModel[] = []
    let skippedCount = 0
    const providerRows = await db
      .select({
        providerId: userProviderTable.providerId,
        defaultChatEndpoint: userProviderTable.defaultChatEndpoint,
        endpointConfigs: userProviderTable.endpointConfigs
      })
      .from(userProviderTable)
    const providerConfigMap = new Map(providerRows.map((row) => [row.providerId, row]))

    for (const row of userModels) {
      const presetModelId = row.presetModelId!
      // Exact match first, normalized fallback
      const presetModel = modelMap.get(presetModelId) ?? normalizedModelMap.get(normalizeModelId(presetModelId)) ?? null

      if (!presetModel) {
        skippedCount++
        continue
      }

      const providerOverrides = overridesByProvider.get(row.providerId)
      const normalizedProviderOverrides = normalizedOverridesByProvider.get(row.providerId)
      const registryOverride =
        providerOverrides?.get(presetModelId) ??
        normalizedProviderOverrides?.get(normalizeModelId(presetModelId)) ??
        null
      const providerConfig = providerConfigMap.get(row.providerId)
      const registryReasoningConfig = this.getRegistryReasoningConfig(row.providerId)
      const defaultChatEndpoint = providerConfig?.defaultChatEndpoint ?? registryReasoningConfig.defaultChatEndpoint
      const reasoningFormatTypes =
        extractReasoningFormatTypes(providerConfig?.endpointConfigs) ?? registryReasoningConfig.reasoningFormatTypes

      const merged = mergeModelConfig(
        {
          providerId: row.providerId,
          modelId: row.modelId,
          presetModelId,
          name: row.name,
          description: row.description,
          group: row.group,
          capabilities: row.capabilities,
          inputModalities: row.inputModalities,
          outputModalities: row.outputModalities,
          endpointTypes: row.endpointTypes,
          contextWindow: row.contextWindow,
          maxOutputTokens: row.maxOutputTokens,
          supportsStreaming: row.supportsStreaming,
          reasoning: row.reasoning,
          isEnabled: row.isEnabled,
          isHidden: row.isHidden
        },
        registryOverride,
        presetModel,
        row.providerId,
        reasoningFormatTypes,
        defaultChatEndpoint
      )

      updateRows.push({
        providerId: row.providerId,
        modelId: row.modelId,
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
        pricing: merged.pricing ?? null,
        isEnabled: merged.isEnabled,
        isHidden: merged.isHidden
      })
    }

    if (updateRows.length > 0) {
      await modelService.batchUpsert(updateRows)
    }

    logger.info('Model enrichment completed', {
      total: userModels.length,
      enriched: updateRows.length,
      skipped: skippedCount,
      registrySize: registryModels.length
    })
  }

  /** Get the current registry models version (for version-gated enrichment). */
  getModelsVersion(): string {
    return this.getLoader().getModelsVersion()
  }
}

export const providerRegistryService = new ProviderRegistryService()
