/**
 * Catalog Service - imports catalog data into SQLite
 *
 * Responsible for:
 * - Reading catalog protobuf files (models.pb, provider-models.pb, providers.pb)
 * - Merging configurations using mergeModelConfig/mergeProviderConfig
 * - Writing resolved data to user_model / user_provider tables
 *
 * Called during app initialization or when a user adds a preset provider.
 */

import { join } from 'node:path'

import type { ProtoModelConfig, ProtoProviderModelOverride } from '@cherrystudio/provider-catalog'
import {
  EndpointType,
  readModelCatalog,
  readProviderCatalog,
  readProviderModelCatalog
} from '@cherrystudio/provider-catalog'
import type { NewUserModel } from '@data/db/schemas/userModel'
import type { NewUserProvider } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import type { Model } from '@shared/data/types/model'
import { mergeModelConfig } from '@shared/data/utils/modelMerger'

import { modelService } from './ModelService'
import { providerService } from './ProviderService'

const logger = loggerService.withContext('DataApi:CatalogService')

export class CatalogService {
  private static instance: CatalogService

  private catalogModels: ProtoModelConfig[] | null = null
  private catalogProviderModels: ProtoProviderModelOverride[] | null = null

  private constructor() {}

  public static getInstance(): CatalogService {
    if (!CatalogService.instance) {
      CatalogService.instance = new CatalogService()
    }
    return CatalogService.instance
  }

  /**
   * Get the path to catalog data directory
   */
  private getCatalogDataPath(): string {
    if (isDev) {
      return join(__dirname, '..', '..', '..', 'packages', 'catalog', 'data')
    }
    // TODO
    return ''
  }

  /**
   * Load and cache catalog models from models.pb
   */
  private loadCatalogModels(): ProtoModelConfig[] {
    if (this.catalogModels) return this.catalogModels

    try {
      const dataPath = this.getCatalogDataPath()
      const data = readModelCatalog(join(dataPath, 'models.pb'))
      this.catalogModels = data.models ?? []
      logger.info('Loaded catalog models', { count: this.catalogModels.length })
      return this.catalogModels
    } catch (error) {
      logger.warn('Failed to load catalog models.pb', { error })
      return []
    }
  }

  /**
   * Load and cache provider-model overrides from provider-models.pb
   */
  private loadProviderModels(): ProtoProviderModelOverride[] {
    if (this.catalogProviderModels) return this.catalogProviderModels

    try {
      const dataPath = this.getCatalogDataPath()
      const data = readProviderModelCatalog(join(dataPath, 'provider-models.pb'))
      this.catalogProviderModels = data.overrides ?? []
      logger.info('Loaded catalog provider-models', { count: this.catalogProviderModels.length })
      return this.catalogProviderModels
    } catch (error) {
      logger.warn('Failed to load catalog provider-models.pb', { error })
      return []
    }
  }

  /**
   * Initialize models for a specific provider
   *
   * Reads catalog data, merges configurations, and writes to SQLite.
   *
   * @param providerId - The provider ID to initialize models for
   */
  async initializeProvider(providerId: string): Promise<Model[]> {
    const catalogModels = this.loadCatalogModels()
    const providerModels = this.loadProviderModels()

    // Find all overrides for this provider
    const overrides = providerModels.filter((pm) => pm.providerId === providerId)

    if (overrides.length === 0) {
      logger.info('No catalog overrides found for provider', { providerId })
      return []
    }

    // Build a map of catalog models by ID for fast lookup
    const modelMap = new Map<string, ProtoModelConfig>()
    for (const model of catalogModels) {
      modelMap.set(model.id, model)
    }

    // Merge each override with its base model
    const mergedModels: Model[] = []
    const dbRows: NewUserModel[] = []

    for (const override of overrides) {
      const baseModel = modelMap.get(override.modelId) ?? null

      if (!baseModel) {
        logger.warn('Base model not found for override', {
          providerId,
          modelId: override.modelId
        })
        continue
      }

      // Merge: no user override (null), catalog override, preset model
      const merged = mergeModelConfig(null, override, baseModel, providerId)
      mergedModels.push(merged)

      // Convert to DB row format — capabilities/modalities are now numeric arrays
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

    // Batch upsert to database
    await modelService.batchUpsert(dbRows)

    logger.info('Initialized provider models from catalog', {
      providerId,
      count: mergedModels.length
    })

    return mergedModels
  }

  /**
   * Initialize preset providers from catalog into SQLite.
   *
   * Reads providers.pb, maps fields to NewUserProvider, and batch upserts.
   * Also seeds the cherryai provider which is not in providers.pb.
   */
  async initializePresetProviders(): Promise<void> {
    const dataPath = this.getCatalogDataPath()
    let rawProviders: ReturnType<typeof readProviderCatalog>['providers'] = []

    try {
      const data = readProviderCatalog(join(dataPath, 'providers.pb'))
      rawProviders = data.providers
    } catch (error) {
      logger.warn('Failed to load providers.pb for provider import', { error })
      return
    }

    const dbRows: NewUserProvider[] = rawProviders.map((p) => {
      // Map catalog metadata.website to runtime websites field
      const catalogWebsite = p.metadata?.website
      const websites =
        catalogWebsite &&
        (catalogWebsite.official || catalogWebsite.docs || catalogWebsite.apiKey || catalogWebsite.models)
          ? {
              official: catalogWebsite.official || undefined,
              docs: catalogWebsite.docs || undefined,
              apiKey: catalogWebsite.apiKey || undefined,
              models: catalogWebsite.models || undefined
            }
          : null

      // Proto baseUrls uses map<int32, string> — convert to Record<string, string>
      const baseUrls: Record<string, string> = {}
      if (p.baseUrls) {
        for (const [k, v] of Object.entries(p.baseUrls)) {
          baseUrls[String(k)] = v
        }
      }

      return {
        providerId: p.id,
        presetProviderId: p.id,
        name: p.name,
        baseUrls: Object.keys(baseUrls).length > 0 ? baseUrls : null,
        modelsApiUrls: p.modelsApiUrls ?? null,
        defaultChatEndpoint: p.defaultChatEndpoint ?? null,
        apiCompatibility: p.apiCompatibility ?? null,
        websites
      }
    })

    dbRows.push({
      providerId: 'cherryai',
      name: 'CherryAI',
      baseUrls: {
        [EndpointType.CHAT_COMPLETIONS]: 'https://api.cherry-ai.com'
      },
      defaultChatEndpoint: EndpointType.CHAT_COMPLETIONS
    })

    await providerService.batchUpsert(dbRows)

    logger.info('Initialized preset providers from catalog', { count: dbRows.length })
  }

  /**
   * Initialize all preset providers from catalog
   *
   * Called during app startup to seed the database with catalog data.
   * Only imports provider configurations; models are imported on-demand per provider.
   */
  async initializeAllPresetProviders(): Promise<void> {
    await this.initializePresetProviders()

    logger.info('Initialized all preset providers (provider configs only, models on-demand)')
  }

  /**
   * Look up catalog data for a single model
   *
   * Returns the preset base model and provider-level override (if any).
   * Used by ModelService.create to auto-enrich models at save time.
   */
  lookupModel(
    providerId: string,
    modelId: string
  ): { presetModel: ProtoModelConfig | null; catalogOverride: ProtoProviderModelOverride | null } {
    const catalogModels = this.loadCatalogModels()
    const providerModels = this.loadProviderModels()

    const presetModel = catalogModels.find((m) => m.id === modelId) ?? null
    const catalogOverride = providerModels.find((pm) => pm.providerId === providerId && pm.modelId === modelId) ?? null

    return { presetModel, catalogOverride }
  }

  /**
   * Resolve raw model entries against catalog data
   *
   * For each raw entry, looks up catalog preset + provider override
   * and produces an enriched Model via mergeModelConfig.
   * Models not found in catalog are returned with minimal data.
   *
   * Used by the renderer to display enriched models in ManageModelsPopup
   * before the user adds them.
   */
  resolveModels(
    providerId: string,
    rawModels: Array<{
      modelId: string
      name?: string
      group?: string
      description?: string
      endpointTypes?: number[]
    }>
  ): Model[] {
    const catalogModels = this.loadCatalogModels()
    const providerModels = this.loadProviderModels()

    // Build lookup maps
    const modelMap = new Map<string, ProtoModelConfig>()
    for (const m of catalogModels) {
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
      const catalogOverride = overrideMap.get(raw.modelId) ?? null

      // Build a minimal user row from the raw entry
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
          // Catalog match found — merge with preset data
          results.push(mergeModelConfig(userRow, catalogOverride, presetModel, providerId))
        } else {
          // No catalog match — return as custom model (no presetModelId)
          results.push(mergeModelConfig({ ...userRow, presetModelId: null }, null, null, providerId))
        }
      } catch (error) {
        logger.warn('Failed to resolve model', { providerId, modelId: raw.modelId, error })
      }
    }

    return results
  }

  /**
   * Clear cached catalog data
   */
  clearCache(): void {
    this.catalogModels = null
    this.catalogProviderModels = null
  }
}

export const catalogService = CatalogService.getInstance()
