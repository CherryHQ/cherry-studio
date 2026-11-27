import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, Provider } from '@shared/data/types/provider'

type ProviderExportSettings = Pick<
  Provider['settings'],
  'streamOptions' | 'apiVersion' | 'cacheControl' | 'keepAliveTime' | 'rateLimit' | 'timeout' | 'extraHeaders'
>

type ProviderExportModel = Pick<
  Model,
  | 'id'
  | 'providerId'
  | 'apiModelId'
  | 'presetModelId'
  | 'name'
  | 'description'
  | 'group'
  | 'family'
  | 'ownedBy'
  | 'capabilities'
  | 'inputModalities'
  | 'outputModalities'
  | 'contextWindow'
  | 'maxOutputTokens'
  | 'maxInputTokens'
  | 'endpointTypes'
  | 'supportsStreaming'
  | 'reasoning'
  | 'supportsFastMode'
  | 'requestControls'
  | 'parameterSupport'
  | 'pricing'
  | 'isEnabled'
  | 'isHidden'
  | 'isDeprecated'
  | 'replaceWith'
>

type ProviderExportEntry = Pick<
  Provider,
  | 'id'
  | 'presetProviderId'
  | 'name'
  | 'logo'
  | 'description'
  | 'endpointConfigs'
  | 'defaultChatEndpoint'
  | 'modelListSource'
  | 'authMethods'
  | 'authOptional'
  | 'reportedCostCurrency'
  | 'reportsActualCost'
  | 'fastMode'
  | 'authType'
  | 'isEnabled'
> & {
  apiKeys: ApiKeyEntry[]
  authConfig: AuthConfig | null
  settings: ProviderExportSettings
  models: ProviderExportModel[]
}

type ProviderExportPayload = {
  version: 1
  providers: ProviderExportEntry[]
}

function projectSettings(settings: Provider['settings']): ProviderExportSettings {
  return {
    streamOptions: settings.streamOptions,
    apiVersion: settings.apiVersion,
    cacheControl: settings.cacheControl,
    keepAliveTime: settings.keepAliveTime,
    rateLimit: settings.rateLimit,
    timeout: settings.timeout,
    extraHeaders: settings.extraHeaders
  }
}

function projectModel(model: Model): ProviderExportModel {
  return {
    id: model.id,
    providerId: model.providerId,
    apiModelId: model.apiModelId,
    presetModelId: model.presetModelId,
    name: model.name,
    description: model.description,
    group: model.group,
    family: model.family,
    ownedBy: model.ownedBy,
    capabilities: model.capabilities,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    maxInputTokens: model.maxInputTokens,
    endpointTypes: model.endpointTypes,
    supportsStreaming: model.supportsStreaming,
    reasoning: model.reasoning,
    supportsFastMode: model.supportsFastMode,
    requestControls: model.requestControls,
    parameterSupport: model.parameterSupport,
    pricing: model.pricing,
    isEnabled: model.isEnabled,
    isHidden: model.isHidden,
    isDeprecated: model.isDeprecated,
    replaceWith: model.replaceWith
  }
}

/** Build the versioned credential-bearing payload a paired mobile device can import. */
export function getProviderExportPayload(): ProviderExportPayload {
  const providers = providerService.list({ enabled: true }).map<ProviderExportEntry>((provider) => ({
    id: provider.id,
    presetProviderId: provider.presetProviderId,
    name: provider.name,
    logo: provider.logo,
    description: provider.description,
    endpointConfigs: provider.endpointConfigs,
    defaultChatEndpoint: provider.defaultChatEndpoint,
    modelListSource: provider.modelListSource,
    authMethods: provider.authMethods,
    authOptional: provider.authOptional,
    reportedCostCurrency: provider.reportedCostCurrency,
    reportsActualCost: provider.reportsActualCost,
    fastMode: provider.fastMode,
    apiKeys: providerService.getApiKeys(provider.id, { enabled: true }),
    authConfig: providerService.getAuthConfig(provider.id),
    authType: provider.authType,
    settings: projectSettings(provider.settings),
    isEnabled: provider.isEnabled,
    models: modelService.list({ providerId: provider.id, enabled: true }).map(projectModel)
  }))

  return { version: 1, providers }
}
