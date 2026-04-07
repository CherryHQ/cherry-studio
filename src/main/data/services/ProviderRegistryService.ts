/**
 * Registry Service - imports registry data into SQLite
 *
 * Responsible for:
 * - Reading registry JSON files (models.json, provider-models.json, providers.json)
 * - Merging configurations using mergeModelConfig/mergeProviderConfig
 * - Writing resolved data to user_model / user_provider tables
 *
 * Managed by the lifecycle system. Seeds preset data during onInit.
 */

import { join } from 'node:path'

import type {
  ProtoModelConfig,
  ProtoProviderConfig,
  ProtoProviderModelOverride,
  RegistryEndpointConfig
} from '@cherrystudio/provider-registry'
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

/**
 * Convert registry endpointConfigs (with reasoningFormat discriminated union)
 * to runtime endpointConfigs (with reasoningFormatType string).
 */
function buildRuntimeEndpointConfigs(
  registryConfigs: Record<string, RegistryEndpointConfig> | undefined
): Partial<Record<EndpointType, EndpointConfig>> | null {
  if (!registryConfigs || Object.keys(registryConfigs).length === 0) return null

  const configs: Partial<Record<EndpointType, EndpointConfig>> = {}

  for (const [k, regConfig] of Object.entries(registryConfigs)) {
    const ep = k as EndpointType
    const config: EndpointConfig = {}

    if (regConfig.baseUrl) config.baseUrl = regConfig.baseUrl
    if (regConfig.modelsApiUrls) config.modelsApiUrls = regConfig.modelsApiUrls
    if (regConfig.reasoningFormat?.type)
      config.reasoningFormatType = regConfig.reasoningFormat.type as ReasoningFormatType

    if (Object.keys(config).length > 0) configs[ep] = config
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
    await this.initializeAllPresetProviders()
  }

  protected onDestroy(): void {
    this.clearCache()
  }

  private getRegistryDataPath(): string {
    if (isDev) {
      return join(__dirname, '..', '..', 'packages', 'provider-registry', 'data')
    }
    return join(process.resourcesPath, 'packages', 'provider-registry', 'data')
  }

  private loadRegistryModels(): ProtoModelConfig[] {
    if (this.registryModels) return this.registryModels

    try {
      const dataPath = this.getRegistryDataPath()
      const data = readModelRegistry(join(dataPath, 'models.json'))
      const models = data.models ?? []
      this.registryModels = models
      logger.info('Loaded registry models', { count: models.length })
      return models
    } catch (error) {
      logger.warn('Failed to load registry models.json', { error })
      return []
    }
  }

  private loadProviderModels(): ProtoProviderModelOverride[] {
    if (this.registryProviderModels) return this.registryProviderModels

    try {
      const dataPath = this.getRegistryDataPath()
      const data = readProviderModelRegistry(join(dataPath, 'provider-models.json'))
      const overrides = data.overrides ?? []
      this.registryProviderModels = overrides
      logger.info('Loaded registry provider-models', { count: overrides.length })
      return overrides
    } catch (error) {
      logger.warn('Failed to load registry provider-models.json', { error })
      return []
    }
  }

  private loadRegistryProviders(): ProtoProviderConfig[] {
    if (this.registryProviders) return this.registryProviders

    try {
      const dataPath = this.getRegistryDataPath()
      const data = readProviderRegistry(join(dataPath, 'providers.json'))
      const providers = data.providers ?? []
      this.registryProviders = providers
      return providers
    } catch (error) {
      logger.warn('Failed to load registry providers.json', { error })
      return []
    }
  }

  private getRegistryReasoningConfig(providerId: string): {
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  } {
    const providers = this.loadRegistryProviders()
    const provider = providers.find((p) => p.id === providerId)
    const endpointConfigs = provider ? buildRuntimeEndpointConfigs(provider.endpointConfigs) : null

    return {
      defaultChatEndpoint: provider?.defaultChatEndpoint,
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

  async initializeProvider(providerId: string): Promise<Model[]> {
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()
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

  getRegistryModelsByProvider(providerId: string): Model[] {
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()
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

  async initializePresetProviders(): Promise<void> {
    const dataPath = this.getRegistryDataPath()
    let rawProviders: ReturnType<typeof readProviderRegistry>['providers'] = []

    try {
      const data = readProviderRegistry(join(dataPath, 'providers.json'))
      rawProviders = data.providers
    } catch (error) {
      logger.warn('Failed to load providers.json for provider import', { error })
      return
    }

    const dbRows: NewUserProvider[] = rawProviders.map((p) => {
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

      const endpointConfigs = buildRuntimeEndpointConfigs(p.endpointConfigs)

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

  private async initializeAllPresetProviders(): Promise<void> {
    await this.initializePresetProviders()
    await this.enrichExistingModels()

    logger.info('Initialized all preset providers and enriched existing models')
  }

  async enrichExistingModels(): Promise<void> {
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()

    if (registryModels.length === 0) {
      logger.warn('No registry models loaded, skipping model enrichment')
      return
    }

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
    const registryModels = this.loadRegistryModels()
    const providerModels = this.loadProviderModels()
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
        logger.warn('Failed to resolve model', { providerId, modelId: raw.modelId, error })
      }
    }

    return results
  }

  clearCache(): void {
    this.registryModels = null
    this.registryProviderModels = null
    this.registryProviders = null
  }
}
