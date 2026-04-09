/**
 * Registry Service — merge-dependent operations that bridge registry data with SQLite.
 *
 * Responsibilities:
 * - getRegistryModelsByProvider: read-only merged model list
 * - resolveModels: resolve raw SDK model entries against registry
 * - lookupModel: DB-aware single model lookup with reasoning config
 *
 * Pure JSON loading, caching, and lookups live in @cherrystudio/provider-registry
 * (RegistryLoader, lookupRegistryModel, buildRuntimeEndpointConfigs).
 */

import type { ProtoModelConfig, ProtoProviderModelOverride } from '@cherrystudio/provider-registry'
import type { EndpointType } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs, lookupRegistryModel } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { Model } from '@shared/data/types/model'
import type { EndpointConfig, ReasoningFormatType } from '@shared/data/types/provider'
import { extractReasoningFormatTypes, mergeModelConfig } from '@shared/data/utils/modelMerger'
import { eq } from 'drizzle-orm'

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
}

export const providerRegistryService = new ProviderRegistryService()
