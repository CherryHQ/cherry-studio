/**
 * Registry Service - imports registry data into SQLite
 *
 * Responsible for:
 * - Reading registry protobuf files (models.pb, provider-models.pb, providers.pb)
 * - Merging configurations using mergeModelConfig/mergeProviderConfig
 * - Writing resolved data to user_model / user_provider tables
 *
 * Managed by the lifecycle system. Seeds preset data during onInit.
 */

import { join } from 'node:path'

import type { ProtoModelConfig, ProtoProviderConfig, ProtoProviderModelOverride } from '@cherrystudio/provider-registry'
import {
  EndpointType,
  readModelRegistry,
  readProviderModelRegistry,
  readProviderRegistry
} from '@cherrystudio/provider-registry'
import type { NewUserModel } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { NewUserProvider } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import type { Model } from '@shared/data/types/model'
import type { EndpointConfig, ReasoningFormatType } from '@shared/data/types/provider'
import { extractReasoningFormatTypes, mergeModelConfig } from '@shared/data/utils/modelMerger'
import { eq, isNotNull } from 'drizzle-orm'

import { modelService } from './ModelService'
import { providerService } from './ProviderService'

const logger = loggerService.withContext('DataApi:ProviderRegistryService')

/** Map proto ProviderReasoningFormat oneof case to runtime type string */
const CASE_TO_TYPE: Record<string, ReasoningFormatType> = {
  openaiChat: 'openai-chat',
  openaiResponses: 'openai-responses',
  anthropic: 'anthropic',
  gemini: 'gemini',
  openrouter: 'openrouter',
  enableThinking: 'enable-thinking',
  thinkingType: 'thinking-type',
  dashscope: 'dashscope',
  selfHosted: 'self-hosted'
}

/**
 * Build runtime endpointConfigs from proto provider data.
 * Converts proto EndpointConfig messages to plain runtime objects.
 */
function buildEndpointConfigsFromProto(p: ProtoProviderConfig): Partial<Record<EndpointType, EndpointConfig>> | null {
  const configs: Partial<Record<EndpointType, EndpointConfig>> = {}

  for (const [k, protoConfig] of Object.entries(p.endpointConfigs)) {
    const ep = Number(k) as EndpointType
    const config: EndpointConfig = {}

    if (protoConfig.baseUrl) {
      config.baseUrl = protoConfig.baseUrl
    }

    // Convert proto ModelsApiUrls message to plain object
    if (protoConfig.modelsApiUrls) {
      const modelsApiUrls: Record<string, string> = {}
      if (protoConfig.modelsApiUrls.default) modelsApiUrls.default = protoConfig.modelsApiUrls.default
      if (protoConfig.modelsApiUrls.embedding) modelsApiUrls.embedding = protoConfig.modelsApiUrls.embedding
      if (protoConfig.modelsApiUrls.reranker) modelsApiUrls.reranker = protoConfig.modelsApiUrls.reranker
      if (Object.keys(modelsApiUrls).length > 0) {
        config.modelsApiUrls = modelsApiUrls
      }
    }

    // Convert proto ProviderReasoningFormat to runtime type string
    const formatCase = protoConfig.reasoningFormat?.format.case
    const reasoningFormatType = formatCase ? CASE_TO_TYPE[formatCase] : undefined
    if (reasoningFormatType) {
      config.reasoningFormatType = reasoningFormatType
    }

    if (Object.keys(config).length > 0) {
      configs[ep] = config
    }
  }

  return Object.keys(configs).length > 0 ? configs : null
}

@Injectable('ProviderRegistryService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['DbService'])
export class ProviderRegistryService extends BaseService {
  private registryModels: ProtoModelConfig[] | null = null
  private registryProviderModels: ProtoProviderModelOverride[] | null = null
  private registryProviders: ProtoProviderConfig[] | null = null

  protected async onInit(): Promise<void> {
    // Sync preset registry data on every startup so that provider websites/baseUrls
    // and model capabilities/modalities/contextWindow/pricing stay up-to-date
    // when the registry protobuf files are updated between app versions.
    await this.initializeAllPresetProviders()
  }

  protected onDestroy(): void {
    this.clearCache()
  }

  /**
   * Get the path to registry data directory
   */
  private getRegistryDataPath(): string {
    if (isDev) {
      return join(__dirname, '..', '..', 'packages', 'provider-registry', 'data')
    }
    return join(process.resourcesPath, 'packages', 'provider-registry', 'data')
  }

  /**
   * Load and cache registry models from models.pb
   */
  private loadRegistryModels(): ProtoModelConfig[] {
    if (this.registryModels) return this.registryModels

    try {
      const dataPath = this.getRegistryDataPath()
      const data = readModelRegistry(join(dataPath, 'models.pb'))
      const models = data.models ?? []
      this.registryModels = models
      logger.info('Loaded registry models', { count: models.length })
      return models
    } catch (error) {
      logger.warn('Failed to load registry models.pb', { error })
      return []
    }
  }

  /**
   * Load and cache provider-model overrides from provider-models.pb
   */
  private loadProviderModels(): ProtoProviderModelOverride[] {
    if (this.registryProviderModels) return this.registryProviderModels

    try {
      const dataPath = this.getRegistryDataPath()
      const data = readProviderModelRegistry(join(dataPath, 'provider-models.pb'))
      const overrides = data.overrides ?? []
      this.registryProviderModels = overrides
      logger.info('Loaded registry provider-models', { count: overrides.length })
      return overrides
    } catch (error) {
      logger.warn('Failed to load registry provider-models.pb', { error })
      return []
    }
  }

  /**
   * Load and cache registry providers from providers.pb
   */
  private loadRegistryProviders(): ProtoProviderConfig[] {
    if (this.registryProviders) return this.registryProviders

    try {
      const dataPath = this.getRegistryDataPath()
      const data = readProviderRegistry(join(dataPath, 'providers.pb'))
      const providers = data.providers ?? []
      this.registryProviders = providers
      return providers
    } catch (error) {
      logger.warn('Failed to load registry providers.pb', { error })
      return []
    }
  }

  /**
   * Get provider reasoning config from registry data.
   */
  private getRegistryReasoningConfig(providerId: string): {
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  } {
    const providers = this.loadRegistryProviders()
    const provider = providers.find((p) => p.id === providerId)
    const endpointConfigs = provider ? buildEndpointConfigsFromProto(provider) : null

    return {
      defaultChatEndpoint: provider?.defaultChatEndpoint,
      reasoningFormatTypes: extractReasoningFormatTypes(endpointConfigs)
    }
  }

  /**
   * Get provider reasoning config, preferring persisted provider data when available.
   */
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

      return {
        defaultChatEndpoint,
        reasoningFormatTypes
      }
    }

    return registryConfig
  }

  /**
   * Initialize models for a specific provider
   *
   * Reads registry data, merges configurations, and writes to SQLite.
   *
   * @param providerId - The provider ID to initialize models for
   */
  async initializeProvider(providerId: string): Promise<Model[]> {
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()
    const { defaultChatEndpoint, reasoningFormatTypes } = await this.getEffectiveReasoningConfig(providerId)

    // Find all overrides for this provider
    const overrides = providerModels.filter((pm) => pm.providerId === providerId)

    if (overrides.length === 0) {
      logger.info('No registry overrides found for provider', { providerId })
      return []
    }

    // Build a map of registry models by ID for fast lookup
    const modelMap = new Map<string, ProtoModelConfig>()
    for (const model of registryModels) {
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

      // Merge: no user override (null), registry override, preset model
      const merged = mergeModelConfig(null, override, baseModel, providerId, reasoningFormatTypes, defaultChatEndpoint)
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

    logger.info('Initialized provider models from registry', {
      providerId,
      count: mergedModels.length
    })

    return mergedModels
  }

  /**
   * Get registry preset models for a provider (read-only, no DB writes).
   */
  getRegistryModelsByProvider(providerId: string): Model[] {
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()
    const { defaultChatEndpoint, reasoningFormatTypes } = this.getRegistryReasoningConfig(providerId)

    const overrides = providerModels.filter((pm) => pm.providerId === providerId)
    if (overrides.length === 0) {
      return []
    }

    const modelMap = new Map<string, ProtoModelConfig>()
    for (const model of registryModels) {
      modelMap.set(model.id, model)
    }

    const mergedModels: Model[] = []
    for (const override of overrides) {
      const baseModel = modelMap.get(override.modelId) ?? null
      if (!baseModel) {
        continue
      }
      mergedModels.push(
        mergeModelConfig(null, override, baseModel, providerId, reasoningFormatTypes, defaultChatEndpoint)
      )
    }

    return mergedModels
  }

  /**
   * Initialize preset providers from registry into SQLite.
   *
   * Reads providers.pb, maps fields to NewUserProvider, and batch upserts.
   * Also seeds the cherryai provider which is not in providers.pb.
   */
  async initializePresetProviders(): Promise<void> {
    const dataPath = this.getRegistryDataPath()
    let rawProviders: ReturnType<typeof readProviderRegistry>['providers'] = []

    try {
      const data = readProviderRegistry(join(dataPath, 'providers.pb'))
      rawProviders = data.providers
    } catch (error) {
      logger.warn('Failed to load providers.pb for provider import', { error })
      return
    }

    const dbRows: NewUserProvider[] = rawProviders.map((p) => {
      // Map registry metadata.website to runtime websites field
      const registryWebsite = p.metadata?.website
      const websites =
        registryWebsite &&
        (registryWebsite.official || registryWebsite.docs || registryWebsite.apiKey || registryWebsite.models)
          ? {
              official: registryWebsite.official || undefined,
              docs: registryWebsite.docs || undefined,
              apiKey: registryWebsite.apiKey || undefined,
              models: registryWebsite.models || undefined
            }
          : null

      const apiFeatures = p.apiFeatures
        ? {
            arrayContent: p.apiFeatures.arrayContent,
            streamOptions: p.apiFeatures.streamOptions,
            developerRole: p.apiFeatures.developerRole,
            serviceTier: p.apiFeatures.serviceTier,
            verbosity: p.apiFeatures.verbosity,
            enableThinking: p.apiFeatures.enableThinking
          }
        : null

      // Build unified endpointConfigs from proto baseUrls + modelsApiUrls + reasoningFormat
      const endpointConfigs = buildEndpointConfigsFromProto(p)

      return {
        providerId: p.id,
        presetProviderId: p.id,
        name: p.name,
        endpointConfigs,
        defaultChatEndpoint: p.defaultChatEndpoint ?? null,
        apiFeatures,
        websites
      }
    })

    dbRows.push({
      providerId: 'cherryai',
      name: 'CherryAI',
      endpointConfigs: {
        [EndpointType.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.cherry-ai.com'
        }
      },
      defaultChatEndpoint: EndpointType.OPENAI_CHAT_COMPLETIONS
    })

    await providerService.batchUpsert(dbRows)

    logger.info('Initialized preset providers from registry', { count: dbRows.length })
  }

  /**
   * Initialize all preset providers from registry
   *
   * Seeds provider configurations and enriches existing user models with registry data.
   */
  private async initializeAllPresetProviders(): Promise<void> {
    await this.initializePresetProviders()
    await this.enrichExistingModels()

    logger.info('Initialized all preset providers and enriched existing models')
  }

  /**
   * Enrich existing user models with registry data
   *
   * For each user model that has a presetModelId, looks up the registry model
   * and updates capabilities, modalities, contextWindow, maxOutputTokens,
   * reasoning, pricing, etc.
   *
   * This bridges the gap between:
   * - Migration: inserts user models with null registry fields
   * - Registry: has rich model metadata (capabilities, limits, pricing)
   *
   * Uses presetModelId to match user models to registry models.
   */
  async enrichExistingModels(): Promise<void> {
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()

    if (registryModels.length === 0) {
      logger.warn('No registry models loaded, skipping model enrichment')
      return
    }

    // Build lookup maps
    const modelMap = new Map<string, ProtoModelConfig>()
    for (const m of registryModels) {
      modelMap.set(m.id, m)
    }

    const overridesByProvider = new Map<string, Map<string, ProtoProviderModelOverride>>()
    for (const pm of providerModels) {
      let providerMap = overridesByProvider.get(pm.providerId)
      if (!providerMap) {
        providerMap = new Map()
        overridesByProvider.set(pm.providerId, providerMap)
      }
      providerMap.set(pm.modelId, pm)
    }

    // Query all user models that have a presetModelId
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
      const presetModel = modelMap.get(presetModelId)

      if (!presetModel) {
        skippedCount++
        continue
      }

      const providerOverrides = overridesByProvider.get(row.providerId)
      const registryOverride = providerOverrides?.get(presetModelId) ?? null
      const providerConfig = providerConfigMap.get(row.providerId)
      const registryReasoningConfig = this.getRegistryReasoningConfig(row.providerId)
      const defaultChatEndpoint = providerConfig?.defaultChatEndpoint ?? registryReasoningConfig.defaultChatEndpoint
      const reasoningFormatTypes =
        extractReasoningFormatTypes(providerConfig?.endpointConfigs) ?? registryReasoningConfig.reasoningFormatTypes

      // Merge registry data with user data
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

  /**
   * Look up registry data for a single model
   *
   * Returns the preset base model and provider-level override (if any).
   * Used by ModelService.create to auto-enrich models at save time.
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
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()

    const presetModel = registryModels.find((m) => m.id === modelId) ?? null
    const registryOverride = providerModels.find((pm) => pm.providerId === providerId && pm.modelId === modelId) ?? null
    const reasoningConfig = await this.getEffectiveReasoningConfig(providerId)

    return { presetModel, registryOverride, ...reasoningConfig }
  }

  /**
   * Resolve raw model entries against registry data
   *
   * For each raw entry, looks up registry preset + provider override
   * and produces an enriched Model via mergeModelConfig.
   * Models not found in registry are returned with minimal data.
   *
   * Used by the renderer to display enriched models in ManageModelsPopup
   * before the user adds them.
   */
  async resolveModels(
    providerId: string,
    rawModels: Array<{
      modelId: string
      name?: string
      group?: string
      description?: string
      endpointTypes?: number[]
    }>
  ): Promise<Model[]> {
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()
    const { defaultChatEndpoint, reasoningFormatTypes } = await this.getEffectiveReasoningConfig(providerId)

    // Build lookup maps
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
          // Registry match found — merge with preset data
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
          // No registry match — return as custom model (no presetModelId)
          results.push(mergeModelConfig({ ...userRow, presetModelId: null }, null, null, providerId))
        }
      } catch (error) {
        logger.warn('Failed to resolve model', { providerId, modelId: raw.modelId, error })
      }
    }

    return results
  }

  /**
   * Clear cached registry data
   */
  clearCache(): void {
    this.registryModels = null
    this.registryProviderModels = null
    this.registryProviders = null
  }
}
