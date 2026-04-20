/**
 * Registry Service — merge-dependent operations that bridge registry data with SQLite.
 *
 * Responsibilities:
 * - getRegistryModelsByProvider: read-only merged model list
 * - resolveModels: resolve raw SDK model entries against registry
 * - lookupModel: DB-aware single model lookup with reasoning config
 *
 * Pure JSON loading, caching, and lookups live in @cherrystudio/provider-registry
 * (RegistryLoader, buildRuntimeEndpointConfigs).
 */

import { application } from '@application'
import type { ProtoModelConfig, ProtoProviderModelOverride } from '@cherrystudio/provider-registry'
import type { EndpointType } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { loggerService } from '@logger'
import { ErrorCode, isDataApiError } from '@shared/data/api/apiErrors'
import type { Model } from '@shared/data/types/model'
import type { EndpointConfig, ReasoningFormatType } from '@shared/data/types/provider'
import { createCustomModel, extractReasoningFormatTypes, mergePresetModel } from '@shared/data/utils/modelMerger'

import { providerService } from './ProviderService'

const logger = loggerService.withContext('DataApi:ProviderRegistryService')

/**
 * Bridges the read-only provider registry (JSON) with SQLite user data.
 *
 * This service handles operations that require merging preset model/provider
 * data from the registry package with user-specific configuration stored in
 * the database (e.g. reasoning format overrides from `user_provider`).
 *
 * It does **not** own any database table and does **not** access the
 * database directly. User data is obtained via `ProviderService`.
 *
 * @see {@link RegistryLoader} for JSON loading, caching, and O(1) indexed lookups
 * @see {@link mergePresetModel} for the two-layer merge (preset → override)
 * @see {@link mergeModelWithUser} for the three-layer merge (preset → override → user)
 */
class ProviderRegistryService {
  private loader: RegistryLoader | null = null

  /** Lazily create the shared RegistryLoader instance. */
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
   * Get reasoning config from registry providers.json only (no DB).
   *
   * Resolves `defaultChatEndpoint` and `reasoningFormatTypes` for a provider
   * by looking up its `endpointConfigs` in the shipped registry data.
   *
   * @param providerId - The provider to look up
   * @returns Registry-level reasoning config (may be overridden by user DB values)
   */
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

  /**
   * Get effective reasoning config by merging registry defaults with user DB overrides.
   *
   * Priority: user_provider DB values > registry providers.json defaults.
   * Obtains user provider data via ProviderService (does not access DB directly).
   *
   * @param providerId - The provider to resolve config for
   * @returns Merged reasoning config with user overrides applied
   */
  private async getEffectiveReasoningConfig(providerId: string): Promise<{
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  }> {
    const registryConfig = this.getRegistryReasoningConfig(providerId)

    try {
      const provider = await providerService.getByProviderId(providerId)
      const defaultChatEndpoint = provider.defaultChatEndpoint ?? registryConfig.defaultChatEndpoint
      const reasoningFormatTypes =
        extractReasoningFormatTypes(provider.endpointConfigs) ?? registryConfig.reasoningFormatTypes

      return { defaultChatEndpoint, reasoningFormatTypes }
    } catch (error) {
      if (!(isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)) {
        logger.warn('Failed to fetch provider for reasoning config, using registry defaults', error as Error)
      }
      return registryConfig
    }
  }

  /**
   * Get all registry models for a provider as fully merged Model objects.
   *
   * Read-only — does not write to the database. Uses only registry data
   * (models.json + provider-models.json + providers.json) without DB queries
   * for user overrides.
   *
   * Used by: `GET /providers/:providerId/registry-models`
   *
   * @param providerId - The provider whose registry models to return
   * @returns Array of merged Model objects with preset + override data applied
   */
  getRegistryModelsByProvider(providerId: string): Model[] {
    const loader = this.getLoader()
    const { defaultChatEndpoint, reasoningFormatTypes } = this.getRegistryReasoningConfig(providerId)

    const overrides = loader.getOverridesForProvider(providerId)
    if (overrides.length === 0) return []

    const mergedModels: Model[] = []
    for (const override of overrides) {
      const baseModel = loader.findModel(override.modelId)
      if (!baseModel) continue
      mergedModels.push(mergePresetModel(baseModel, override, providerId, reasoningFormatTypes, defaultChatEndpoint))
    }

    return mergedModels
  }

  /**
   * Look up a single model's registry data and effective reasoning config.
   *
   * Combines O(1) indexed registry lookup (exact match + normalized fallback via
   * {@link RegistryLoader.findModel}) with DB-aware reasoning config resolution.
   *
   * Used by: `POST /models` handler — the handler calls this, then passes
   * the result to `ModelService.create([{ dto, registryData }])` to avoid a
   * circular dependency between ModelService and this service.
   *
   * @param providerId - The provider context for override and reasoning lookup
   * @param modelId - The model ID to look up (supports normalized fallback)
   * @returns Preset model, provider override, and effective reasoning config
   */
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
    const presetModel = loader.findModel(modelId)
    const registryOverride = loader.findOverride(providerId, modelId)
    const reasoningConfig = await this.getEffectiveReasoningConfig(providerId)

    return { presetModel, registryOverride, ...reasoningConfig }
  }

  /**
   * Resolve raw model IDs (e.g. from provider SDK listModels) against the registry.
   *
   * For each model ID, looks up its preset data and provider override from
   * the registry, then merges (preset → override). All data comes from
   * the registry — SDK only provides the model ID for matching.
   * Models not found in the registry are returned as minimal custom models.
   * Duplicates (by modelId) are deduplicated — first occurrence wins.
   *
   * Used by: `POST /providers/:providerId/registry-models` with body `{ models: [{ modelId }] }`
   *
   * @param providerId - The provider context
   * @param modelIds - Model IDs from SDK listModels()
   * @returns Array of fully resolved Model objects
   */
  async resolveModels(providerId: string, modelIds: string[]): Promise<Model[]> {
    const loader = this.getLoader()
    const { defaultChatEndpoint, reasoningFormatTypes } = await this.getEffectiveReasoningConfig(providerId)

    const results: Model[] = []
    const seen = new Set<string>()

    for (const modelId of modelIds) {
      if (!modelId || seen.has(modelId)) continue
      seen.add(modelId)

      // O(1) lookup with exact match + normalized fallback
      const presetModel = loader.findModel(modelId)
      const registryOverride = loader.findOverride(providerId, modelId)

      try {
        if (presetModel) {
          results.push(
            mergePresetModel(presetModel, registryOverride, providerId, reasoningFormatTypes, defaultChatEndpoint)
          )
        } else {
          results.push(createCustomModel(providerId, modelId))
        }
      } catch (error) {
        logger.error(`Failed to resolve model ${providerId}/${modelId} — will be missing from results`, error as Error)
      }
    }

    return results
  }
}

export const providerRegistryService = new ProviderRegistryService()
